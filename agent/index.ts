// Tandem agent: boot, mount the overlay, wire voice and the command bar into one pipeline.
// This script is the only thing the host page loads. It knows the page through the DOM alone.
import type { Trace } from './loop';
import { createPipeline } from './pipeline';
import { mountOverlay } from './ui/overlay';
import { createVoice, type Voice } from './voice';

let voice: Voice;

const overlay = mountOverlay({
  onCommand: (text) => void pipeline.typed(text),
  onTyping: () => pipeline.warm(),
  onMic: (on) => voice.setMic(on),
  onMute: (on) => voice.setMuted(on),
  onStop: () => pipeline.stop('Esc'),
});

const pipeline = createPipeline(overlay, () => voice);

voice = createVoice({
  onSpeechStart: pipeline.onSpeechStart,
  onInterim: pipeline.onInterim,
  onFinal: pipeline.onFinal,
  onState: overlay.setMicState,
});
overlay.setMicState(voice.supported ? 'off' : 'unsupported');

// Dev-only simulator. It feeds the same pipeline as the recognizer, echo guard included, so the
// voice path can be checked without a microphone. Stripped from the standalone build.
//   await __tandem.say('open the second one', { interims: ['open', 'open the second', 'open the second one'] })
if (import.meta.env.DEV) {
  type SayOptions = { interims?: string[]; interimGapMs?: number; finalDelayMs?: number };
  const summary = (t: Trace | undefined) => t && {
    utterance: t.utterance, result: t.result, note: t.note, winner: t.winner, speculative: t.speculative,
    finalToActionMs: t.t3 === undefined ? undefined : Math.round(t.t3 - t.heard.final),
    lastInterimToActionMs: t.t3 === undefined || t.heard.lastInterim === undefined ? undefined : Math.round(t.t3 - t.heard.lastInterim),
    jevMs: t.response?.ms, kind: t.response?.heads.kind,
  };
  (window as unknown as { __tandem: unknown }).__tandem = {
    async say(text: string, opts: SayOptions = {}) {
      const next = pipeline.next();
      const fed = await voice.feed(text, opts);
      if (fed !== 'heard') return { dropped: fed };
      return summary(await next);
    },
    speak: (text: string) => voice.speak(text),
    guarded: () => voice.guarded(),
  };
}

console.info('[tandem] agent loaded. Press / for the command bar, i for the inspector.');
