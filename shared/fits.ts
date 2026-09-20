// Fit check helpers. Pure: which candidates to ask about, and how to rank the answers.
import { FIT_MIN, FIT_POOL } from './config';
import type { ElementRow } from './types';

// Candidates like the one the Choice preferred: same role and group. Always includes `must`, INSIDE the cap: the
// server refuses a longer list, and on a dense page (every Hacker News link is alike) the preferred row is rarely
// among the first forty.
export function fitPool(rows: ElementRow[], anchor: ElementRow, must: string[], cap: number = FIT_POOL): ElementRow[] {
  const alike = rows.filter((r) => must.includes(r.id) || (r.role === anchor.role && r.group === anchor.group));
  const visibleFirst = [...alike.filter((r) => !r.offscreen), ...alike.filter((r) => r.offscreen)];
  const kept = new Set(must);
  for (const r of visibleFirst) { if (kept.size >= cap) break; kept.add(r.id); }
  return rows.filter((r) => kept.has(r.id)); // reading order
}

// Candidates that fit. Those within FIT_TIE of the best answer count as equally good and keep
// reading order with visible rows first, so the badges land where the user expects. The rest follow by answer.
const FIT_TIE = 0.15;

export function rankFits(pool: ElementRow[], fits: Record<string, number>, min: number = FIT_MIN): ElementRow[] {
  const fitting = pool.filter((r) => (fits[r.id] ?? 0) >= min);
  const best = Math.max(0, ...fitting.map((r) => fits[r.id] ?? 0));
  const tied = fitting.filter((r) => (fits[r.id] ?? 0) >= best - FIT_TIE);
  const rest = fitting.filter((r) => !tied.includes(r)).sort((a, b) => (fits[b.id] ?? 0) - (fits[a.id] ?? 0));
  return [...tied.filter((r) => !r.offscreen), ...tied.filter((r) => r.offscreen), ...rest];
}
