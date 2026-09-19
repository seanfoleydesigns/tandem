// The one loop. Drive and delegate differ only by the leash: maxSteps 1 versus 25.
// snapshot → (task: saved preferences, in code) → /api/decide → policy.resolve → execute → settle → record.
import { newBudget, type Budget } from '../shared/blockers';
import { candidates, groupsByLabel, rowLine, type Candidates } from '../shared/candidates';
import { LEAVING_WAIT_MS, MAX_TASK_MS, type LabelStyle } from '../shared/config';
import { mergeConstraints } from '../shared/constraints';
import { fitPool, rankFits } from '../shared/fits';
import { pageDigest } from '../shared/digest';
import { cleanLabel, controlGroups, isChosen, isNeutral, labelKey, unsetGroups, type ControlGroup } from '../shared/groups';
import { asksFor, declines, denied, resolve, type Resolution, type Why } from '../shared/policy';
import { countResults, exactOption, parseRange, priceGroup, priceLimit, sortAscending, wanted, withoutPriceGroup } from '../shared/price';
import { searchField, taskTyping } from '../shared/search';
import { planSlate, setOptions } from '../shared/slate';
import { normalise } from '../shared/speech';
import type {
  ActionRecord, ApiError, Constraints, DecideRequest, DecideResponse, ElementRow, FitsResponse, Leash, LlmCall, Operation,
  ParseResponse, Preference, SlateResponse, VerifyRequest, VerifyResponse,
} from '../shared/types';
import { clearBlocker, inPopup, type BlockerTrace } from './blockers';
import { env, type SavedTask } from './env';
import * as exec from './execute';
import { openModal, takeSnapshot, type Snap } from './snapshot';

// When the words were heard. `final` is the final transcript (or Enter in the command bar);
// `lastInterim` is the last time the interim transcript changed, when there was one.
export type Heard = { final: number; lastInterim?: number };

// Observe and decide, without acting. Voice fires this speculatively on a stable interim transcript.
export type Decision = {
  utterance: string;
  snap: Snap;
  cands: Candidates;
  rowsById: Map<string, ElementRow>;
  rowNames: Map<string, string>; // label -> short name, for the inspector
  t1: number; // request sent
  t2: number; // response received
  response?: DecideResponse;
  error?: string;
  typing?: 'query' | 'span'; // task leash: TYPE was on offer in this decision
};

export type Option = { label: string; line: string; row: ElementRow; el: Element; option?: HTMLOptionElement };
export type Disambiguation = { op: Operation; options: [Option, Option]; text?: string };

export type Trace = {
  utterance: string;
  leash: Leash;
  step: number;
  heard: Heard;
  speculative: 'hit' | 'miss' | 'none'; // was a decision fired on an interim transcript used?
  rows: number;
  snapshotMs: number;
  t1: number;
  t2: number;
  t3?: number; // action done
  settleMs?: number;
  response?: DecideResponse;
  resolution?: Resolution;
  winner?: string; // the snapshot row that won, as sent to Jev
  disambiguation?: Disambiguation;
  confirm?: { op: Operation; option: Option; name: string }; // drive mode: a deny-listed target waits for an explicit yes
  why?: Why; // why nothing was done, so the agent is never silent
  fit?: { ms: number; asked: number; fits: { line: string; noul: number }[] }; // the follow-up fit check, when one ran
  constraints?: Constraints; // task leash: what the LLM parsed from the goal (M4)
  llm?: { parse?: LlmCall; verify?: LlmCall }; // LLM latency and tokens, next to Jev's
  verdict?: { ok: boolean; issues: string[]; spoken: string };
  blocker?: BlockerTrace; // a pop-up or banner was in the way, and what was done about it
  rowNames: Map<string, string>;
  // 'gated': Jev said DONE but the page does not show every attribute yet; the loop decides again.
  result: 'acted' | 'ignored' | 'asked' | 'gated' | 'confirm' | 'task' | 'done' | 'stuck' | 'yours' | 'stopped' | 'failed' | 'error';
  note: string;
};

// The question card. The page writes the question: its group label and its option names.
export type AskResult = { type: 'answer'; row: ElementRow } | { type: 'skip' } | { type: 'giveup' } | { type: 'stopped' };

export type LoopHooks = {
  overlay: Element;
  labelStyle: () => LabelStyle;
  pageFocus: () => Element | null;
  onRing: (rect: DOMRect, radius?: number) => void;
  onStep: (trace: Trace) => void; // after every step, for the inspector
  onTrail: (text: string, tone?: 'memory') => void; // what was done
  onDriving: () => void; // a second step is beginning: the agent is visibly driving
  prefs: () => Preference[];
  savePref: (label: string, value: string) => void;
  ask: (group: ControlGroup, reason: string) => Promise<AskResult>;
  matchOption: (group: string, options: string[], answer: string) => Promise<string | undefined>; // /api/match
  // M4, task leash only. Nothing in drive mode calls these (tests/no-llm-in-drive.test.ts).
  parseGoal: (goal: string) => Promise<ParseResponse | undefined>; // /api/parse; undefined when unreachable
  verify: (req: VerifyRequest) => Promise<VerifyResponse | undefined>; // /api/verify
  onThinking: (on: boolean, llmAnswered?: boolean) => void;
  lastConstraints: () => Constraints;
  setConstraints: (c: Constraints) => void;
  blockers?: { budget: Budget; signal?: AbortSignal }; // set by runLoop: dismissal attempts left in this task or command
  beforeAct?: (about: ActionRecord) => void; // set by runLoop on the task leash: save the task before an action that may unload the page
};

const driveHistory: ActionRecord[] = [];
const describeTarget = (row?: ElementRow) => (row ? [row.role, row.name, row.group].filter(Boolean).join(' · ') : undefined);

export async function decideOnce(
  input: { utterance?: string; goal?: string; leash: Leash; history: ActionRecord[]; asked?: string[]; prefs?: Preference[]; constraints?: Constraints; typing?: 'query' | 'span'; unmet?: string[] },
  hooks: Pick<LoopHooks, 'overlay' | 'labelStyle' | 'pageFocus' | 'lastConstraints'>, signal?: AbortSignal, taken?: Snap,
): Promise<Decision> {
  const snap = taken ?? takeSnapshot({ overlay: hooks.overlay, focused: hooks.pageFocus() });
  // Price is code's job: while a price constraint exists, Jev is never offered the price group, on either leash.
  const offered = withoutPriceGroup(snap.snapshot, controlGroups(snap.snapshot), input.constraints ?? hooks.lastConstraints());
  const cands = candidates(offered);
  const decision: Decision = {
    utterance: input.utterance ?? input.goal ?? '', snap, cands,
    rowsById: new Map(offered.rows.map((r) => [r.id, r])),
    rowNames: new Map<string, string>([
      ...offered.rows.map((r) => [r.id, `${r.role} ${r.name}`.slice(0, 36)] as [string, string]),
      ...cands.select.map((s) => [s.label, s.optionLabel.slice(0, 36)] as [string, string]),
    ]),
    t1: performance.now(), t2: 0,
  };
  const body: DecideRequest = {
    leash: input.leash, utterance: input.utterance, goal: input.goal, prefs: input.prefs ?? [],
    history: input.history.slice(-6), snapshot: offered, asked: input.asked, constraints: input.constraints, labelStyle: hooks.labelStyle(),
    ...(input.typing ? { typing: input.typing } : {}), ...(input.unmet?.length ? { unmet: input.unmet } : {}),
  };
  try {
    const res = await env().api('/api/decide', { body: JSON.stringify(body), signal });
    const json = (await res.json()) as DecideResponse | ApiError;
    if (!res.ok || 'error' in json) throw new Error('error' in json ? json.error : `HTTP ${res.status}`);
    decision.response = json;
  } catch (err) {
    decision.error = err instanceof Error ? err.message : String(err);
  }
  decision.t2 = performance.now();
  return decision;
}

// Follow-up to an uncertain target: one Noul per candidate. Returns nothing if the call fails.
async function fitCheck(utterance: string, rows: ElementRow[], leash: Leash, signal?: AbortSignal): Promise<FitsResponse | undefined> {
  try {
    const res = await env().api('/api/fits', { body: JSON.stringify({ utterance, rows, leash }), signal });
    return res.ok ? ((await res.json()) as FitsResponse) : undefined;
  } catch {
    return undefined;
  }
}

// Carry out one chosen operation on one element, then wait for the page to settle.
export async function act(
  action: { op: Operation; row?: ElementRow; el?: Element; option?: HTMLOptionElement; text?: string; append?: boolean; usedPref?: string },
  hooks: Pick<LoopHooks, 'overlay' | 'onRing'> & Partial<Pick<LoopHooks, 'onTrail' | 'blockers' | 'beforeAct'>>, history: ActionRecord[] = driveHistory,
): Promise<{ outcome: exec.ExecResult; t3: number; settleMs: number; blocker?: BlockerTrace }> {
  let before = { url: location.href, scrollY: window.scrollY };
  const { op, el } = action;
  const record = (outcome: ActionRecord['outcome']): ActionRecord => ({
    op, target: action.row?.name || describeTarget(action.row), value: action.text ?? action.option?.label, usedPref: action.usedPref, outcome, ts: Date.now(),
  });
  // If this action loads a new page, this script dies before it can record it: the task is saved with the action
  // already counted as done. And once the page says it is unloading, nothing more is decided on it.
  hooks.beforeAct?.(record('changed'));
  let leaving = false;
  const onLeave = () => { leaving = true; };
  window.addEventListener('beforeunload', onLeave);
  const perform = (): exec.ExecResult => {
    if (op === 'SCROLL_DOWN') return exec.scroll(1);
    if (op === 'SCROLL_UP') return exec.scroll(-1);
    if (op === 'GO_BACK') return exec.back();
    if (!el) return { ok: false, reason: 'the chosen label is not in this snapshot' };
    if (op === 'CLICK') return exec.click(el, hooks.overlay, hooks.onRing);
    if (op === 'TYPE') return exec.type(el, action.text ?? '', hooks.overlay, hooks.onRing, { append: action.append, submit: !action.append });
    if (op === 'SELECT') return exec.select(el, action.option, hooks.overlay, hooks.onRing);
    return { ok: false, reason: `nothing to execute for ${op}` };
  };
  let outcome = perform();
  // Something covers the target. If it is a pop-up or banner, get it out of the way and try the same action once more.
  let blocker: BlockerTrace | undefined;
  if (!outcome.ok && outcome.coveredBy) {
    blocker = await clearBlocker({ cover: outcome.coveredBy, target: el }, hooks, hooks.blockers?.budget ?? newBudget());
    if (blocker?.dismissed && !hooks.blockers?.signal?.aborted) { before = { url: location.href, scrollY: window.scrollY }; outcome = perform(); }
  }
  const t3 = performance.now();

  const settled = await exec.settle(hooks.overlay, before);
  window.removeEventListener('beforeunload', onLeave);
  if (leaving && outcome.ok) {
    // The old document lingers until the new one arrives, looking unchanged. Wait here rather than decide on it,
    // overwrite the saved task, or end it. If the page cancels the unload after all, carry on.
    history.push(record('changed'));
    if (!hooks.blockers?.signal?.aborted) await new Promise((r) => setTimeout(r, LEAVING_WAIT_MS));
    return { outcome, t3, settleMs: settled.ms, blocker };
  }
  history.push(record(!outcome.ok ? 'failed' : settled.changed ? 'changed' : 'no_change'));
  return { outcome, t3, settleMs: settled.ms, blocker };
}

const VERB: Partial<Record<Operation, string>> = { SCROLL_DOWN: 'Scrolled down', SCROLL_UP: 'Scrolled up', GO_BACK: 'Went back' };
function trailText(op: Operation, row?: ElementRow, value?: string): string {
  if (VERB[op]) return VERB[op]!;
  if (op === 'TYPE') return /search/i.test(`${row?.role} ${row?.name}`) ? `Searched for ${value}` : `Typed ${value}`;
  if (op === 'SELECT') return /sort/i.test(row?.name ?? '') ? `Sorted by ${value}` : `Chose ${value}`;
  if (row?.role === 'checkbox' || row?.role === 'switch') return `${/(^|, )checked/.test(row.state ?? '') ? 'Unchecked' : 'Checked'} ${row.name}`;
  if (row?.role === 'radio') return `Chose ${cleanLabel(row.group ?? '').toLowerCase()} ${row.name}`.replace(/\s+/g, ' ');
  return `${row?.role === 'link' ? 'Opened' : 'Pressed'} ${shortName(row?.name)}`;
}

// A product card's name runs on ("Tidewater Boardwalk Tan sneakers $58"): drop a trailing price and keep it short.
function shortName(name = ''): string {
  const n = name.replace(/\s*[$€£]\s?\d[\d.,]*\s*$/, '');
  return n.length > 40 ? `${n.slice(0, 40).replace(/\s+\S*$/, '')}…` : n;
}

// Plain past-tense words for what was done. No arrows, no quotes.
export const confirmationFor = trailText;

export async function runLoop(
  input: { utterance?: string; goal?: string; leash: Leash; maxSteps: number; heard: Heard; prepared?: Promise<Decision>; specMissed?: boolean; signal?: AbortSignal; resume?: SavedTask },
  base: LoopHooks,
): Promise<Trace> {
  let currentStep = 0;
  const hooks: LoopHooks = { ...base, blockers: { budget: newBudget(), signal: input.signal }, beforeAct: (about) => remember(currentStep + 1, about) };
  const budget = hooks.blockers!.budget;
  const task = input.leash === 'task';
  const said = input.utterance ?? input.goal ?? '';
  const history: ActionRecord[] = task ? [] : driveHistory; // loop detection looks at this task only
  const asked: string[] = []; // group keys asked or skipped in this task
  const memoryTried = new Set<string>();
  const started = performance.now();
  let waited = 0; // time spent waiting for the user does not count against the task clock
  let trace!: Trace;
  const end = (result: Trace['result'], note?: string, why?: Why): Trace => {
    trace = { ...trace, result, note: note ?? trace.note, why };
    if (task) env().task.clear(); // however it ended, there is nothing left to pick up on the next page
    hooks.onStep(trace);
    return trace;
  };

  // Task start, two things at once: Jev checks for a clean slate, and the LLM parses the goal into
  // constraints. The LLM is only ever reached on the task leash: here, and at DONE below.
  let constraints: Constraints = {};
  let llm: Trace['llm'];
  let cleared = 0;
  let startBlocker: BlockerTrace | undefined;
  let flowModal: Element | undefined; // a modal the task's own action opened is part of the flow, not a blocker
  let retried = false; // drive mode: one second look after a pop-up was dismissed
  // A task saved before it had really begun (the page unloaded during the clean slate) starts again properly.
  const resume = task && !input.resume?.fresh ? input.resume : undefined;
  let sortTried = false;
  let unmet: string[] = resume?.unmet ?? []; // the DONE gate: attributes the page does not show yet, passed to the next decision
  let gated = resume?.gated ?? 0;
  // Saved after every step and just before every action, because the action may unload the page.
  function remember(step: number, about?: ActionRecord, fresh = false) {
    if (task) env().task.save({ goal: input.goal ?? '', constraints, history: about ? [...history, about] : [...history], asked: [...asked], step, parsed: !!llm?.parse?.ok, gated, unmet: [...unmet], ts: Date.now(), ...(fresh ? { fresh } : {}) });
  }
  if (resume) {
    // A click loaded a new page in the middle of the task (the extension). Carry on from where it was: the goal
    // was parsed and the slate cleaned on the first page, so neither happens again.
    constraints = resume.constraints;
    history.push(...resume.history);
    asked.push(...resume.asked);
    llm = { parse: { ok: resume.parsed, ms: 0 } };
    hooks.setConstraints(constraints);
    hooks.onDriving();
  } else if (task) {
    remember(0, undefined, true); // if clearing an old filter reloads the page, the next page starts this task again
    // A modal open at task start is dismissed first: the clean slate and the parse must read the real page.
    const modal = openModal(hooks.overlay);
    if (modal) startBlocker = await clearBlocker({ modal }, hooks, budget);
    hooks.onThinking(true);
    const [slate, parsed] = await Promise.all([
      cleanSlate(input.goal ?? '', hooks, history, input.signal),
      hooks.parseGoal(input.goal ?? ''),
    ]);
    cleared = slate.cleared;
    // With the LLM away (no key, a timeout), code reads the price limit itself, so a price never falls to Jev.
    const stated = parsed?.llm.ok ? parsed.constraints : priceLimit(input.goal ?? '') ?? {};
    // A refinement adjusts the last search, so it keeps the constraints it does not restate.
    constraints = slate.refinement ? mergeConstraints(hooks.lastConstraints(), stated) : stated;
    llm = { parse: parsed?.llm };
    hooks.setConstraints(constraints);
    hooks.onThinking(false, !!parsed?.llm.ok);
  }

  for (let step = resume?.step ?? 0; step < input.maxSteps; step++) {
    currentStep = step;
    if (!input.signal?.aborted) remember(step); // a stopped loop (a page woken from the back/forward cache) saves nothing
    if (step === 1 || (step === 0 && cleared)) hooks.onDriving(); // the frame appears only when a second step begins
    const snap = takeSnapshot({ overlay: hooks.overlay, focused: hooks.pageFocus() });
    trace = {
      utterance: said, leash: input.leash, step, heard: input.heard, speculative: 'none', rows: snap.snapshot.rows.length,
      snapshotMs: snap.ms, t1: performance.now(), t2: performance.now(), rowNames: new Map(), result: 'error', note: '',
      ...(task ? { constraints, llm } : {}),
      ...(step === 0 && startBlocker ? { blocker: startBlocker } : {}), // closed at task start, or just before this second look
    };
    if (input.signal?.aborted) return end('stopped', 'stopped before acting');
    // A pop-up that appeared on its own, mid-task (a newsletter after five seconds): dismiss it and look again.
    if (task && snap.modal && snap.modal !== flowModal) {
      const blocker = await clearBlocker({ modal: snap.modal }, hooks, budget);
      if (input.signal?.aborted) return end('stopped', 'stopped while closing a pop-up');
      if (blocker?.dismissed) { trace = { ...trace, blocker, winner: blocker.chosen, result: 'acted', note: `a pop-up was in the way: ${blocker.note}` }; hooks.onStep(trace); continue; }
      flowModal = snap.modal; // it stays: carry on inside it rather than trying again at every step
      if (blocker) trace.blocker = blocker;
    }
    if (task && performance.now() - started - waited > MAX_TASK_MS) return end('stuck', `the task ran past ${MAX_TASK_MS / 1000} s`);

    // Saved preferences, then price: both are applied in code, before Jev is asked for the next operation.
    if (task) {
      const applied = (await applyMemory(snap, hooks, history, memoryTried)) ?? (await applyPrice(snap, constraints, hooks, history, sortTried, () => { sortTried = true; }));
      if (applied) { trace = { ...trace, t3: applied.t3, settleMs: applied.settleMs, winner: applied.line, result: 'acted', note: applied.note }; hooks.onStep(trace); continue; }
    }

    // A decision made on a matching interim transcript is reused; otherwise decide now.
    let decision = step === 0 && input.prepared && !retried ? await input.prepared : undefined;
    const speculative = step !== 0 ? 'none' : input.prepared ? (decision?.response ? 'hit' : 'miss') : input.specMissed ? 'miss' : 'none';
    if (!decision?.response) {
      // Typing on the task leash is for searching only, and only when there are words to type (shared/search.ts).
      const typing = task ? taskTyping({ snapshot: snap.snapshot, history, query: constraints.search_query, parsed: !!llm?.parse?.ok }) : undefined;
      decision = await decideOnce({ utterance: input.utterance, goal: input.goal, leash: input.leash, history, asked, prefs: task ? hooks.prefs() : [], constraints: task ? constraints : undefined, typing, unmet }, hooks, input.signal, snap);
      decision.typing = typing;
    }
    const { cands, rowsById, response } = decision;
    const nodes = decision.snap.nodes;
    trace = { ...trace, speculative, rows: decision.snap.snapshot.rows.length, snapshotMs: decision.snap.ms, t1: decision.t1, t2: decision.t2, response, rowNames: decision.rowNames, note: decision.error ?? '' };
    if (input.signal?.aborted) return end('stopped', 'stopped before acting');
    if (!response) return end('error');

    const names: Record<string, string> = {};
    for (const r of decision.snap.snapshot.rows) names[r.id] = r.name;
    for (const s of cands.select) names[s.label] = s.optionLabel;
    // The deny-list never blocks a decline inside a pop-up or banner. Looked up only for names that decline.
    const inBlocker = Object.keys(names).filter((id) => declines(names[id]!) && nodes.get(id) && inPopup(nodes.get(id)!));
    const resolution = resolve(response.heads, {
      leash: input.leash, utterance: input.utterance, goal: input.goal, useKind: !task, groups: groupsByLabel(cands),
      names, inBlocker, needs: response.needs, asked, history, met: response.met, gated,
      // The field is chosen in code; the words are the LLM's query, or come from typed_span on the fallback.
      search: (() => { const field = decision!.typing && searchField(decision!.snap.snapshot); return field ? { target: field.id, text: decision!.typing === 'query' ? constraints.search_query : undefined } : undefined; })(),
    });
    trace.resolution = resolution;
    trace.note = resolution.reason;

    const optionFor = (label: string): Option | undefined => {
      const pick = cands.select.find((s) => s.label === label);
      const row = pick?.row ?? rowsById.get(label);
      const el = row && nodes.get(row.id);
      return row && el ? { label, line: rowLine(row), row, el, option: pick && decision!.snap.options.get(pick.label) } : undefined;
    };

    let next: Resolution = resolution;

    // Drive mode with a pop-up open: what the user asked for is behind it. Dismiss it and look once more.
    // Only for a command that could not be carried out inside the pop-up, never for speech that was not for us.
    const behindPopup = async (): Promise<boolean> => {
      const modal = decision!.snap.modal;
      if (task || !modal || retried || response.heads.kind?.choice === 'NOT_FOR_ME') return false;
      const blocker = await clearBlocker({ modal }, hooks, budget);
      startBlocker = blocker ?? startBlocker; // the inspector shows it on the command's trace
      if (blocker) trace.blocker = blocker;
      if (!blocker?.dismissed || input.signal?.aborted) return false;
      retried = true;
      return true;
    };

    if (next.type === 'Disambiguate') {
      // Jev's Choice names one winner even when several candidates fit equally well, so ask a
      // yes/no question about each candidate like it, then decide with the answers.
      let pair = next.candidates;
      const anchor = rowsById.get(pair[0]);
      let ranked: ElementRow[] | undefined;
      if (anchor && !anchor.options) {
        const pool = fitPool(anchor.role === 'textbox' || anchor.role === 'searchbox' ? cands.type : cands.click, anchor, [anchor.id]);
        const checked = await fitCheck(said, pool, input.leash, input.signal);
        if (checked) {
          ranked = rankFits(pool, checked.fits);
          trace.fit = { ms: checked.ms, asked: pool.length, fits: ranked.slice(0, 6).map((r) => ({ line: rowLine(r), noul: checked.fits[r.id] ?? 0 })) };
          if (ranked.length >= 2) pair = [ranked[0]!.id, ranked[1]!.id];
        }
      }
      if (ranked?.length === 0) {
        if (await behindPopup()) { step -= 1; continue; }
        return end(task ? 'stuck' : 'ignored', `${trace.note}; fit check: no candidate fits`, 'not_found');
      }
      if (ranked?.length === 1 && next.op === 'CLICK') {
        next = { type: 'Act', op: 'CLICK', target: ranked[0]!.id, reason: `${trace.note}; fit check: only one candidate fits, so act on it` };
      } else if (task) {
        // Several fitting options in one unset group: the user decides.
        const group = ranked && ranked.every((r) => r.group === ranked![0]!.group) ? ranked[0]!.group : undefined;
        const key = group && labelKey(group);
        if (key && unsetGroups(decision.snap.snapshot).some((g) => g.key === key) && !asked.includes(key)) {
          next = { type: 'Ask', group: key, reason: `${trace.note}; fit check: ${ranked!.length} options of "${group}" fit and none is determined` };
        } else if (ranked?.length && next.op === 'CLICK') {
          // Several things to open fit equally and the goal does not say which ("open a product"): take the first.
          next = { type: 'Act', op: 'CLICK', target: ranked[0]!.id, reason: `${trace.note}; fit check: ${ranked.length} candidates fit equally and the goal does not say which, so take the first` };
        } else return end('stuck', `${trace.note}; several candidates fit and it is not a question the page can ask`);
      } else {
        const [a, b] = pair.map(optionFor);
        const span = response.heads.typed_span?.choice;
        if (a && b) trace.disambiguation = { op: next.op, options: [a, b], text: next.op === 'TYPE' ? span : undefined };
        return end(a && b ? 'asked' : 'ignored');
      }
      trace.note = next.reason;
    }

    if (next.type === 'Ask') {
      const key = next.group;
      const group = controlGroups(decision.snap.snapshot).find((g) => g.key === key);
      asked.push(key);
      if (!group) continue;
      const t = performance.now();
      const answer = await hooks.ask(group, next.reason);
      waited += performance.now() - t;
      if (answer.type === 'stopped') return end('stopped', 'stopped while waiting for an answer');
      if (answer.type === 'giveup') return end('stuck', `could not understand the answer to "Which ${group.label}?"`);
      if (answer.type === 'skip') { hooks.onTrail(`Skipped ${group.label.toLowerCase()}`); hooks.onStep({ ...trace, result: 'asked' }); continue; }
      const el = nodes.get(answer.row.id);
      const done = await act({ op: 'CLICK', row: answer.row, el }, hooks, history);
      if (done.outcome.ok) { hooks.savePref(group.label, answer.row.name); hooks.onTrail(`${group.label} ${answer.row.name}. I'll remember that.`); }
      trace = { ...trace, t3: done.t3, settleMs: done.settleMs, winner: rowLine(answer.row), result: done.outcome.ok ? 'acted' : 'failed', note: `${next.reason}; the user answered "${answer.row.name}"` };
      hooks.onStep(trace);
      continue;
    }

    if (next.type === 'StartTask') return end('task');
    if (next.type === 'Continue') {
      // The DONE gate. Nothing was done; the next decision is told what is still missing.
      unmet = next.unmet;
      gated += 1;
      hooks.onStep({ ...trace, result: 'gated' });
      continue;
    }
    if (next.type === 'HandBack' && next.outcome === 'done' && task) {
      // Task end: the LLM checks the page against the goal and writes the spoken summary. Counts come from code.
      hooks.onThinking(true);
      const wide = takeSnapshot({ overlay: hooks.overlay, wide: true }).snapshot;
      const verdict = await hooks.verify({ goal: input.goal ?? '', constraints, page: pageDigest(wide), counts: countResults(wide, wanted(constraints)) });
      hooks.onThinking(false, !!verdict?.llm.ok);
      trace.llm = { ...trace.llm, verify: verdict?.llm };
      if (verdict?.llm.ok) trace.verdict = { ok: verdict.ok, issues: verdict.issues, spoken: verdict.spoken };
      return end('done');
    }
    if (next.type === 'HandBack') return end(next.outcome);
    if (next.type === 'Ignore' && next.why !== 'not_for_me' && (await behindPopup())) { step -= 1; continue; }
    if (next.type === 'Ignore') return end('ignored', undefined, next.why);
    if (next.type === 'Answer') return end('ignored', undefined, 'unsure');
    if (next.type === 'Confirm') {
      // Drive mode and the target spends money or commits: the pipeline asks for a second, explicit yes.
      const chosen = optionFor(next.target);
      if (!chosen) return end('ignored', undefined, 'not_found');
      trace.confirm = { op: next.op, option: chosen, name: next.name };
      trace.winner = chosen.line;
      return end('confirm');
    }

    // Act, or type the transcript as it is into the focused field. Labels are only ever looked up.
    let done: Awaited<ReturnType<typeof act>>;
    let pressedRole: string | undefined; // the role of what was clicked, if anything was
    if (next.type === 'Dictate') {
      const row = rowsById.get(decision.snap.snapshot.focused ?? '');
      if (row) trace.winner = rowLine(row);
      done = await act({ op: 'TYPE', row, el: row && nodes.get(row.id), text: next.text, append: true }, hooks, history);
      if (done.outcome.ok) hooks.onTrail(`Typed ${next.text}`);
    } else {
      const chosen = next.target ? optionFor(next.target) : undefined;
      if (task && chosen && !inBlocker.includes(chosen.label) && denied(chosen.row.name, input.goal ?? '')) return end('yours', `${trace.note}; "${chosen.row.name}" is on the deny-list`);
      // Never submit a form on the task leash unless the goal literally asks for it. A search form is the one exception.
      if (task && chosen && next.op === 'CLICK' && exec.submitsForm(chosen.el) && !asksFor(input.goal ?? '', chosen.row.name)) {
        return end('yours', `${trace.note}; "${chosen.row.name}" submits a form, and the goal does not ask for that`);
      }
      if (chosen) trace.winner = chosen.line;
      if (next.op === 'CLICK') pressedRole = chosen?.row.role;
      done = await act({ op: next.op, row: chosen?.row, el: chosen?.el, option: chosen?.option, text: next.text }, hooks, history);
      if (done.outcome.ok) hooks.onTrail(trailText(next.op, chosen?.row, next.text ?? chosen?.option?.label));
    }
    trace.t3 = done.t3;
    trace.settleMs = done.settleMs;
    if (done.blocker) trace.blocker = done.blocker;
    if (task) {
      // A modal that follows a press or an opened link is part of the flow. One that shows up after a filter toggle,
      // a dropdown or typing came on its own (a timer pop-up during settle) and is dismissed at the next step.
      const opened = openModal(hooks.overlay);
      const couldOpenIt = done.outcome.ok && !!pressedRole && !['checkbox', 'radio', 'switch', 'option'].includes(pressedRole);
      if (!opened || opened === flowModal || couldOpenIt) flowModal = opened;
    }
    if (done.outcome.ok) unmet = []; // the page changed: what is missing is judged afresh at the next DONE
    trace.result = done.outcome.ok ? 'acted' : 'failed';
    if (!done.outcome.ok) trace.note += `; failed: ${done.outcome.reason}`;
    hooks.onStep(trace);
  }
  return task ? end('stuck', `reached the cap of ${input.maxSteps} steps`) : trace;
}

// If an unset group's label equals a saved preference's label, act on the option whose name equals
// the saved value. No name matches exactly: ask /api/match. One attempt per group per page per task:
// the listing's Size filter and a product page's Size selector are different controls.
async function applyMemory(snap: Snap, hooks: LoopHooks, history: ActionRecord[], tried: Set<string>) {
  const prefs = hooks.prefs();
  for (const group of unsetGroups(snap.snapshot)) {
    const pref = prefs.find((p) => labelKey(p.label) === group.key);
    const attempt = `${location.pathname}|${group.key}`;
    if (!pref || tried.has(attempt)) continue;
    tried.add(attempt);
    let row = group.rows.find((r) => normalise(r.name) === normalise(pref.value));
    if (!row) {
      const choice = await hooks.matchOption(group.label, group.rows.map((r) => r.name), pref.value);
      row = group.rows.find((r) => r.name === choice);
    }
    if (!row) continue;
    const done = await act({ op: 'CLICK', row, el: snap.nodes.get(row.id), usedPref: `${group.label}: ${pref.value}` }, hooks, history);
    if (!done.outcome.ok) continue;
    hooks.onTrail(`Used your saved ${group.label.toLowerCase()}, ${row.name}`, 'memory');
    return { ...done, line: rowLine(row), note: `saved preference ${group.label} = ${pref.value}, applied in code with no model call` };
  }
  return undefined;
}

// Clean slate, once at task start. One Jev request: is the goal a refinement, and which of the filter
// options that are on does it ask for? A new search switches off the rest, except a saved preference.
// Returns how many filters were cleared.
async function cleanSlate(goal: string, hooks: LoopHooks, history: ActionRecord[], signal?: AbortSignal): Promise<{ cleared: number; refinement: boolean }> {
  const snap = takeSnapshot({ overlay: hooks.overlay, wide: true }); // filters may be scrolled out of view
  const set = setOptions(snap.snapshot);
  if (!set.length) return { cleared: 0, refinement: false };

  let answers: SlateResponse;
  try {
    const { title, headings, notices } = snap.snapshot;
    const body = { goal, page: { title, headings, notices }, filters: set.map((o) => ({ id: o.id, text: `${o.group}: ${o.option}` })) };
    const res = await env().api('/api/slate', { body: JSON.stringify(body), signal });
    if (!res.ok) return { cleared: 0, refinement: false };
    answers = (await res.json()) as SlateResponse;
  } catch {
    return { cleared: 0, refinement: false }; // without an answer, leave the page as it is
  }

  const plan = planSlate(set, answers, hooks.prefs());
  for (const kept of plan.keptPrefs) hooks.onTrail(`Kept your saved ${kept.group.toLowerCase()}, ${kept.option}`, 'memory');
  let cleared = 0;
  for (const o of plan.clear) {
    if (signal?.aborted) break;
    // Housekeeping: not part of loop detection, and not saved as a step. The task is still marked fresh, so if this
    // click reloads the page the next page parses and cleans the slate again, until nothing is left to clear.
    const done = await act({ op: 'CLICK', row: o.row, el: snap.nodes.get(o.id) }, { ...hooks, beforeAct: undefined }, []);
    if (done.outcome.ok) cleared += 1;
  }
  if (cleared) {
    hooks.onTrail(`Cleared ${cleared} old filter${cleared === 1 ? '' : 's'}`);
    history.push({ op: 'CLICK', target: `cleared ${cleared} old filters`, outcome: 'changed', ts: Date.now() });
  }
  return { cleared, refinement: plan.refinement };
}

// Price, in code. Select a price option only when its range matches the constraint exactly; otherwise
// leave the price filter alone and sort cheapest first if the page can. The overlay dims the rest.
async function applyPrice(snap: Snap, constraints: Constraints, hooks: LoopHooks, history: ActionRecord[], sortTried: boolean, markSortTried: () => void) {
  const want = wanted(constraints);
  if (!want) return undefined;
  const group = priceGroup(controlGroups(snap.snapshot));
  const exact = exactOption(group, want);
  if (exact) {
    if (/(^|, )checked/.test(exact.state ?? '')) return undefined;
    const done = await act({ op: 'CLICK', row: exact, el: snap.nodes.get(exact.id) }, hooks, history);
    if (!done.outcome.ok) return undefined;
    hooks.onTrail(trailText('CLICK', exact));
    return { ...done, line: rowLine(exact), note: `price ${exact.name} matches the constraint exactly, chosen in code with no model call` };
  }
  // A price option left over from before hides results the new limit allows: take it back if the page offers "Any price".
  const stale = group?.rows.find((r) => isChosen(r) && parseRange(r.name));
  const any = stale && group?.rows.find(isNeutral);
  if (stale && any) {
    const done = await act({ op: 'CLICK', row: any, el: snap.nodes.get(any.id) }, hooks, history);
    if (done.outcome.ok) {
      hooks.onTrail(`Cleared price ${stale.name}`);
      return { ...done, line: rowLine(any), note: `price ${stale.name} was set but does not match the constraint, cleared in code` };
    }
  }
  const sort = sortAscending(snap.snapshot);
  if (!sort || sort.already || sortTried) return undefined;
  markSortTried();
  const done = await act({ op: 'SELECT', row: sort.row, el: snap.nodes.get(sort.row.id), option: snap.options.get(`${sort.row.id}_${sort.optionId}`) }, hooks, history);
  if (!done.outcome.ok) return undefined;
  hooks.onTrail(`Sorted by ${sort.label}`);
  return { ...done, line: rowLine(sort.row), note: 'no price option matches the constraint exactly, so the filter is left alone and the results are sorted cheapest first, in code' };
}
