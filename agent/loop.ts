// The one loop. Drive and delegate differ only by the leash: maxSteps 1 versus 25.
// snapshot → /api/decide → policy.resolve → execute → settle → record.
import { candidates, groupsByLabel, rowLine, type Candidates } from '../shared/candidates';
import type { LabelStyle } from '../shared/config';
import { fitPool, rankFits } from '../shared/fits';
import { resolve, type Resolution } from '../shared/policy';
import type { ActionRecord, ApiError, DecideRequest, DecideResponse, ElementRow, FitsResponse, Leash, Operation } from '../shared/types';
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
  fit?: { ms: number; asked: number; fits: { line: string; noul: number }[] }; // the follow-up fit check, when one ran
  rowNames: Map<string, string>;
  result: 'acted' | 'ignored' | 'asked' | 'task' | 'stopped' | 'failed' | 'error';
  note: string;
};

export type LoopHooks = {
  overlay: Element;
  labelStyle: () => LabelStyle;
  pageFocus: () => Element | null;
  onRing: (rect: DOMRect) => void;
};

const history: ActionRecord[] = [];
const describeTarget = (row?: ElementRow) => (row ? [row.role, row.name, row.group].filter(Boolean).join(' · ') : undefined);

export async function decideOnce(utterance: string, leash: Leash, hooks: LoopHooks, signal?: AbortSignal): Promise<Decision> {
  const snap = takeSnapshot({ overlay: hooks.overlay, focused: hooks.pageFocus() });
  const cands = candidates(snap.snapshot);
  const decision: Decision = {
    utterance, snap, cands,
    rowsById: new Map(snap.snapshot.rows.map((r) => [r.id, r])),
    rowNames: new Map<string, string>([
      ...snap.snapshot.rows.map((r) => [r.id, `${r.role} ${r.name}`.slice(0, 36)] as [string, string]),
      ...cands.select.map((s) => [s.label, s.optionLabel.slice(0, 36)] as [string, string]),
    ]),
    t1: performance.now(), t2: 0,
  };
  const body: DecideRequest = {
    leash, utterance, prefs: [], history: history.slice(-6), snapshot: snap.snapshot, labelStyle: hooks.labelStyle(),
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
async function fitCheck(utterance: string, rows: ElementRow[], signal?: AbortSignal): Promise<FitsResponse | undefined> {
  try {
    const res = await fetch('/api/fits', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ utterance, rows }), signal });
    return res.ok ? ((await res.json()) as FitsResponse) : undefined;
  } catch {
    return undefined;
  }
}

// Carry out one chosen operation on one element, then wait for the page to settle.
export async function act(
  action: { op: Operation; row?: ElementRow; el?: Element; option?: HTMLOptionElement; text?: string; append?: boolean },
  hooks: LoopHooks,
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
    op, target: describeTarget(action.row), value: action.text ?? action.option?.label,
    outcome: !outcome.ok ? 'failed' : settled.changed ? 'changed' : 'no_change', ts: Date.now(),
  });
  return { outcome, t3, settleMs: settled.ms };
}

export async function runLoop(
  input: { utterance: string; leash: Leash; maxSteps: number; heard: Heard; prepared?: Promise<Decision>; specMissed?: boolean; signal?: AbortSignal },
  hooks: LoopHooks,
): Promise<Trace> {
  let trace!: Trace;
  for (let step = 0; step < input.maxSteps; step++) {
    // A decision made on a matching interim transcript is reused; otherwise decide now.
    let decision = step === 0 && input.prepared ? await input.prepared : undefined;
    const speculative = step !== 0 ? 'none' : input.prepared ? (decision?.response ? 'hit' : 'miss') : input.specMissed ? 'miss' : 'none';
    if (!decision?.response) decision = await decideOnce(input.utterance, input.leash, hooks, input.signal);
    const { snap, cands, rowsById, response } = decision;

    trace = {
      utterance: input.utterance, leash: input.leash, heard: input.heard, speculative,
      rows: snap.snapshot.rows.length, snapshotMs: snap.ms, t1: decision.t1, t2: decision.t2,
      response, rowNames: decision.rowNames, result: 'error', note: decision.error ?? '',
    };
    if (input.signal?.aborted) return { ...trace, result: 'stopped', note: 'stopped before acting' };
    if (!response) return trace;

    const resolution = resolve(response.heads, {
      leash: input.leash, utterance: input.utterance, useKind: true, groups: groupsByLabel(cands),
    });
    trace.resolution = resolution;
    trace.note = resolution.reason;

    const optionFor = (label: string): Option | undefined => {
      const pick = cands.select.find((s) => s.label === label);
      const row = pick?.row ?? rowsById.get(label);
      const el = row && snap.nodes.get(row.id);
      return row && el ? { label, line: rowLine(row), row, el, option: pick && snap.options.get(pick.label) } : undefined;
    };

    if (resolution.type === 'Disambiguate') {
      // Jev's Choice names one winner even when several candidates fit equally well, so ask a
      // yes/no question about each candidate like it. Two or more fit: badge the best two.
      // Exactly one fits: that is the answer. None fit: give up.
      let pair = resolution.candidates;
      const anchor = rowsById.get(pair[0]);
      if (anchor && !anchor.options) {
        const pool = fitPool(anchor.role === 'textbox' || anchor.role === 'searchbox' ? cands.type : cands.click, anchor, [anchor.id]);
        const checked = await fitCheck(input.utterance, pool, input.signal);
        if (checked) {
          const ranked = rankFits(pool, checked.fits);
          trace.fit = { ms: checked.ms, asked: pool.length, fits: ranked.slice(0, 6).map((r) => ({ line: rowLine(r), noul: checked.fits[r.id] ?? 0 })) };
          if (ranked.length >= 2) pair = [ranked[0]!.id, ranked[1]!.id];
          else if (ranked.length === 1 && resolution.op === 'CLICK') {
            const only = optionFor(ranked[0]!.id)!;
            trace.winner = only.line;
            trace.note += `; fit check: only one of ${pool.length} candidates fits, so act on it`;
            const done = await act({ op: 'CLICK', row: only.row, el: only.el }, hooks);
            return { ...trace, t3: done.t3, settleMs: done.settleMs, result: done.outcome.ok ? 'acted' : 'failed' };
          } else if (ranked.length === 0) return { ...trace, result: 'ignored', note: `${trace.note}; fit check: none of ${pool.length} candidates fits` };
        }
      }
      const [a, b] = pair.map(optionFor);
      const span = response.heads.typed_span?.choice;
      if (a && b) trace.disambiguation = { op: resolution.op, options: [a, b], text: resolution.op === 'TYPE' ? span : undefined };
      return { ...trace, result: a && b ? 'asked' : 'ignored' };
    }
    if (resolution.type === 'StartTask') return { ...trace, result: 'task', note: `${resolution.reason}. Delegate mode arrives in M3.` };
    if (resolution.type === 'HandBack') return { ...trace, result: resolution.outcome === 'stopped' ? 'stopped' : 'ignored' };
    if (resolution.type === 'Ignore' || resolution.type === 'Ask' || resolution.type === 'Answer') return { ...trace, result: 'ignored' };

    // Act, or type the transcript as it is into the focused field. Labels are only ever looked up.
    let done: Awaited<ReturnType<typeof act>>;
    if (resolution.type === 'Dictate') {
      const row = rowsById.get(snap.snapshot.focused ?? '');
      if (row) trace.winner = rowLine(row);
      done = await act({ op: 'TYPE', row, el: row && snap.nodes.get(row.id), text: resolution.text, append: true }, hooks);
    } else {
      const chosen = resolution.target ? optionFor(resolution.target) : undefined;
      if (chosen) trace.winner = chosen.line;
      done = await act({ op: resolution.op, row: chosen?.row, el: chosen?.el, option: chosen?.option, text: resolution.text }, hooks);
    }
    trace.t3 = done.t3;
    trace.settleMs = done.settleMs;
    trace.result = done.outcome.ok ? 'acted' : 'failed';
    if (!done.outcome.ok) trace.note += ` — failed: ${done.outcome.reason}`;
  }
  return trace;
}
