// @vitest-environment jsdom
// Dense real pages (trial fix 2). Found on Hacker News: 227 usable controls, 175 of them on screen, and the snapshot
// kept the first 120 in reading order, so "More" (row 218) was cut while the user was looking at it.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { takeSnapshot } from '../agent/snapshot';
import { decideRequest } from '../server/decide';
import { MAX_ROWS, MAX_WIDE_ROWS } from '../shared/config';
import { keepRows } from '../shared/keep';
import type { Placement } from '../shared/ordinals';

type Row = { i: number; place: Placement };
const rows = (places: Placement[]): Row[] => places.map((place, i) => ({ i, place }));
const fill = (n: number, place: Placement): Placement[] => Array.from({ length: n }, () => place);
const ascending = (kept: Row[]) => kept.every((r, k) => k === 0 || kept[k - 1]!.i < r.i);

describe('keepRows: who gets a seat when a page has more controls than the cap', () => {
  it('at or under the cap: the very same array, whatever is on screen (the demo store never gets near it)', () => {
    const store = rows([...fill(10, 'above'), ...fill(20, 'visible'), ...fill(30, 'below')]);
    expect(keepRows(store)).toBe(store);
    const exactly = rows(fill(MAX_ROWS, 'below'));
    expect(keepRows(exactly)).toBe(exactly);
  });

  it('Hacker News scrolled to the bottom (52 above, 175 on screen): all 227 rows are kept', () => {
    const hn = rows([...fill(52, 'above'), ...fill(175, 'visible')]);
    expect(keepRows(hn)).toBe(hn);
  });

  it('the same page under a smaller cap: everything on screen survives, "More" and the search box included', () => {
    const hn = rows([...fill(52, 'above'), ...fill(175, 'visible')]);
    const kept = keepRows(hn, 180);
    expect(kept).toHaveLength(180);
    expect(ascending(kept)).toBe(true); // still reading order
    expect(kept.filter((r) => r.place === 'visible')).toHaveLength(175);
    expect(kept.map((r) => r.i)).toEqual(expect.arrayContaining([217, 226])); // More, the search box
    expect(kept.filter((r) => r.place === 'above').map((r) => r.i)).toEqual([0, 1, 2, 3, 4]); // the rest: reading order
    expect(hn).toHaveLength(227); // the input is not touched
  });

  it('the top of a Wikipedia article (128 on screen, interleaved with 69 that are not): nothing on screen is cut', () => {
    const wiki = rows(Array.from({ length: 197 }, (_, i): Placement => (i < 138 && i % 2 === 1 ? 'below' : 'visible')));
    expect(wiki.filter((r) => r.place === 'visible')).toHaveLength(128);
    expect(wiki.slice(120).some((r) => r.place === 'visible')).toBe(true); // what the old cut lost
    expect(keepRows(wiki)).toBe(wiki); // under 240: all of it
    const kept = keepRows(wiki, 150);
    expect(kept.filter((r) => r.place === 'visible')).toHaveLength(128);
    expect(kept.filter((r) => r.place === 'below').map((r) => r.i)).toEqual(Array.from({ length: 22 }, (_, k) => 2 * k + 1)); // the first 22 of the rest
    expect(ascending(kept)).toBe(true);
  });

  it('more on screen than the cap: the first of them in reading order (the limit that remains)', () => {
    const kept = keepRows(rows(fill(300, 'visible')));
    expect(kept).toHaveLength(MAX_ROWS);
    expect(kept.at(-1)!.i).toBe(MAX_ROWS - 1);
  });
});

describe('takeSnapshot on a dense page', () => {
  let overlay: HTMLElement;

  beforeAll(() => {
    // jsdom has no layout: every element says where it is with data-top (20 px high, 100 px wide).
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const top = Number((this as HTMLElement).dataset?.top ?? 10);
      return { x: 10, y: top, left: 10, top, right: 110, bottom: top + 20, width: 100, height: 20, toJSON() {} } as DOMRect;
    };
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  });

  beforeEach(() => {
    document.body.innerHTML = '<div id="page"></div><div id="tandem"></div>';
    overlay = document.getElementById('tandem')!;
    (document as unknown as { elementsFromPoint: () => Element[] }).elementsFromPoint = () => [];
  });

  const link = (name: string, top: number) => `<a href="/${encodeURIComponent(name)}" data-top="${top}">${name}</a>`;
  const build = (html: string) => { document.getElementById('page')!.innerHTML = html; };
  const names = (wide = false) => takeSnapshot({ overlay, wide }).snapshot.rows.map((r) => `${r.role} ${r.name}`);

  // 60 links scrolled off above, 190 on screen, then "More" and a bare text field at the bottom of the screen: 252.
  const dense = () => build([
    ...Array.from({ length: 60 }, (_, i) => link(`old story ${i + 1}`, -300)),
    ...Array.from({ length: 190 }, (_, i) => link(`story ${i + 1}`, 100)),
    link('More', 700),
    '<input type="text" name="q" data-top="730">',
  ].join(''));

  it('keeps what is on screen: "More" and the field at the bottom survive, the oldest rows above give way', () => {
    dense();
    const kept = names();
    expect(kept).toHaveLength(MAX_ROWS);
    expect(kept).toContain('link More');
    expect(kept.at(-1)).toMatch(/^textbox/);
    expect(kept).toContain('link story 190');
    expect(kept).toContain('link old story 48'); // 240 - 192 on screen = 48 seats for the rest, in reading order
    expect(kept).not.toContain('link old story 49');
    expect(kept.indexOf('link old story 1')).toBeLessThan(kept.indexOf('link story 1')); // reading order kept
  });

  it('the row a kept id points at is the element itself', () => {
    dense();
    const snap = takeSnapshot({ overlay });
    const more = snap.snapshot.rows.find((r) => r.name === 'More')!;
    expect(snap.nodes.get(more.id)?.textContent).toBe('More');
  });

  it('housekeeping snapshots are as before: the first rows in reading order', () => {
    dense();
    const kept = names(true);
    expect(kept).toHaveLength(MAX_WIDE_ROWS);
    expect(kept[0]).toBe('link old story 1');
    expect(kept).not.toContain('link More');
  });

  it('150 controls in range: all 150, in document order (it used to be 120)', () => {
    build(Array.from({ length: 150 }, (_, i) => link(`item ${i + 1}`, 100)).join(''));
    const kept = names();
    expect(kept).toHaveLength(150);
    expect(kept[0]).toBe('link item 1');
    expect(kept.at(-1)).toBe('link item 150');
  });

  it('a page the size of the demo store: every row, in document order', () => {
    build(Array.from({ length: 60 }, (_, i) => link(`shoe ${i + 1}`, i < 30 ? 100 : 1200)).join(''));
    expect(names()).toEqual(Array.from({ length: 60 }, (_, i) => `link shoe ${i + 1}`));
  });
});

describe('the server accepts what the agent may now send', () => {
  const request = (n: number) => ({
    leash: 'single', utterance: 'click more',
    snapshot: { url: '/', title: 't', headings: [], notices: [], rows: Array.from({ length: n }, (_, i) => ({ id: `e${i}`, role: 'link', name: `row ${i}` })) },
  });
  it('MAX_ROWS rows pass, one more does not', () => {
    expect(decideRequest.safeParse(request(MAX_ROWS)).success).toBe(true);
    expect(decideRequest.safeParse(request(MAX_ROWS + 1)).success).toBe(false);
  });
});
