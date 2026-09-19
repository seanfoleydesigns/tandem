// Where the agent runs. On the demo store it is a page script: same-origin fetch and localStorage, exactly as
// before. As a Chrome extension it is a content script: API calls go through the background worker (a page's
// CORS and private-network rules would block them), preferences live in chrome.storage.local, and the worker
// remembers a running task so that a click which loads a new page does not kill it.
// The agent never checks which one it is in. extension/content.ts swaps these before the agent boots.
import type { ActionRecord, Constraints, Preference } from '../shared/types';

export type ApiResponse = { ok: boolean; status: number; json: () => Promise<unknown> };

// A task as it stands, saved after every step and just before every action (the action may unload the page).
export type SavedTask = {
  goal: string;
  constraints: Constraints;
  history: ActionRecord[];
  asked: string[];
  step: number; // the next step to run
  parsed: boolean; // did the LLM parse answer at task start
  fresh?: boolean; // saved before the task had really begun: the next page starts it properly (parse, clean slate)
  gated?: number; // the DONE gate's count of refusals, so the cap holds across page loads
  unmet?: string[];
  ts: number;
};

export type Env = {
  api: (path: string, init?: { body?: string; signal?: AbortSignal }) => Promise<ApiResponse>;
  prefs: { read: () => Preference[]; write: (all: Preference[]) => void };
  task: { save: (t: SavedTask) => void; clear: () => void };
  constraints: { save: (c: Constraints) => void }; // so that dimming survives a page load
  pageUrl: () => string; // what the snapshot reports as the page's address
};

const PREFS = 'tandem.prefs';

const page: Env = {
  api: (path, init = {}) => fetch(path, { method: 'POST', ...(init.body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: init.body }), signal: init.signal }),
  prefs: {
    read() {
      try {
        const parsed: unknown = JSON.parse(localStorage.getItem(PREFS) ?? '[]');
        return Array.isArray(parsed) ? (parsed as Preference[]) : [];
      } catch {
        return [];
      }
    },
    write(all) {
      try { localStorage.setItem(PREFS, JSON.stringify(all)); } catch { /* storage may be blocked */ }
    },
  },
  task: { save() {}, clear() {} }, // the store navigates without reloading, and must behave exactly as before
  constraints: { save() {} },
  pageUrl: () => location.pathname + location.search, // our own demo store: its query string is its filters
};

let current: Env = page;
export const env = (): Env => current;
export const setEnv = (e: Partial<Env>) => { current = { ...current, ...e }; };
