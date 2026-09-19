// Ordinals are computed in code, because Jev cannot count, and written in words, because
// numeric forms are a documented weak spot. They follow what the user can see.

export type Box = { top: number; left: number; width: number; height: number };
export type Viewport = { width: number; height: number; insetTop?: number }; // insetTop: sticky header
export type Placement = 'visible' | 'above' | 'below';

// On screen means at least half of the box is inside the viewport.
export function placement(box: Box, vp: Viewport): Placement {
  const top = vp.insetTop ?? 0;
  const area = box.width * box.height;
  if (area > 0) {
    const w = Math.max(0, Math.min(box.left + box.width, vp.width) - Math.max(box.left, 0));
    const h = Math.max(0, Math.min(box.top + box.height, vp.height) - Math.max(box.top, top));
    if ((w * h) / area >= 0.5) return 'visible';
  }
  const centre = box.top + box.height / 2;
  return centre < (top + vp.height) / 2 ? 'above' : 'below';
}

const ONES = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth',
  'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth'];
const TENS = ['', '', 'twent', 'thirt', 'fort', 'fift', 'sixt', 'sevent', 'eight', 'ninet'];

export function ordinalWord(n: number): string {
  if (n >= 1 && n < 20) return ONES[n]!;
  if (n >= 20 && n < 100) {
    const tens = TENS[Math.floor(n / 10)]!;
    return n % 10 === 0 ? `${tens}ieth` : `${tens}y-${ONES[n % 10]}`;
  }
  return `number ${n}`;
}

// One string per sibling of a repeated collection, in reading order.
//   on screen:  "second visible (item 10 of 24 in Results)"
//   off screen: "off-screen below (item 14 of 24 in Results)"
// Only the visible ordinal is in words. The collection position is in digits on purpose: Jev reads
// literally, and "second of 24" on an off-screen row used to win "open the second one" (NOTES.md, M1).
export function describeOrdinals(placements: Placement[], group?: string): string[] {
  const total = placements.length;
  const where = group ? ` in ${group}` : '';
  let seen = 0;
  return placements.map((p, i) => {
    const position = `item ${i + 1} of ${total}${where}`;
    if (p !== 'visible') return `off-screen ${p} (${position})`;
    seen += 1;
    return `${ordinalWord(seen)} visible (${position})`;
  });
}
