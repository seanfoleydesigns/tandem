// Pure policy: heads in, one resolution out. No DOM, no network. Unit tested.
// Rules 2, 3 and 5 read Jev's `confidence`. Rule 4 reads the top probability.
// M1 covers rules 1 to 5 and 8. Rules 6 (deny-list) and 7 (loop detection) arrive in M3.

import { NONE, NO_SPAN } from './candidates';
import { AMBIG_MASS, AMBIG_TOP, OP_MIN, TARGET_MIN, TASK_MIN } from './config';
import type { Head, Heads, Leash, Operation } from './types';

export type Resolution =
  | { type: 'Act'; op: Operation; target?: string; text?: string; reason: string }
  | { type: 'Ask'; group: string; reason: string }
  | { type: 'Disambiguate'; op: Operation; candidates: [string, string]; reason: string }
  | { type: 'StartTask'; goal: string; reason: string }
  | { type: 'Answer'; reason: string }
  | { type: 'Dictate'; text: string; reason: string }
  | { type: 'HandBack'; outcome: 'done' | 'stuck' | 'stopped'; reason: string }
  | { type: 'Ignore'; reason: string };

export type PolicyContext = {
  leash: Leash;
  utterance?: string;
  useKind: boolean; // kind is sent from M1 but only routed on from M2
  groups: Record<string, string | undefined>; // candidate label -> group
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

const TARGET_HEAD: Partial<Record<Operation, 'click_target' | 'type_target' | 'select_target'>> = {
  CLICK: 'click_target',
  TYPE: 'type_target',
  SELECT: 'select_target',
};

export function resolve(heads: Heads, ctx: PolicyContext): Resolution {
  const drive = ctx.leash === 'single';
  const giveUp = (reason: string): Resolution =>
    drive ? { type: 'Ignore', reason } : { type: 'HandBack', outcome: 'stuck', reason };

  // Rule 1: kind
  if (ctx.useKind && heads.kind) {
    const k = heads.kind.choice;
    const why = `kind ${k} (conf ${f(heads.kind.confidence)})`;
    if (k === 'STOP') return { type: 'HandBack', outcome: 'stopped', reason: why };
    if (k === 'ANSWER') return { type: 'Answer', reason: why };
    // Biased toward ACTION: a task starts only when TASK's own probability reaches TASK_MIN.
    const pTask = heads.kind.probabilities.TASK ?? 0;
    if (k === 'TASK' && pTask >= TASK_MIN) return { type: 'StartTask', goal: ctx.utterance ?? '', reason: `${why}, TASK ${f(pTask)} ≥ TASK_MIN ${TASK_MIN}` };
    if (k === 'DICTATION') return { type: 'Dictate', text: ctx.utterance ?? '', reason: why };
    if (k === 'NOT_FOR_ME') return { type: 'Ignore', reason: why };
  }

  // Rule 2: operation confidence
  const op = heads.operation.choice as Operation;
  const opWhy = `operation ${op} (conf ${f(heads.operation.confidence)}, top ${f(topProbability(heads.operation))})`;
  if (heads.operation.confidence < OP_MIN) return giveUp(`${opWhy} is under OP_MIN ${OP_MIN}`);

  if (op === 'DONE') return { type: 'HandBack', outcome: 'done', reason: opWhy };
  if (op === 'STUCK') return giveUp(opWhy);
  if (op === 'SCROLL_DOWN' || op === 'SCROLL_UP' || op === 'GO_BACK') return { type: 'Act', op, reason: opWhy };

  if (op === 'ASK_USER') {
    const g = heads.ask_group;
    if (!g || g.choice === NONE || g.confidence < TARGET_MIN) return giveUp(`${opWhy}; no clear group to ask about`);
    return { type: 'Ask', group: g.choice, reason: `${opWhy}; ask_group ${g.choice} (conf ${f(g.confidence)})` };
  }

  // Rule 3: the target head for the chosen operation
  const headName = TARGET_HEAD[op]!;
  const target = heads[headName];
  if (!target) return giveUp(`${opWhy}; the page offers no candidate for ${headName}`);
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
        : { type: 'Ask', group, reason: why };
    }
  }

  // Rule 5: other low-confidence targets
  if (low) {
    const why = `${opWhy}; ${tWhy} is under TARGET_MIN ${TARGET_MIN}`;
    if (drive && order.length >= 2) return { type: 'Disambiguate', op, candidates: [order[0]![0], order[1]![0]], reason: why };
    return giveUp(why);
  }

  // TYPE also needs the words. On the single leash they come from the typed_span head.
  if (op === 'TYPE') {
    const span = heads.typed_span;
    if (!span || span.choice === NO_SPAN || span.confidence < TARGET_MIN) {
      const sWhy = span ? `typed_span ${JSON.stringify(span.choice)} (conf ${f(span.confidence)}, top ${f(topProbability(span))})` : 'no typed_span head';
      return giveUp(`${opWhy}; ${tWhy}; ${sWhy}: no clear text to type`);
    }
    return { type: 'Act', op, target: target.choice, text: span.choice, reason: `${opWhy}; ${tWhy}; typed_span ${JSON.stringify(span.choice)} (conf ${f(span.confidence)})` };
  }

  // Rule 8: act
  return { type: 'Act', op, target: target.choice, reason: `${opWhy}; ${tWhy}` };
}
