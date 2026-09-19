// The one loop. Drive and delegate differ only by the leash: maxSteps 1 versus 25.
// snapshot → /api/decide → policy.resolve → execute → settle → record.
import { candidates, groupsByLabel, rowLine } from '../shared/candidates';
import type { LabelStyle } from '../shared/config';
import { resolve, type Resolution } from '../shared/policy';
import type { ActionRecord, ApiError, DecideRequest, DecideResponse, ElementRow, Leash } from '../shared/types';
import * as exec from './execute';
import { takeSnapshot } from './snapshot';

export type Trace = {
  utterance: string;
  leash: Leash;
  rows: number;
  snapshotMs: number;
  t: { t0: number; t1: number; t2: number; t3?: number }; // ms since page load
  settleMs?: number;
  response?: DecideResponse;
  resolution?: Resolution;
  winner?: string; // the snapshot row that won, as sent to Jev
  candidates?: string[]; // top two, when the policy wants to disambiguate
  rowNames: Map<string, string>; // label -> short name, for the inspector
  result: 'acted' | 'ignored' | 'failed' | 'error';
  note: string;
};

export type LoopHooks = {
  overlay: Element;
  labelStyle: () => LabelStyle;
  pageFocus: () => Element | null;
  onRing: (rect: DOMRect) => void;
  onTrace: (trace: Trace) => void;
};

const history: ActionRecord[] = [];
const describeTarget = (row?: ElementRow) => (row ? [row.role, row.name, row.group].filter(Boolean).join(' · ') : undefined);

export async function runLoop(input: { utterance: string; leash: Leash; maxSteps: number }, hooks: LoopHooks): Promise<void> {
  for (let step = 0; step < input.maxSteps; step++) {
    const t0 = performance.now();
    const snap = takeSnapshot({ overlay: hooks.overlay, focused: hooks.pageFocus() });
    const rowsById = new Map(snap.snapshot.rows.map((r) => [r.id, r]));
    const cands = candidates(snap.snapshot);
    const rowNames = new Map<string, string>([
      ...snap.snapshot.rows.map((r) => [r.id, `${r.role} ${r.name}`.slice(0, 36)] as [string, string]),
      ...cands.select.map((s) => [s.label, s.optionLabel.slice(0, 36)] as [string, string]),
    ]);
    const trace: Trace = {
      utterance: input.utterance, leash: input.leash, rows: snap.snapshot.rows.length, snapshotMs: snap.ms,
      t: { t0, t1: 0, t2: 0 }, result: 'error', note: '', rowNames,
    };

    const body: DecideRequest = {
      leash: input.leash, utterance: input.utterance, prefs: [], history: history.slice(-6),
      snapshot: snap.snapshot, labelStyle: hooks.labelStyle(),
    };
    trace.t.t1 = performance.now();
    let response: DecideResponse;
    try {
      const res = await fetch('/api/decide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const json = (await res.json()) as DecideResponse | ApiError;
      trace.t.t2 = performance.now();
      if (!res.ok || 'error' in json) throw new Error('error' in json ? json.error : `HTTP ${res.status}`);
      response = json;
    } catch (err) {
      trace.t.t2 ||= performance.now();
      trace.note = err instanceof Error ? err.message : String(err);
      hooks.onTrace(trace);
      return;
    }
    trace.response = response;

    const resolution = resolve(response.heads, {
      leash: input.leash, utterance: input.utterance, useKind: false, groups: groupsByLabel(cands),
    });
    trace.resolution = resolution;
    trace.note = resolution.reason;

    if (resolution.type === 'Disambiguate') {
      trace.candidates = resolution.candidates.map((label) => {
        const row = rowsById.get(label) ?? cands.select.find((s) => s.label === label)?.row;
        return row ? rowLine(row) : label;
      });
    }
    if (resolution.type !== 'Act') {
      trace.result = 'ignored';
      hooks.onTrace(trace);
      return;
    }

    // Act. A label is only ever looked up in maps built from this snapshot.
    const before = { url: location.href, scrollY: window.scrollY };
    let outcome: exec.ExecResult;
    let row: ElementRow | undefined;
    let value: string | undefined;
    if (resolution.op === 'SCROLL_DOWN') outcome = exec.scroll(1);
    else if (resolution.op === 'SCROLL_UP') outcome = exec.scroll(-1);
    else if (resolution.op === 'GO_BACK') outcome = exec.back();
    else {
      const pick = cands.select.find((s) => s.label === resolution.target);
      row = resolution.op === 'SELECT' ? pick?.row : rowsById.get(resolution.target ?? '');
      const el = row && snap.nodes.get(row.id);
      if (!row || !el) outcome = { ok: false, reason: 'the chosen label is not in this snapshot' };
      else {
        trace.winner = rowLine(row);
        if (resolution.op === 'CLICK') outcome = exec.click(el, hooks.overlay, hooks.onRing);
        else if (resolution.op === 'TYPE') outcome = exec.type(el, (value = resolution.text ?? ''), hooks.overlay, hooks.onRing);
        else {
          value = pick!.optionLabel;
          outcome = exec.select(el, snap.options.get(pick!.label), hooks.overlay, hooks.onRing);
        }
      }
    }
    trace.t.t3 = performance.now();

    const settled = await exec.settle(hooks.overlay, before);
    trace.settleMs = settled.ms;
    trace.result = outcome.ok ? 'acted' : 'failed';
    if (!outcome.ok) trace.note += ` — failed: ${outcome.reason}`;
    history.push({
      op: resolution.op, target: describeTarget(row), value,
      outcome: !outcome.ok ? 'failed' : settled.changed ? 'changed' : 'no_change', ts: Date.now(),
    });
    hooks.onTrace(trace);
  }
}
