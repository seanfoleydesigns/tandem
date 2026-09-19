// The content script: the same agent that runs on the demo store, in its own shadow root, on whatever page the
// user turned Tandem on for. It is injected by the worker, never declared in the manifest, so it is nowhere until
// the toolbar button is clicked. Injection may happen twice into one document; the second time only re-syncs.
//
// What differs from the store is only the environment (agent/env.ts):
//   /api calls       -> messages to the worker, which makes them (a page's CORS and network rules do not apply there)
//   preferences      -> chrome.storage.local
//   the running task -> the worker's chrome.storage.session, so it survives a page load
// Voice stays here, in the page: Chrome asks for the microphone once per site. That is a known limit.
import { boot } from '../agent/boot';
import { setEnv, type ApiResponse, type SavedTask } from '../agent/env';
import type { Constraints, Preference } from '../shared/types';

const PREFS = 'tandem.prefs';
type Hello = { on: boolean; task?: SavedTask; constraints?: Constraints };
type Flagged = typeof globalThis & { __tandemLoaded?: boolean; __tandemSync?: () => void };
const flagged = globalThis as Flagged;

// A worker that was reloaded leaves this script orphaned: sendMessage then THROWS ("Extension context
// invalidated") rather than rejecting. Either way the answer is "no answer".
function send<T>(message: unknown): Promise<T | undefined> {
  try {
    return chrome.runtime.sendMessage(message).then((r) => r as T, () => undefined);
  } catch {
    return Promise.resolve(undefined);
  }
}

async function api(path: string, init: { body?: string; signal?: AbortSignal } = {}): Promise<ApiResponse> {
  const aborted = () => new DOMException('stopped', 'AbortError');
  if (init.signal?.aborted) throw aborted();
  const r = await send<{ ok: boolean; status: number; body: unknown }>({ type: 'api', path, body: init.body });
  if (init.signal?.aborted) throw aborted(); // the answer is ignored; the worker's fetch is cheap to waste
  if (!r) return { ok: false, status: 0, json: async () => ({ ok: false, error: 'the Tandem extension is not answering; reload this page' }) };
  return { ok: r.ok, status: r.status, json: async () => r.body };
}

async function main() {
  const hello = await send<Hello>({ type: 'hello' });
  if (!hello?.on) { flagged.__tandemLoaded = false; return; } // not on for this tab: stay out of the page, and let a later injection try again

  // Once this page is on its way out, nothing it does may touch the saved task: stopping its loop must not clear
  // the task the next page is about to pick up, and a page woken from the back/forward cache must not write a stale one.
  let leaving = false;

  // Preferences are read synchronously by the agent, so they are loaded once and written through.
  let prefs = (((await chrome.storage.local.get(PREFS).catch(() => ({}))) as Record<string, unknown>)[PREFS] as Preference[] | undefined) ?? [];
  setEnv({
    api,
    prefs: { read: () => prefs, write: (all) => { prefs = all; void chrome.storage.local.set({ [PREFS]: all }).catch(() => {}); } },
    task: { save: (task) => { if (!leaving) void send({ type: 'task:save', task }); }, clear: () => { if (!leaving) void send({ type: 'task:clear' }); } },
    constraints: { save: (constraints) => { if (!leaving) void send({ type: 'constraints:save', constraints }); } },
    // A real site's query string can carry a search, an email, a token. The path and the parameter NAMES go out; values stay here.
    pageUrl: () => location.pathname + (location.search ? `?${[...new URLSearchParams(location.search).keys()].join('&')}` : ''),
  });

  const tandem = boot({ sealed: true }); // this page is not ours: closed shadow root, made-up events ignored
  tandem.overlay.showStatus('Tandem is on for this tab', 'ok');
  if (hello.constraints) tandem.pipeline.restoreConstraints(hello.constraints);
  if (hello.task) void tandem.resume(hello.task); // a click loaded this page in the middle of a task

  // Ask the worker again whether this tab is on, and show or hide accordingly.
  const sync = () => void send<Hello>({ type: 'hello' }).then((h) => tandem.setEnabled(!!h?.on));
  flagged.__tandemSync = sync;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const type = (message as { type?: string } | undefined)?.type;
    if (type === 'tandem:off') tandem.setEnabled(false);
    else if (type === 'tandem:on') { tandem.setEnabled(true); tandem.overlay.showStatus('Tandem is on for this tab', 'ok'); }
    else if (type === 'tandem:paused') {
      // Access to this site was taken back while the page was open. Stop, say so, and wait for a click.
      tandem.pipeline.stop('paused');
      tandem.voice.setMic(false);
      tandem.overlay.showStatus('Paused. Turn me on for this site.', 'unsure');
    } else return false;
    sendResponse({ ok: true });
    return false;
  });

  // Leaving: stop whatever loop is running, so that a page kept in the back/forward cache does not wake up later
  // and carry on a task that has long since finished elsewhere. The saved task is left alone (see `leaving`).
  window.addEventListener('pagehide', () => { leaving = true; tandem.pipeline.stop('left the page'); });
  // Back and forward can bring this document back with the agent still in it: ask again whether it should be.
  window.addEventListener('pageshow', (e) => { if (e.persisted) { leaving = false; sync(); } });
}

if (!flagged.__tandemLoaded) {
  flagged.__tandemLoaded = true;
  void main();
} else flagged.__tandemSync?.(); // injected again into the same document: nothing to boot, but the worker's view may have changed
