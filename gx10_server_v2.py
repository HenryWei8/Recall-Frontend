"""
GX10 server v2 — accepts raw video uploads, extracts frames with cv2,
runs MonoGS, and serves results.

Run from inside the MonoGS directory:
  MONOGS_DIR=$(pwd) python gx10_server_v2.py
"""

import json
import math
import os
import signal
import sqlite3
import subprocess
import threading
import uuid
import zipfile
from datetime import datetime
from pathlib import Path

import cv2
import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

MONOGS_DIR = Path(os.environ.get("MONOGS_DIR", Path(__file__).parent))
JOBS_DIR   = Path(os.environ.get("JOBS_DIR",   "/tmp/monogs_jobs"))
PYTHON_BIN = Path(os.environ.get("PYTHON_BIN", Path(__file__).parent.parent / "monogs_env" / "bin" / "python"))
DB_PATH    = JOBS_DIR / "jobs.db"
JOBS_DIR.mkdir(parents=True, exist_ok=True)

gpu_lock = threading.Semaphore(1)
_db_lock = threading.Lock()


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def _get_db():
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def _init_db():
    with _db_lock:
        conn = _get_db()
        conn.execute("""
            CREATE TABLE IF NOT EXISTS jobs (
                id         TEXT PRIMARY KEY,
                title      TEXT,
                status     TEXT,
                log        TEXT,
                error      TEXT,
                ply_path   TEXT,
                thumb_path TEXT,
                created_at TEXT
            )
        """)
        conn.commit()
        conn.close()


_init_db()


def _update_job(job_id: str, **kwargs):
    with _db_lock:
        conn = _get_db()
        sets   = ", ".join(f"{k} = ?" for k in kwargs)
        values = list(kwargs.values()) + [job_id]
        conn.execute(f"UPDATE jobs SET {sets} WHERE id = ?", values)
        conn.commit()
        conn.close()


def _get_job(job_id: str):
    conn = _get_db()
    row  = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    conn.close()
    return row


def _job_to_memory(row) -> dict:
    job_id = row["id"]
    return {
        "id":           job_id,
        "title":        row["title"] or job_id,
        "plyUrl":       f"/api/ply/{job_id}",
        "thumbnailUrl": f"/api/thumbnail/{job_id}",
        "posterUrl":    f"/api/thumbnail/{job_id}",
        "position":     None,
        "createdAt":    row["created_at"],
    }


# ---------------------------------------------------------------------------
# Video → frames
# ---------------------------------------------------------------------------

def _extract_frames(video_path: Path, dataset_dir: Path,
                    fps: float, max_short: int,
                    cal_override: dict | None) -> dict:
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {video_path}")

    orig_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    vid_w    = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    vid_h    = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    # Scale so the short side is at most max_short
    short = min(vid_w, vid_h)
    if short > max_short:
        s     = max_short / short
        out_w = int(vid_w * s) & ~1   # keep even for codec compat
        out_h = int(vid_h * s) & ~1
    else:
        out_w, out_h = vid_w, vid_h

    frame_interval = max(1, round(orig_fps / fps))
    rgb_dir = dataset_dir / "rgb"
    rgb_dir.mkdir()

    extracted: list[str] = []
    idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if idx % frame_interval == 0:
            resized    = cv2.resize(frame, (out_w, out_h), interpolation=cv2.INTER_AREA)
            frame_name = f"{len(extracted) + 1:010d}.jpg"
            cv2.imwrite(str(rgb_dir / frame_name), resized,
                        [cv2.IMWRITE_JPEG_QUALITY, 95])
            extracted.append(f"rgb/{frame_name}")
        idx += 1
    cap.release()

    if not extracted:
        raise ValueError("No frames extracted from video")

    # TUM rgb.txt
    lines = [f"{i / fps:.6f} {path}" for i, path in enumerate(extracted)]
    (dataset_dir / "rgb.txt").write_text("\n".join(lines))

    # Calibration — scale provided intrinsics to match extracted frame size
    if cal_override:
        src_w = float(cal_override.get("width",  vid_w) or vid_w)
        src_h = float(cal_override.get("height", vid_h) or vid_h)
        sx = out_w / src_w
        sy = out_h / src_h
        calibration = {
            "fx":       float(cal_override["fx"]) * sx,
            "fy":       float(cal_override["fy"]) * sy,
            "cx":       float(cal_override["cx"]) * sx,
            "cy":       float(cal_override["cy"]) * sy,
            "width":    out_w,
            "height":   out_h,
            "distorted": bool(cal_override.get("distorted", False)),
        }
    else:
        # Estimate assuming 70° horizontal FOV (matches frontend auto-detect)
        fov = 70 * math.pi / 180
        fx  = out_w / (2 * math.tan(fov / 2))
        calibration = {
            "fx": fx,   "fy": fx,
            "cx": out_w / 2, "cy": out_h / 2,
            "width":  out_w,
            "height": out_h,
            "distorted": False,
        }

    return calibration, extracted


# ---------------------------------------------------------------------------
# Dataset helpers
# ---------------------------------------------------------------------------

def _ensure_tum_files(dataset_dir: Path) -> None:
    rgb_txt   = dataset_dir / "rgb.txt"
    depth_txt = dataset_dir / "depth.txt"
    gt_txt    = dataset_dir / "groundtruth.txt"

    if not rgb_txt.exists():
        raise FileNotFoundError(f"rgb.txt missing from dataset at {dataset_dir}")

    lines = [l for l in rgb_txt.read_text().splitlines() if l and not l.startswith("#")]

    if not depth_txt.exists():
        depth_txt.write_text(
            "\n".join(f"{ts} {path}" for ts, path in (l.split(None, 1) for l in lines))
        )

    if not gt_txt.exists():
        rows = ["# timestamp tx ty tz qx qy qz qw"]
        for l in lines:
            ts = l.split()[0]
            rows.append(f"{ts} 0.0 0.0 0.0 0.0 0.0 0.0 1.0")
        gt_txt.write_text("\n".join(rows))


def _find_ply(results_dir: Path) -> Path | None:
    for name in ["point_cloud.ply", "scene.ply", "gaussian.ply", "rerun_compressed.ply"]:
        for f in results_dir.rglob(name):
            return f
    for f in results_dir.rglob("*.ply"):
        return f
    return None


def _find_thumbnail(dataset_dir: Path) -> Path | None:
    rgb_txt = dataset_dir / "rgb.txt"
    if not rgb_txt.exists():
        return None
    lines = [l for l in rgb_txt.read_text().splitlines() if l and not l.startswith("#")]
    if not lines:
        return None
    idx   = max(0, len(lines) // 4)
    parts = lines[idx].split(None, 1)
    if len(parts) < 2:
        return None
    img_path = dataset_dir / parts[1]
    return img_path if img_path.exists() else None


# ---------------------------------------------------------------------------
# Job runner
# ---------------------------------------------------------------------------

def _run(job_id: str, dataset_dir: Path, config_path: Path, results_dir: Path):
    _update_job(job_id, status="running")

    if not gpu_lock.acquire(blocking=False):
        _update_job(job_id, log="Waiting for GPU (another job is running)…")
        gpu_lock.acquire()

    try:
        torch_lib = str(
            PYTHON_BIN.parent.parent / "lib" / "python3.12"
            / "site-packages" / "torch" / "lib"
        )
        env = os.environ.copy()
        env["LD_LIBRARY_PATH"] = torch_lib + ":" + env.get("LD_LIBRARY_PATH", "")

        proc = subprocess.Popen(
            [str(PYTHON_BIN), "slam.py", "--config", str(config_path)],
            cwd=str(MONOGS_DIR),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            env=env,
            start_new_session=True,
        )

        tail: list[str] = []

        def _read_stdout():
            line_count = 0
            for line in proc.stdout:
                tail.append(line.rstrip())
                if len(tail) > 80:
                    tail.pop(0)
                line_count += 1
                if line_count % 10 == 0:
                    _update_job(job_id, log="\n".join(tail))
            _update_job(job_id, log="\n".join(tail))

        reader = threading.Thread(target=_read_stdout, daemon=True)
        reader.start()

        # Poll every 15s for results. MonoGS multiprocessing workers often
        # keep the process alive long after the PLY is written — don't wait
        # for a clean exit; finalize as soon as the output file appears.
        import time as _time
        MAX_WAIT = 7200  # 2-hour hard timeout
        POLL     = 15
        waited   = 0
        ply_path = None
        while proc.poll() is None and waited < MAX_WAIT:
            _time.sleep(POLL)
            waited += POLL
            ply_path = _find_ply(results_dir)
            if ply_path:
                break  # results are ready; kill workers below

        returncode = proc.poll() if proc.poll() is not None else -1

        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except (ProcessLookupError, OSError):
            pass
        reader.join(timeout=10)

        if ply_path is None:
            ply_path = _find_ply(results_dir)

        if ply_path:
            thumb_path = _find_thumbnail(dataset_dir)
            _update_job(
                job_id,
                status="done",
                ply_path=str(ply_path),
                thumb_path=str(thumb_path) if thumb_path else None,
            )
        else:
            _update_job(job_id, status="failed", error=f"slam.py exited with code {returncode} — no PLY produced")

    except Exception as exc:
        _update_job(job_id, status="failed", error=str(exc))
    finally:
        gpu_lock.release()


# ---------------------------------------------------------------------------
# API  (/api/* prefix — Vite proxy strips nothing, forwards path as-is)
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/api/memories")
async def api_memories():
    conn = _get_db()
    rows = conn.execute(
        "SELECT * FROM jobs WHERE status = 'done' ORDER BY created_at DESC"
    ).fetchall()
    conn.close()
    return [_job_to_memory(r) for r in rows]


@app.post("/api/submit")
async def api_submit(
    video:     UploadFile = File(...),
    title:     str   = Form(default=""),
    fps:       float = Form(default=5.0),
    max_short: int   = Form(default=480),
    fx:        str   = Form(default=""),
    fy:        str   = Form(default=""),
    cx:        str   = Form(default=""),
    cy:        str   = Form(default=""),
    width:     str   = Form(default=""),
    height:    str   = Form(default=""),
):
    job_id  = uuid.uuid4().hex[:8]
    job_dir = JOBS_DIR / job_id
    job_dir.mkdir(parents=True)

    # Save uploaded video
    video_path  = job_dir / f"input{Path(video.filename or 'video.mp4').suffix}"
    video_path.write_bytes(await video.read())

    dataset_dir = job_dir / "dataset"
    dataset_dir.mkdir()

    # Build calibration override from form fields if all are provided
    cal_override = None
    if all([fx, fy, cx, cy, width, height]):
        cal_override = {
            "fx": float(fx), "fy": float(fy),
            "cx": float(cx), "cy": float(cy),
            "width": int(width), "height": int(height),
        }

    try:
        calibration, _ = _extract_frames(
            video_path, dataset_dir, fps, max_short, cal_override
        )
    except Exception as e:
        raise HTTPException(400, f"Frame extraction failed: {e}")

    (dataset_dir / "calibration.json").write_text(json.dumps(calibration))
    _ensure_tum_files(dataset_dir)

    results_dir = job_dir / "results"
    results_dir.mkdir()
    base_cfg = MONOGS_DIR / "configs" / "mono" / "tum" / "base_config.yaml"

    config_yaml = f"""\
inherit_from: "{base_cfg}"

Dataset:
  dataset_path: "{dataset_dir}"
  Calibration:
    fx: {calibration['fx']}
    fy: {calibration['fy']}
    cx: {calibration['cx']}
    cy: {calibration['cy']}
    k1: 0.0
    k2: 0.0
    p1: 0.0
    p2: 0.0
    k3: 0.0
    width: {calibration['width']}
    height: {calibration['height']}
    distorted: false

Results:
  save_dir: "{results_dir}"
  save_results: True
  use_gui: False
  use_wandb: False
"""

    config_path = job_dir / "config.yaml"
    config_path.write_text(config_yaml)

    job_title = title.strip() or video.filename or f"Memory {job_id}"

    with _db_lock:
        conn = _get_db()
        conn.execute(
            "INSERT INTO jobs (id, title, status, log, error, ply_path, thumb_path, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (job_id, job_title, "queued", "", "", None, None, datetime.utcnow().isoformat()),
        )
        conn.commit()
        conn.close()

    threading.Thread(
        target=_run,
        args=(job_id, dataset_dir, config_path, results_dir),
        daemon=True,
    ).start()

    return {"job_id": job_id, "status": "queued"}


@app.get("/api/status/{job_id}")
async def api_status(job_id: str):
    row = _get_job(job_id)
    if not row:
        raise HTTPException(404, "Job not found")
    return {
        "job_id": job_id,
        "status": row["status"],
        "log":    row["log"]   or "",
        "error":  row["error"] or "",
    }


@app.get("/api/ply/{job_id}")
async def api_ply(job_id: str):
    row = _get_job(job_id)
    if not row:
        raise HTTPException(404, "Job not found")
    if row["status"] != "done":
        raise HTTPException(400, f"Job is '{row['status']}', not done yet")
    ply_path = row["ply_path"]
    if not ply_path or not Path(ply_path).exists():
        raise HTTPException(404, "PLY file not found")
    return FileResponse(ply_path, media_type="application/octet-stream",
                        filename=f"{job_id}.ply")


@app.get("/api/thumbnail/{job_id}")
async def api_thumbnail(job_id: str):
    row = _get_job(job_id)
    if not row:
        raise HTTPException(404, "Job not found")
    thumb_path = row["thumb_path"]
    if not thumb_path or not Path(thumb_path).exists():
        raise HTTPException(404, "Thumbnail not found")
    return FileResponse(thumb_path, media_type="image/jpeg")


@app.delete("/api/memories/{job_id}")
async def api_delete_memory(job_id: str):
    import shutil
    row = _get_job(job_id)
    if not row:
        raise HTTPException(404, "Not found")
    job_dir = JOBS_DIR / job_id
    if job_dir.exists():
        shutil.rmtree(job_dir, ignore_errors=True)
    conn = _get_db()
    conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
    conn.commit()
    conn.close()
    return {"deleted": job_id}


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8081
    print(f"\n  GX10 server v2  →  0.0.0.0:{port}")
    print(f"  MonoGS dir      →  {MONOGS_DIR}")
    print(f"  Jobs dir        →  {JOBS_DIR}")
    print(f"  DB              →  {DB_PATH}\n")
    uvicorn.run(app, host="0.0.0.0", port=port)
