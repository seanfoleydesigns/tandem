// What the background worker decides, as pure functions: no chrome.* in here, so it is unit tested.
// One record per tab, kept in chrome.storage.session by the worker.
import type { SavedTask } from '../agent/env';
import type { Constraints } from '../shared/types';

export const RESUME_MS = 60_000; // a task older than this is not picked up again
export const API_BASE = 'http://localhost:8787'; // the same literal host as in manifest.json host_permissions

export type TabState = {
  on: boolean; // the user turned Tandem on for this tab
  paused?: boolean; // on, but the tab is now on a site that has not been granted
  pausedAt?: number;
  task?: SavedTask;
  constraints?: Constraints; // the last task's, so price dimming survives a page load
};

export const OFF: TabState = { on: false };

// The one site to ask for: scheme and host of the current page, nothing wider. Chrome ignores the path.
// Only http and https can be granted; chrome://, the Web Store, file:// and the like cannot.
export function originPattern(url: string | undefined): string | undefined {
  try {
    const u = new URL(url ?? '');
    return u.protocol === 'http:' || u.protocol === 'https:' ? `${u.origin}/*` : undefined;
  } catch {
    return undefined;
  }
}

export type Badge = { text: string; color: string; title: string };
export function badgeFor(s: TabState): Badge {
  if (s.on && s.paused) return { text: 'off', color: '#6b7280', title: 'Tandem is paused. Click to turn it on for this site.' };
  if (s.on) return { text: 'on', color: '#2563EB', title: 'Tandem is on for this tab. Click to turn it off.' };
  return { text: '', color: '#6b7280', title: 'Turn Tandem on for this tab' };
}

// The toolbar click. `granted` is the answer to permissions.request for this page's site, which the worker has
// to ask for before it can look anything up (the request must be the first thing in the click handler).
//   on and running        -> off
//   off, or on but paused -> on, if the site was granted; a paused task gets its clock back
export function onClick(s: TabState, granted: boolean, now: number): { next: TabState; action: 'inject' | 'off' | 'none' } {
  if (s.on && !s.paused) return { next: { on: false, constraints: undefined }, action: 'off' };
  if (!granted) return { next: s, action: 'none' };
  const task = s.task && s.pausedAt ? { ...s.task, ts: s.task.ts + (now - s.pausedAt) } : s.task; // paused time does not age a task
  return { next: { ...s, on: true, paused: false, pausedAt: undefined, task }, action: 'inject' };
}

// An enabled tab finished loading a document. Without host access Chrome hides the tab's URL from us, and
// that absence is the signal: this site has not been granted, so Tandem pauses, and so does any task.
export function onLoaded(s: TabState, urlVisible: boolean, now: number): { next: TabState; action: 'inject' | 'pause' | 'none' } {
  if (!s.on) return { next: s, action: 'none' };
  if (!urlVisible) return { next: s.paused ? s : { ...s, paused: true, pausedAt: now }, action: 'pause' };
  return { next: s.paused ? { ...s, paused: false, pausedAt: undefined } : s, action: 'inject' };
}

// What the content script is told when it boots in a tab.
export function hello(s: TabState, now: number): { on: boolean; task?: SavedTask; constraints?: Constraints } {
  const on = s.on && !s.paused;
  const fresh = on && s.task && now - s.task.ts < RESUME_MS ? s.task : undefined;
  return { on, ...(fresh ? { task: fresh } : {}), ...(on && s.constraints ? { constraints: s.constraints } : {}) };
}

// Page text leaves the browser only for tabs the user turned on, and only to the Tandem routes.
export const mayCallApi = (s: TabState, path: unknown): path is string => s.on && !s.paused && typeof path === 'string' && /^\/api\/[a-z]+$/.test(path);
