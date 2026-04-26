#!/usr/bin/env python3
"""
Pull all memories from the GX10 server into public/memories/ so the
frontend can be deployed statically (no backend needed to browse memories).

Usage:
    python3 scripts/sync-memories.py
    GX10_URL=http://10.30.199.103:8081 python3 scripts/sync-memories.py
    python3 scripts/sync-memories.py --gx10 http://192.168.1.50:8081

After running, commit the result:
    git add public/memories
    git commit -m "sync memories"
    git push
"""

import sys
import json
import os
import argparse
import urllib.request
import urllib.error
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_DIR   = REPO_ROOT / "public" / "memories"


def download(url: str, dest: Path) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            dest.write_bytes(r.read())
        return True
    except Exception as e:
        print(f"      ✗  {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Sync GX10 memories to public/memories/")
    parser.add_argument("--gx10", default=os.environ.get("GX10_URL", "http://10.30.199.103:8081"),
                        help="GX10 base URL (default: http://10.30.199.103:8081)")
    parser.add_argument("--skip-ply", action="store_true",
                        help="Only sync thumbnails + metadata, skip (large) PLY files")
    args = parser.parse_args()

    gx10 = args.gx10.rstrip("/")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"→ Fetching memory list from {gx10} …")
    try:
        with urllib.request.urlopen(f"{gx10}/api/memories", timeout=10) as r:
            memories = json.loads(r.read())
    except Exception as e:
        print(f"  ✗  Could not reach GX10: {e}")
        sys.exit(1)

    print(f"  Found {len(memories)} memories.\n")

    index = []
    for mem in memories:
        mid   = mem["id"]
        title = mem.get("title", mid)
        print(f"  [{mid}]  {title}")

        # thumbnail
        thumb_path = OUT_DIR / f"{mid}.jpg"
        ok_thumb = download(f"{gx10}/api/thumbnail/{mid}", thumb_path)
        print(f"      thumbnail  {'✓' if ok_thumb else '✗'}")

        # PLY
        ply_path = OUT_DIR / f"{mid}.ply"
        if args.skip_ply:
            ok_ply = ply_path.exists()
            print(f"      PLY        {'✓ (already present)' if ok_ply else 'skipped'}")
        else:
            print(f"      PLY        downloading …", end="", flush=True)
            ok_ply = download(f"{gx10}/api/ply/{mid}", ply_path)
            if ok_ply:
                kb = ply_path.stat().st_size // 1024
                print(f"\r      PLY        ✓  ({kb} KB)        ")
            else:
                print()

        index.append({
            "id":           mid,
            "title":        title,
            "plyUrl":       f"/memories/{mid}.ply" if ok_ply else mem.get("plyUrl", ""),
            "thumbnailUrl": f"/memories/{mid}.jpg" if ok_thumb else mem.get("thumbnailUrl", ""),
            "posterUrl":    f"/memories/{mid}.jpg" if ok_thumb else mem.get("posterUrl", ""),
            "position":     mem.get("position"),
            "createdAt":    mem.get("createdAt", ""),
        })
        print()

    index_path = OUT_DIR / "index.json"
    index_path.write_text(json.dumps(index, indent=2))

    print(f"✓  Wrote {index_path.relative_to(REPO_ROOT)}")
    print()
    print("  Next steps:")
    print("    git add public/memories")
    print('    git commit -m "sync memories"')
    print("    git push")


if __name__ == "__main__":
    main()
