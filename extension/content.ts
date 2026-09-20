// The content script: the same agent that runs on the demo store, in its own shadow root, on whatever page the
// user turned Tandem on for. It is injected by the worker, never declared in the manifest, so it is nowhere until
// the toolbar button is clicked. Injection may happen twice into one document; the second time only re-syncs.
//
// What differs from the store is only the environment (agent/env.ts):
//   /api calls       -> messages to the worker, which makes them (a page's CORS and network rules do not apply there)
//   preferences      -> chrome.storage.local
//   the running task -> the worker's chrome.storage.session, so it survives a page load
//   speech output    -> the worker's chrome.tts (a freshly loaded page may not speak); the mic's on/off -> the worker, per tab
// Recognition itself stays here, in the page: Chrome asks for the microphone once per site, and gives it to the
// site. That is a known limit; the way out is an extension-owned page (README, next steps).
import { boot } from '../agent/boot';
import { env, setEnv, type ApiResponse, type SavedTask, type SpeechEvents } from '../agent/env';
import type { Constraints, Preference } from '../shared/types';

const PREFS = 'tandem.prefs';
type Hello = { on: boolean; task?: SavedTask; constraints?: Constraints; mic?: boolean; muted?: boolean };
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
  let toggled = false; // the user has used the mic button: their click outranks what the tab remembered
  const pageSpeech = env().speech; // the page's own voice, before the environment is swapped: the fallback
  const spoken = new Map<string, SpeechEvents>(); // phrases the worker is speaking, waiting for their start and end

  // Preferences are read synchronously by the agent, so they are loaded once and written through.
  let prefs = (((await chrome.storage.local.get(PREFS).catch(() => ({}))) as Record<string, unknown>)[PREFS] as Preference[] | undefined) ?? [];
  setEnv({
    api,
    prefs: { read: () => prefs, write: (all) => { prefs = all; void chrome.storage.local.set({ [PREFS]: all }).catch(() => {}); } },
    task: { save: (task) => { if (!leaving) void send({ type: 'task:save', task }); }, clear: () => { if (!leaving) void send({ type: 'task:clear' }); } },
    constraints: { save: (constraints) => { if (!leaving) void send({ type: 'constraints:save', constraints }); } },
    // A real site's query string can carry a search, an email, a token. The path and the parameter NAMES go out; values stay here.
    pageUrl: () => location.pathname + (location.search ? `?${[...new URLSearchParams(location.search).keys()].join('&')}` : ''),
    // Speech comes from the worker (chrome.tts). Chrome lets a page speak only after a user gesture on it, and a page
    // that has just loaded has had none, so an agent that spoke from the page would go mute after every navigation
    // to a new site. If the worker cannot speak, the page tries its own voice.
    speech: {
      speak(text, on) {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        spoken.set(id, on);
        void send<{ ok: boolean }>({ type: 'tts:speak', id, text }).then((r) => {
          if (r?.ok || !spoken.delete(id)) return;
          pageSpeech.speak(text, on);
        });
      },
      // Not while leaving: stopping the old page's loop must not silence what the next page has started to say.
      cancel() { if (!leaving) void send({ type: 'tts:stop' }); pageSpeech.cancel(); },
    },
    // Whether the microphone is on is the tab's business, not the page's: the next page starts listening by itself.
    mic: { save: (on) => { toggled = true; if (!leaving) void send({ type: 'mic:save', on }); } },
    muted: { save: (on) => { if (!leaving) void send({ type: 'muted:save', on }); } },
  });

  const tandem = boot({ sealed: true }); // this page is not ours: closed shadow root, made-up events ignored
  tandem.overlay.showStatus('Tandem is on for this tab', 'ok');
  if (hello.constraints) tandem.pipeline.restoreConstraints(hello.constraints);
  if (hello.muted) tandem.restoreMuted(); // before the task: a muted agent stays quiet on the next page too
  // Resuming and listening are independent. A task that a click interrupted carries on at once; it never waits for the microphone.
  if (hello.task) void tandem.resume(hello.task);

  // The worker's voice outlives the page: a phrase the last page started may still be playing, and this document's
  // echo guard knows nothing of it. Wait until the browser is quiet (10 s at most) before listening by itself.
  const quiet = async () => {
    for (let i = 0; i < 40; i += 1) {
      if (!(await send<{ speaking: boolean }>({ type: 'tts:speaking' }))?.speaking) return;
      await new Promise((r) => setTimeout(r, 250));
    }
  };
  const listenWhenQuiet = () => { toggled = false; void quiet().then(() => { if (!leaving && !toggled) void tandem.listen(); }); };
  // What the tab remembers about the mic, applied to this document.
  const applyMic = (h: Hello | undefined) => {
    if (!h?.on) return;
    if (h.mic) listenWhenQuiet();
    else tandem.voice.setMic(false, { remember: false });
  };
  if (hello.mic) listenWhenQuiet(); // the mic was on before this page loaded

  // Ask the worker again whether this tab is on, and show or hide accordingly.
  // A document back from the back/forward cache remembers the mic as it was when it was left; the tab knows better.
  const sync = (mic = false) => void send<Hello>({ type: 'hello' }).then((h) => { tandem.setEnabled(!!h?.on); if (mic) applyMic(h); });
  flagged.__tandemSync = () => sync();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const type = (message as { type?: string } | undefined)?.type;
    if (type === 'tts:event') {
      // The worker's voice started or finished a phrase: that is what raises and lowers the echo guard.
      const { id, event } = message as { id: string; event: 'start' | 'end' };
      const on = spoken.get(id);
      if (event === 'start') on?.onStart?.();
      else if (on) { spoken.delete(id); on.onEnd(); }
    } else if (type === 'tandem:off') tandem.setEnabled(false);
    else if (type === 'tandem:on') {
      tandem.setEnabled(true);
      tandem.overlay.showStatus('Tandem is on for this tab', 'ok');
      void send<Hello>({ type: 'hello' }).then(applyMic); // back from a pause in this same document: the mic comes back with the site
    }
    else if (type === 'tandem:paused') {
      // Access to this site was taken back while the page was open. Stop, say so, and wait for a click.
      tandem.pipeline.stop('paused');
      tandem.voice.setMic(false, { remember: false }); // not the user's choice: the mic comes back with the site
      tandem.overlay.showStatus('Paused. Turn me on for this site.', 'unsure');
    } else return false;
    sendResponse({ ok: true });
    return false;
  });

  // Leaving: stop whatever loop is running, so that a page kept in the back/forward cache does not wake up later
  // and carry on a task that has long since finished elsewhere. The saved task is left alone (see `leaving`).
  window.addEventListener('pagehide', () => { leaving = true; tandem.pipeline.stop('left the page'); });
  // Back and forward can bring this document back with the agent still in it: ask again whether it should be.
  window.addEventListener('pageshow', (e) => { if (e.persisted) { leaving = false; sync(true); } });
}

if (!flagged.__tandemLoaded) {
  flagged.__tandemLoaded = true;
  void main();
} else flagged.__tandemSync?.(); // injected again into the same document: nothing to boot, but the worker's view may have changed
