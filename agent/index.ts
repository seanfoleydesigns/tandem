// Tandem agent, as the demo store loads it: one script tag. It knows the page through the DOM alone.
import { boot } from './boot';
import type { Trace } from './loop';

const { pipeline, voice } = boot();

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
    leash: t.leash, step: t.step, constraints: t.constraints, llm: t.llm, verdict: t.verdict,
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
