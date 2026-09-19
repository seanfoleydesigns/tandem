// Boot: mount the overlay, wire voice and the command bar into one pipeline. The agent knows the page through
// the DOM alone. On the demo store index.ts calls this at load; the extension's content script calls it after
// it has set the environment (agent/env.ts).
import type { SavedTask } from './env';
import { createPipeline } from './pipeline';
import { mountOverlay } from './ui/overlay';
import { createVoice, type Voice } from './voice';

export function boot(opts: { sealed?: boolean } = {}) {
  let voice: Voice;
  const overlay = mountOverlay({
    onCommand: (text) => void pipeline.typed(text),
    onTyping: () => pipeline.warm(),
    onMic: (on) => voice.setMic(on),
    onMute: (on) => voice.setMuted(on),
    onStop: () => pipeline.stop('Esc'),
  }, { sealed: opts.sealed });
  const pipeline = createPipeline(overlay, () => voice);
  voice = createVoice({
    onSpeechStart: pipeline.onSpeechStart,
    onInterim: pipeline.onInterim,
    onFinal: pipeline.onFinal,
    onState: overlay.setMicState,
  });
  overlay.setMicState(voice.supported ? 'off' : 'unsupported');

  return {
    overlay, pipeline, voice,
    // The extension's toolbar button. Off: stop whatever runs, let go of the microphone, leave the page alone.
    setEnabled(on: boolean) {
      if (!on) { pipeline.stop('turned off'); voice.setMic(false); }
      overlay.setEnabled(on);
    },
    resume: (task: SavedTask) => pipeline.resume(task),
  };
}
