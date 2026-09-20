// Which snapshot rows get a seat when a page has more controls near the viewport than Jev can be shown. Pure.
// Real pages are dense: the Hacker News front page has 227 usable controls, 175 of them on screen at once. A plain
// cut in reading order threw away "More", at the bottom of the screen, while the user was looking at it.
import { MAX_ROWS } from './config';
import type { Placement } from './ordinals';

// At or under the cap: every row, the very same array (the demo store never gets near it). Over it: what is on
// screen first, then the rest, every tie in reading order; the rows kept are returned in reading order.
export function keepRows<T extends { place: Placement }>(rows: T[], cap: number = MAX_ROWS): T[] {
  if (rows.length <= cap) return rows;
  const kept = new Set([...rows.filter((r) => r.place === 'visible'), ...rows.filter((r) => r.place !== 'visible')].slice(0, cap));
  return rows.filter((r) => kept.has(r));
}
