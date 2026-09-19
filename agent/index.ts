// Tandem agent: boot and mount the overlay.
// This script is the only thing the host page loads. It knows the page through the DOM alone.
import { runLoop, type Trace } from './loop';
import { mountOverlay } from './ui/overlay';

let busy = false;
let lastWarm = -Infinity;
const WARM_EVERY_MS = 3000;

const overlay = mountOverlay(
  async (utterance) => {
    if (busy) return;
    busy = true;
    overlay.setBusy(utterance);
    try {
      // Drive mode: the same loop as delegate mode, on a leash of one step.
      await runLoop({ utterance, leash: 'single', maxSteps: 1 }, {
        overlay: overlay.host,
        labelStyle: overlay.labelStyle,
        pageFocus: overlay.pageFocus,
        onRing: overlay.ring,
        onTrace: (trace: Trace) => overlay.showTrace(trace, trace.rowNames),
      });
    } finally {
      busy = false;
    }
  },
  // Open the server's connection to Jev while the user is still typing. An idle connection closes
  // after a few seconds, and a cold one costs about 180 ms (NOTES.md, M1), so warm it again when stale.
  () => {
    if (performance.now() - lastWarm < WARM_EVERY_MS) return;
    lastWarm = performance.now();
    void fetch('/api/warm', { method: 'POST' }).catch(() => {});
  },
);

console.info('[tandem] agent loaded. Press / for the command bar, i for the inspector.');
