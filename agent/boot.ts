// Boot: mount the overlay, wire voice and the command bar into one pipeline. The agent knows the page through
// the DOM alone. On the demo store index.ts calls this at load; the extension's content script calls it after
// it has set the environment (agent/env.ts).
import type { SavedTask } from './env';
import { createPipeline } from './pipeline';
import { mountOverlay } from './ui/overlay';
import { createVoice, type Voice } from './voice';

export function boot(opts: { sealed?: boolean } = {}) {
  let voice: Voice;
  let auto = false; // listening was started by the agent after a page load, not by a click on this page
  let hinted = false; // the capsule is telling the user what to do about the microphone
  let told = false; // this page has told them to click the mic; 'listening' is reported before Chrome has answered, so it outlives `hinted`
  const HINT = 'Click the mic to allow it on this site.';
  const BLOCKED = "The microphone is blocked on this site. Allow it in Chrome's site settings.";
  const hint = (text: string) => { hinted = true; told = true; overlay.showStatus(text, 'unsure'); };
  const overlay = mountOverlay({
    onCommand: (text) => void pipeline.typed(text),
    onTyping: () => pipeline.warm(),
    onMic: (on) => { auto = false; voice.setMic(on); }, // the user's own toggle: remembered
    onMute: (on) => voice.setMuted(on),
    onStop: () => pipeline.stop('Esc'),
  }, { sealed: opts.sealed });
  const pipeline = createPipeline(overlay, () => voice);
  voice = createVoice({
    onSpeechStart: pipeline.onSpeechStart,
    onInterim: pipeline.onInterim,
    onFinal: pipeline.onFinal,
    onState: (state) => {
      overlay.setMicState(state);
      // Started by itself on a site that has not been given the microphone: say how to fix it. A click is a user
      // gesture, so Chrome can then ask.
      if (state === 'denied' && auto) { auto = false; hint(HINT); }
      else if (state === 'denied' && told) hint(BLOCKED); // they clicked, as told, and were still refused: stop saying "click"
      else if (state === 'listening' && hinted) { hinted = false; overlay.showStatus('Listening', 'ok'); } // the hint has done its job
    },
  });
  overlay.setMicState(voice.supported ? 'off' : 'unsupported');

  return {
    overlay, pipeline, voice,
    // The extension's toolbar button. Off: stop whatever runs, let go of the microphone, leave the page alone.
    setEnabled(on: boolean) {
      if (!on) { pipeline.stop('turned off'); voice.setMic(false, { remember: false }); }
      overlay.setEnabled(on);
    },
    resume: (task: SavedTask) => pipeline.resume(task),
    // Mute was on before this page loaded. Not the user's click, so nothing is saved and nothing is cancelled.
    restoreMuted() { voice.setMuted(true, { remember: false }); overlay.setMuted(true); },
    // The microphone was on before this page loaded: start listening without a click. Nothing waits for this.
    async listen() {
      let state = 'unknown';
      try { state = (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state; } catch { /* not every browser can say */ }
      // Not granted here yet: starting now would make Chrome pop its microphone prompt on a page the user only just
      // arrived at. Say how to allow it instead; the click is the gesture Chrome wants.
      if (state === 'prompt') return hint(HINT);
      // Blocked here, by the user once or by the site's own policy: a click cannot help, so do not ask for one.
      if (state === 'denied') { overlay.setMicState('denied'); return hint(BLOCKED); }
      auto = true;
      voice.setMic(true, { remember: false });
    },
  };
}
