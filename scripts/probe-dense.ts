// Probe: does Jev still pick the right row on a dense real page? Fetches the Hacker News front page, turns its
// controls into rows roughly the way the snapshot would (no layout here, so no ordinals and nothing off screen),
// and asks the running dev API. A script, not a test: it uses the network twice (the page, and TypeSafe).
//   npx tsx scripts/probe-dense.ts
import { JSDOM } from 'jsdom';
import { MAX_ROWS } from '../shared/config';
import type { DecideRequest, DecideResponse, ElementRow } from '../shared/types';

const API = 'http://localhost:8787';
const html = await (await fetch('https://news.ycombinator.com/')).text();
const doc = new JSDOM(html).window.document;
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

const rows: ElementRow[] = [...doc.querySelectorAll('a[href],input:not([type=hidden]),button,select,textarea')].map((el, i) => ({
  id: `e${i + 1}`,
  role: el.tagName === 'A' ? 'link' : el.tagName === 'INPUT' ? 'textbox' : el.tagName.toLowerCase(),
  name: clean(el.textContent) || clean(el.querySelector('[title]')?.getAttribute('title')) || clean(el.getAttribute('title')),
})).slice(0, MAX_ROWS);
const idOf = (name: string) => rows.find((r) => r.name === name)?.id;
console.log(`${rows.length} rows; "More" is ${idOf('More')}, the text field is ${rows.find((r) => r.role === 'textbox')?.id}`);

const CASES = [
  { say: 'click more', op: 'CLICK', target: idOf('More') },
  { say: 'click new', op: 'CLICK', target: idOf('new') },
  { say: 'open the jobs page', op: 'CLICK', target: idOf('jobs') },
  { say: 'scroll down', op: 'SCROLL_DOWN' },
];
console.log('say                   operation      target            conf   ms   tokens in');
for (const c of CASES) {
  const body: DecideRequest = {
    leash: 'single', utterance: c.say, prefs: [], history: [],
    snapshot: { url: '/', title: clean(doc.title), headings: [], notices: [], rows },
  };
  const res = await fetch(`${API}/api/decide`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const r = (await res.json()) as DecideResponse;
  if (!res.ok) { console.log(c.say, 'FAILED', JSON.stringify(r).slice(0, 300)); continue; }
  const target = r.heads.click_target;
  const name = rows.find((x) => x.id === target?.choice)?.name ?? target?.choice ?? '';
  const ok = r.heads.operation.choice === c.op && (!c.target || target?.choice === c.target);
  console.log(`${c.say.padEnd(21)} ${r.heads.operation.choice.padEnd(14)} ${name.slice(0, 16).padEnd(17)} ${(target?.confidence ?? r.heads.operation.confidence).toFixed(2)}  ${String(r.ms).padStart(4)}  ${String(r.usage.input_tokens).padStart(6)}  ${ok ? 'ok' : 'WRONG'}`);
}
