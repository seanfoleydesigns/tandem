// @vitest-environment jsdom
// Voice across page loads (trial fix 1): the echo guard is driven by whoever speaks, the mic's on/off is remembered
// only when the USER toggles it, listening follows the visible tab, and starting by itself never pops a prompt.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { boot } from '../agent/boot';
import { env, setEnv, type Env, type SpeechEvents } from '../agent/env';
import { createVoice, type MicState } from '../agent/voice';
import { ECHO_GUARD_MS } from '../shared/config';

// A stand-in for webkitSpeechRecognition: records what happens to it, and lets a test fire its events.
class FakeRecognition {
  static made: FakeRecognition[] = [];
  static failWith: string | undefined;
  continuous = false; interimResults = false; lang = '';
  onspeechstart: (() => void) | null = null; onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null; onend: (() => void) | null = null;
  started = false; aborted = false;
  constructor() { FakeRecognition.made.push(this); }
  start() {
    this.started = true;
    const error = FakeRecognition.failWith;
    if (error) queueMicrotask(() => { this.onerror?.({ error }); this.onend?.(); });
  }
  abort() { this.aborted = true; queueMicrotask(() => this.onend?.()); }
}

let original: Env;
let visibility: 'visible' | 'hidden';
let phrases: { text: string; on: SpeechEvents }[];
let cancels: number;
let micSaves: boolean[];
let mutedSaves: boolean[];
let states: MicState[];
const handlers = () => ({ onSpeechStart() {}, onInterim() {}, onFinal() {}, onState: (s: MicState) => states.push(s) });
const show = (v: 'visible' | 'hidden') => { visibility = v; document.dispatchEvent(new Event('visibilitychange')); };

beforeEach(() => {
  vi.useFakeTimers();
  original = env();
  phrases = []; cancels = 0; micSaves = []; mutedSaves = []; states = []; visibility = 'visible';
  FakeRecognition.made = []; FakeRecognition.failWith = undefined;
  (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = FakeRecognition;
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  setEnv({ speech: { speak: (text, on) => phrases.push({ text, on }), cancel: () => { cancels += 1; } }, mic: { save: (on) => micSaves.push(on) }, muted: { save: (on) => mutedSaves.push(on) } });
});
afterEach(() => { setEnv(original); vi.useRealTimers(); document.body.innerHTML = ''; document.querySelectorAll('tandem-overlay').forEach((e) => e.remove()); });

describe('the echo guard is driven by whoever speaks', () => {
  it('goes up when the agent decides to speak and comes down ECHO_GUARD_MS after the phrase ended', () => {
    const voice = createVoice(handlers());
    voice.speak('On it');
    expect(voice.guarded()).toBe(true);
    expect(phrases.map((p) => p.text)).toEqual(['On it']);
    phrases[0]!.on.onStart?.();
    phrases[0]!.on.onEnd();
    vi.advanceTimersByTime(ECHO_GUARD_MS - 1);
    expect(voice.guarded()).toBe(true);
    vi.advanceTimersByTime(2);
    expect(voice.guarded()).toBe(false);
  });

  it('never lifts between two phrases queued back to back', () => {
    const voice = createVoice(handlers());
    voice.speak('On it');
    voice.speak('Which size?');
    phrases[0]!.on.onEnd();
    vi.advanceTimersByTime(ECHO_GUARD_MS + 50);
    expect(voice.guarded()).toBe(true); // the second phrase has not ended
    phrases[1]!.on.onEnd();
    vi.advanceTimersByTime(ECHO_GUARD_MS + 1);
    expect(voice.guarded()).toBe(false);
  });

  it('a lost end event cannot leave the recognizer deaf: the guard gives up after the time the phrase should take', () => {
    const voice = createVoice(handlers());
    voice.speak('Your turn.'); // no start, no end: a worker that was put to sleep, or a voice that sends no events
    vi.advanceTimersByTime(800 + 'Your turn.'.length * 90 + ECHO_GUARD_MS + 1);
    expect(voice.guarded()).toBe(false);
  });

  it('counts the time from when the phrase really started, when it is told', () => {
    const voice = createVoice(handlers());
    voice.speak('Your turn.');
    vi.advanceTimersByTime(1500); // queued behind another phrase
    phrases[0]!.on.onStart?.();
    vi.advanceTimersByTime(1500); // would have given up by now if counted from the call
    expect(voice.guarded()).toBe(true);
  });

  it('a phrase that starts after the guard gave up on it takes the guard back (queued behind a long one)', async () => {
    const voice = createVoice(handlers());
    voice.speak('I found twelve trail shoes under a hundred dollars, sorted by price. Your turn.');
    phrases[0]!.on.onStart?.();
    voice.speak('Which brand?'); // queued by the engine behind the summary
    vi.advanceTimersByTime(800 + 'Which brand?'.length * 90 + 1); // its failsafe fires before it has even started
    phrases[0]!.on.onEnd();
    vi.advanceTimersByTime(100);
    phrases[1]!.on.onStart?.(); // now it is really being spoken
    vi.advanceTimersByTime(ECHO_GUARD_MS + 300);
    expect(voice.guarded()).toBe(true); // or the recognizer would hear "which brand" as the user's answer
    phrases[1]!.on.onEnd();
    vi.advanceTimersByTime(ECHO_GUARD_MS + 1);
    expect(voice.guarded()).toBe(false);
  });

  it('muting and stopping go to the same speaker', () => {
    const voice = createVoice(handlers());
    voice.cancelSpeech();
    voice.setMuted(true);
    voice.speak('never said');
    expect(cancels).toBe(2);
    expect(phrases).toEqual([]);
  });
});

describe('the mic is remembered only when the user toggles it', () => {
  it('a click is remembered; a stop the agent makes for its own reasons is not', () => {
    const voice = createVoice(handlers());
    voice.setMic(true);
    voice.setMic(false, { remember: false }); // turned off from the toolbar, or paused on a site without access
    voice.setMic(true, { remember: false }); // started by itself after a page load
    voice.setMic(false);
    expect(micSaves).toEqual([true, false]);
  });

  it('being refused the microphone does not change what the user wanted', async () => {
    FakeRecognition.failWith = 'not-allowed';
    const voice = createVoice(handlers());
    voice.setMic(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(states).toContain('denied');
    expect(micSaves).toEqual([true]); // still "on" for the next site, which may well allow it
  });
});

describe('mute is remembered like the mic', () => {
  it('the click is saved and silences what is being said; restoring it on a new page saves nothing and cancels nothing', () => {
    const voice = createVoice(handlers());
    voice.setMuted(true, { remember: false }); // a new page in a tab that was muted: the voice that may be speaking is not this page's
    expect(mutedSaves).toEqual([]);
    expect(cancels).toBe(0);
    voice.speak('never said');
    expect(phrases).toEqual([]);
    voice.setMuted(false);
    voice.setMuted(true);
    expect(mutedSaves).toEqual([false, true]);
    expect(cancels).toBe(1);
  });

  it('a restored mute shows on the button', () => {
    const tandem = boot();
    tandem.restoreMuted();
    const button = document.querySelector('tandem-overlay')!.shadowRoot!.querySelector('.mute')!;
    expect(button.getAttribute('aria-pressed')).toBe('true');
    tandem.voice.speak('never said');
    expect(phrases).toEqual([]);
    expect(mutedSaves).toEqual([]);
  });
});

describe('listening follows the visible tab (Chrome runs one recognition session for the whole browser)', () => {
  it('does not start in a hidden tab, starts when the tab is shown, lets go when it is hidden again', async () => {
    visibility = 'hidden';
    const voice = createVoice(handlers());
    voice.setMic(true);
    expect(FakeRecognition.made).toHaveLength(0);
    expect(states.at(-1)).toBe('paused');
    show('visible');
    expect(FakeRecognition.made).toHaveLength(1);
    expect(states.at(-1)).toBe('listening');
    show('hidden');
    expect(FakeRecognition.made[0]!.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(FakeRecognition.made).toHaveLength(1); // no restart while hidden: two tabs would fight over the mic for ever
  });

  it('a visible tab still restarts after Chrome ends a session by itself', async () => {
    const voice = createVoice(handlers());
    voice.setMic(true);
    FakeRecognition.made[0]!.onend?.(); // 15 s of silence
    await vi.advanceTimersByTimeAsync(300);
    expect(FakeRecognition.made).toHaveLength(2);
  });
});

describe('starting to listen after a page load, without a click', () => {
  const capsuleText = () => document.querySelector('tandem-overlay')!.shadowRoot!.textContent!.replace(/\s+/g, ' ');
  const permission = (state: string | undefined) => {
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: state ? { query: async () => ({ state }) } : undefined });
  };

  it('starts at once where the site already has the microphone, and does not save anything', async () => {
    permission('granted');
    const tandem = boot();
    await tandem.listen();
    expect(FakeRecognition.made).toHaveLength(1);
    expect(FakeRecognition.made[0]!.started).toBe(true);
    expect(micSaves).toEqual([]);
  });

  it('never pops Chrome\'s microphone prompt on a page the user only just arrived at: it says what to do instead', async () => {
    permission('prompt');
    const tandem = boot();
    await tandem.listen();
    expect(FakeRecognition.made).toHaveLength(0); // start() without a gesture would have made Chrome ask
    expect(capsuleText()).toContain('Click the mic to allow it on this site.');
    expect(micSaves).toEqual([]); // the tab's mic stays on for the next site
  });

  it('on a site where the microphone is blocked a click cannot help, so it does not ask for one', async () => {
    permission('denied'); // blocked by the user once, or by the site's own Permissions-Policy
    const tandem = boot();
    await tandem.listen();
    expect(FakeRecognition.made).toHaveLength(0);
    expect(capsuleText()).toContain('blocked on this site');
    expect(capsuleText()).not.toContain('Click the mic');
    expect(micSaves).toEqual([]); // still on for the next site
  });

  it('the hint goes away once the user has clicked and is listening', async () => {
    permission('prompt');
    const tandem = boot();
    await tandem.listen();
    document.querySelector('tandem-overlay')!.shadowRoot!.querySelector<HTMLButtonElement>('.mic')!.click(); // allowed
    expect(FakeRecognition.made).toHaveLength(1);
    expect(capsuleText()).not.toContain('Click the mic'); // or it would now be telling a listening user to turn the mic off
    expect(capsuleText()).toContain('Listening');
  });

  it('clicked as told and still refused: it stops saying "click"', async () => {
    permission('prompt');
    FakeRecognition.failWith = 'not-allowed';
    const tandem = boot();
    await tandem.listen();
    document.querySelector('tandem-overlay')!.shadowRoot!.querySelector<HTMLButtonElement>('.mic')!.click(); // pressed Block
    await vi.advanceTimersByTimeAsync(10);
    expect(capsuleText()).toContain('blocked on this site');
    expect(capsuleText()).not.toContain('Click the mic');
  });

  it('says the same when it cannot ask Chrome beforehand and the start is refused', async () => {
    permission(undefined);
    FakeRecognition.failWith = 'not-allowed';
    const tandem = boot();
    await tandem.listen();
    await vi.advanceTimersByTimeAsync(10);
    expect(capsuleText()).toContain('Click the mic to allow it on this site.');
  });
});
