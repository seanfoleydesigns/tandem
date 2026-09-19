import { describe, expect, it } from 'vitest';
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
