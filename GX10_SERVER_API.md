# GX10 MonoGS Server — API Reference

The GX10 server (`gx10_server.py`) is a FastAPI service that receives RGB frame datasets from the Mac, runs MonoGS (monocular Gaussian Splatting SLAM), and returns the reconstruction results as a zip archive.

---

## Running the Server

```bash
cd /home/asus/PROJECT/MonoGS
MONOGS_DIR=$(pwd) /home/asus/PROJECT/monogs_env/bin/python gx10_server.py
# optional: pass a port number as the first argument (default: 8081)
MONOGS_DIR=$(pwd) /home/asus/PROJECT/monogs_env/bin/python gx10_server.py 8081
```

**Environment variables**

| Variable | Default | Purpose |
|---|---|---|
| `MONOGS_DIR` | directory of `gx10_server.py` | Root of the MonoGS repo |
| `JOBS_DIR` | `/tmp/monogs_jobs` | Where job files are stored |
| `PYTHON_BIN` | `../monogs_env/bin/python` | Python used to run `slam.py` |

The server listens on `0.0.0.0:8081` and accepts one SLAM job at a time (GPU-serialised via an internal semaphore).

---

## Endpoints

### `POST /submit`

Submit a new SLAM job.

**Request**

- Content-Type: `multipart/form-data`
- Field name: `payload`
- Field value: a `.zip` file

**Payload zip structure**

```
payload.zip
├── calibration.json        # required — camera intrinsics
├── rgb.txt                 # required — TUM-format frame index
├── rgb/
│   ├── 0000000001.jpg
│   ├── 0000000002.jpg
│   └── ...
├── depth.txt               # optional — auto-generated if absent
└── groundtruth.txt         # optional — auto-generated if absent
```

**`calibration.json` schema**

```json
{
  "fx": 458.654,
  "fy": 457.296,
  "cx": 367.215,
  "cy": 248.375,
  "k1": -0.28340811,
  "k2": 0.07395907,
  "p1": 0.00019359,
  "p2": 1.76187e-05,
  "k3": 0.0,
  "width": 752,
  "height": 480,
  "distorted": false
}
```

All distortion coefficients (`k1`–`k3`, `p1`, `p2`) and `distorted` are optional and default to `0.0` / `false`. `depth_scale` should be omitted — this server runs in monocular mode and synthesises depth internally.

**`rgb.txt` format** (TUM convention)

```
# Each line: <timestamp_seconds> <relative/path/to/image>
0.000000 rgb/0000000001.jpg
0.100000 rgb/0000000002.jpg
0.200000 rgb/0000000003.jpg
```

If `depth.txt` or `groundtruth.txt` are missing they are auto-generated:
- `depth.txt` — mirrors `rgb.txt` timestamps (depth is synthesised at runtime, files are never opened)
- `groundtruth.txt` — identity pose (`0 0 0 / 0 0 0 1`) for every frame

**Response** `200 OK`

```json
{
  "job_id": "a3f9c112",
  "status": "queued"
}
```

**Error responses**

| Code | Reason |
|---|---|
| `400` | Zip missing `calibration.json` |
| `400` | Zip missing `rgb.txt` |

---

### `GET /status/{job_id}`

Poll the status of a submitted job.

**Response** `200 OK`

```json
{
  "job_id": "a3f9c112",
  "status": "running",
  "log": "... last 80 lines of slam.py stdout ...",
  "error": ""
}
```

**`status` values**

| Value | Meaning |
|---|---|
| `queued` | Job accepted, waiting for GPU |
| `running` | `slam.py` is actively executing |
| `done` | SLAM finished successfully; results are ready |
| `failed` | `slam.py` exited non-zero or an internal error occurred |

When `status` is `failed`, the `error` field contains the error message and `log` contains the last lines of slam output for diagnosis.

**Error responses**

| Code | Reason |
|---|---|
| `404` | `job_id` not found (server was restarted, or ID is wrong) |

---

### `GET /results/{job_id}`

Download the results archive for a completed job.

**Response** `200 OK`

- Content-Type: `application/zip`
- Content-Disposition: `attachment; filename="results_<job_id>.zip"`
- Body: zip of everything MonoGS wrote to its `save_dir`

Typical contents of the results zip:

```
results_a3f9c112.zip
├── point_cloud/
│   └── iteration_<N>/
│       └── point_cloud.ply      # Gaussian splat point cloud
├── cameras.json                 # estimated camera poses
├── cfg_args                     # MonoGS config snapshot
└── ...
```

**Error responses**

| Code | Reason |
|---|---|
| `404` | `job_id` not found |
| `400` | Job exists but is not `done` yet (still queued/running/failed) |
| `404` | Job is done but results archive is missing from disk |

---

## Typical Client Flow

```
1.  POST /submit          → { job_id, status: "queued" }
2.  GET  /status/{job_id} → poll every 3 s until status == "done" or "failed"
3.  GET  /results/{job_id}→ download results.zip
```

```bash
# Example with curl

# 1. Submit
JOB=$(curl -s -X POST http://10.30.199.103:8081/submit \
  -F "payload=@payload.zip" | python3 -c "import sys,json; print(json.load(sys.stdin)['job_id'])")

# 2. Poll
while true; do
  STATUS=$(curl -s http://10.30.199.103:8081/status/$JOB | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
  echo "status: $STATUS"
  [ "$STATUS" = "done" ] || [ "$STATUS" = "failed" ] && break
  sleep 3
done

# 3. Download
curl -O http://10.30.199.103:8081/results/$JOB
```

---

## Concurrency & Queueing

The server accepts multiple `/submit` requests simultaneously but runs only **one SLAM job at a time** — the GPU semaphore blocks subsequent jobs until the current one finishes. Jobs do not time out; a stuck `slam.py` process will hold the GPU indefinitely. Restart the server (`fuser -k 8081/tcp`) to recover.

---

## Storage Layout

Each job gets its own directory under `JOBS_DIR`:

```
/tmp/monogs_jobs/
└── <job_id>/
    ├── payload.zip       # original upload
    ├── dataset/          # extracted frames + generated index files
    │   ├── calibration.json
    │   ├── rgb.txt
    │   ├── depth.txt     # generated if missing
    │   ├── groundtruth.txt
    │   └── rgb/
    ├── config.yaml       # per-job MonoGS config (auto-generated)
    ├── results/          # MonoGS output directory
    └── results.zip       # final archive (present when status == done)
```

Job data persists until the server is restarted or `/tmp` is cleared. There is no automatic cleanup.
