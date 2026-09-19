// The overlay: mounted in a shadow root, excluded from snapshots, never blocking the page.
import { LABEL_STYLE, type LabelStyle } from '../../shared/config';
import type { Trace } from '../loop';
import type { MicState } from '../voice';
import { renderInspector } from './inspector';
import css from './styles.css?inline';

export type OverlayEvents = {
  onCommand: (text: string) => void;
  onTyping: () => void; // the command bar has focus or is being typed in
  onMic: (on: boolean) => void;
  onMute: (on: boolean) => void;
  onStop: () => void; // Esc
};

export type Overlay = {
  host: HTMLElement;
  labelStyle: () => LabelStyle;
  pageFocus: () => Element | null;
  ring: (rect: DOMRect) => void;
  badges: (els: [Element, Element] | undefined, onTap?: (index: 0 | 1) => void) => void;
  setMicState: (state: MicState) => void;
  setBusy: (utterance: string) => void;
  showInterim: (text: string) => void;
  showStatus: (text: string, tone: 'ok' | 'unsure') => void;
  showTrace: (trace: Trace) => void;
};

const STYLE_KEY = 'tandem.labelStyle';

const MIC_LABEL: Record<MicState, string> = {
  off: 'Mic off', listening: 'Listening', paused: 'Paused (speaking)', unsupported: 'No speech recognition here', denied: 'Mic blocked',
};

function isEditable(target: EventTarget | undefined): boolean {
  const el = target as HTMLElement | undefined;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

export function mountOverlay(events: OverlayEvents): Overlay {
  const host = document.createElement('tandem-overlay');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>${css}</style>
    <div class="ring"></div>
    <button class="badge" data-badge="0" hidden>1</button>
    <button class="badge" data-badge="1" hidden>2</button>
    <div class="bar">
      <span class="pill">You're driving</span>
      <button class="mic" aria-pressed="false" title="Turn the microphone on or off">Mic off</button>
      <button class="mute" aria-pressed="false" title="Mute Tandem's voice">Sound on</button>
      <input class="cmd" type="text" placeholder="Press / and type a command" aria-label="Tandem command" autocomplete="off" spellcheck="false">
      <span class="heard"></span>
    </div>
    <div class="inspector" hidden></div>`;
  document.documentElement.append(host);

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const cmd = $<HTMLInputElement>('.cmd');
  const heard = $('.heard');
  const ringEl = $('.ring');
  const inspector = $('.inspector');
  const mic = $<HTMLButtonElement>('.mic');
  const mute = $<HTMLButtonElement>('.mute');
  const badgeEls = [...root.querySelectorAll<HTMLButtonElement>('.badge')];

  let labelStyle: LabelStyle = LABEL_STYLE;
  try {
    const saved = localStorage.getItem(STYLE_KEY);
    if (saved === 'described' || saved === 'ids') labelStyle = saved;
  } catch { /* storage may be blocked */ }

  let lastTrace: Trace | undefined;
  let pageFocus: Element | null = null; // what the page had focused before the command bar took focus
  const draw = () => { inspector.innerHTML = renderInspector(lastTrace, labelStyle); };
  const say = (text: string, tone = '') => { heard.className = `heard ${tone}`; heard.textContent = text; };

  cmd.addEventListener('focus', () => {
    const active = document.activeElement;
    pageFocus = active && active !== host && active !== document.body ? active : null;
    events.onTyping();
  });
  cmd.addEventListener('input', events.onTyping);
  cmd.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === '/' && !cmd.value) e.preventDefault(); // the hotkey again, with the bar already focused
    if (e.key === 'Escape') { cmd.blur(); events.onStop(); }
    if (e.key === 'Enter' && cmd.value.trim()) {
      const text = cmd.value.trim();
      cmd.value = '';
      events.onCommand(text);
    }
  });

  let micOn = false;
  mic.addEventListener('click', () => events.onMic(!micOn));
  mute.addEventListener('click', () => {
    const muted = mute.getAttribute('aria-pressed') !== 'true';
    mute.setAttribute('aria-pressed', String(muted));
    mute.textContent = muted ? 'Sound off' : 'Sound on';
    events.onMute(muted);
  });

  inspector.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-action="toggle-style"]')) {
      labelStyle = labelStyle === 'described' ? 'ids' : 'described';
      try { localStorage.setItem(STYLE_KEY, labelStyle); } catch { /* ignore */ }
      draw();
    }
  });

  // Hotkeys: "/" command bar, "i" inspector, Esc stop. Never while the user is typing in the page.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return events.onStop();
    if (e.ctrlKey || e.metaKey || e.altKey || isEditable(e.composedPath()[0])) return;
    if (e.key === '/') { e.preventDefault(); cmd.focus(); }
    if (e.key === 'i') { inspector.hidden = !inspector.hidden; draw(); }
  });

  // Disambiguation badges follow their elements while the question is open.
  let badged: [Element, Element] | undefined;
  let onTap: ((index: 0 | 1) => void) | undefined;
  const place = () => badged?.forEach((el, i) => {
    const r = el.getBoundingClientRect();
    Object.assign(badgeEls[i]!.style, { left: `${Math.max(4, r.left - 10)}px`, top: `${Math.max(4, r.top - 10)}px` });
  });
  window.addEventListener('scroll', place, { passive: true });
  window.addEventListener('resize', place);
  badgeEls.forEach((b, i) => b.addEventListener('click', () => onTap?.(i as 0 | 1)));

  let ringTimer: ReturnType<typeof setTimeout>;
  return {
    host,
    labelStyle: () => labelStyle,
    // The field the user is in: the page's own focus, or what had focus before the command bar took it.
    pageFocus() {
      const active = document.activeElement;
      if (active && active !== host && active !== document.body) return active;
      return pageFocus?.isConnected ? pageFocus : null;
    },
    ring(rect) {
      Object.assign(ringEl.style, {
        left: `${rect.left - 4}px`, top: `${rect.top - 4}px`, width: `${rect.width + 8}px`, height: `${rect.height + 8}px`,
      });
      ringEl.classList.add('on');
      clearTimeout(ringTimer);
      ringTimer = setTimeout(() => ringEl.classList.remove('on'), 350);
    },
    badges(els, tap) {
      badged = els;
      onTap = tap;
      badgeEls.forEach((b) => (b.hidden = !els));
      if (els) {
        els[0].scrollIntoView({ block: 'nearest', behavior: 'instant' });
        place();
        say('One or two? Say it, or tap a badge.', 'unsure');
      }
    },
    setMicState(state) {
      micOn = state === 'listening' || state === 'paused';
      mic.textContent = MIC_LABEL[state];
      mic.className = `mic ${state}`;
      mic.setAttribute('aria-pressed', String(micOn));
      mic.disabled = state === 'unsupported';
    },
    setBusy: (utterance) => say(`“${utterance}” …`),
    showInterim: (text) => say(text, 'interim'),
    showStatus: (text, tone) => say(text, tone),
    showTrace(trace) {
      lastTrace = trace;
      const what = trace.resolution?.type === 'Act' ? trace.resolution.op.toLowerCase().replace('_', ' ')
        : trace.resolution?.type === 'Dictate' ? 'typed as dictation' : 'done';
      if (trace.result === 'acted') say(`“${trace.utterance}” → ${what}`, 'ok');
      else if (trace.result === 'task') say(`“${trace.utterance}” → a task (delegate mode arrives in M3)`, 'unsure');
      else if (trace.result === 'stopped') say('Stopped', 'ok');
      else if (trace.result !== 'asked') say(`“${trace.utterance}” ?`, 'unsure');
      heard.title = trace.note;
      draw();
    },
  };
}
