// Score probe for the production wording. It sends fixed requests through the real routes of the running
// dev server (so it sees exactly what the agent sees) and saves every score, to compare before and after
// a rewording. It calls Jev, so it is a script, not a test.
//   npx tsx scripts/probe-heads.ts save before.json
//   npx tsx scripts/probe-heads.ts save after.json
//   npx tsx scripts/probe-heads.ts diff before.json after.json      prints every score that moved by more than 0.1
import { readFileSync, writeFileSync } from 'node:fs';
import products from '../store/src/data/products.json';
import { describeOrdinals, type Placement } from '../shared/ordinals';
import type { DecideRequest, DecideResponse, ElementRow, FitsResponse, Head, MatchResponse, SlateResponse, Snapshot } from '../shared/types';

const API = 'http://localhost:8787';
const MOVED = 0.1;
const title = (s: string) => s[0]!.toUpperCase() + s.slice(1);

// Rows shaped like the Footnote listing. `set` names the options that are on; `category` the current one.
function listing(set: string[] = [], category?: string): Snapshot {
  let id = 1;
  const row = (r: Omit<ElementRow, 'id'>): ElementRow => ({ id: `e${id++}`, ...r });
  const state = (name: string) => (set.includes(name) ? 'checked' : 'unchecked');
  const group = (label: string, role: string, names: string[]) => names.map((n) => row({ role, name: n, state: state(n), group: label }));
  const wanted = products.filter((p) => (!category || p.category === category.toLowerCase()) && (!set.includes('White') || p.colour === 'white')).slice(0, 8);
  const places: Placement[] = wanted.map((_, i) => (i < 6 ? 'visible' : 'below'));
  const ordinals = describeOrdinals(places, 'Results');
  return {
    url: '/', title: `${category ?? 'All shoes'} · Footnote`, headings: [category ?? 'All shoes', 'Filters', 'Results'], notices: [`Showing ${wanted.length} of ${wanted.length} results`],
    rows: [
      row({ role: 'link', name: 'Footnote' }), row({ role: 'searchbox', name: 'Search shoes' }), row({ role: 'button', name: 'Search' }),
      ...['Sneakers', 'Boots', 'Running', 'Loafers', 'Sandals'].map((c) => row({ role: 'link', name: c, group: 'Shop', ...(c === category ? { state: 'current' } : {}) })),
      row({ role: 'link', name: 'Cart (0)' }),
      ...group('Colour', 'checkbox', ['White', 'Black', 'Grey', 'Navy', 'Brown', 'Tan']),
      ...group('Size', 'radio', ['9', '9.5', '10', '10.5', '11', '11.5']),
      ...group('Brand', 'checkbox', ['Northfield', 'Arco', 'Pace & Co', 'Lumen', 'Tidewater']),
      ...group('Price', 'radio', ['Any price', 'Under $75', '$75 to $125', '$125 to $175', 'Over $175']),
      row({ role: 'button', name: 'Clear all filters', group: 'Filters' }),
      row({ role: 'combobox', name: 'Sort by', state: 'selected: Featured', group: 'Results', options: ['Featured', 'Price low to high', 'Price high to low'].map((label, i) => ({ id: `o${i}`, label, selected: i === 0 })) }),
      ...wanted.map((p, i) => row({ role: 'link', name: `${p.name} ${title(p.colour)} ${p.category} $${p.price}`, group: 'Results', ordinal: ordinals[i], ...(places[i] === 'visible' ? {} : { offscreen: 'below' as const }) })),
    ],
  };
}

const post = async <T>(path: string, body: unknown): Promise<T> => {
  const res = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
};

type Scores = Record<string, number | string>;
const top = (h: Head) => Math.max(...Object.values(h.probabilities));
function heads(prefix: string, r: DecideResponse, rows: ElementRow[], out: Scores) {
  const name = (label: string) => rows.find((x) => x.id === label)?.name ?? label;
  for (const [key, h] of Object.entries(r.heads)) {
    if (!h) continue;
    out[`${prefix} · ${key} choice`] = name(h.choice);
    out[`${prefix} · ${key} conf`] = h.confidence;
    out[`${prefix} · ${key} top`] = top(h);
  }
  for (const [g, parts] of Object.entries(r.needsParts ?? {})) {
    out[`${prefix} · needs ${g} personal`] = parts.personal;
    out[`${prefix} · needs ${g} given`] = parts.given;
  }
}

async function save(file: string) {
  const out: Scores = {};
  const fresh = listing();
  const decide = (req: Partial<DecideRequest> & { snapshot: Snapshot }) => post<DecideResponse>('/api/decide', { prefs: [], history: [], ...req });

  for (const utterance of ['scroll down', 'open the second one', 'go back', 'check white', 'sort by price low to high', 'search for running shoes',
    'find me white sneakers', 'find me white sneakers and add the first one to the cart', 'what a lovely day it is']) {
    heads(`single "${utterance}"`, await decide({ leash: 'single', utterance, snapshot: fresh }), fresh.rows, out);
  }

  const goal = 'find me white sneakers';
  const prefs = [{ label: 'Size', value: '10.5', scope: 'localhost', ts: 0 }];
  const steps: [string, Snapshot, Partial<DecideRequest>][] = [
    ['task fresh page', fresh, {}],
    ['task white set', listing(['White']), {}],
    ['task white + sneakers, no size', listing(['White'], 'Sneakers'), {}],
    ['task all set', listing(['White', '10.5'], 'Sneakers'), { prefs }],
    ['task all set, price handled by code', listing(['White', '10.5'], 'Sneakers'), { prefs, goal: 'find me white sneakers under a hundred dollars', constraints: { attributes: { category: 'Sneakers', colour: 'White' }, max_price: 100 } }],
  ];
  for (const [label, snapshot, extra] of steps) heads(label, await decide({ leash: 'task', goal, snapshot, ...extra }), snapshot.rows, out);

  const page = { title: 'Sneakers · Footnote', headings: ['Sneakers', 'Filters', 'Results'], notices: ['Showing 4 of 4 results'] };
  const filters = [{ id: 'f1', text: 'Colour: White' }, { id: 'f2', text: 'Size: 10.5' }, { id: 'f3', text: 'Brand: Arco' }];
  for (const g of ['find me black boots', 'only the ones under a hundred and fifty', 'show me the arco ones in white']) {
    const s = await post<SlateResponse>('/api/slate', { goal: g, page, filters });
    out[`slate "${g}" · refines`] = s.refines;
    out[`slate "${g}" · names product`] = s.namesProduct;
    for (const f of filters) out[`slate "${g}" · asks ${f.text}`] = s.asks[f.id] ?? -1;
  }

  const cards = listing(['White']).rows.filter((r) => r.ordinal).slice(0, 3);
  const f1 = await post<FitsResponse>('/api/fits', { utterance: 'open the northfield one', rows: cards, leash: 'single' });
  for (const c of cards) out[`fits single "open the northfield one" · ${c.name}`] = f1.fits[c.id] ?? -1;
  const nav = fresh.rows.filter((r) => r.group === 'Shop');
  const f2 = await post<FitsResponse>('/api/fits', { utterance: goal, rows: nav, leash: 'task' });
  for (const c of nav) out[`fits task "${goal}" · ${c.name}`] = f2.fits[c.id] ?? -1;

  const options = ['9', '9.5', '10', '10.5', '11', '11.5'];
  for (const answer of ['ten and a half', 'skip it', 'the blue one']) {
    const m = await post<MatchResponse>('/api/match', { group: 'Size', options, answer });
    out[`match "${answer}" · choice`] = m.head.choice;
    out[`match "${answer}" · conf`] = m.head.confidence;
  }

  writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(`saved ${Object.keys(out).length} scores to ${file}`);
}

function diff(a: string, b: string) {
  const before = JSON.parse(readFileSync(a, 'utf8')) as Scores, after = JSON.parse(readFileSync(b, 'utf8')) as Scores;
  let moved = 0;
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const x = before[key], y = after[key];
    const changed = typeof x === 'number' && typeof y === 'number' ? Math.abs(x - y) > MOVED : x !== y;
    if (!changed) continue;
    moved += 1;
    const show = (v: number | string | undefined) => (typeof v === 'number' ? v.toFixed(2) : String(v));
    console.log(`${key}: ${show(x)} -> ${show(y)}`);
  }
  console.log(moved ? `${moved} scores moved by more than ${MOVED} (or changed choice)` : `nothing moved by more than ${MOVED}`);
}

const [mode, a, b] = process.argv.slice(2);
if (mode === 'save' && a) await save(a);
else if (mode === 'diff' && a && b) diff(a, b);
else console.log('usage: probe-heads.ts save <file> | diff <before> <after>');
