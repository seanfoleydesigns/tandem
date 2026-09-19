// Pure policy: heads in, one resolution out. No DOM, no network. Unit tested.
// Rules 2, 3 and 5 read Jev's `confidence`. Rule 4 reads the top probability.

import { NONE, NO_SPAN } from './candidates';
import { AMBIG_MASS, AMBIG_TOP, ASK_MIN, DICTATION_MIN, MAX_GATED_DONE, MET_MIN, OP_MIN, TARGET_MIN, TASK_MIN } from './config';
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
  // The DONE gate: Jev said DONE, but the page does not show these attributes yet. Decide again, with them in state.
  | { type: 'Continue'; unmet: string[]; reason: string }
  // Drive mode, and the target is on the deny-list: speech can be misheard, so ask for a second, explicit yes.
  | { type: 'Confirm'; op: Operation; target: string; name: string; reason: string }
  // Never silent: an Ignore says why. not_found: "I can't find that on this page." unsure: "Didn't catch that."
  | { type: 'Ignore'; why: Why; reason: string };

export type Why = 'not_found' | 'unsure' | 'not_for_me';

export type PolicyContext = {
  leash: Leash;
  utterance?: string;
  goal?: string;
  useKind: boolean;
  groups: Record<string, string | undefined>; // candidate label -> group
  names?: Record<string, string>; // candidate label -> accessible name, for the deny-list
  inBlocker?: string[]; // candidate labels that sit inside a pop-up or banner
  met?: Record<string, number>; // task leash: attribute "name: value" -> the page already shows it (Noul)
  gated?: number; // how many times DONE has been refused in this task
  search?: { target: string; text?: string }; // task leash: the search field code chose, and the LLM's query if any
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

// A form is submitted on the task leash only when the goal literally asks for it: it names the control ("add to
// cart", "sign in") in so many words.
// Naming it is not enough ("find me a sign in sheet", "how to delete my account"): the name has to open the goal or
// follow a pressing verb or a connective, the way a step in a list of steps does.
export function asksFor(goal: string, name: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const n = norm(name);
  if (n.length < 3) return false;
  const g = norm(goal);
  if (/\bhow (to|do|can)\b|\babout\b/.test(g)) return false; // asking about it is not asking for it
  // `n` is letters, digits and single spaces by now, so it goes into the pattern as it is.
  return new RegExp(`(^|\\b(press|click|hit|tap|submit|choose|and|then) (the )?)${n}( button)?( for me| please)?( and | then |$)`).test(g);
}

// Pop-ups and banners. A control that accepts, joins or spends is never pressed to get one out of the way.
// A refusal is a refusal however it is worded: "No thanks, I'd rather pay full price" says no before it says pay.
const ACCEPT = /\b(accept|agree|allow|subscribe|sign ?(me )?up|join|register|buy)\b/i;

// Word order is not enough: "No thanks, continue to checkout" and "Don't wait - Buy now" put a refusing word first
// and still spend. A name that mentions accepting or spending counts as a refusal only in one of two shapes:
//   the guilt trip: it opens with "No" / "No thanks" / "Not now" and goes on in the first person about the user
//     ("No thanks, I'd rather pay full price", "No, I don't want to subscribe"), without saying they want the offer;
//   necessary only: it keeps only what is necessary ("Accept only essential cookies"), and nothing says "all".
const GUILT_TRIP = /^\s*(no|nope|nah|not now|not today|maybe later)\b(,?\s*thanks?( you)?)?[\s,.!:;–—-]*(i\b|i['’]|$)/i;
const WANTS_IT = /\bi(['’]d| would)? (want|like|love|wish)( to)? (buy|pay|subscribe|purchase|check ?out|join|sign)/i;
const NECESSARY = /\b(necessary|essential)\b/i;
const EVERYTHING = /\ball\b|\bnon-?\s?essential|\bmarketing\b|\badvertising\b/i;

export function declines(name: string): boolean {
  if (GUILT_TRIP.test(name) && !WANTS_IT.test(name)) return true;
  return NECESSARY.test(name) && !EVERYTHING.test(name);
}

export const accepts = (name: string): boolean => (ACCEPT.test(name) || DENY.test(name) || ADD_TO_CART.test(name)) && !declines(name);

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
  const giveUp = (reason: string, why: Why): Resolution =>
    drive ? { type: 'Ignore', why, reason } : asks.length ? askTop(reason) : { type: 'HandBack', outcome: 'stuck', reason };

  // Rule 1: kind. Biased toward ACTION: TASK and DICTATION need their own probability to reach a floor.
  if (ctx.useKind && heads.kind) {
    const k = heads.kind.choice;
    const p = heads.kind.probabilities[k] ?? 0;
    const why = `kind ${k} ${f(p)} (conf ${f(heads.kind.confidence)})`;
    if (k === 'STOP') return { type: 'HandBack', outcome: 'stopped', reason: why };
    if (k === 'ANSWER') return { type: 'Answer', reason: why };
    if (k === 'TASK' && p >= TASK_MIN) return { type: 'StartTask', goal: ctx.utterance ?? '', reason: `${why} ≥ TASK_MIN ${TASK_MIN}` };
    if (k === 'DICTATION' && p >= DICTATION_MIN) return { type: 'Dictate', text: ctx.utterance ?? '', reason: `${why} ≥ DICTATION_MIN ${DICTATION_MIN}` };
    // Confidently not for us: stay quiet. Weakly so: it may have been a command we did not catch.
    if (k === 'NOT_FOR_ME') return { type: 'Ignore', why: heads.kind.confidence >= 0.5 ? 'not_for_me' : 'unsure', reason: why };
  }

  // Rule 2: operation confidence
  const op = heads.operation.choice as Operation;
  const opWhy = `operation ${op} (conf ${f(heads.operation.confidence)}, top ${f(topProbability(heads.operation))})`;
  if (heads.operation.confidence < OP_MIN) return giveUp(`${opWhy} is under OP_MIN ${OP_MIN}`, 'unsure');

  // DONE is accepted only when nothing essential is still unknown, and only when the page shows every attribute
  // the goal states. A Choice collapses onto DONE while a section is still wrong; a Noul per attribute does not.
  if (op === 'DONE') {
    if (asks.length) return askTop(opWhy);
    const unmet = Object.entries(ctx.met ?? {}).filter(([, p]) => p < MET_MIN);
    if (unmet.length && (ctx.gated ?? 0) < MAX_GATED_DONE) {
      return { type: 'Continue', unmet: unmet.map(([a]) => a), reason: `${opWhy}, but the page does not show ${unmet.map(([a, p]) => `${a} (${f(p)})`).join(', ')} (MET_MIN ${MET_MIN})` };
    }
    return { type: 'HandBack', outcome: 'done', reason: unmet.length ? `${opWhy}; still not shown after ${MAX_GATED_DONE} tries: ${unmet.map(([a]) => a).join(', ')}` : opWhy };
  }
  if (op === 'STUCK') return giveUp(opWhy, 'not_found');

  const act = (action: { target?: string; text?: string }, reason: string): Resolution => {
    const name = action.target ? ctx.names?.[action.target] ?? '' : '';
    // Asking takes precedence over clicking inside the group it would ask about.
    const group = action.target ? ctx.groups[action.target] : undefined;
    if (group && asks.some(([key]) => key === labelKey(group))) return askTop(`${reason}, which is inside a group the user must decide`);
    // The deny-list never blocks a decline inside a pop-up, however guilt-trippy its wording: refusing spends nothing.
    const decline = !!action.target && !!ctx.inBlocker?.includes(action.target) && declines(name);
    if (drive && action.target && name && !decline && denied(name, ctx.utterance ?? '')) {
      return { type: 'Confirm', op, target: action.target, name, reason: `${reason}; "${name}" is on the deny-list, so confirm first` };
    }
    if (!drive) {
      if (name && !decline && denied(name, ctx.goal ?? '')) return { type: 'HandBack', outcome: 'yours', reason: `${reason}; "${name}" is on the deny-list` };
      const loop = looping(ctx.history ?? [], { op, target: name || undefined });
      if (loop) return { type: 'HandBack', outcome: 'stuck', reason: `${reason}; loop detected: ${loop}` };
    }
    return { type: 'Act', op, ...action, reason };
  };

  if (op === 'SCROLL_DOWN' || op === 'SCROLL_UP' || op === 'GO_BACK') return act({}, opWhy);

  // TYPE on the task leash is for searching only. Code chose the field; the words are the LLM's search_query, or,
  // when the parse was unavailable, the span of the goal that typed_span picks. Jev never writes them.
  if (!drive && op === 'TYPE') {
    if (!ctx.search) return giveUp(`${opWhy}; typing is not on offer here`, 'not_found');
    if (ctx.search.text) return act({ target: ctx.search.target, text: ctx.search.text }, `${opWhy}; the search field, and the query parsed from the goal`);
    const span = heads.typed_span;
    if (!span || span.choice === NO_SPAN || span.confidence < TARGET_MIN) return giveUp(`${opWhy}; no clear words in the goal to search for`, 'unsure');
    return act({ target: ctx.search.target, text: span.choice }, `${opWhy}; the search field; typed_span ${JSON.stringify(span.choice)} (conf ${f(span.confidence)})`);
  }

  // Rule 3: the target head for the chosen operation
  const headName = TARGET_HEAD[op];
  const target = headName && heads[headName];
  if (!headName || !target) return giveUp(`${opWhy}; the page offers no candidate for it`, 'not_found');
  const top = topProbability(target);
  const tWhy = `${headName} ${target.choice} (conf ${f(target.confidence)}, top ${f(top)})`;

  // A confident `none` means nothing fits. Treat it like rule 2 instead of badging two near-zero rows.
  if (target.choice === NONE && target.confidence >= TARGET_MIN) return giveUp(`${opWhy}; ${tWhy}: nothing fits`, 'not_found');

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
    return giveUp(why, 'not_found');
  }

  // TYPE also needs the words. On the single leash they come from the typed_span head.
  if (op === 'TYPE') {
    const span = heads.typed_span;
    if (!span || span.choice === NO_SPAN || span.confidence < TARGET_MIN) {
      const sWhy = span ? `typed_span ${JSON.stringify(span.choice)} (conf ${f(span.confidence)}, top ${f(topProbability(span))})` : 'no typed_span head';
      return giveUp(`${opWhy}; ${tWhy}; ${sWhy}: no clear text to type`, 'unsure');
    }
    return act({ target: target.choice, text: span.choice }, `${opWhy}; ${tWhy}; typed_span ${JSON.stringify(span.choice)} (conf ${f(span.confidence)})`);
  }

  // Rule 8: act
  return act({ target: target.choice }, `${opWhy}; ${tWhy}`);
}
