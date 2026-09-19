// From words to an action. Typed commands, the recognizer and the dev simulator all arrive here.
// Order of business for every transcript: stop (code), an open question (code, then /api/match),
// "one / two" (code), a "Narrow by" chip (code), then the one loop (Jev).
import { INTERIM_STABLE_MS, MAX_STEPS, MAX_UNCLEAR, SAVE_MIN, WARM_EVERY_MS } from '../shared/config';
import { pageDigest } from '../shared/digest';
import { unsetGroups, type ControlGroup } from '../shared/groups';
import { noMatches } from '../shared/notices';
import { mentionsPrice, pricedCards, wanted, within, type Range } from '../shared/price';
import { MATCH_SKIP, MATCH_UNCLEAR } from '../shared/questions';
import { isStop, normalise, pickOneOrTwo, pickYesOrNo } from '../shared/speech';
import type { Constraints, ElementRow, MatchResponse, ParseResponse, VerifyRequest, VerifyResponse } from '../shared/types';
import { act, confirmationFor, decideOnce, runLoop, type AskResult, type Decision, type Disambiguation, type LoopHooks, type Trace } from './loop';
import { deletePref, listPrefs, savePref } from './memory';
import { takeSnapshot } from './snapshot';
import type { Overlay } from './ui/overlay';
import type { Voice } from './voice';

export function createPipeline(overlay: Overlay, getVoice: () => Voice) {
  let busy = false;
  let abort: AbortController | undefined;
  let pending: Disambiguation | undefined; // badges are up, waiting for "one" or "two"
  let question: { group: ControlGroup; hear: (text: string) => void; settle: (r: AskResult) => void } | undefined;
  let narrow: ControlGroup[] = []; // "Narrow by" chips on screen after a hand-back
  let confirming: { settle: (yes: boolean) => void } | undefined; // "Click Checkout?" is on screen
  const personal: Record<string, number> = {}; // group key -> the latest personal Noul, to decide what is worth remembering
  let lastWarm = -Infinity;
  const traces: Trace[] = []; // the decision log
  let constraints: Constraints = {}; // what the LLM parsed from the last task's goal; a refinement builds on it

  // The utterance being spoken right now.
  let interimText = '';
  let lastInterimAt: number | undefined;
  let stableTimer: ReturnType<typeof setTimeout> | undefined;
  let spec: { text: string; promise: Promise<Decision>; controller: AbortController } | undefined;
  let swallowFinal = false; // the utterance was a stop; its final transcript is not a new command
  const waiters: ((t: Trace | undefined) => void)[] = [];

  const showMemory = () => overlay.memory(listPrefs(), (label) => { deletePref(label); showMemory(); });

  // /api/match: which option does this answer mean? Returns an option name, "skip", "unclear", or nothing on failure.
  async function matchOption(group: string, options: string[], answer: string): Promise<string | undefined> {
    try {
      const res = await fetch('/api/match', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ group, options, answer }) });
      return res.ok ? ((await res.json()) as MatchResponse).head.choice : undefined;
    } catch {
      return undefined;
    }
  }

  // ---- M4: the LLM at the edges. Reached only from the task leash, through these two functions. ----
  const post = async <T>(url: string, body: unknown): Promise<T | undefined> => {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return res.ok ? ((await res.json()) as T) : undefined;
    } catch {
      return undefined; // no server, no key, a timeout: the task carries on without the LLM
    }
  };
  function parseGoal(goal: string) {
    const { title, categories, filters } = pageDigest(takeSnapshot({ overlay: overlay.host, wide: true }).snapshot);
    return post<ParseResponse>('/api/parse', { goal, page: { title, categories, filters } });
  }
  const verify = (req: VerifyRequest) => post<VerifyResponse>('/api/verify', req);

  // Price is code's job. Cards outside the wanted range are dimmed by the overlay; the page is not touched.
  const money = (n: number) => `$${n}`;
  const rangeLabel = (r: Range) =>
    r.min > 0 && r.max !== Infinity ? `Outside ${money(r.min)} to ${money(r.max)}` : r.max !== Infinity ? `Over ${money(r.max)}` : `Under ${money(r.min)}`;
  function refreshDim() {
    const want = wanted(constraints);
    if (!want) return overlay.dim([], '');
    const snap = takeSnapshot({ overlay: overlay.host, wide: true });
    const outside = pricedCards(snap.snapshot)
      .filter((c) => c.price !== undefined && !within(c.price, want))
      .map((c) => snap.nodes.get(c.row.id))
      .filter((el): el is Element => !!el);
    overlay.dim(outside, rangeLabel(want));
  }
  // The list can change under us (the user filters by hand, "Load more"): keep the dimming current.
  let dimTimer: ReturnType<typeof setTimeout>;
  new MutationObserver((records) => {
    if (!wanted(constraints) || records.every((r) => r.target === overlay.host)) return;
    clearTimeout(dimTimer);
    dimTimer = setTimeout(refreshDim, 250);
  }).observe(document.documentElement, { subtree: true, childList: true });

  // The question card. The page writes the question: the group's own label and option names.
  function ask(group: ControlGroup, _reason: string): Promise<AskResult> {
    return new Promise<AskResult>((resolve) => {
      let unclear = 0;
      const settle = (r: AskResult) => {
        if (question?.group !== group) return;
        question = undefined;
        overlay.question(undefined);
        overlay.setMode(busy ? 'agent' : 'user');
        resolve(r);
      };
      const hear = async (text: string) => {
        // Code first: the answer may simply be an option's name. Otherwise Jev matches it.
        const exact = group.rows.find((r) => normalise(r.name) === normalise(text));
        const choice = exact?.name ?? (await matchOption(group.label, group.rows.map((r) => r.name), text));
        if (choice === MATCH_SKIP) return settle({ type: 'skip' });
        const row = group.rows.find((r) => r.name === choice);
        if (row) return settle({ type: 'answer', row });
        unclear += 1;
        if (choice !== MATCH_UNCLEAR && choice !== undefined) unclear = MAX_UNCLEAR; // an answer we cannot map: do not loop
        if (unclear >= MAX_UNCLEAR) return settle({ type: 'giveup' });
        overlay.pulseQuestion();
        getVoice().speak('Tap one, or say it again.');
      };
      question = { group, hear: (t) => void hear(t), settle };
      overlay.setMode('waiting');
      overlay.question(
        { heading: `Which ${group.label.toLowerCase()}?`, options: group.rows.map((r) => r.name), skip: true },
        (i) => settle({ type: 'answer', row: group.rows[i] as ElementRow }),
        () => settle({ type: 'skip' }),
      );
      getVoice().speak(`Which ${group.label.toLowerCase()}?`);
    });
  }

  const hooks: LoopHooks = {
    overlay: overlay.host,
    labelStyle: overlay.labelStyle,
    pageFocus: overlay.pageFocus,
    onRing: overlay.ring,
    onStep: (trace) => {
      traces.push(trace);
      if (trace.leash === 'task') refreshDim();
      for (const [key, parts] of Object.entries(trace.response?.needsParts ?? {})) personal[key] = parts.personal;
      overlay.showTrace(trace);
    },
    onTrail: overlay.trail,
    onDriving: () => overlay.setMode('agent'),
    prefs: listPrefs,
    savePref: (label, value) => { savePref(label, value); showMemory(); },
    ask,
    matchOption,
    parseGoal,
    verify,
    // Thinking: the glow dims and breathes while the LLM is in flight. If it never answered, fall back to the
    // M3 behaviour, where the frame appears only when a second step begins.
    onThinking: (on, llmAnswered) => overlay.setMode(on ? 'thinking' : llmAnswered ? 'agent' : 'user'),
    lastConstraints: () => constraints,
    setConstraints: (c) => { constraints = c; refreshDim(); },
  };

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

  // Each command resolves the simulator promises that were waiting when it began, and only those.
  async function handle(text: string, heard: Trace['heard']) {
    const mine = waiters.splice(0);
    let trace: Trace | undefined;
    try { trace = await command(text, heard); } finally { mine.forEach((w) => w(trace)); }
  }

  // Stop is code: no model call. Halts whatever is in flight and clears any question on screen.
  function stop(source: string) {
    abort?.abort();
    dropSpec();
    getVoice().cancelSpeech();
    if (pending) { pending = undefined; overlay.badges(undefined); }
    question?.settle({ type: 'stopped' });
    if (confirming) { confirming = undefined; overlay.question(undefined); overlay.setMode('user'); }
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
      if (done.outcome.ok) overlay.trail(confirmationFor(d.op, o.row, d.text ?? o.option?.label));
      const trace: Trace = {
        utterance: said, leash: 'single', step: 0, heard, speculative: 'none', rows: 0, snapshotMs: 0, t1: heard.final, t2: heard.final,
        t3: done.t3, settleMs: done.settleMs, winner: o.line, rowNames: new Map(),
        result: done.outcome.ok ? 'acted' : 'failed',
        note: `"${said}" chose candidate ${index + 1} in code, with no model call${done.outcome.ok ? '' : `; failed: ${done.outcome.reason}`}`,
      };
      hooks.onStep(trace);
      return trace;
    } finally { busy = false; }
  }

  // The agent takes the wheel. Same loop, longer leash.
  async function runTask(goal: string, heard: Trace['heard']): Promise<Trace> {
    overlay.narrow(undefined);
    narrow = [];
    overlay.showStatus('On it', 'ok');
    getVoice().speak('On it');
    const trace = await runLoop({ goal, leash: 'task', maxSteps: MAX_STEPS, heard, signal: abort!.signal }, hooks);
    handBack(trace);
    return trace;
  }

  // Hand back: mode = drive; say "Your turn."
  function handBack(trace: Trace) {
    overlay.setMode('user');
    if (trace.result === 'stopped') return overlay.showStatus('Stopped. Your turn.', 'ok');
    if (trace.result === 'yours') { getVoice().speak("This one's yours."); return overlay.showStatus("This one's yours.", 'ok'); }
    refreshDim();
    // M4: the LLM's spoken summary, when it answered. Counts in it were computed in code.
    if (trace.result === 'done' && trace.verdict?.spoken) {
      const text = `${trace.verdict.spoken} Your turn.`;
      getVoice().speak(text);
      overlay.showStatus(text, trace.verdict.ok ? 'ok' : 'unsure');
      if (trace.verdict.ok) { narrow = unsetGroups(takeSnapshot({ overlay: overlay.host }).snapshot); overlay.narrow(narrow.map((g) => g.label), (i) => void narrowBy(narrow[i]!)); }
      return;
    }
    // Code reads the page's own result notice: an empty list is worth saying out loud.
    const page = takeSnapshot({ overlay: overlay.host }).snapshot;
    const empty = noMatches(page.notices);
    const lead = empty ? 'No matches with these filters. ' : '';
    getVoice().speak(`${lead}Your turn.`);
    // Plain words in the capsule; the reasons stay in the inspector.
    if (trace.result !== 'done') {
      const why = empty ? '' : trace.resolution?.type === 'HandBack' || /operation DONE/.test(trace.note) ? " That's as far as I could take it." : " I wasn't sure what to do next.";
      return overlay.showStatus(`${lead}Your turn.${why}`, 'unsure');
    }
    overlay.showStatus(`${lead}Your turn.`, empty ? 'unsure' : 'ok');
    // "Narrow by": the groups nobody has set. Optional filters are never asked about; the user may pick one.
    narrow = unsetGroups(takeSnapshot({ overlay: overlay.host }).snapshot);
    overlay.narrow(narrow.map((g) => g.label), (i) => void narrowBy(narrow[i]!));
  }

  // The user picked a "Narrow by" chip: ask about that group, apply the answer, stay in drive mode.
  async function narrowBy(chip: ControlGroup) {
    if (busy) return;
    busy = true;
    overlay.narrow(undefined);
    try {
      const snap = takeSnapshot({ overlay: overlay.host });
      const group = unsetGroups(snap.snapshot).find((g) => g.key === chip.key);
      if (!group) return;
      const answer = await ask(group, 'the user chose to narrow by this group');
      if (answer.type !== 'answer') return;
      const done = await act({ op: 'CLICK', row: answer.row, el: snap.nodes.get(answer.row.id) }, hooks);
      if (!done.outcome.ok) return;
      // Remember only what is a fact about the user (a size that must fit), never a taste like brand or colour.
      const remember = (personal[group.key] ?? 0) >= SAVE_MIN;
      if (remember) hooks.savePref(group.label, answer.row.name);
      overlay.trail(remember ? `${group.label} ${answer.row.name}. I'll remember that.` : confirmationFor('CLICK', answer.row));
    } finally {
      busy = false;
      overlay.setMode('user');
      // Offer what is still open, so the user can keep narrowing.
      narrow = unsetGroups(takeSnapshot({ overlay: overlay.host }).snapshot);
      overlay.narrow(narrow.map((g) => g.label), (i) => void narrowBy(narrow[i]!));
    }
  }

  // Never silent: when nothing was done in drive mode, say why, in the capsule and by voice.
  function explain(trace: Trace) {
    if (trace.result === 'ignored' && trace.why === 'not_for_me') return overlay.showStatus("That didn't sound like it was for me.", 'unsure'); // shown, not spoken
    const text = trace.result === 'error' ? "I couldn't reach the model."
      : trace.result === 'failed' && trace.blocker && !trace.blocker.dismissed ? "Something is covering that, and I couldn't close it."
      : trace.result === 'failed' ? "I couldn't do that here."
      : trace.result === 'ignored' && trace.why === 'not_found' ? "I can't find that on this page."
      : trace.result === 'ignored' ? "Didn't catch that." : undefined;
    if (!text) return;
    overlay.showStatus(text, 'unsure');
    getVoice().speak(text);
  }

  // Drive mode and a target that spends money or commits: speech can be misheard, so ask for a second, explicit yes.
  function confirm(c: NonNullable<Trace['confirm']>, heard: Trace['heard']) {
    const settle = (yes: boolean) => {
      if (!confirming) return;
      confirming = undefined;
      overlay.question(undefined);
      overlay.setMode('user');
      if (!yes) return overlay.showStatus(`Left ${c.name} alone.`, 'ok');
      void act({ op: c.op, row: c.option.row, el: c.option.el, option: c.option.option }, hooks).then((done) => {
        if (done.outcome.ok) overlay.trail(`Pressed ${c.name}, as you confirmed`);
        else overlay.showStatus("I couldn't do that here.", 'unsure');
      });
    };
    confirming = { settle };
    void heard;
    overlay.setMode('waiting');
    overlay.question({ heading: `Click ${c.name}?`, options: ['Yes', 'No'] }, (i) => settle(i === 0));
    getVoice().speak(`Click ${c.name}?`);
  }

  async function command(text: string, heard: Trace['heard']): Promise<Trace | undefined> {
    if (isStop(text)) { stop('said'); return undefined; }
    if (confirming) {
      const yes = pickYesOrNo(text);
      if (yes !== undefined) { confirming.settle(yes); return undefined; }
      confirming.settle(false); // anything else is a new command, and the confirmation is withdrawn
    }
    if (question) { question.hear(text); return undefined; }
    if (pending) {
      const pick = pickOneOrTwo(text);
      if (pick !== undefined) return choose(pick, heard, text);
      pending = undefined; // anything else is a new command
      overlay.badges(undefined);
    }
    if (busy) { overlay.showStatus('Still working. Say stop to take over.', 'unsure'); return undefined; }
    const chip = narrow.find((g) => [g.key, `narrow by ${g.key}`, `by ${g.key}`].includes(normalise(text)));
    if (chip) { void narrowBy(chip); return undefined; }

    const prepared = spec && normalise(spec.text) === normalise(text) ? spec.promise : undefined;
    const specMissed = !!spec && !prepared; // a decision was fired on an interim transcript that turned out different
    if (!prepared) dropSpec();
    spec = undefined;

    busy = true;
    abort = new AbortController();
    overlay.setBusy(text);
    try {
      // Price is code's job, routing included: a price limit goes straight to the task path. On the single
      // leash Jev would pick a range by feel.
      if (mentionsPrice(text)) { dropSpec(); return await runTask(text, heard); }
      // Drive mode: the same loop as delegate mode, on a leash of one step.
      let trace = await runLoop({ utterance: text, leash: 'single', maxSteps: 1, heard, prepared, specMissed, signal: abort.signal }, hooks);
      if (trace.result === 'task' && trace.resolution?.type === 'StartTask') trace = await runTask(trace.resolution.goal, heard);
      else if (trace.disambiguation) {
        pending = trace.disambiguation;
        overlay.badges(pending.options.map((o) => o.el) as [Element, Element], (i) => void choose(i, { final: performance.now() }, `tap ${i + 1}`));
        getVoice().speak('One or two?');
      } else if (trace.result === 'confirm' && trace.confirm) confirm(trace.confirm, heard);
      else if (trace.result === 'acted') { overlay.narrow(undefined); narrow = []; }
      else explain(trace);
      return trace;
    } finally { busy = false; abort = undefined; }
  }

  showMemory();

  return {
    stop,
    warm,
    traces: () => traces,
    // The command bar does everything voice does.
    typed: (text: string) => handle(text, { final: performance.now() }),

    onSpeechStart() { warm(); overlay.wave(); },

    onInterim(text: string) {
      overlay.showInterim(text);
      overlay.wave();
      warm();
      if (swallowFinal) return;
      if (isStop(text)) { swallowFinal = true; interimText = ''; lastInterimAt = undefined; return stop('heard mid-sentence'); }
      if (normalise(text) === normalise(interimText)) return;
      interimText = text;
      lastInterimAt = performance.now();
      clearTimeout(stableTimer);
      // Speculative decide: the transcript has stopped changing, so ask Jev now and keep the answer for the
      // final transcript. Not while the agent drives, a question is open, the reply is "one" / "two", or the
      // words set a price limit (that goes to the task path, not to Jev).
      stableTimer = setTimeout(() => {
        if (busy || question || mentionsPrice(text) || (pending && pickOneOrTwo(text) !== undefined)) return;
        spec?.controller.abort();
        const controller = new AbortController();
        spec = { text, controller, promise: decideOnce({ utterance: text, leash: 'single', history: [] }, hooks, controller.signal) };
      }, INTERIM_STABLE_MS);
    },

    onFinal(text: string) {
      const heard = { final: performance.now(), lastInterim: lastInterimAt };
      clearTimeout(stableTimer);
      interimText = '';
      lastInterimAt = undefined;
      if (swallowFinal || !text.trim()) { swallowFinal = false; dropSpec(); waiters.splice(0).forEach((w) => w(undefined)); return; }
      void handle(text, heard);
    },

    // Resolves with the trace of the next command that finishes. Used by the dev simulator.
    next: () => new Promise<Trace | undefined>((r) => waiters.push(r)),
  };
}
