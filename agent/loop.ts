// The one loop. Drive and delegate differ only by the leash: maxSteps 1 versus 25.
// snapshot → (task: saved preferences, in code) → /api/decide → policy.resolve → execute → settle → record.
import { candidates, groupsByLabel, rowLine, type Candidates } from '../shared/candidates';
import { MAX_TASK_MS, type LabelStyle } from '../shared/config';
import { fitPool, rankFits } from '../shared/fits';
import { controlGroups, labelKey, unsetGroups, type ControlGroup } from '../shared/groups';
import { denied, resolve, type Resolution, type Why } from '../shared/policy';
import { planSlate, setOptions } from '../shared/slate';
import { normalise } from '../shared/speech';
import type {
  ActionRecord, ApiError, DecideRequest, DecideResponse, ElementRow, FitsResponse, Leash, Operation, Preference, SlateResponse,
} from '../shared/types';
import * as exec from './execute';
import { takeSnapshot, type Snap } from './snapshot';

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
  rowNames: Map<string, string>;
  result: 'acted' | 'ignored' | 'asked' | 'confirm' | 'task' | 'done' | 'stuck' | 'yours' | 'stopped' | 'failed' | 'error';
  note: string;
};

// The question card. The page writes the question: its group label and its option names.
export type AskResult = { type: 'answer'; row: ElementRow } | { type: 'skip' } | { type: 'giveup' } | { type: 'stopped' };

export type LoopHooks = {
  overlay: Element;
  labelStyle: () => LabelStyle;
  pageFocus: () => Element | null;
  onRing: (rect: DOMRect) => void;
  onStep: (trace: Trace) => void; // after every step, for the inspector
  onTrail: (text: string, tone?: 'memory') => void; // what was done
  onDriving: () => void; // a second step is beginning: the agent is visibly driving
  prefs: () => Preference[];
  savePref: (label: string, value: string) => void;
  ask: (group: ControlGroup, reason: string) => Promise<AskResult>;
  matchOption: (group: string, options: string[], answer: string) => Promise<string | undefined>; // /api/match
};

const driveHistory: ActionRecord[] = [];
const describeTarget = (row?: ElementRow) => (row ? [row.role, row.name, row.group].filter(Boolean).join(' · ') : undefined);

export async function decideOnce(
  input: { utterance?: string; goal?: string; leash: Leash; history: ActionRecord[]; asked?: string[]; prefs?: Preference[] },
  hooks: Pick<LoopHooks, 'overlay' | 'labelStyle' | 'pageFocus'>, signal?: AbortSignal, taken?: Snap,
): Promise<Decision> {
  const snap = taken ?? takeSnapshot({ overlay: hooks.overlay, focused: hooks.pageFocus() });
  const cands = candidates(snap.snapshot);
  const decision: Decision = {
    utterance: input.utterance ?? input.goal ?? '', snap, cands,
    rowsById: new Map(snap.snapshot.rows.map((r) => [r.id, r])),
    rowNames: new Map<string, string>([
      ...snap.snapshot.rows.map((r) => [r.id, `${r.role} ${r.name}`.slice(0, 36)] as [string, string]),
      ...cands.select.map((s) => [s.label, s.optionLabel.slice(0, 36)] as [string, string]),
    ]),
    t1: performance.now(), t2: 0,
  };
  const body: DecideRequest = {
    leash: input.leash, utterance: input.utterance, goal: input.goal, prefs: input.prefs ?? [],
    history: input.history.slice(-6), snapshot: snap.snapshot, asked: input.asked, labelStyle: hooks.labelStyle(),
  };
  try {
    const res = await fetch('/api/decide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
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
    const res = await fetch('/api/fits', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ utterance, rows, leash }), signal });
    return res.ok ? ((await res.json()) as FitsResponse) : undefined;
  } catch {
    return undefined;
  }
}

// Carry out one chosen operation on one element, then wait for the page to settle.
export async function act(
  action: { op: Operation; row?: ElementRow; el?: Element; option?: HTMLOptionElement; text?: string; append?: boolean; usedPref?: string },
  hooks: Pick<LoopHooks, 'overlay' | 'onRing'>, history: ActionRecord[] = driveHistory,
): Promise<{ outcome: exec.ExecResult; t3: number; settleMs: number }> {
  const before = { url: location.href, scrollY: window.scrollY };
  const { op, el } = action;
  let outcome: exec.ExecResult;
  if (op === 'SCROLL_DOWN') outcome = exec.scroll(1);
  else if (op === 'SCROLL_UP') outcome = exec.scroll(-1);
  else if (op === 'GO_BACK') outcome = exec.back();
  else if (!el) outcome = { ok: false, reason: 'the chosen label is not in this snapshot' };
  else if (op === 'CLICK') outcome = exec.click(el, hooks.overlay, hooks.onRing);
  else if (op === 'TYPE') outcome = exec.type(el, action.text ?? '', hooks.overlay, hooks.onRing, { append: action.append, submit: !action.append });
  else if (op === 'SELECT') outcome = exec.select(el, action.option, hooks.overlay, hooks.onRing);
  else outcome = { ok: false, reason: `nothing to execute for ${op}` };
  const t3 = performance.now();

  const settled = await exec.settle(hooks.overlay, before);
  history.push({
    op, target: action.row?.name || describeTarget(action.row), value: action.text ?? action.option?.label, usedPref: action.usedPref,
    outcome: !outcome.ok ? 'failed' : settled.changed ? 'changed' : 'no_change', ts: Date.now(),
  });
  return { outcome, t3, settleMs: settled.ms };
}

const VERB: Partial<Record<Operation, string>> = { SCROLL_DOWN: 'Scrolled down', SCROLL_UP: 'Scrolled up', GO_BACK: 'Went back' };
function trailText(op: Operation, row?: ElementRow, value?: string): string {
  if (VERB[op]) return VERB[op]!;
  if (op === 'TYPE') return `Typed "${value}"`;
  if (op === 'SELECT') return `Chose ${value}`;
  return row?.group && ['checkbox', 'radio', 'switch'].includes(row.role) ? `${row.group.replace(/\s*\(.*\)/, '')}: ${row.name}` : `Opened ${row?.name ?? ''}`;
}

export async function runLoop(
  input: { utterance?: string; goal?: string; leash: Leash; maxSteps: number; heard: Heard; prepared?: Promise<Decision>; specMissed?: boolean; signal?: AbortSignal },
  hooks: LoopHooks,
): Promise<Trace> {
  const task = input.leash === 'task';
  const said = input.utterance ?? input.goal ?? '';
  const history: ActionRecord[] = task ? [] : driveHistory; // loop detection looks at this task only
  const asked: string[] = []; // group keys asked or skipped in this task
  const memoryTried = new Set<string>();
  const started = performance.now();
  let waited = 0; // time spent waiting for the user does not count against the task clock
  let trace!: Trace;
  const end = (result: Trace['result'], note?: string, why?: Why): Trace => { trace = { ...trace, result, note: note ?? trace.note, why }; hooks.onStep(trace); return trace; };

  // A new search starts from a clean slate; a refinement keeps what is there.
  const cleared = task ? await cleanSlate(input.goal ?? '', hooks, history, input.signal) : 0;

  for (let step = 0; step < input.maxSteps; step++) {
    if (step === 1 || (step === 0 && cleared)) hooks.onDriving(); // the frame appears only when a second step begins
    const snap = takeSnapshot({ overlay: hooks.overlay, focused: hooks.pageFocus() });
    trace = {
      utterance: said, leash: input.leash, step, heard: input.heard, speculative: 'none', rows: snap.snapshot.rows.length,
      snapshotMs: snap.ms, t1: performance.now(), t2: performance.now(), rowNames: new Map(), result: 'error', note: '',
    };
    if (input.signal?.aborted) return end('stopped', 'stopped before acting');
    if (task && performance.now() - started - waited > MAX_TASK_MS) return end('stuck', `the task ran past ${MAX_TASK_MS / 1000} s`);

    // Saved preferences are applied in code, before Jev is asked for the next operation.
    if (task) {
      const applied = await applyMemory(snap, hooks, history, memoryTried);
      if (applied) { trace = { ...trace, t3: applied.t3, settleMs: applied.settleMs, winner: applied.line, result: 'acted', note: applied.note }; hooks.onStep(trace); continue; }
    }

    // A decision made on a matching interim transcript is reused; otherwise decide now.
    let decision = step === 0 && input.prepared ? await input.prepared : undefined;
    const speculative = step !== 0 ? 'none' : input.prepared ? (decision?.response ? 'hit' : 'miss') : input.specMissed ? 'miss' : 'none';
    if (!decision?.response) {
      decision = await decideOnce({ utterance: input.utterance, goal: input.goal, leash: input.leash, history, asked, prefs: task ? hooks.prefs() : [] }, hooks, input.signal, snap);
    }
    const { cands, rowsById, response } = decision;
    const nodes = decision.snap.nodes;
    trace = { ...trace, speculative, rows: decision.snap.snapshot.rows.length, snapshotMs: decision.snap.ms, t1: decision.t1, t2: decision.t2, response, rowNames: decision.rowNames, note: decision.error ?? '' };
    if (input.signal?.aborted) return end('stopped', 'stopped before acting');
    if (!response) return end('error');

    const names: Record<string, string> = {};
    for (const r of decision.snap.snapshot.rows) names[r.id] = r.name;
    for (const s of cands.select) names[s.label] = s.optionLabel;
    const resolution = resolve(response.heads, {
      leash: input.leash, utterance: input.utterance, goal: input.goal, useKind: !task, groups: groupsByLabel(cands),
      names, needs: response.needs, asked, history,
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
      if (ranked?.length === 0) return end(task ? 'stuck' : 'ignored', `${trace.note}; fit check: no candidate fits`, 'not_found');
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
      if (answer.type === 'skip') { hooks.onTrail(`${group.label}: skipped`); hooks.onStep({ ...trace, result: 'asked' }); continue; }
      const el = nodes.get(answer.row.id);
      const done = await act({ op: 'CLICK', row: answer.row, el }, hooks, history);
      if (done.outcome.ok) { hooks.savePref(group.label, answer.row.name); hooks.onTrail(`${group.label}: ${answer.row.name} (saved)`); }
      trace = { ...trace, t3: done.t3, settleMs: done.settleMs, winner: rowLine(answer.row), result: done.outcome.ok ? 'acted' : 'failed', note: `${next.reason}; the user answered "${answer.row.name}"` };
      hooks.onStep(trace);
      continue;
    }

    if (next.type === 'StartTask') return end('task');
    if (next.type === 'HandBack') return end(next.outcome);
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
    if (next.type === 'Dictate') {
      const row = rowsById.get(decision.snap.snapshot.focused ?? '');
      if (row) trace.winner = rowLine(row);
      done = await act({ op: 'TYPE', row, el: row && nodes.get(row.id), text: next.text, append: true }, hooks, history);
      if (done.outcome.ok) hooks.onTrail(`Typed "${next.text}"`);
    } else {
      const chosen = next.target ? optionFor(next.target) : undefined;
      if (task && chosen && denied(chosen.row.name, input.goal ?? '')) return end('yours', `${trace.note}; "${chosen.row.name}" is on the deny-list`);
      if (chosen) trace.winner = chosen.line;
      done = await act({ op: next.op, row: chosen?.row, el: chosen?.el, option: chosen?.option, text: next.text }, hooks, history);
      if (done.outcome.ok) hooks.onTrail(trailText(next.op, chosen?.row, next.text ?? chosen?.option?.label));
    }
    trace.t3 = done.t3;
    trace.settleMs = done.settleMs;
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
    hooks.onTrail(`Used your saved ${group.label.toLowerCase()}: ${row.name}`, 'memory');
    return { ...done, line: rowLine(row), note: `saved preference ${group.label} = ${pref.value}, applied in code with no model call` };
  }
  return undefined;
}

// Clean slate, once at task start. One Jev request: is the goal a refinement, and which of the filter
// options that are on does it ask for? A new search switches off the rest, except a saved preference.
// Returns how many filters were cleared.
async function cleanSlate(goal: string, hooks: LoopHooks, history: ActionRecord[], signal?: AbortSignal): Promise<number> {
  const snap = takeSnapshot({ overlay: hooks.overlay, wide: true }); // filters may be scrolled out of view
  const set = setOptions(snap.snapshot);
  if (!set.length) return 0;

  let answers: SlateResponse;
  try {
    const { title, headings, notices } = snap.snapshot;
    const body = { goal, page: { title, headings, notices }, filters: set.map((o) => ({ id: o.id, text: `${o.group}: ${o.option}` })) };
    const res = await fetch('/api/slate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
    if (!res.ok) return 0;
    answers = (await res.json()) as SlateResponse;
  } catch {
    return 0; // without an answer, leave the page as it is
  }

  const plan = planSlate(set, answers, hooks.prefs());
  for (const kept of plan.keptPrefs) hooks.onTrail(`Kept your saved ${kept.group.toLowerCase()}: ${kept.option}`, 'memory');
  let cleared = 0;
  for (const o of plan.clear) {
    if (signal?.aborted) break;
    const done = await act({ op: 'CLICK', row: o.row, el: snap.nodes.get(o.id) }, hooks, []); // housekeeping: not part of loop detection
    if (done.outcome.ok) cleared += 1;
  }
  if (cleared) {
    hooks.onTrail(`Cleared ${cleared} old filter${cleared === 1 ? '' : 's'}`);
    history.push({ op: 'CLICK', target: `cleared ${cleared} old filters`, outcome: 'changed', ts: Date.now() });
  }
  return cleared;
}
