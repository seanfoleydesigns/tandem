// Blockers, the DOM side: find the pop-up or banner, read its own controls, and press the one that says no.
// What may be pressed is decided in shared/blockers.ts (code) and by Jev (/api/dismiss). This click does not go
// through policy.resolve, so the deny-list never stops a refusal; accepting controls were removed before that.
import { blockerKind, codeFirst, dismissCandidates, dismisses, dismissTrail, pickDismiss, spend, type BlockerKind, type Budget } from '../shared/blockers';
import { MAX_BLOCKER_CONTROLS } from '../shared/config';
import type { DismissResponse } from '../shared/types';
import { composedContains, composedParent } from './dom';
import * as exec from './execute';
import { openModal, takeSnapshot } from './snapshot';

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const CONTAINER = 'dialog,[role=dialog],[role=alertdialog],[aria-modal="true"]';

// From whatever covers a target, up to the thing it belongs to: a dialog, or a fixed or sticky box such as a
// cookie banner (those are rarely dialogs).
export function blockerOf(cover: Element): Element | undefined {
  for (let n: Element | null = cover; n && n !== document.body && n !== document.documentElement; n = composedParent(n)) {
    if (n.matches(CONTAINER)) return n;
    const position = getComputedStyle(n).position;
    if (position === 'fixed' || position === 'sticky') return n;
  }
  return undefined;
}

// For the deny-list exemption only: is this control inside a pop-up? Stricter than blockerOf.
export function inPopup(el: Element): boolean {
  for (let n: Element | null = el; n && n !== document.body && n !== document.documentElement; n = composedParent(n)) {
    if (n.matches(CONTAINER)) return true;
    if (getComputedStyle(n).position === 'fixed' && blockerKind(visibleText(n), false) === 'cookie banner') return true;
  }
  return false;
}

// What a person can read: innerText skips display:none, <script> and <style>. jsdom has none, so fall back.
const visibleText = (el: Element) => clean((el as HTMLElement).innerText ?? el.textContent).slice(0, 400);

export type BlockerTrace = {
  trigger: 'covered' | 'modal';
  kind: BlockerKind;
  title: string;
  offered: string[];
  removed: string[]; // accepting controls, removed in code before any model call
  by: 'code' | 'jev' | 'nobody';
  chosen?: string;
  scores?: { name: string; refuses: number; accepts: number; dismisses: number }[];
  ms?: number;
  dismissed: boolean;
  note: string;
};

export type BlockerHooks = {
  overlay: Element;
  onRing?: exec.OnReady;
  onTrail?: (text: string) => void;
  blockers?: { budget: Budget; signal?: AbortSignal };
};

const gone = (el: Element, modal: boolean, overlay: Element) =>
  !el.isConnected || !((el as HTMLElement).checkVisibility?.() ?? true) || el.getBoundingClientRect().height === 0 || (modal && openModal(overlay) !== el);

export async function clearBlocker(trigger: { cover: Element; target?: Element } | { modal: Element }, hooks: BlockerHooks, budget: Budget): Promise<BlockerTrace | undefined> {
  const isModal = 'modal' in trigger;
  let el = isModal ? trigger.modal : blockerOf(trigger.cover);
  if (!el) return undefined; // not a pop-up or banner: the action fails as it always has
  // A real blocker never contains the thing it covers. A web app's fixed shell does; its own buttons are not ours to press.
  if (!isModal && trigger.target && composedContains(el, trigger.target)) return undefined;

  let snap = takeSnapshot({ overlay: hooks.overlay, within: el, wide: true });
  if (!snap.snapshot.rows.length && !isModal) {
    // A backdrop has no controls of its own; they are in the modal it belongs to.
    const modal = openModal(hooks.overlay);
    if (modal) { el = modal; snap = takeSnapshot({ overlay: hooks.overlay, within: el, wide: true }); }
  }
  const text = visibleText(el); // never hidden text: it could be written to sway the answer
  const kind = blockerKind(text, isModal || el.matches(CONTAINER));
  const title = clean(el.querySelector('h1,h2,h3,[role=heading]')?.textContent).slice(0, 120);
  const { offered, removed } = dismissCandidates(snap.snapshot.rows, kind, budget);
  const trace: BlockerTrace = { trigger: isModal ? 'modal' : 'covered', kind, title, offered: offered.map((r) => r.name), removed, by: 'nobody', dismissed: false, note: '' };
  if (budget.left <= 0) return { ...trace, note: 'no dismissal attempts left' };
  if (!offered.length) { spend(budget, kind); return { ...trace, note: 'none of its controls may be pressed' }; }

  let pick = codeFirst(offered);
  if (pick) trace.by = 'code';
  else {
    try {
      const asked = offered.slice(0, MAX_BLOCKER_CONTROLS);
      const res = await fetch('/api/dismiss', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ blocker: { kind, title, text }, controls: asked }), signal: hooks.blockers?.signal });
      if (res.ok) {
        const r = (await res.json()) as DismissResponse;
        trace.ms = r.ms;
        trace.scores = asked.map((c) => ({ name: c.name, refuses: r.scores[c.id]?.refuses ?? 0, accepts: r.scores[c.id]?.accepts ?? 0, dismisses: dismisses(r.scores[c.id]) }));
        pick = pickDismiss(r.scores, asked);
        if (pick) trace.by = 'jev';
      }
    } catch { /* no answer: leave it in place */ }
  }
  spend(budget, kind, pick?.name);
  if (hooks.blockers?.signal?.aborted) return { ...trace, note: 'stopped' };
  if (!pick) return { ...trace, note: 'no control clearly refuses or closes it' };

  const node = snap.nodes.get(pick.id);
  const before = { url: location.href, scrollY: window.scrollY };
  const clicked = node ? exec.click(node, hooks.overlay, hooks.onRing) : { ok: false };
  await exec.settle(hooks.overlay, before);
  trace.chosen = pick.name;
  trace.dismissed = clicked.ok && gone(el, isModal, hooks.overlay);
  trace.note = trace.dismissed ? `pressed "${pick.name}"${trace.by === 'code' ? ', chosen in code with no model call' : ''}` : `pressed "${pick.name}" but it is still there`;
  if (trace.dismissed) hooks.onTrail?.(dismissTrail(kind));
  return trace;
}
