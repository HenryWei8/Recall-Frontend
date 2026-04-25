"""
GX10 server — receives raw video from the browser, extracts frames with OpenCV,
runs MonoGS (slam.py), and serves the resulting gaussian-splat .ply files.

Start (from the MonoGS repo root so slam.py and configs/ are found):

    cd /home/asus/PROJECT/MonoGS
    nohup env MONOGS_DIR=$(pwd) \\
        /home/asus/PROJECT/monogs_env/bin/python /tmp/LAHacks/gx10_server_v2.py \\
        > /tmp/gx10_server_v2.log 2>&1 &

Or if this file lives inside the MonoGS directory already:

    cd /home/asus/PROJECT/MonoGS
    nohup /home/asus/PROJECT/monogs_env/bin/python gx10_server_v2.py \\
        > /tmp/gx10_server_v2.log 2>&1 &
"""

import json
import math
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import uuid
import zipfile
from contextlib import contextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

# All dirs / binaries configurable via env vars
MONOGS_DIR = Path(os.environ.get("MONOGS_DIR", str(Path(__file__).parent)))
JOBS_DIR   = Path(os.environ.get("JOBS_DIR",   "/tmp/monogs_jobs"))
PYTHON_BIN = os.environ.get("PYTHON_BIN", sys.executable)
DB_PATH    = JOBS_DIR / "jobs.db"
JOBS_DIR.mkdir(parents=True, exist_ok=True)

gpu_lock = threading.Semaphore(1)  # one MonoGS job at a time

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


# ── SQLite ────────────────────────────────────────────────────────────────────

def init_db():
    with sqlite3.connect(DB_PATH) as con:
        con.execute("""
            CREATE TABLE IF NOT EXISTS jobs (
                id         TEXT PRIMARY KEY,
                title      TEXT DEFAULT 'Memory',
                status     TEXT DEFAULT 'queued',
                log        TEXT DEFAULT '',
                error      TEXT DEFAULT '',
                ply_path   TEXT DEFAULT '',
                thumb_path TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        con.commit()


init_db()


@contextmanager
def db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    try:
        yield con
        con.commit()
    finally:
        con.close()


def db_set(job_id: str, **fields):
    sets = ", ".join(f"{k}=?" for k in fields)
    vals = list(fields.values()) + [job_id]
    with db() as con:
        con.execute(f"UPDATE jobs SET {sets} WHERE id=?", vals)


# ── Video / frame helpers ─────────────────────────────────────────────────────

def compute_scale(orig_w: int, orig_h: int, max_short: int):
    """Scale so the shorter edge equals max_short; keep even dimensions."""
    if orig_w <= orig_h:
        sw = max_short
        sh = round(orig_h * max_short / orig_w / 2) * 2
    else:
        sh = max_short
        sw = round(orig_w * max_short / orig_h / 2) * 2
    return sw, sh


def compute_intrinsics(orig_w, orig_h, scale_w, scale_h,
                       fx="", fy="", cx="", cy=""):
    if fx and fy and cx and cy:
        sx = scale_w / orig_w
        sy = scale_h / orig_h
        return float(fx) * sx, float(fy) * sy, float(cx) * sx, float(cy) * sy
    fov  = 70 * math.pi / 180
    fx_f = scale_w / (2 * math.tan(fov / 2))
    return fx_f, fx_f, scale_w / 2.0, scale_h / 2.0


def extract_frames_cv2(video_path: Path, target_fps: float,
                       scale_w: int, scale_h: int, rgb_dir: Path) -> int:
    import cv2
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    src_fps    = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_step = max(1, round(src_fps / target_fps))

    saved = idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if idx % frame_step == 0:
            resized = cv2.resize(frame, (scale_w, scale_h))
            cv2.imwrite(
                str(rgb_dir / f"{saved:010d}.jpg"),
                resized,
                [cv2.IMWRITE_JPEG_QUALITY, 95],
            )
            saved += 1
        idx += 1

    cap.release()
    return saved


# ── MonoGS job runner (background thread) ────────────────────────────────────

def _find_ply(results_dir: Path) -> str:
    for name in ("point_cloud.ply", "scene.ply", "gaussian.ply", "rerun_compressed.ply"):
        p = results_dir / name
        if p.exists():
            return str(p)
    for p in results_dir.rglob("*.ply"):
        return str(p)
    return ""


def run_job(job_id: str, dataset_dir: Path, results_dir: Path, cal: dict):
    results_dir.mkdir(parents=True, exist_ok=True)
    config_path = dataset_dir / "config.yaml"
    config_path.write_text(f"""
inherit_from: "{MONOGS_DIR}/configs/mono/tum/base_config.yaml"
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
    width:  {cal['width']}
    height: {cal['height']}
    depth_scale: {cal.get('depth_scale', 1.0)}
    distorted: {str(cal.get('distorted', False)).lower()}
Results:
  save_dir: "{results_dir}"
  save_results: True
  use_gui: False
  use_wandb: False
""")

    db_set(job_id, status="running", log="MonoGS starting…")

    with gpu_lock:
        try:
            proc = subprocess.Popen(
                [PYTHON_BIN, "slam.py", "--config", str(config_path)],
                cwd=str(MONOGS_DIR),
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            )
            log_lines: list[str] = []
            for line in proc.stdout:
                log_lines.append(line.rstrip())
                if len(log_lines) > 300:
                    log_lines.pop(0)
                db_set(job_id, log="\n".join(log_lines[-60:]))
            proc.wait()

            if proc.returncode != 0:
                raise RuntimeError(f"slam.py exited with code {proc.returncode}")

            ply_path = _find_ply(results_dir)
            if not ply_path:
                raise RuntimeError("No .ply file found in results")

            # Thumbnail: frame at 25% through the extracted sequence
            thumb_path = str(results_dir / "thumbnail.jpg")
            rgb_frames = sorted((dataset_dir / "rgb").glob("*.jpg"))
            if rgb_frames:
                shutil.copy(str(rgb_frames[len(rgb_frames) // 4]), thumb_path)

            db_set(job_id,
                   status="done",
                   ply_path=ply_path,
                   thumb_path=thumb_path,
                   log="\n".join(log_lines[-30:]))

        except Exception as exc:
            db_set(job_id, status="failed", error=str(exc))


# ── Shared video-upload logic ─────────────────────────────────────────────────

async def _ingest_video(
    video: UploadFile, title: str,
    fps: str, max_short: str,
    fx: str, fy: str, cx: str, cy: str,
    width: str, height: str,
) -> dict:
    import cv2

    job_id      = str(uuid.uuid4())
    job_dir     = JOBS_DIR / job_id
    dataset_dir = job_dir / "dataset"
    results_dir = job_dir / "results"
    rgb_dir     = dataset_dir / "rgb"
    dataset_dir.mkdir(parents=True)
    rgb_dir.mkdir()

    # Save raw video to disk
    video_path = job_dir / "input.video"
    video_path.write_bytes(await video.read())

    target_fps = float(fps) if fps else 5.0
    ms         = int(max_short) if max_short else 480

    # Probe native dimensions
    cap    = cv2.VideoCapture(str(video_path))
    orig_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    orig_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()

    if width and height:
        orig_w, orig_h = int(width), int(height)
    if orig_w == 0 or orig_h == 0:
        orig_w, orig_h = 1920, 1080

    scale_w, scale_h        = compute_scale(orig_w, orig_h, ms)
    fx_f, fy_f, cx_f, cy_f = compute_intrinsics(
        orig_w, orig_h, scale_w, scale_h, fx, fy, cx, cy
    )

    saved = extract_frames_cv2(video_path, target_fps, scale_w, scale_h, rgb_dir)
    if saved == 0:
        raise HTTPException(400, "No frames extracted — check video format or codec")

    # TUM-format rgb.txt
    with open(dataset_dir / "rgb.txt", "w") as f:
        for i in range(saved):
            f.write(f"{i / target_fps:.6f} rgb/{i:010d}.jpg\n")

    cal = {
        "fx": fx_f, "fy": fy_f, "cx": cx_f, "cy": cy_f,
        "width": scale_w, "height": scale_h,
        "k1": 0.0, "k2": 0.0, "p1": 0.0, "p2": 0.0, "k3": 0.0,
        "depth_scale": 1.0, "distorted": False,
    }
    (dataset_dir / "calibration.json").write_text(json.dumps(cal))

    mem_title = title or (video.filename or "memory").rsplit(".", 1)[0]
    with db() as con:
        con.execute(
            "INSERT INTO jobs (id, title, status) VALUES (?,?,?)",
            (job_id, mem_title, "queued"),
        )

    threading.Thread(
        target=run_job, args=(job_id, dataset_dir, results_dir, cal), daemon=True
    ).start()

    return {"job_id": job_id}


# ── Memory row serialiser ─────────────────────────────────────────────────────

def _row_to_memory(r) -> dict:
    return {
        "id":           r["id"],
        "title":        r["title"],
        "plyUrl":       f"/api/ply/{r['id']}",
        "thumbnailUrl": f"/api/thumbnail/{r['id']}",
        "posterUrl":    f"/api/thumbnail/{r['id']}",
        "position":     None,
        "createdAt":    r["created_at"],
    }


# ── /api/* routes (consumed by the Vite frontend) ────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/api/memories")
async def api_memories():
    with db() as con:
        rows = con.execute(
            "SELECT * FROM jobs WHERE status='done' ORDER BY created_at DESC"
        ).fetchall()
    return [_row_to_memory(r) for r in rows]


@app.post("/api/submit")
async def api_submit(
    video:     UploadFile = File(...),
    title:     str = Form(""),
    fps:       str = Form("5"),
    max_short: str = Form("480"),
    fx:        str = Form(""),
    fy:        str = Form(""),
    cx:        str = Form(""),
    cy:        str = Form(""),
    width:     str = Form(""),
    height:    str = Form(""),
):
    return await _ingest_video(
        video, title, fps, max_short, fx, fy, cx, cy, width, height
    )


@app.get("/api/status/{job_id}")
async def api_status(job_id: str):
    with db() as con:
        row = con.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Job not found")
    return {
        "job_id": row["id"],
        "status": row["status"],
        "log":    row["log"],
        "error":  row["error"],
    }


@app.get("/api/ply/{job_id}")
async def api_ply(job_id: str):
    with db() as con:
        row = con.execute("SELECT ply_path FROM jobs WHERE id=?", (job_id,)).fetchone()
    if not row or not row["ply_path"]:
        raise HTTPException(404, "PLY not found")
    p = Path(row["ply_path"])
    if not p.exists():
        raise HTTPException(404, "PLY missing from disk")
    return FileResponse(
        str(p),
        media_type="application/octet-stream",
        filename=f"scene_{job_id}.ply",
        headers={"Access-Control-Allow-Origin": "*"},
    )


@app.get("/api/thumbnail/{job_id}")
async def api_thumbnail(job_id: str):
    with db() as con:
        row = con.execute("SELECT thumb_path FROM jobs WHERE id=?", (job_id,)).fetchone()
    if not row or not row["thumb_path"]:
        raise HTTPException(404, "Thumbnail not found")
    p = Path(row["thumb_path"])
    if not p.exists():
        raise HTTPException(404, "Thumbnail missing from disk")
    return FileResponse(str(p), media_type="image/jpeg",
                        headers={"Access-Control-Allow-Origin": "*"})


@app.get("/api/results/{job_id}")
async def api_results(job_id: str):
    """Download .ply for a completed job (used by the drawer download button)."""
    with db() as con:
        row = con.execute(
            "SELECT ply_path, status FROM jobs WHERE id=?", (job_id,)
        ).fetchone()
    if not row or row["status"] != "done":
        raise HTTPException(404, "Results not ready")
    p = Path(row["ply_path"])
    if not p.exists():
        raise HTTPException(404, "PLY missing from disk")
    return FileResponse(str(p), media_type="application/octet-stream",
                        filename=f"scene_{job_id}.ply")


# ── Legacy routes (backward-compat with mac_server.py zip workflow) ───────────

@app.get("/memories")
async def legacy_memories():
    return await api_memories()


@app.post("/submit")
async def legacy_submit(payload: UploadFile = File(...)):
    """Accepts the zip bundle produced by mac_server.py."""
    job_id      = str(uuid.uuid4())
    job_dir     = JOBS_DIR / job_id
    dataset_dir = job_dir / "dataset"
    results_dir = job_dir / "results"
    dataset_dir.mkdir(parents=True)

    with tempfile.NamedTemporaryFile(delete=False, suffix=".zip") as tmp:
        tmp.write(await payload.read())
        tmp_path = tmp.name
    with zipfile.ZipFile(tmp_path) as zf:
        zf.extractall(dataset_dir)
    os.unlink(tmp_path)

    cal_file = dataset_dir / "calibration.json"
    if not cal_file.exists():
        raise HTTPException(400, "calibration.json missing from payload")
    cal = json.loads(cal_file.read_text())

    title = "Memory"
    meta_file = dataset_dir / "meta.json"
    if meta_file.exists():
        try:
            title = json.loads(meta_file.read_text()).get("title", "Memory") or "Memory"
        except Exception:
            pass

    with db() as con:
        con.execute(
            "INSERT INTO jobs (id, title, status) VALUES (?,?,?)",
            (job_id, title, "queued"),
        )

    threading.Thread(
        target=run_job, args=(job_id, dataset_dir, results_dir, cal), daemon=True
    ).start()
    return {"job_id": job_id}


@app.get("/status/{job_id}")
async def legacy_status(job_id: str):
    return await api_status(job_id)


@app.get("/ply/{job_id}")
async def legacy_ply(job_id: str):
    return await api_ply(job_id)


@app.get("/thumbnail/{job_id}")
async def legacy_thumbnail(job_id: str):
    return await api_thumbnail(job_id)


@app.get("/results/{job_id}")
async def legacy_results(job_id: str):
    return await api_results(job_id)


if __name__ == "__main__":
    print(f"\n  GX10 server  →  http://0.0.0.0:8081")
    print(f"  MonoGS dir   :  {MONOGS_DIR}")
    print(f"  Python bin   :  {PYTHON_BIN}")
    print(f"  Jobs dir     :  {JOBS_DIR}\n")
    uvicorn.run(app, host="0.0.0.0", port=8081)
