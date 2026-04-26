import type { Memory } from '../types';

const BASE = import.meta.env.VITE_API_BASE ?? '';

export async function fetchMemories(): Promise<Memory[]> {
  const res = await fetch(`${BASE}/api/memories`);
  if (!res.ok) throw new Error(`Failed to fetch memories: ${res.status}`);
  return res.json();
}

export async function submitMemory(formData: FormData): Promise<{ job_id: string }> {
  const res = await fetch(`${BASE}/api/submit`, { method: 'POST', body: formData });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function pollStatus(jobId: string): Promise<{
  job_id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  log: string;
  error: string;
}> {
  const res = await fetch(`${BASE}/api/status/${jobId}`);
  if (!res.ok) throw new Error(`Poll failed: ${res.status}`);
  return res.json();
}

export function plyUrl(jobId: string): string {
  return `${BASE}/api/ply/${jobId}`;
}

export function thumbnailUrl(jobId: string): string {
  return `${BASE}/api/thumbnail/${jobId}`;
}

export async function renameMemory(id: string, title: string): Promise<void> {
  const res = await fetch(`${BASE}/api/memories/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) console.warn('Rename failed:', res.status);
}

export interface PlyStats {
  splatCount: number;
  fileSizeBytes: number;
  shDegree: number;
}

export async function fetchPlyStats(url: string): Promise<PlyStats | null> {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-3071' } });
    if (!res.ok && res.status !== 206) return null;

    let fileSizeBytes = 0;
    const cr = res.headers.get('Content-Range');
    if (cr) {
      const m = cr.match(/\/(\d+)$/);
      if (m) fileSizeBytes = parseInt(m[1]);
    }
    if (!fileSizeBytes) {
      const cl = res.headers.get('Content-Length');
      if (cl) fileSizeBytes = parseInt(cl);
    }

    const bytes = await res.arrayBuffer();
    // PLY header is ASCII up to "end_header\n"
    const text = new TextDecoder('ascii').decode(new Uint8Array(bytes));
    const headerEnd = text.indexOf('end_header');
    const header = headerEnd >= 0 ? text.slice(0, headerEnd) : text;

    const vertMatch = header.match(/element vertex (\d+)/);
    const splatCount = vertMatch ? parseInt(vertMatch[1]) : 0;

    // Count f_rest_N properties to determine SH degree
    const fRestMatches = header.match(/property float f_rest_\d+/g);
    const fRestCount = fRestMatches ? fRestMatches.length : 0;
    // 0→deg0, 9→deg1, 24→deg2, 45→deg3
    const shDegree = fRestCount >= 45 ? 3 : fRestCount >= 24 ? 2 : fRestCount >= 9 ? 1 : 0;

    return { splatCount, fileSizeBytes, shDegree };
  } catch {
    return null;
  }
}
