// Latency bench for /api/decide. Hits the running dev server, so it is a script, not a test.
//   npx tsx scripts/bench-decide.ts            p50 of t2 − t1 at 40 / 80 / 120 / 180 / 240 rows, both label styles
//   npx tsx scripts/bench-decide.ts --rows=180,240   only these row counts
//   npx tsx scripts/bench-decide.ts --idle     also: cold connection versus warmed connection
import products from '../store/src/data/products.json';
import { describeOrdinals, type Placement } from '../shared/ordinals';
import type { DecideRequest, DecideResponse, ElementRow } from '../shared/types';

const API = 'http://localhost:8787';
const CALLS = 10;
const UTTERANCES = ['scroll down', 'open the second one', 'go back', 'check white', 'sort by price low to high', 'search for running shoes'];

const title = (s: string) => s[0]!.toUpperCase() + s.slice(1);

// Rows shaped like the Footnote listing: header, filters, sort, product cards, load more.
function rows(n: number): ElementRow[] {
  let id = 1;
  const row = (r: Omit<ElementRow, 'id'>): ElementRow => ({ id: `e${id++}`, ...r });
  const out: ElementRow[] = [
    row({ role: 'link', name: 'Footnote' }),
    row({ role: 'searchbox', name: 'Search shoes' }),
    row({ role: 'button', name: 'Search' }),
    ...['Sneakers', 'Boots', 'Running', 'Loafers', 'Sandals'].map((c) => row({ role: 'link', name: c, group: 'Categories' })),
    row({ role: 'link', name: 'Cart (1)' }),
    ...['White', 'Black', 'Grey', 'Navy', 'Brown', 'Tan', 'Red', 'Green', 'Blue'].map((c) => row({ role: 'checkbox', name: c, state: 'unchecked', group: 'Colour' })),
  ];
  if (n >= 80) {
    out.push(
      ...['7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5', '12', '12.5', '13'].map((s) => row({ role: 'radio', name: s, state: 'unchecked', group: 'Size' })),
      ...['Northfield', 'Arco', 'Pace & Co', 'Lumen', 'Tidewater'].map((b) => row({ role: 'checkbox', name: b, state: 'unchecked', group: 'Brand' })),
      ...['Laces', 'Slip-on', 'Velcro', 'Zip'].map((c) => row({ role: 'checkbox', name: c, state: 'unchecked', group: 'Closure' })),
      ...['Under $75', '$75 to $125', '$125 to $175', 'Over $175'].map((p) => row({ role: 'radio', name: p, state: 'unchecked', group: 'Price' })),
      row({ role: 'button', name: 'Clear all filters', group: 'Filters' }),
    );
  }
  out.push(row({
    role: 'combobox', name: 'Sort by', state: 'selected: Featured', group: 'Results',
    options: ['Featured', 'Price low to high', 'Price high to low', 'Name A to Z'].map((label, i) => ({ id: `o${i}`, label, selected: i === 0 })),
  }));
  const cards = n - out.length - 1;
  const places: Placement[] = Array.from({ length: cards }, (_, i) => (i < 12 ? 'visible' : 'below'));
  const ordinals = describeOrdinals(places, 'Results');
  for (let i = 0; i < cards; i++) {
    const p = products[i % products.length]!;
    out.push(row({
      role: 'link', name: `${p.name} ${title(p.colour)} ${p.category} $${p.price}`, group: 'Results', ordinal: ordinals[i],
      ...(places[i] === 'visible' ? {} : { offscreen: 'below' as const }),
    }));
  }
  out.push(row({ role: 'button', name: 'Load more', group: 'Results', offscreen: 'below' }));
  return out;
}

// What each utterance should resolve to on these rows: the operation, and the head and label that carry it out.
function expected(all: ElementRow[]): { op: string; head?: 'click_target' | 'select_target' | 'type_target'; label?: string }[] {
  const find = (f: (r: ElementRow) => boolean) => all.find(f)!.id;
  return [
    { op: 'SCROLL_DOWN' },
    { op: 'CLICK', head: 'click_target', label: find((r) => !!r.ordinal?.startsWith('second visible')) },
    { op: 'GO_BACK' },
    { op: 'CLICK', head: 'click_target', label: find((r) => r.role === 'checkbox' && r.name === 'White') },
    { op: 'SELECT', head: 'select_target', label: `${find((r) => r.role === 'combobox')}_o1` },
    { op: 'TYPE', head: 'type_target', label: find((r) => r.role === 'searchbox') },
  ];
}

async function call(n: number, labelStyle: 'described' | 'ids', utterance: string): Promise<DecideResponse & { wall: number }> {
  const body: DecideRequest = {
    leash: 'single', utterance, prefs: [], history: [], labelStyle,
    snapshot: { url: '/', title: 'All shoes · Footnote', headings: ['All shoes', 'Filters', 'Results'], notices: ['Showing 24 of 36 results'], rows: rows(n) },
  };
  const t = performance.now();
  const res = await fetch(`${API}/api/decide`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json()) as DecideResponse;
  if (!res.ok) throw new Error(JSON.stringify(json));
  return { ...json, wall: performance.now() - t };
}

const p = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))]!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

console.log('rows  style      p50 ms  min  max   tokens in   operation  target  span');
await call(40, 'described', 'scroll down'); // open the connection once; not counted
const only = process.argv.find((a) => a.startsWith('--rows='))?.slice('--rows='.length).split(',').map(Number);
for (const n of only ?? [40, 80, 120, 180, 240]) {
  for (const style of ['described', 'ids'] as const) {
    const ms: number[] = [];
    let tokens = 0;
    const want = expected(rows(n));
    let ops = 0, targets = 0, targetTotal = 0, spans = 0, spanTotal = 0;
    for (let i = 0; i < CALLS; i++) {
      const w = want[i % want.length]!;
      const r = await call(n, style, UTTERANCES[i % UTTERANCES.length]!);
      ms.push(r.ms);
      tokens = r.usage.input_tokens;
      if (r.heads.operation.choice === w.op) ops++;
      if (w.head) { targetTotal++; if (r.heads[w.head]?.choice === w.label) targets++; }
      if (w.op === 'TYPE') { spanTotal++; if (r.heads.typed_span?.choice === 'running shoes') spans++; }
    }
    console.log(`${String(n).padEnd(5)} ${style.padEnd(10)} ${String(p(ms, 0.5)).padStart(6)} ${String(Math.min(...ms)).padStart(4)} ${String(Math.max(...ms)).padStart(4)}   ${String(tokens).padStart(9)}   ${ops}/${CALLS}      ${targets}/${targetTotal}     ${spans}/${spanTotal}`);
  }
}

if (process.argv.includes('--idle')) {
  console.log('\nConnection warm-up, 80 rows, described. Each call follows 8 s of idle time.');
  for (const warmFirst of [false, true]) {
    const ms: number[] = [];
    for (let i = 0; i < 5; i++) {
      await sleep(8000);
      if (warmFirst) { await fetch(`${API}/api/warm`, { method: 'POST' }); await sleep(300); }
      ms.push((await call(80, 'described', UTTERANCES[i % UTTERANCES.length]!)).ms);
    }
    console.log(`${warmFirst ? 'warmed first' : 'cold        '}  p50 ${p(ms, 0.5)} ms   all: ${ms.join(', ')}`);
  }
}
