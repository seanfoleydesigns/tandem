// Pure policy: heads in, one resolution out. No DOM, no network. Unit tested.
// Rules 2, 3 and 5 read Jev's `confidence`. Rule 4 reads the top probability.

import { NONE, NO_SPAN } from './candidates';
import { AMBIG_MASS, AMBIG_TOP, ASK_MIN, DICTATION_MIN, OP_MIN, TARGET_MIN, TASK_MIN } from './config';
import { labelKey } from './groups';
import type { ActionRecord, Head, Heads, Leash, Operation } from './types';

export type Resolution =
  | { type: 'Act'; op: Operation; target?: string; text?: string; reason: string }
  | { type: 'Ask'; group: string; reason: string } // group key
  // The target is uncertain. The loop runs a fit check: badges in drive mode, a question or STUCK in task mode.
  | { type: 'Disambiguate'; op: Operation; candidates: [string, string]; reason: string }
  | { type: 'StartTask'; goal: string; reason: string }
  | { type: 'Answer'; reason: string }
  | { type: 'Dictate'; text: string; reason: string }
  | { type: 'HandBack'; outcome: 'done' | 'stuck' | 'stopped' | 'yours'; reason: string }
  | { type: 'Ignore'; reason: string };

export type PolicyContext = {
  leash: Leash;
  utterance?: string;
  goal?: string;
  useKind: boolean;
  groups: Record<string, string | undefined>; // candidate label -> group
  names?: Record<string, string>; // candidate label -> accessible name, for the deny-list
  needs?: Record<string, number>; // task leash: group key -> needs_* Noul
  asked?: string[]; // group keys asked or skipped in this task
  history?: ActionRecord[]; // this task's actions, oldest first
};

const f = (n: number) => n.toFixed(2);

export const topProbability = (h: Head) => h.probabilities[h.choice] ?? 0;

// Candidates by probability, highest first, without the no-match label.
export function ranked(h: Head): [string, number][] {
  return Object.entries(h.probabilities)
    .filter(([label]) => label !== NONE && label !== NO_SPAN)
    .sort((a, b) => b[1] - a[1]);
}

// The smallest set of top candidates covering AMBIG_MASS of the mass that is not on `none`.
export function massSet(h: Head): string[] {
  const r = ranked(h);
  const total = r.reduce((sum, [, p]) => sum + p, 0);
  if (total <= 0) return [];
  const out: string[] = [];
  let mass = 0;
  for (const [label, p] of r) {
    out.push(label);
    mass += p;
    if (mass / total >= AMBIG_MASS) break;
  }
  return out;
}

// Rule 6. The agent does the clicking; the user does the buying.
const DENY = /\b(buy|purchase|place order|checkout|check out|pay|confirm|subscribe)\b/i;
const ADD_TO_CART = /\badd to (cart|bag|basket)\b/i;

export function denied(name: string, goal: string): boolean {
  if (DENY.test(name)) return true;
  return ADD_TO_CART.test(name) && !ADD_TO_CART.test(goal); // allowed only if the goal literally asks for it
}

// Rule 7. The same operation on the same target three times, or three actions in a row that changed nothing.
export function looping(history: ActionRecord[], next: { op: Operation; target?: string }): string | undefined {
  const last = history.slice(-2);
  if (last.length === 2 && last.every((a) => a.op === next.op && a.target === next.target) && next.target) {
    return `the same ${next.op} on "${next.target}" three times`;
  }
  const three = history.slice(-3);
  if (three.length === 3 && three.every((a) => a.outcome !== 'changed')) return 'three actions in a row changed nothing';
  return undefined;
}

// Groups whose needs_* Noul reaches ASK_MIN and that have not been asked or skipped, highest first.
export function needy(needs: Record<string, number> = {}, asked: string[] = []): [string, number][] {
  return Object.entries(needs)
    .filter(([key, p]) => p >= ASK_MIN && !asked.includes(key))
    .sort((a, b) => b[1] - a[1]);
}

const TARGET_HEAD: Partial<Record<Operation, 'click_target' | 'type_target' | 'select_target'>> = {
  CLICK: 'click_target',
  TYPE: 'type_target',
  SELECT: 'select_target',
};

export function resolve(heads: Heads, ctx: PolicyContext): Resolution {
  const drive = ctx.leash === 'single';
  const asks = drive ? [] : needy(ctx.needs, ctx.asked);
  const askTop = (why: string): Resolution => ({
    type: 'Ask', group: asks[0]![0], reason: `${why}; needs ${asks[0]![0]} ${f(asks[0]![1])} ≥ ASK_MIN ${ASK_MIN}`,
  });
  // In task mode, not knowing what to do next becomes a question when there is one to ask.
  const giveUp = (reason: string): Resolution =>
    drive ? { type: 'Ignore', reason } : asks.length ? askTop(reason) : { type: 'HandBack', outcome: 'stuck', reason };

  // Rule 1: kind. Biased toward ACTION: TASK and DICTATION need their own probability to reach a floor.
  if (ctx.useKind && heads.kind) {
    const k = heads.kind.choice;
    const p = heads.kind.probabilities[k] ?? 0;
    const why = `kind ${k} ${f(p)} (conf ${f(heads.kind.confidence)})`;
    if (k === 'STOP') return { type: 'HandBack', outcome: 'stopped', reason: why };
    if (k === 'ANSWER') return { type: 'Answer', reason: why };
    if (k === 'TASK' && p >= TASK_MIN) return { type: 'StartTask', goal: ctx.utterance ?? '', reason: `${why} ≥ TASK_MIN ${TASK_MIN}` };
    if (k === 'DICTATION' && p >= DICTATION_MIN) return { type: 'Dictate', text: ctx.utterance ?? '', reason: `${why} ≥ DICTATION_MIN ${DICTATION_MIN}` };
    if (k === 'NOT_FOR_ME') return { type: 'Ignore', reason: why };
  }

  // Rule 2: operation confidence
  const op = heads.operation.choice as Operation;
  const opWhy = `operation ${op} (conf ${f(heads.operation.confidence)}, top ${f(topProbability(heads.operation))})`;
  if (heads.operation.confidence < OP_MIN) return giveUp(`${opWhy} is under OP_MIN ${OP_MIN}`);

  // DONE is accepted only when nothing essential is still unknown.
  if (op === 'DONE') return asks.length ? askTop(opWhy) : { type: 'HandBack', outcome: 'done', reason: opWhy };
  if (op === 'STUCK') return giveUp(opWhy);

  const act = (action: { target?: string; text?: string }, reason: string): Resolution => {
    const name = action.target ? ctx.names?.[action.target] ?? '' : '';
    // Asking takes precedence over clicking inside the group it would ask about.
    const group = action.target ? ctx.groups[action.target] : undefined;
    if (group && asks.some(([key]) => key === labelKey(group))) return askTop(`${reason}, which is inside a group the user must decide`);
    if (!drive) {
      if (name && denied(name, ctx.goal ?? '')) return { type: 'HandBack', outcome: 'yours', reason: `${reason}; "${name}" is on the deny-list` };
      const loop = looping(ctx.history ?? [], { op, target: name || undefined });
      if (loop) return { type: 'HandBack', outcome: 'stuck', reason: `${reason}; loop detected: ${loop}` };
    }
    return { type: 'Act', op, ...action, reason };
  };

  if (op === 'SCROLL_DOWN' || op === 'SCROLL_UP' || op === 'GO_BACK') return act({}, opWhy);

  // Rule 3: the target head for the chosen operation
  const headName = TARGET_HEAD[op];
  const target = headName && heads[headName];
  if (!headName || !target) return giveUp(`${opWhy}; the page offers no candidate for it`);
  const top = topProbability(target);
  const tWhy = `${headName} ${target.choice} (conf ${f(target.confidence)}, top ${f(top)})`;

  // A confident `none` means nothing fits. Treat it like rule 2 instead of badging two near-zero rows.
  if (target.choice === NONE && target.confidence >= TARGET_MIN) return giveUp(`${opWhy}; ${tWhy}: nothing fits`);

  const low = target.choice === NONE || target.confidence < TARGET_MIN;
  const order = ranked(target);

  // Rule 4: ambiguity inside one group. Uncertainty becomes a question.
  if (top < AMBIG_TOP) {
    const set = massSet(target);
    const group = set.length >= 2 ? ctx.groups[set[0]!] : undefined;
    if (group && set.every((label) => ctx.groups[label] === group)) {
      const why = `${opWhy}; ${tWhy} is under AMBIG_TOP ${AMBIG_TOP} and the top ${set.length} candidates share group "${group}"`;
      return drive
        ? { type: 'Disambiguate', op, candidates: [order[0]![0], order[1]![0]], reason: why }
        : { type: 'Ask', group: labelKey(group), reason: why };
    }
  }

  // Rule 5: other low-confidence targets. Jev collapses a Choice onto one winner, so the loop checks
  // which candidates fit before badging (drive) or asking (task).
  if (low) {
    const why = `${opWhy}; ${tWhy} is under TARGET_MIN ${TARGET_MIN}`;
    if (order.length >= 2) return { type: 'Disambiguate', op, candidates: [order[0]![0], order[1]![0]], reason: why };
    return giveUp(why);
  }

  // TYPE also needs the words. On the single leash they come from the typed_span head.
  if (op === 'TYPE') {
    const span = heads.typed_span;
    if (!span || span.choice === NO_SPAN || span.confidence < TARGET_MIN) {
      const sWhy = span ? `typed_span ${JSON.stringify(span.choice)} (conf ${f(span.confidence)}, top ${f(topProbability(span))})` : 'no typed_span head';
      return giveUp(`${opWhy}; ${tWhy}; ${sWhy}: no clear text to type`);
    }
    return act({ target: target.choice, text: span.choice }, `${opWhy}; ${tWhy}; typed_span ${JSON.stringify(span.choice)} (conf ${f(span.confidence)})`);
  }

  // Rule 8: act
  return act({ target: target.choice }, `${opWhy}; ${tWhy}`);
}
