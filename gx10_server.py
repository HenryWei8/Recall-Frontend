"""
GX10 server — receives frame payloads, runs MonoGS, returns results.

Run from inside the MonoGS directory:
  MONOGS_DIR=$(pwd) python gx10_server.py
"""

import json
import os
import signal
import subprocess
import threading
import uuid
import zipfile
from pathlib import Path

import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse

app = FastAPI()

MONOGS_DIR  = Path(os.environ.get("MONOGS_DIR",  Path(__file__).parent))
JOBS_DIR    = Path(os.environ.get("JOBS_DIR",   "/tmp/monogs_jobs"))
PYTHON_BIN  = Path(os.environ.get("PYTHON_BIN", Path(__file__).parent.parent / "monogs_env" / "bin" / "python"))
JOBS_DIR.mkdir(parents=True, exist_ok=True)

_gpu_lock = threading.Semaphore(1)
jobs: dict[str, dict] = {}


def _ensure_tum_files(dataset_dir: Path) -> None:
    """Generate missing TUM-format index files so TUMParser doesn't crash."""
    rgb_txt = dataset_dir / "rgb.txt"
    depth_txt = dataset_dir / "depth.txt"
    gt_txt = dataset_dir / "groundtruth.txt"

    if not rgb_txt.exists():
        raise FileNotFoundError(f"rgb.txt missing from dataset at {dataset_dir}")

    lines = [l for l in rgb_txt.read_text().splitlines() if l and not l.startswith("#")]

    # depth.txt: same timestamps, reuse the rgb paths (never opened in mono mode)
    if not depth_txt.exists():
        depth_txt.write_text(
            "\n".join(f"{ts} {path}" for ts, path in (l.split(None, 1) for l in lines))
        )

    # groundtruth.txt: identity pose for every frame
    if not gt_txt.exists():
        rows = ["# timestamp tx ty tz qx qy qz qw"]
        for l in lines:
            ts = l.split()[0]
            rows.append(f"{ts} 0.0 0.0 0.0 0.0 0.0 0.0 1.0")
        gt_txt.write_text("\n".join(rows))


def _run(job_id: str, dataset_dir: Path, config_path: Path, results_dir: Path):
    jobs[job_id]["status"] = "running"

    if not _gpu_lock.acquire(blocking=False):
        jobs[job_id]["log"] = "Waiting for GPU (another job is running)…"
        _gpu_lock.acquire()

    try:
        torch_lib = str(PYTHON_BIN.parent.parent / "lib" / "python3.12" /
                        "site-packages" / "torch" / "lib")
        env = os.environ.copy()
        env["LD_LIBRARY_PATH"] = torch_lib + ":" + env.get("LD_LIBRARY_PATH", "")

        proc = subprocess.Popen(
            [str(PYTHON_BIN), "slam.py", "--config", str(config_path)],
            cwd=str(MONOGS_DIR),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            env=env,
            start_new_session=True,  # own process group so we can kill children
        )

        tail: list[str] = []

        def _read_stdout():
            for line in proc.stdout:
                tail.append(line.rstrip())
                if len(tail) > 80:
                    tail.pop(0)
                jobs[job_id]["log"] = "\n".join(tail)

        reader = threading.Thread(target=_read_stdout, daemon=True)
        reader.start()

        proc.wait()  # returns as soon as slam.py main process exits
        jobs[job_id]["returncode"] = proc.returncode

        # mp worker children keep stdout open — kill the whole process group
        # so the reader thread unblocks and the pipe drains
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except (ProcessLookupError, OSError):
            pass
        reader.join(timeout=10)

        # Treat as success if results were written, even if mp cleanup caused non-zero exit
        has_results = any(results_dir.rglob("*.ply")) or any(results_dir.rglob("*.json"))

        if proc.returncode == 0 or has_results:
            zip_path = JOBS_DIR / job_id / "results.zip"
            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                for f in results_dir.rglob("*"):
                    if f.is_file():
                        zf.write(f, f.relative_to(results_dir))
            jobs[job_id]["results_zip"] = str(zip_path)
            jobs[job_id]["status"] = "done"
        else:
            jobs[job_id]["status"] = "failed"
            jobs[job_id]["error"]  = f"slam.py exited with code {proc.returncode}"

    except Exception as exc:
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["error"]  = str(exc)
    finally:
        _gpu_lock.release()


@app.post("/submit")
async def submit(payload: UploadFile = File(...)):
    job_id  = uuid.uuid4().hex[:8]
    job_dir = JOBS_DIR / job_id
    job_dir.mkdir(parents=True)

    zip_path    = job_dir / "payload.zip"
    dataset_dir = job_dir / "dataset"
    dataset_dir.mkdir()
    zip_path.write_bytes(await payload.read())

    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(dataset_dir)

    cal_file = dataset_dir / "calibration.json"
    if not cal_file.exists():
        raise HTTPException(400, "Payload missing calibration.json")
    cal = json.loads(cal_file.read_text())

    # TUMParser requires depth.txt — generate it from rgb.txt if absent.
    # In monocular mode MonoGS synthesises depth, so the paths are never opened.
    _ensure_tum_files(dataset_dir)

    results_dir  = job_dir / "results"
    results_dir.mkdir()
    base_cfg = MONOGS_DIR / "configs" / "mono" / "tum" / "base_config.yaml"

    config_yaml = f"""\
inherit_from: "{base_cfg}"

Dataset:
  dataset_path: "{dataset_dir}"
  Calibration:
    fx: {cal['fx']}
    fy: {cal['fy']}
    cx: {cal['cx']}
    cy: {cal['cy']}
    k1: {cal.get('k1', 0.0)}
    k2: {cal.get('k2', 0.0)}
    p1: {cal.get('p1', 0.0)}
    p2: {cal.get('p2', 0.0)}
    k3: {cal.get('k3', 0.0)}
    width: {cal['width']}
    height: {cal['height']}
    distorted: {str(cal.get('distorted', False)).lower()}

Results:
  save_dir: "{results_dir}"
  save_results: True
  use_gui: False
  use_wandb: False
"""

    config_path = job_dir / "config.yaml"
    config_path.write_text(config_yaml)

    jobs[job_id] = {
        "job_id":      job_id,
        "status":      "queued",
        "log":         "",
        "error":       "",
        "results_zip": None,
    }
    threading.Thread(
        target=_run,
        args=(job_id, dataset_dir, config_path, results_dir),
        daemon=True,
    ).start()

    return {"job_id": job_id, "status": "queued"}


@app.get("/status/{job_id}")
async def status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(404, "Job not found")
    j = jobs[job_id]
    return {
        "job_id": job_id,
        "status": j["status"],
        "log":    j.get("log", ""),
        "error":  j.get("error", ""),
    }


@app.get("/results/{job_id}")
async def results(job_id: str):
    if job_id not in jobs:
        raise HTTPException(404, "Job not found")
    j = jobs[job_id]
    if j["status"] != "done":
        raise HTTPException(400, f"Job is '{j['status']}', not done yet")
    zp = j.get("results_zip")
    if not zp or not Path(zp).exists():
        raise HTTPException(404, "Results archive not found")
    return FileResponse(zp, media_type="application/zip", filename=f"results_{job_id}.zip")


if __name__ == "__main__":
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8081
    print(f"\n  GX10 server  →  0.0.0.0:{port}")
    print(f"  MonoGS dir   →  {MONOGS_DIR}")
    print(f"  Jobs dir     →  {JOBS_DIR}\n")
    uvicorn.run(app, host="0.0.0.0", port=port)
