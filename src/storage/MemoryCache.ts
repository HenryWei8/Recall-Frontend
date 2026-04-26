/**
 * Persistent local cache using the browser's Origin Private File System (OPFS).
 * PLY files and thumbnails are stored as binary files; metadata in localStorage.
 * Memories survive GX10 reboots and offline sessions.
 */
import type { Memory } from '../types';

const META_KEY = 'recall_v1';

interface CacheMeta {
  id: string;
  title: string;
  createdAt: string | null;
  plyOk:   boolean;
  thumbOk: boolean;
}

// ── localStorage metadata ─────────────────────────────────────────────────

function readMetas(): CacheMeta[] {
  try { return JSON.parse(localStorage.getItem(META_KEY) ?? '[]'); }
  catch { return []; }
}
function writeMetas(metas: CacheMeta[]) {
  try { localStorage.setItem(META_KEY, JSON.stringify(metas)); } catch { /* quota */ }
}

// ── OPFS helpers ──────────────────────────────────────────────────────────

async function getDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('recall', { create: true });
}

async function writeFile(dir: FileSystemDirectoryHandle, name: string, url: string): Promise<boolean> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return false;
    const buf = await resp.arrayBuffer();
    const fh  = await dir.getFileHandle(name, { create: true });
    const w   = await (fh as any).createWritable();
    await w.write(buf);
    await w.close();
    return true;
  } catch { return false; }
}

async function readBlobUrl(dir: FileSystemDirectoryHandle, name: string): Promise<string | null> {
  try {
    const fh   = await dir.getFileHandle(name);
    const file = await fh.getFile();
    return URL.createObjectURL(file);
  } catch { return null; }
}

// ── Public API ─────────────────────────────────────────────────────────────

/** Cache PLY + thumbnail for a memory. Fire-and-forget after job completes. */
export async function cacheMemory(memory: Memory): Promise<void> {
  if (!('storage' in navigator && 'getDirectory' in navigator.storage)) return;
  const dir = await getDir();
  const [plyOk, thumbOk] = await Promise.all([
    writeFile(dir, `${memory.id}.ply`,   memory.plyUrl),
    writeFile(dir, `${memory.id}.thumb`, memory.thumbnailUrl),
  ]);

  const metas = readMetas();
  const meta: CacheMeta = { id: memory.id, title: memory.title, createdAt: memory.createdAt ?? null, plyOk, thumbOk };
  const idx = metas.findIndex(m => m.id === memory.id);
  if (idx >= 0) metas[idx] = meta;
  else metas.unshift(meta);
  writeMetas(metas);
}

/** Load all cached memories, returning blob URLs so GX10 is not needed. */
export async function loadCachedMemories(): Promise<Memory[]> {
  if (!('storage' in navigator && 'getDirectory' in navigator.storage)) return [];
  const metas = readMetas();
  if (metas.length === 0) return [];

  const dir = await getDir();
  const results: Memory[] = [];

  for (const m of metas) {
    const plyUrl   = m.plyOk   ? (await readBlobUrl(dir, `${m.id}.ply`))   ?? `/api/ply/${m.id}`         : `/api/ply/${m.id}`;
    const thumbUrl = m.thumbOk ? (await readBlobUrl(dir, `${m.id}.thumb`)) ?? `/api/thumbnail/${m.id}`   : `/api/thumbnail/${m.id}`;
    results.push({
      id: m.id, title: m.title, createdAt: m.createdAt ?? '',
      plyUrl, thumbnailUrl: thumbUrl, posterUrl: thumbUrl, position: null,
    });
  }
  return results;
}

/**
 * Merge remote memories into local metadata.
 * Returns only the new ones (not yet in cache) so the gallery can add them.
 * Caches their files in the background.
 */
export function mergeAndCacheNew(remote: Memory[]): Memory[] {
  const known = new Set(readMetas().map(m => m.id));
  const fresh = remote.filter(m => !known.has(m.id));

  // add metadata stubs immediately so next load shows them
  if (fresh.length > 0) {
    const stubs: CacheMeta[] = fresh.map(m => ({
      id: m.id, title: m.title, createdAt: m.createdAt ?? null, plyOk: false, thumbOk: false,
    }));
    writeMetas([...stubs, ...readMetas()]);

    // download files in background
    (async () => {
      for (const m of fresh) await cacheMemory(m);
    })();
  }
  return fresh;
}

/** Update the title in local metadata (OPFS files don't store title). */
export function renameCachedMemory(id: string, title: string): void {
  const metas = readMetas().map(m => m.id === id ? { ...m, title } : m);
  writeMetas(metas);
}

/** Remove a memory from OPFS and metadata. */
export async function deleteCachedMemory(id: string): Promise<void> {
  if ('storage' in navigator && 'getDirectory' in navigator.storage) {
    const dir = await getDir();
    for (const name of [`${id}.ply`, `${id}.thumb`]) {
      try { await dir.removeEntry(name); } catch { /* not cached */ }
    }
  }
  writeMetas(readMetas().filter(m => m.id !== id));
}
