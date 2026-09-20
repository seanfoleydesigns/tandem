// The overlay: mounted in a shadow root, excluded from snapshots, never blocking the page.
// One capsule at the bottom centre. It names the state in words, widens for the live transcript, and
// morphs into the question card and back. State is never colour-only: an aria-live region says it too.
import { deepActiveElement } from '../dom';
import { LABEL_STYLE, type LabelStyle } from '../../shared/config';
import type { Preference } from '../../shared/types';
import type { Trace } from '../loop';
import type { MicState } from '../voice';
import { ICONS, WAVE } from './icons';
import { renderInspector } from './inspector';
import css from './styles.css?inline';

export type OverlayEvents = {
  onCommand: (text: string) => void;
  onTyping: () => void; // the command field has focus or is being typed in
  onMic: (on: boolean) => void;
  onMute: (on: boolean) => void;
  onStop: () => void; // Esc or the Stop button
};

export type Mode = 'user' | 'agent' | 'waiting' | 'thinking';
export type Question = { heading: string; options: string[]; skip?: boolean; selected?: number };

export type Overlay = {
  host: HTMLElement;
  setEnabled: (on: boolean) => void;
  labelStyle: () => LabelStyle;
  pageFocus: () => Element | null;
  ring: (rect: DOMRect, radius?: number) => void;
  badges: (els: [Element, Element] | undefined, onTap?: (index: 0 | 1) => void) => void;
  setMode: (mode: Mode) => void;
  setMicState: (state: MicState) => void;
  setMuted: (muted: boolean) => void; // show the mute button as pressed or not, without it having been clicked
  wave: () => void; // speech is arriving: move the waveform
  setBusy: (utterance: string) => void;
  showInterim: (text: string) => void;
  showStatus: (text: string, tone?: 'ok' | 'unsure') => void;
  showTrace: (trace: Trace) => void;
  trail: (text: string, tone?: 'memory') => void;
  question: (q: Question | undefined, onPick?: (index: number) => void, onSkip?: () => void) => void;
  pulseQuestion: () => void;
  narrow: (labels: string[] | undefined, onPick?: (index: number) => void) => void;
  memory: (prefs: Preference[], onDelete: (label: string) => void) => void;
  showMemory: (open: boolean) => void;
  showInspector: (open: boolean) => void;
  dim: (els: Element[], label: string) => void; // veil result cards that are outside the wanted price range
};

const STYLE_KEY = 'tandem.labelStyle';

const MIC_LABEL: Record<MicState, string> = {
  off: 'Microphone is off. Turn it on', listening: 'Listening. Turn the microphone off', paused: 'Paused while Tandem speaks',
  unsupported: 'Speech recognition is not available in this browser', denied: 'The microphone is blocked. Try again',
};
const STATE: Record<Mode, string> = { user: "You're driving", agent: 'Tandem is driving', waiting: 'Waiting for you', thinking: 'Thinking' };
const ANNOUNCE: Record<Mode, string> = {
  user: "You're driving.", agent: 'Tandem is driving. Say stop, or press Escape, to take over.', waiting: 'Tandem is waiting for you.', thinking: 'Tandem is thinking.',
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function isEditable(target: EventTarget | undefined): boolean {
  const el = target as HTMLElement | undefined;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

// The rotating frame animates a custom property, which must be registered on the document
// (an @property rule inside a shadow root is ignored).
function registerAngle() {
  try {
    (CSS as unknown as { registerProperty?: (d: object) => void }).registerProperty?.({ name: '--t-angle', syntax: '<angle>', inherits: true, initialValue: '0deg' });
  } catch { /* already registered */ }
}

function adoptStyles(root: ShadowRoot): boolean {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [sheet];
    return true;
  } catch {
    return false;
  }
}

// `parent` and `hotkeys` exist for the dev gallery, which mounts many overlays side by side.
// `sealed` is for pages that are not ours (the extension): the shadow root is closed, and events a page script made
// up are ignored, so a page cannot type a command into the capsule or press "Yes" on the confirm card as the user.
export function mountOverlay(events: OverlayEvents, opts: { parent?: HTMLElement; hotkeys?: boolean; scheme?: 'light' | 'dark'; sealed?: boolean } = {}): Overlay {
  registerAngle();
  const host = document.createElement('tandem-overlay');
  if (opts.scheme) host.dataset.scheme = opts.scheme;
  host.dataset.mode = 'user';
  const root = host.attachShadow({ mode: opts.sealed ? 'closed' : 'open' });
  if (opts.sealed) {
    for (const type of ['click', 'keydown', 'keyup', 'input', 'change', 'pointerdown', 'mousedown']) {
      root.addEventListener(type, (e) => { if (!e.isTrusted) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
    }
  }
  // Styles go in through adoptedStyleSheets, so a page's Content-Security-Policy cannot block them. Where
  // constructed sheets do not exist (jsdom), a <style> element does the same job.
  const adopted = adoptStyles(root);
  root.innerHTML = `
    ${adopted ? '' : `<style>${css}</style>`}
    <div class="sr" role="status" aria-live="polite"></div>
    <div class="frame user"></div>
    <div class="veils" aria-hidden="true"></div>
    <div class="ring"></div>
    <button class="badge" aria-label="Choose one" hidden>1</button>
    <button class="badge" aria-label="Choose two" hidden>2</button>
    <div class="memory material" role="dialog" aria-label="Saved preferences" hidden></div>
    <div class="dock">
      <div class="narrow" role="group" aria-label="Narrow by" hidden></div>
      <div class="trail" aria-label="What Tandem did"></div>
      <div class="capsule material" data-view="bar">
        <div class="bar">
          <button class="icon mic" aria-pressed="false">${ICONS.mic}${WAVE}</button>
          <div class="words">
            <span class="state">You're driving</span>
            <span class="heard"></span>
            <input class="cmd" type="text" placeholder="Type a command" aria-label="Type a command for Tandem" autocomplete="off" spellcheck="false">
          </div>
          <button class="stop" hidden>${ICONS.stop}Stop<kbd>Esc</kbd></button>
          <button class="icon mute" aria-pressed="false" aria-label="Mute Tandem's voice">${ICONS.sound}</button>
          <button class="icon mem" aria-expanded="false">${ICONS.memory}<span class="count"></span></button>
        </div>
        <div class="card" hidden></div>
      </div>
    </div>
    <div class="inspector material" hidden></div>`;
  (opts.parent ?? document.documentElement).append(host);

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const capsule = $('.capsule');
  const card = $('.card');
  const cmd = $<HTMLInputElement>('.cmd');
  const heard = $('.heard');
  const stateEl = $('.state');
  const live = $('.sr');
  const ringEl = $('.ring');
  const inspector = $('.inspector');
  const mic = $<HTMLButtonElement>('.mic');
  const mute = $<HTMLButtonElement>('.mute');
  const mem = $<HTMLButtonElement>('.mem');
  const panel = $('.memory');
  const badgeEls = [...root.querySelectorAll<HTMLButtonElement>('.badge')];

  let labelStyle: LabelStyle = LABEL_STYLE;
  try {
    const saved = localStorage.getItem(STYLE_KEY);
    if (saved === 'described' || saved === 'ids') labelStyle = saved;
  } catch { /* storage may be blocked */ }

  let mode: Mode = 'user';
  let micState: MicState = 'off';
  let lastTrace: Trace | undefined;
  let pageFocus: Element | null = null; // what the page had focused before the command field took focus
  const draw = () => { inspector.innerHTML = renderInspector(lastTrace, labelStyle); };
  const announce = (text: string) => { live.textContent = text; };
  // Positions are viewport coordinates; the host sits at the viewport's origin except in the gallery.
  const origin = () => host.getBoundingClientRect();

  const nameState = () => { stateEl.textContent = mode === 'user' && (micState === 'listening' || micState === 'paused') ? 'Listening' : STATE[mode]; };
  function say(text: string, tone = '') {
    heard.className = `heard ${tone}`;
    heard.textContent = text;
    capsule.classList.toggle('wide', text.length > 20 || capsule.classList.contains('typing'));
  }

  // The words are also the command field: click them, or press "/", and type.
  $('.words').addEventListener('click', () => cmd.focus());
  cmd.addEventListener('focus', () => {
    const active = document.activeElement === host ? null : deepActiveElement(); // a field inside a web component counts
    pageFocus = active && active !== document.body ? active : null;
    capsule.classList.add('typing', 'wide');
    events.onTyping();
  });
  cmd.addEventListener('blur', () => { if (!cmd.value) { capsule.classList.remove('typing'); say(heard.textContent ?? ''); } });
  cmd.addEventListener('input', events.onTyping);
  cmd.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === '/' && !cmd.value) e.preventDefault(); // the hotkey again, with the field already focused
    if (e.key === 'Escape') { cmd.value = ''; cmd.blur(); events.onStop(); }
    if (e.key === 'Enter' && cmd.value.trim()) {
      const text = cmd.value.trim();
      cmd.value = '';
      events.onCommand(text);
    }
  });

  mic.addEventListener('click', () => events.onMic(!(micState === 'listening' || micState === 'paused')));
  const showMuted = (muted: boolean) => {
    mute.setAttribute('aria-pressed', String(muted));
    mute.setAttribute('aria-label', muted ? "Unmute Tandem's voice" : "Mute Tandem's voice");
    mute.innerHTML = muted ? ICONS.muted : ICONS.sound;
  };
  mute.addEventListener('click', () => {
    const muted = mute.getAttribute('aria-pressed') !== 'true';
    showMuted(muted);
    events.onMute(muted);
  });
  $('.stop').addEventListener('click', events.onStop);
  const showMemory = (open: boolean) => { panel.hidden = !open; mem.setAttribute('aria-expanded', String(open)); };
  mem.addEventListener('click', () => showMemory(!!panel.hidden));

  inspector.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-action="toggle-style"]')) {
      labelStyle = labelStyle === 'described' ? 'ids' : 'described';
      try { localStorage.setItem(STYLE_KEY, labelStyle); } catch { /* ignore */ }
      draw();
    }
  });

  // Hotkeys: "/" command field, "i" inspector, Esc stop. Never while the user is typing in the page.
  if (opts.hotkeys !== false) {
    document.addEventListener('keydown', (e) => {
      if (!enabled) return; // switched off (the extension's toolbar button): the page has its keys back
      if (opts.sealed && !e.isTrusted) return;
      if (e.key === 'Escape') return events.onStop();
      if (e.ctrlKey || e.metaKey || e.altKey || isEditable(e.composedPath()[0])) return;
      if (e.key === '/') { e.preventDefault(); cmd.focus(); }
      if (e.key === 'i') { inspector.hidden = !inspector.hidden; draw(); }
    });
  }

  let enabled = true;

  // Disambiguation badges follow their elements while the question is open.
  let badged: [Element, Element] | undefined;
  let onTap: ((index: 0 | 1) => void) | undefined;
  const place = () => {
    const o = origin();
    badged?.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      Object.assign(badgeEls[i]!.style, { left: `${Math.max(4, r.left - o.left - 10)}px`, top: `${Math.max(4, r.top - o.top - 10)}px` });
    });
  };
  // Veils follow the cards they dim. The page itself is never touched.
  let dimmed: Element[] = [];
  const placeVeils = () => {
    const o = origin();
    const veils = [...root.querySelectorAll<HTMLElement>('.veil')];
    dimmed.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const veil = veils[i]!;
      veil.hidden = !el.isConnected || (r.width === 0 && r.height === 0);
      Object.assign(veil.style, { left: `${r.left - o.left}px`, top: `${r.top - o.top}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: getComputedStyle(el).borderTopLeftRadius });
    });
  };
  window.addEventListener('scroll', () => { place(); placeVeils(); }, { passive: true });
  window.addEventListener('resize', () => { place(); placeVeils(); });
  badgeEls.forEach((b, i) => b.addEventListener('click', () => onTap?.(i as 0 | 1)));

  const trailItems: { text: string; tone?: string }[] = [];
  let ringTimer: ReturnType<typeof setTimeout>;
  let waveTimer: ReturnType<typeof setTimeout>;

  return {
    host,
    // Off means gone from the page: nothing drawn, no hotkeys. The extension turns Tandem on and off per tab.
    setEnabled(on) {
      enabled = on;
      host.style.setProperty('display', on ? '' : 'none', on ? '' : 'important');
    },
    labelStyle: () => labelStyle,
    // The field the user is in: the page's own focus, or what had focus before the command field took it.
    pageFocus() {
      const active = document.activeElement === host ? null : deepActiveElement();
      if (active && active !== document.body) return active;
      return pageFocus?.isConnected ? pageFocus : null;
    },
    // The ring hugs the element: its own corner radius plus 4px. It scales from 1.06 to 1 and fades over 600 ms.
    ring(rect, radius = 4) {
      const o = origin();
      Object.assign(ringEl.style, {
        left: `${rect.left - o.left - 4}px`, top: `${rect.top - o.top - 4}px`, width: `${rect.width + 8}px`, height: `${rect.height + 8}px`,
        borderRadius: `${radius + 4}px`,
      });
      ringEl.classList.add('on');
      clearTimeout(ringTimer);
      ringTimer = setTimeout(() => ringEl.classList.remove('on'), 40);
    },
    badges(els, tap) {
      badged = els;
      onTap = tap;
      badgeEls.forEach((b) => (b.hidden = !els));
      if (els) {
        els[0].scrollIntoView({ block: 'nearest', behavior: 'instant' });
        place();
        say('Which one? Say one or two.');
        announce('Which one? Say one or two, or tap a badge.');
      }
    },
    // Who is driving. Named in words in the capsule, announced, and shown by the frame.
    setMode(next) {
      if (next !== mode) announce(ANNOUNCE[next]);
      mode = next;
      host.dataset.mode = next;
      $('.frame').className = `frame ${next}`;
      $('.stop').hidden = next === 'user';
      nameState();
    },
    setMuted: showMuted,
    setMicState(state) {
      micState = state;
      mic.className = `icon mic ${state}`;
      mic.setAttribute('aria-pressed', String(state === 'listening' || state === 'paused'));
      mic.setAttribute('aria-label', MIC_LABEL[state]);
      mic.title = MIC_LABEL[state];
      mic.disabled = state === 'unsupported';
      nameState();
    },
    wave() {
      const w = $('.wave');
      w.classList.add('on');
      clearTimeout(waveTimer);
      waveTimer = setTimeout(() => w.classList.remove('on'), 700); // still when silent
    },
    setBusy: (utterance) => say(utterance),
    showInterim(text) { say(text, 'interim'); capsule.classList.add('wide'); }, // it widens for the live transcript
    showStatus(text) { say(text); announce(text); },
    showTrace(trace) { lastTrace = trace; heard.title = trace.note; if (!inspector.hidden) draw(); },
    // The last five things that were done, in plain past-tense words.
    trail(text) {
      trailItems.push({ text });
      $('.trail').innerHTML = trailItems.slice(-5).map((t) => `<span class="step">${esc(t.text)}</span>`).join('');
      say(text);
      announce(text);
    },
    // The capsule morphs into the card. The page writes the question: its own label and option names.
    question(q, onPick, onSkip) {
      capsule.dataset.view = q ? 'card' : 'bar';
      card.hidden = !q;
      if (!q) return;
      card.innerHTML = `
        <h2 id="t-q">${esc(q.heading)}</h2>
        <div class="chips" role="radiogroup" aria-labelledby="t-q">
          ${q.options.map((o, i) => `<button class="chip" role="radio" aria-checked="${i === q.selected}" tabindex="${i === (q.selected ?? 0) ? 0 : -1}" data-chip="${i}">${ICONS.check}${esc(o)}</button>`).join('')}
        </div>
        <footer>${q.skip ? '<button class="skip">Skip</button>' : '<span></span>'}<span>Say it, or tap.</span></footer>`;
      const radios = [...card.querySelectorAll<HTMLButtonElement>('.chip')];
      radios.forEach((b, i) => {
        b.addEventListener('click', () => {
          radios.forEach((r) => r.setAttribute('aria-checked', String(r === b)));
          setTimeout(() => onPick?.(i), 160); // let the selected state be seen
        });
        b.addEventListener('keydown', (e) => {
          const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
          if (!step) return;
          e.preventDefault();
          radios[(i + step + radios.length) % radios.length]!.focus();
        });
      });
      card.querySelector('.skip')?.addEventListener('click', () => onSkip?.());
      announce(`${q.heading} ${q.options.join(', ')}.`);
    },
    pulseQuestion() {
      card.classList.remove('pulse');
      void card.offsetWidth; // restart the animation
      card.classList.add('pulse');
    },
    narrow(labels, onPick) {
      const row = $('.narrow');
      row.hidden = !labels?.length;
      if (!labels?.length) return;
      row.innerHTML = `<span>Narrow by</span>${labels.map((l, i) => `<button class="chip" data-chip="${i}">${esc(l)}</button>`).join('')}`;
      row.querySelectorAll<HTMLButtonElement>('[data-chip]').forEach((b) => b.addEventListener('click', () => onPick?.(Number(b.dataset.chip))));
    },
    memory(prefs, onDelete) {
      mem.setAttribute('aria-label', `Saved preferences, ${prefs.length}`);
      mem.title = 'Saved preferences';
      $('.mem .count').textContent = prefs.length ? String(prefs.length) : '';
      panel.innerHTML = `<h2>Saved preferences</h2>${prefs.length
        ? `<ul>${prefs.map((p, i) => `<li><b>${esc(p.label)}</b> ${esc(p.value)} <button data-del="${i}" aria-label="Forget ${esc(p.label)} ${esc(p.value)}">Forget</button></li>`).join('')}</ul>`
        : '<p>Nothing saved yet. I remember answers such as your size, never tastes like brand or colour.</p>'}`;
      panel.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) =>
        b.addEventListener('click', () => onDelete(prefs[Number(b.dataset.del)]!.label)));
    },
    showMemory,
    showInspector(open) { inspector.hidden = !open; draw(); },
    dim(els, label) {
      dimmed = els;
      $('.veils').innerHTML = els.map(() => `<div class="veil"><span>${esc(label)}</span></div>`).join('');
      placeVeils();
      if (els.length) announce(`${els.length} result${els.length === 1 ? '' : 's'} dimmed: ${label.toLowerCase()}.`);
    },
  };
}
