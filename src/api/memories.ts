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
