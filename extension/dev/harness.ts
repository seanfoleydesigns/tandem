// Dev only, never built: runs the extension's content script on the demo store without Chrome's extension
// system, so the parts that do not need Chrome can be checked for real: the environment seam, the worker's
// decisions (the same state.ts), chrome.storage.local preferences, styles through adoptedStyleSheets, and a
// task that survives a full page load.
//   http://localhost:5173/__ext/on     from then on the store loads content.ts in place of the page script
//   http://localhost:5173/__ext/off    back to normal
// What it cannot check is Chrome itself: the permission prompt, injection, the badge. Those are in the README steps.
import type { SavedTask } from '../../agent/env';
import type { Constraints } from '../../shared/types';
import { hello, mayCallApi, type TabState } from '../state';

const TAB = 'tandem.harness.tab'; // stands in for the worker's chrome.storage.session record of this tab
const read = (): TabState => JSON.parse(sessionStorage.getItem(TAB) ?? '{"on":true}') as TabState;
const write = (s: TabState) => sessionStorage.setItem(TAB, JSON.stringify(s));
const log: unknown[] = [];

type Message = { type: string; path?: string; body?: string; task?: SavedTask; constraints?: Constraints; on?: boolean };
async function worker(msg: Message): Promise<unknown> {
  const s = read();
  log.push(msg.type === 'api' ? `api ${msg.path}` : msg.type);
  if (msg.type === 'hello') return hello(s, Date.now());
  if (msg.type === 'api') {
    if (!mayCallApi(s, msg.path)) return { ok: false, status: 0, body: { ok: false, error: 'not on' } };
    const res = await fetch(msg.path, { method: 'POST', ...(msg.body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: msg.body }) });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
  }
  if (msg.type === 'task:save') write({ ...s, task: msg.task });
  else if (msg.type === 'task:clear') write({ ...s, task: undefined });
  else if (msg.type === 'constraints:save') write({ ...s, constraints: msg.constraints });
  else if (msg.type === 'mic:save') write({ ...s, mic: !!msg.on });
  else if (msg.type === 'muted:save') write({ ...s, muted: !!msg.on });
  else if (msg.type === 'tts:speaking') return { speaking: false };
  else if (msg.type === 'tts:speak' || msg.type === 'tts:stop') return { ok: false }; // no chrome.tts here: the page speaks
  return { ok: true };
}

const local = {
  get: async (k: string) => ({ [k]: JSON.parse(localStorage.getItem(`harness.local.${k}`) ?? 'null') ?? undefined }),
  set: async (items: Record<string, unknown>) => { for (const [k, v] of Object.entries(items)) localStorage.setItem(`harness.local.${k}`, JSON.stringify(v)); },
};
(window as unknown as { chrome: unknown }).chrome = {
  runtime: { id: 'harness', sendMessage: (m: Message) => worker(m), onMessage: { addListener() {} } },
  storage: { local },
};
// The overlay is sealed here as it is in Chrome, so a script cannot type a command into it. To start a task from a
// test, hand the stand-in worker a saved task and reload: the content script picks it up the way it does after any page load.
const seed = (goal: string, constraints: Constraints = {}) => {
  write({ on: true, task: { goal, constraints, history: [], asked: [], step: 0, parsed: true, ts: Date.now() } });
  location.reload();
};
(window as unknown as { __harness: unknown }).__harness = { log, tab: read, seed, reset: () => { sessionStorage.removeItem(TAB); } };

// A multi-page site: every link click is a real page load, so the content script dies and must resume.
document.addEventListener('click', (e) => {
  const a = (e.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a || a.origin !== location.origin) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const to = new URL(a.href);
  // The store keeps the filters when a category is chosen; do the same, as a full navigation.
  if (a.closest('.cats') && location.pathname === '/') {
    const params = new URLSearchParams(location.search);
    params.delete('q');
    params.set('category', to.searchParams.get('category') ?? '');
    to.search = params.toString();
  }
  location.href = to.href;
}, true);

await import('../content');
