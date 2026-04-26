import type { Memory } from '../types';

/**
 * Load the baked-in memory list from public/memories/index.json.
 * This is the last-resort fallback: used only when OPFS cache is empty
 * AND the GX10 backend is unreachable (e.g. static deployment, no server).
 */
export async function loadStaticBundle(): Promise<Memory[]> {
  try {
    const res = await fetch('/memories/index.json');
    if (!res.ok) return [];
    const data: unknown = await res.json();
    return Array.isArray(data) ? (data as Memory[]) : [];
  } catch {
    return [];
  }
}
