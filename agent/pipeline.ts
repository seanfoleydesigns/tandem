// From words to an action. Typed commands, the recognizer and the dev simulator all arrive here.
// Order of business for every transcript: stop (code), "one / two" (code), then the one loop (Jev).
import { INTERIM_STABLE_MS, WARM_EVERY_MS } from '../shared/config';
import { isStop, normalise, pickOneOrTwo } from '../shared/speech';
import { act, decideOnce, runLoop, type Decision, type Disambiguation, type LoopHooks, type Trace } from './loop';
import type { Overlay } from './ui/overlay';
import type { Voice } from './voice';

export function createPipeline(overlay: Overlay, getVoice: () => Voice) {
  const hooks: LoopHooks = {
    overlay: overlay.host,
    labelStyle: overlay.labelStyle,
    pageFocus: overlay.pageFocus,
    onRing: overlay.ring,
  };

  let busy = false;
  let abort: AbortController | undefined;
  let pending: Disambiguation | undefined; // badges are up, waiting for "one" or "two"
  let lastWarm = -Infinity;

  // The utterance being spoken right now.
  let interimText = '';
  let lastInterimAt: number | undefined;
  let stableTimer: ReturnType<typeof setTimeout> | undefined;
  let spec: { text: string; promise: Promise<Decision>; controller: AbortController } | undefined;
  let swallowFinal = false; // the utterance was a stop; its final transcript is not a new command
  const waiters: ((t: Trace | undefined) => void)[] = [];

  // An idle connection to Jev closes after a few seconds. Open it while the user is still talking or typing.
  function warm() {
    if (performance.now() - lastWarm < WARM_EVERY_MS) return;
    lastWarm = performance.now();
    void fetch('/api/warm', { method: 'POST' }).catch(() => {});
  }

  function dropSpec() {
    clearTimeout(stableTimer);
    spec?.controller.abort();
    spec = undefined;
  }

  function resetUtterance() {
    interimText = '';
    lastInterimAt = undefined;
    dropSpec();
  }

  function finish(trace: Trace | undefined) {
    if (trace) overlay.showTrace(trace);
    waiters.splice(0).forEach((w) => w(trace));
  }

  // Stop is code: no model call. Halts whatever is in flight and clears any question on screen.
  function stop(source: string) {
    abort?.abort();
    dropSpec();
    getVoice().cancelSpeech();
    if (pending) { pending = undefined; overlay.badges(undefined); }
    overlay.showStatus(`Stopped (${source})`, 'ok');
  }

  async function choose(index: 0 | 1, heard: Trace['heard'], said: string) {
    const d = pending!;
    pending = undefined;
    overlay.badges(undefined);
    const o = d.options[index];
    busy = true;
    try {
      const done = await act({ op: d.op, row: o.row, el: o.el, option: o.option, text: d.text }, hooks);
      finish({
        utterance: said, leash: 'single', heard, speculative: 'none', rows: 0, snapshotMs: 0, t1: heard.final, t2: heard.final,
        t3: done.t3, settleMs: done.settleMs, winner: o.line, rowNames: new Map(),
        result: done.outcome.ok ? 'acted' : 'failed',
        note: `"${said}" chose candidate ${index + 1} in code, with no model call${done.outcome.ok ? '' : ` — failed: ${done.outcome.reason}`}`,
      });
    } finally { busy = false; }
  }

  async function command(text: string, heard: Trace['heard']) {
    if (isStop(text)) { stop('said'); return finish(undefined); }
    if (pending) {
      const pick = pickOneOrTwo(text);
      if (pick !== undefined) return choose(pick, heard, text);
      pending = undefined; // anything else is a new command
      overlay.badges(undefined);
    }
    if (busy) { overlay.showStatus(`“${text}” ignored: still working`, 'unsure'); return finish(undefined); }

    const prepared = spec && normalise(spec.text) === normalise(text) ? spec.promise : undefined;
    const specMissed = !!spec && !prepared; // a decision was fired on an interim transcript that turned out different
    if (!prepared) dropSpec();
    spec = undefined;

    busy = true;
    abort = new AbortController();
    overlay.setBusy(text);
    try {
      // Drive mode: the same loop as delegate mode, on a leash of one step.
      const trace = await runLoop({ utterance: text, leash: 'single', maxSteps: 1, heard, prepared, specMissed, signal: abort.signal }, hooks);
      if (trace.disambiguation) {
        pending = trace.disambiguation;
        overlay.badges(pending.options.map((o) => o.el) as [Element, Element], (i) => void choose(i, { final: performance.now() }, `tap ${i + 1}`));
        getVoice().speak('One or two?');
      }
      finish(trace);
    } finally { busy = false; abort = undefined; }
  }

  return {
    stop,
    warm,
    // The command bar does everything voice does.
    typed: (text: string) => command(text, { final: performance.now() }),

    onSpeechStart: warm,

    onInterim(text: string) {
      overlay.showInterim(text);
      warm();
      if (swallowFinal) return;
      if (isStop(text)) { swallowFinal = true; resetUtterance(); return stop('heard mid-sentence'); }
      if (normalise(text) === normalise(interimText)) return;
      interimText = text;
      lastInterimAt = performance.now();
      clearTimeout(stableTimer);
      // Speculative decide: the transcript has stopped changing, so ask Jev now and keep the answer
      // for the final transcript. "one" / "two" replies and busy periods need no model call.
      stableTimer = setTimeout(() => {
        if (busy || (pending && pickOneOrTwo(text) !== undefined)) return;
        spec?.controller.abort();
        const controller = new AbortController();
        spec = { text, controller, promise: decideOnce(text, 'single', hooks, controller.signal) };
      }, INTERIM_STABLE_MS);
    },

    onFinal(text: string) {
      const heard = { final: performance.now(), lastInterim: lastInterimAt };
      clearTimeout(stableTimer);
      interimText = '';
      lastInterimAt = undefined;
      if (swallowFinal) { swallowFinal = false; dropSpec(); return finish(undefined); }
      if (!text.trim()) return finish(undefined);
      void command(text, heard);
    },

    // Resolves with the trace of the next command that finishes. Used by the dev simulator.
    next: () => new Promise<Trace | undefined>((r) => waiters.push(r)),
  };
}
