import { describe, expect, it } from 'vitest';
import { describeOrdinals, ordinalWord, placement, type Box, type Placement } from '../shared/ordinals';

const vp = { width: 1000, height: 800 };
const box = (top: number, height = 200): Box => ({ top, left: 100, width: 200, height });

describe('placement: on screen means at least half visible', () => {
  it('counts a fully visible box as visible', () => expect(placement(box(100), vp)).toBe('visible'));
  it('counts a box that is exactly half inside as visible', () => expect(placement(box(-100), vp)).toBe('visible'));
  it('marks a box that is mostly above as above', () => expect(placement(box(-150), vp)).toBe('above'));
  it('marks a box that is mostly below as below', () => expect(placement(box(750), vp)).toBe('below'));
  it('counts a control inside the sticky header itself as visible', () => {
    // The search box lives in a 67 px sticky header. It is on screen wherever the page is scrolled to.
    const searchBox = { top: 14, left: 120, width: 260, height: 36 };
    expect(placement(searchBox, { ...vp, insetTop: 67 })).toBe('above'); // the bug: measured as page content
    expect(placement(searchBox, { ...vp, insetTop: 67 }, true)).toBe('visible'); // pinned: measured against the viewport
  });
  it('treats the area under a sticky header as hidden', () => {
    expect(placement(box(0, 100), { ...vp, insetTop: 60 })).toBe('above');
    expect(placement(box(40, 100), { ...vp, insetTop: 60 })).toBe('visible');
  });
});

describe('ordinalWord', () => {
  it('writes ordinals in words', () => {
    expect([1, 2, 3, 10, 12, 20, 21, 24, 30, 40, 99].map(ordinalWord)).toEqual([
      'first', 'second', 'third', 'tenth', 'twelfth', 'twentieth', 'twenty-first', 'twenty-fourth', 'thirtieth', 'fortieth', 'ninety-ninth',
    ]);
  });
});

describe('describeOrdinals: ordinals follow what the user can see', () => {
  it('matches the collection position when the list starts at the top', () => {
    const out = describeOrdinals(['visible', 'visible', 'below'], 'Results');
    expect(out).toEqual([
      'first visible (item 1 of 3 in Results)',
      'second visible (item 2 of 3 in Results)',
      'off-screen below (item 3 of 3 in Results)',
    ]);
  });

  it('after a scroll, "the second one" is the second visible item, not #2 of the list', () => {
    // 24 products in 3 columns. Rows 1 to 3 have scrolled off the top; rows 4 and 5 are on screen.
    const placements: Placement[] = [
      ...Array<Placement>(9).fill('above'),
      ...Array<Placement>(6).fill('visible'),
      ...Array<Placement>(9).fill('below'),
    ];
    const out = describeOrdinals(placements, 'Results');
    expect(out[1]).toBe('off-screen above (item 2 of 24 in Results)');
    expect(out[9]).toBe('first visible (item 10 of 24 in Results)');
    expect(out[10]).toBe('second visible (item 11 of 24 in Results)');
    expect(out[15]).toBe('off-screen below (item 16 of 24 in Results)');
    // The word "second" appears on exactly one row: the second visible one. Jev matches words literally.
    expect(out.filter((s) => s.includes('second'))).toEqual([out[10]]);
  });

  it('works without a group label', () => {
    expect(describeOrdinals(['visible'])).toEqual(['first visible (item 1 of 1)']);
  });
});
