// Recognition, speech output and the echo guard. The recognizer and the dev simulator both feed
// the same three handlers, so everything after this file is identical for real and simulated speech.
import { ECHO_GUARD_MS } from '../shared/config';
import { env } from './env';

export type MicState = 'off' | 'listening' | 'paused' | 'unsupported' | 'denied';

export type VoiceHandlers = {
  onSpeechStart: () => void;
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onState: (state: MicState) => void;
};

// Minimal shapes for Chrome's webkitSpeechRecognition.
type Alternative = { transcript: string };
type Result = { isFinal: boolean; 0: Alternative };
type ResultEvent = { resultIndex: number; results: { length: number; [i: number]: Result } };
type Recognition = {
  continuous: boolean; interimResults: boolean; lang: string;
  onspeechstart: (() => void) | null; onresult: ((e: ResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null;
  start(): void; abort(): void;
};

export function createVoice(h: VoiceHandlers) {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;

  let rec: Recognition | undefined;
  let wantOn = false; // the user's mic toggle
  let guard = false; // echo guard: the agent is speaking, or stopped less than 250 ms ago
  let muted = false;
  let speaking = 0; // phrases queued or being spoken; the guard lifts only when this reaches zero
  let restartDelay = 250;

  const hidden = () => document.visibilityState === 'hidden';

  function start() {
    if (!Ctor) return h.onState('unsupported');
    if (rec || guard) return;
    // Chrome runs one microphone recognition session for the whole browser. A tab nobody is looking at must not
    // take it from the one in front, and commands belong to the page the user sees. It starts when it is shown.
    if (hidden()) return h.onState('paused');
    const r: Recognition = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-US';
    r.onspeechstart = () => { if (!guard) h.onSpeechStart(); };
    r.onresult = (e) => {
      if (guard) return; // never react to our own speech
      restartDelay = 250;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]!;
        if (result.isFinal) h.onFinal(result[0].transcript.trim());
        else interim += result[0].transcript;
      }
      if (interim.trim()) h.onInterim(interim.trim());
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { wantOn = false; h.onState('denied'); }
      else if (e.error === 'network') restartDelay = Math.min(restartDelay * 2, 4000); // quiet, and back off
      // no-speech and aborted are routine: stay quiet and let onend restart.
    };
    r.onend = () => {
      rec = undefined;
      if (wantOn && !guard && !hidden()) setTimeout(() => { if (wantOn && !guard) start(); }, restartDelay);
    };
    rec = r;
    try { r.start(); h.onState('listening'); } catch { rec = undefined; }
  }

  document.addEventListener('visibilitychange', () => {
    if (!wantOn) return;
    if (hidden()) { rec?.abort(); h.onState('paused'); } else if (!guard) start();
  });

  function setGuard(on: boolean) {
    guard = on;
    if (on) { rec?.abort(); if (wantOn) h.onState('paused'); }
    else if (wantOn) start();
  }

  return {
    supported: !!Ctor,
    // `remember`: the user's own toggle is remembered beyond this page (the extension keeps it per tab, so the
    // next page starts listening by itself). Stops the agent makes for its own reasons are not the user's choice.
    setMic(on: boolean, opts: { remember?: boolean } = {}) {
      wantOn = on;
      if (opts.remember !== false) env().mic.save(on);
      if (on) start();
      else { rec?.abort(); h.onState('off'); }
    },
    // Remembered like the mic. Restoring it on a new page cancels nothing: there, the only voice that could be
    // speaking is somebody else's (the extension's voice is one for the whole browser).
    setMuted(on: boolean, opts: { remember?: boolean } = {}) {
      muted = on;
      if (opts.remember === false) return;
      env().muted.save(on);
      if (on) env().speech.cancel();
    },
    guarded: () => guard,

    // Short phrases only. Recognition pauses while speaking and for 250 ms after.
    // The guard goes up the moment the agent decides to speak, and comes down ECHO_GUARD_MS after the engine says
    // the phrase ended. Who speaks is the environment's business (agent/env.ts).
    speak(text: string) {
      if (muted) return;
      setGuard(true);
      speaking += 1;
      let released = false;
      let fallback: ReturnType<typeof setTimeout>;
      const release = () => {
        if (released) return;
        released = true;
        clearTimeout(fallback);
        speaking -= 1;
        // "On it" and "Which size?" can queue back to back: never lift the guard between them.
        setTimeout(() => { if (speaking === 0) setGuard(false); }, ECHO_GUARD_MS);
      };
      // Some engines never say they finished, and an end event can be lost: give up after the time the phrase
      // should take, counted from when it really started if we are told.
      const arm = () => {
        // The phrase started after we had given up on it (it was queued behind a long one): guard it from its real start.
        if (released) { released = false; speaking += 1; setGuard(true); }
        clearTimeout(fallback);
        fallback = setTimeout(release, 800 + text.length * 90);
      };
      arm();
      env().speech.speak(text, { onStart: arm, onEnd: release });
    },
    cancelSpeech() { env().speech.cancel(); },

    // Dev simulator: the same path as the recognizer, echo guard included.
    async feed(text: string, opts: { interims?: string[]; interimGapMs?: number; finalDelayMs?: number } = {}): Promise<'heard' | 'dropped by echo guard'> {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      if (guard) return 'dropped by echo guard';
      const interims = opts.interims ?? [];
      if (interims.length) h.onSpeechStart();
      for (const [i, interim] of interims.entries()) {
        if (i) await sleep(opts.interimGapMs ?? 150);
        if (guard) return 'dropped by echo guard';
        h.onInterim(interim);
      }
      if (interims.length) await sleep(opts.finalDelayMs ?? 600); // Chrome finalises some time after the last interim
      if (guard) return 'dropped by echo guard';
      h.onFinal(text);
      return 'heard';
    },
  };
}

export type Voice = ReturnType<typeof createVoice>;
