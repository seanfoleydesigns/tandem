// Recognition, speech output and the echo guard. The recognizer and the dev simulator both feed
// the same three handlers, so everything after this file is identical for real and simulated speech.
import { ECHO_GUARD_MS } from '../shared/config';

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

  function start() {
    if (!Ctor) return h.onState('unsupported');
    if (rec || guard) return;
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
      if (wantOn && !guard) setTimeout(() => { if (wantOn && !guard) start(); }, restartDelay);
    };
    rec = r;
    try { r.start(); h.onState('listening'); } catch { rec = undefined; }
  }

  function setGuard(on: boolean) {
    guard = on;
    if (on) { rec?.abort(); if (wantOn) h.onState('paused'); }
    else if (wantOn) start();
  }

  return {
    supported: !!Ctor,
    setMic(on: boolean) {
      wantOn = on;
      if (on) start();
      else { rec?.abort(); h.onState('off'); }
    },
    setMuted(on: boolean) { muted = on; if (on) window.speechSynthesis?.cancel(); },
    guarded: () => guard,

    // Short phrases only. Recognition pauses while speaking and for 250 ms after.
    speak(text: string) {
      if (muted || !('speechSynthesis' in window)) return;
      setGuard(true);
      speaking += 1;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        speaking -= 1;
        // "On it" and "Which size?" can queue back to back: never lift the guard between them.
        setTimeout(() => { if (speaking === 0) setGuard(false); }, ECHO_GUARD_MS);
      };
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      u.onend = release;
      u.onerror = release;
      setTimeout(release, 800 + text.length * 90); // some engines never fire onend
      window.speechSynthesis.speak(u);
    },
    cancelSpeech() { window.speechSynthesis?.cancel(); },

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
