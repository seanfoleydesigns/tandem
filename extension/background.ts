// The background service worker. It owns three things the page cannot be trusted or allowed to do:
//   1. who is on: Tandem is off until the toolbar button is clicked, per tab, and runs only on sites granted one by one;
//   2. the network: content scripts are bound by the page's CORS and private-network rules, so every /api call is
//      made here, and only for a tab that is on;
//   3. memory across page loads: the running task lives in chrome.storage.session, so a click that loads a new
//      page does not kill it.
// Every listener is registered synchronously at the top level: a dormant worker is woken by the event itself.
// Decisions are pure functions in state.ts; this file is the chrome.* plumbing around them.
import type { SavedTask } from '../agent/env';
import type { Constraints } from '../shared/types';
import { API_BASE, badgeFor, hello, mayCallApi, OFF, onClick, onLoaded, originPattern, type TabState } from './state';

const key = (tabId: number) => `tab:${tabId}`;
const read = async (tabId: number): Promise<TabState> => ((await chrome.storage.session.get(key(tabId)))[key(tabId)] as TabState | undefined) ?? OFF;
const write = (tabId: number, s: TabState) => chrome.storage.session.set({ [key(tabId)]: s });

// Every read-modify-write of a tab's record goes through one queue. Two saves sent in the same tick (the
// constraints and the task, at task start) would otherwise both read the old record, and the second would undo the first.
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(work: () => Promise<T>): Promise<T> => {
  const run = queue.then(work, work);
  queue = run.catch(() => undefined);
  return run;
};

// Chrome clears a tab's badge on every page load, so it is painted again whenever the state is touched.
async function paint(tabId: number, s: TabState, title?: string) {
  const b = badgeFor(s);
  try {
    await chrome.action.setBadgeText({ tabId, text: b.text });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: b.color });
    await chrome.action.setTitle({ tabId, title: title ?? b.title });
  } catch { /* the tab is gone */ }
}

// Injection is idempotent: content.js does nothing the second time it lands in the same document.
async function inject(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['dist/content.js'] });
    return true;
  } catch {
    return false; // no access to this page after all
  }
}
const tell = (tabId: number, type: string) => chrome.tabs.sendMessage(tabId, { type }).catch(() => undefined);

// The toolbar button. permissions.request needs the click's user gesture, which does not survive an await, so it
// is the first thing that happens, before any state is read. Asking for a site that is already granted answers
// true without a prompt, so asking first costs nothing, including when the click turns Tandem off.
chrome.action.onClicked.addListener((tab) => {
  const tabId = tab.id;
  const pattern = originPattern(tab.url); // activeTab makes the URL visible for this click
  const asked = pattern ? chrome.permissions.request({ origins: [pattern] }).catch(() => false) : Promise.resolve(false);
  if (tabId === undefined) return;
  void (async () => {
    const granted = await asked; // the prompt can take as long as the user likes: outside the queue
    const { was, next, action } = await serial(async () => {
      const was = await read(tabId);
      const decided = onClick(was, granted, Date.now());
      await write(tabId, decided.next); // before the script lands: the first thing it does is ask whether this tab is on
      await paint(tabId, decided.next, decided.action === 'none' ? (pattern ? 'Tandem needs your OK for this site. Click to try again.' : "Tandem can't run on this page.") : undefined);
      return { was, ...decided };
    });
    if (action === 'off') await tell(tabId, 'tandem:off');
    if (action !== 'inject') return;
    // Same document, switched off earlier: the script is still there. Otherwise put it in. Neither happens inside the
    // queue: injection can take until the page is idle, and the queue serves every tab.
    if ((await tell(tabId, 'tandem:on')) || (await inject(tabId))) return;
    await serial(async () => { await write(tabId, was); await paint(tabId, was, "Tandem can't run on this page."); }); // no access to this page after all: back to what it was
  })();
});

// An enabled tab loaded a document. A site that was granted keeps working; one that was not pauses Tandem and
// any task, and the badge says so. (Nothing can be drawn in a page we have no access to, so the capsule cannot.)
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status !== 'loading' && change.status !== 'complete') return;
  void serial(async () => {
    const was = await read(tabId);
    if (!was.on) return 'none' as const;
    const visible = !!originPattern(tab.url) && (await chrome.permissions.contains({ origins: [originPattern(tab.url)!] }).catch(() => false));
    const { next, action } = onLoaded(was, visible, Date.now());
    if (next !== was) await write(tabId, next); // before the script lands, so its first question gets the new answer
    await paint(tabId, next);
    return action;
  }).then((action) => {
    // Both times: 'loading' comes once the new document has committed, and the script then waits for the DOM by itself;
    // 'complete' is the second chance, for a page whose load event is held up. A repeat only re-syncs (content.ts).
    // Outside the queue: executeScript can take until the page is idle, and the queue serves every tab.
    if (action === 'inject') void inject(tabId);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => void serial(() => chrome.storage.session.remove(key(tabId))));

// The user took a site back in Chrome's own settings: tabs on that site pause, and their capsule says so.
chrome.permissions.onRemoved.addListener(() => {
  void serial(async () => {
    const all = await chrome.storage.session.get(null);
    for (const [k, s] of Object.entries(all) as [string, TabState][]) {
      if (!k.startsWith('tab:') || !s.on || s.paused) continue;
      const tabId = Number(k.slice(4));
      const tab = await chrome.tabs.get(tabId).catch(() => undefined);
      const pattern = originPattern(tab?.url);
      if (pattern && (await chrome.permissions.contains({ origins: [pattern] }).catch(() => false))) continue;
      const next = { ...s, paused: true, pausedAt: Date.now() };
      await write(tabId, next);
      await paint(tabId, next);
      await tell(tabId, 'tandem:paused');
    }
  });
});

type Message =
  | { type: 'hello' }
  | { type: 'api'; path: string; body?: string }
  | { type: 'task:save'; task: SavedTask }
  | { type: 'task:clear' }
  | { type: 'constraints:save'; constraints: Constraints };

// One listener, not async (an async listener would answer every message with null), and `true` keeps the channel
// open until sendResponse is called.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  const msg = message as Message;
  if (tabId === undefined || !msg || typeof msg.type !== 'string') return false;
  if (msg.type === 'api') {
    void (async () => {
      const s = await serial(() => read(tabId)); // after any write already queued for this tab

      if (!mayCallApi(s, msg.path)) return sendResponse({ ok: false, status: 0, body: { ok: false, error: 'Tandem is not on for this tab' } });
      try {
        const res = await fetch(API_BASE + msg.path, { method: 'POST', ...(msg.body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: msg.body }) });
        return sendResponse({ ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) });
      } catch {
        return sendResponse({ ok: false, status: 0, body: { ok: false, error: 'the Tandem server on this computer is not answering (npm run dev)' } });
      }
    })();
    return true;
  }
  void serial(async () => {
    const s = await read(tabId);
    if (msg.type === 'hello') return sendResponse(hello(s, Date.now()));
    if (!s.on) return sendResponse({ ok: false });
    if (msg.type === 'task:save') await write(tabId, { ...s, task: msg.task });
    else if (msg.type === 'task:clear') await write(tabId, { ...s, task: undefined });
    else if (msg.type === 'constraints:save') await write(tabId, { ...s, constraints: msg.constraints });
    sendResponse({ ok: true });
  }).catch(() => sendResponse({ ok: false })); // always answer: an unanswered channel is an error on the other side
  return true;
});
