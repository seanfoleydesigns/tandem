// Blockers: a cookie banner, a newsletter pop-up, anything that sits on top of what the user asked for.
// Pure. Code decides what may never be pressed; among the rest an exact refusal is taken in code, and
// anything less plain goes to Jev (shared/questions.ts, dismissQuestion).
import { DISMISS_MIN, MAX_DISMISSALS } from './config';
import { accepts } from './policy';
import { normalise } from './speech';
import type { ElementRow } from './types';

export type BlockerKind = 'cookie banner' | 'pop-up' | 'banner';

export const blockerKind = (text: string, modal: boolean): BlockerKind =>
  /cookie|consent|gdpr|privacy/i.test(text) ? 'cookie banner' : modal ? 'pop-up' : 'banner';

export const dismissTrail = (kind: BlockerKind): string =>
  kind === 'cookie banner' ? 'Closed the cookie banner' : kind === 'pop-up' ? 'Dismissed a pop-up' : 'Closed a banner';

// At most MAX_DISMISSALS attempts per task (or per drive command), and never the same control twice.
// Ids change with every snapshot, so a control is remembered by the blocker's kind and its own name.
export type Budget = { left: number; tried: Set<string> };
export const newBudget = (): Budget => ({ left: MAX_DISMISSALS, tried: new Set() });
const key = (kind: BlockerKind, name: string) => `${kind}|${normalise(name)}`;
export function spend(b: Budget, kind: BlockerKind, name?: string) {
  b.left -= 1;
  if (name !== undefined) b.tried.add(key(kind, name));
}

// The blocker's own buttons and links, minus what must never be pressed: anything that accepts, subscribes,
// signs up or buys. A refusal is kept however it is worded ("No thanks, I'd rather pay full price").
export function dismissCandidates(rows: ElementRow[], kind: BlockerKind, b: Budget): { offered: ElementRow[]; removed: string[] } {
  const controls = rows.filter((r) => r.role === 'button' || r.role === 'link');
  const removed = controls.filter((r) => accepts(r.name)).map((r) => r.name);
  const offered = controls.filter((r) => !accepts(r.name) && !b.tried.has(key(kind, r.name)));
  return { offered, removed };
}

// An exact, plain refusal needs no model. A refusal beats a plain close: "Reject all" also says no.
const REFUSE = ['reject all', 'reject', 'decline', 'decline all', 'deny', 'deny all', 'necessary only', 'only necessary', 'essential only', 'use necessary cookies only', 'no thanks', 'no thank you', 'not now', 'maybe later'];
const CLOSE = ['close', 'dismiss', 'close dialog', 'close banner', 'close this'];
export function codeFirst(offered: ElementRow[]): ElementRow | undefined {
  // × ✕ ✖ are never a brand, so they close whatever their role. The letter X is also a social network: a button only.
  const closes = (r: ElementRow) => /^[×✕✖]$/.test(r.name.trim()) || (/^x$/i.test(r.name.trim()) && r.role === 'button');
  const named = (list: string[]) => offered.find((r) => list.includes(normalise(r.name)) || (list === CLOSE && closes(r)));
  return named(REFUSE) ?? named(CLOSE);
}

// Two Nouls per control, combined in code: dismisses = refuses × (1 − accepts). The best one wins if it reaches
// DISMISS_MIN. Jev's answers only ever select one of the offered ids.
export type DismissScores = Record<string, { refuses: number; accepts: number }>;
export const dismisses = (s?: { refuses: number; accepts: number }) => (s ? s.refuses * (1 - s.accepts) : 0);
export function pickDismiss(scores: DismissScores, offered: ElementRow[]): ElementRow | undefined {
  const best = [...offered].sort((a, b) => dismisses(scores[b.id]) - dismisses(scores[a.id]))[0];
  return best && dismisses(scores[best.id]) >= DISMISS_MIN ? best : undefined;
}
