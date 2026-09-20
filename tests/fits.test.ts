import { describe, expect, it } from 'vitest';
import { fitsRequest } from '../server/decide';
import { FIT_POOL } from '../shared/config';
import { fitPool, rankFits } from '../shared/fits';
import type { ElementRow } from '../shared/types';

const card = (id: string, name: string, offscreen?: 'below'): ElementRow => ({ id, role: 'link', name, group: 'Results', ...(offscreen ? { offscreen } : {}) });
const rows: ElementRow[] = [
  { id: 'e1', role: 'checkbox', name: 'White', group: 'Colour' },
  card('e2', 'Court Classic White'), card('e3', 'Plaza Low White'), card('e4', 'Deck Runner Navy'),
  card('e5', 'Halo White', 'below'),
  { id: 'e6', role: 'link', name: 'Boots', group: 'Categories' },
];

describe('fitPool', () => {
  it('asks only about candidates with the same role and group as the preferred one', () => {
    expect(fitPool(rows, rows[1]!, ['e2']).map((r) => r.id)).toEqual(['e2', 'e3', 'e4', 'e5']);
  });
  it('keeps visible candidates first when it has to cap, and stays in reading order', () => {
    expect(fitPool(rows, rows[1]!, ['e2'], 3).map((r) => r.id)).toEqual(['e2', 'e3', 'e4']);
  });
});

describe('fitPool on a dense page', () => {
  // Hacker News: some 220 links, all role link, no group, so every one of them is "alike". The server takes FIT_POOL rows.
  const links: ElementRow[] = Array.from({ length: 227 }, (_, i) => ({ id: `e${i + 1}`, role: 'link', name: i === 217 ? 'More' : `story ${i + 1}` }));
  it('never asks about more candidates than the server accepts, and the preferred row is always one of them', () => {
    for (const anchor of [links[0]!, links[39]!, links[40]!, links[217]!]) {
      const pool = fitPool(links, anchor, [anchor.id]);
      expect(pool).toHaveLength(FIT_POOL);
      expect(pool).toContain(anchor);
      expect(fitsRequest.safeParse({ utterance: 'click more', rows: pool }).success).toBe(true);
    }
  });
});

describe('rankFits', () => {
  it('keeps the candidates that fit; near-equal answers tie, visible first, then reading order', () => {
    const fits = { e1: 0.2, e2: 0.93, e3: 0.91, e4: 0.03, e5: 0.94 };
    expect(rankFits(rows.slice(0, 5), fits).map((r) => r.id)).toEqual(['e2', 'e3', 'e5']);
  });
  it('puts a clearly better fit first', () => {
    expect(rankFits(rows.slice(0, 5), { e2: 0.6, e3: 0.95 }).map((r) => r.id)).toEqual(['e3', 'e2']);
  });
  it('treats answers within 0.15 of the best as ties, in reading order', () => {
    expect(rankFits(rows.slice(0, 5), { e2: 0.72, e3: 0.59, e4: 0.68 }).map((r) => r.id)).toEqual(['e2', 'e3', 'e4']);
  });
});
