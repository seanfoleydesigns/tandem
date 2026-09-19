// The overlay: mounted in a shadow root, excluded from snapshots, never blocking the page.
import { LABEL_STYLE, type LabelStyle } from '../../shared/config';
import type { Trace } from '../loop';
import { renderInspector } from './inspector';
import css from './styles.css?inline';

export type Overlay = {
  host: HTMLElement;
  labelStyle: () => LabelStyle;
  pageFocus: () => Element | null;
  ring: (rect: DOMRect) => void;
  showTrace: (trace: Trace, rowNames: Map<string, string>) => void;
  setBusy: (utterance: string) => void;
};

const STYLE_KEY = 'tandem.labelStyle';

function isEditable(target: EventTarget | undefined): boolean {
  const el = target as HTMLElement | undefined;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

export function mountOverlay(onCommand: (text: string) => void, onBarFocus: () => void): Overlay {
  const host = document.createElement('tandem-overlay');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>${css}</style>
    <div class="ring"></div>
    <div class="bar">
      <span class="pill">You're driving</span>
      <input class="cmd" type="text" placeholder="Press / and type a command" aria-label="Tandem command" autocomplete="off" spellcheck="false">
      <span class="heard"></span>
    </div>
    <div class="inspector" hidden></div>`;
  document.documentElement.append(host);

  const cmd = root.querySelector<HTMLInputElement>('.cmd')!;
  const heard = root.querySelector<HTMLElement>('.heard')!;
  const ringEl = root.querySelector<HTMLElement>('.ring')!;
  const inspector = root.querySelector<HTMLElement>('.inspector')!;

  let labelStyle: LabelStyle = LABEL_STYLE;
  try {
    const saved = localStorage.getItem(STYLE_KEY);
    if (saved === 'described' || saved === 'ids') labelStyle = saved;
  } catch { /* storage may be blocked */ }

  let lastTrace: Trace | undefined;
  let lastNames = new Map<string, string>();
  let pageFocus: Element | null = null; // what the page had focused before the command bar took focus
  const draw = () => { inspector.innerHTML = renderInspector(lastTrace, labelStyle, lastNames); };

  cmd.addEventListener('focus', () => {
    const active = document.activeElement;
    pageFocus = active && active !== host && active !== document.body ? active : null;
    onBarFocus();
  });
  cmd.addEventListener('input', onBarFocus); // typing also keeps the connection warm
  cmd.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === '/' && !cmd.value) e.preventDefault(); // the hotkey again, with the bar already focused
    if (e.key === 'Escape') cmd.blur();
    if (e.key === 'Enter' && cmd.value.trim()) {
      const text = cmd.value.trim();
      cmd.value = '';
      onCommand(text);
    }
  });

  inspector.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-action="toggle-style"]')) {
      labelStyle = labelStyle === 'described' ? 'ids' : 'described';
      try { localStorage.setItem(STYLE_KEY, labelStyle); } catch { /* ignore */ }
      draw();
    }
  });

  // Hotkeys: "/" focuses the command bar, "i" toggles the inspector. Never while the user is typing in the page.
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isEditable(e.composedPath()[0])) return;
    if (e.key === '/') { e.preventDefault(); cmd.focus(); }
    if (e.key === 'i') { inspector.hidden = !inspector.hidden; draw(); }
  });

  let ringTimer: ReturnType<typeof setTimeout>;
  return {
    host,
    labelStyle: () => labelStyle,
    pageFocus: () => (pageFocus?.isConnected ? pageFocus : null),
    ring(rect) {
      Object.assign(ringEl.style, {
        left: `${rect.left - 4}px`, top: `${rect.top - 4}px`, width: `${rect.width + 8}px`, height: `${rect.height + 8}px`,
      });
      ringEl.classList.add('on');
      clearTimeout(ringTimer);
      ringTimer = setTimeout(() => ringEl.classList.remove('on'), 350);
    },
    setBusy(utterance) {
      heard.className = 'heard';
      heard.textContent = `“${utterance}” …`;
    },
    showTrace(trace, rowNames) {
      lastTrace = trace;
      lastNames = rowNames;
      const acted = trace.result === 'acted';
      heard.className = `heard ${acted ? 'ok' : 'unsure'}`;
      const what = trace.resolution?.type === 'Act' ? trace.resolution.op.toLowerCase().replace('_', ' ') : '';
      heard.textContent = acted ? `“${trace.utterance}” → ${what}` : `“${trace.utterance}” ?`;
      heard.title = trace.note;
      draw();
    },
  };
}
