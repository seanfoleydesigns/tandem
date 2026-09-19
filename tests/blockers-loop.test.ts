// @vitest-environment jsdom
// Blockers in the real loop: something covers the target, the agent dismisses it with one of its OWN controls
// that refuses or closes, and tries the same action once more. It never presses a control that accepts.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { blockerOf } from '../agent/blockers';
import { runLoop, type LoopHooks } from '../agent/loop';
import type { DecideRequest, DecideResponse, ElementRow } from '../shared/types';

const head = (choice: string) => ({ choice, confidence: 0.99, probabilities: { [choice]: 0.99 } });
let urls: string[];
let pressed: string[];
let trail: string[];
let overlay: HTMLElement;
let answer: (name: string) => { refuses: number; accepts: number };

function hooks(): LoopHooks {
  return {
    overlay, labelStyle: () => 'described', pageFocus: () => null, onRing() {}, onStep() {}, onTrail: (t) => trail.push(t), onDriving() {},
    prefs: () => [], savePref() {}, ask: async () => ({ type: 'skip' }), matchOption: async () => undefined,
    parseGoal: async () => ({ constraints: {}, llm: { ok: true, ms: 1 } }), verify: async () => ({ ok: true, issues: [], spoken: '', llm: { ok: true, ms: 1 } }),
    onThinking() {}, lastConstraints: () => ({}), setConstraints() {},
  };
}

beforeAll(() => {
  Element.prototype.getBoundingClientRect = () => ({ x: 10, y: 10, left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30, toJSON() {} }) as DOMRect;
  Element.prototype.scrollIntoView = () => {};
  window.scrollBy = (() => {}) as typeof window.scrollBy;
});

function page(popup: string) {
  document.body.innerHTML = `<main><button id="more">Load more</button></main>
    <div id="popup" style="position: fixed" role="dialog" aria-label="Offer"><h2>Get 10% off</h2>${popup}</div><div id="tandem"></div>`;
  overlay = document.getElementById('tandem')!;
  document.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    pressed.push(b.textContent ?? '');
    if (b.closest('#popup') && !/subscribe|accept/i.test(b.textContent ?? '')) document.getElementById('popup')!.remove(); // a refusal closes it
  }));
  // While the pop-up is there it covers everything outside itself.
  (document as unknown as { elementsFromPoint: () => Element[] }).elementsFromPoint = () => {
    const popupEl = document.getElementById('popup');
    return popupEl ? [popupEl] : [document.getElementById('more')!];
  };
}

beforeEach(() => {
  urls = []; pressed = []; trail = [];
  answer = (name) => (/no thanks/i.test(name) ? { refuses: 0.88, accepts: 0.08 } : { refuses: 0.3, accepts: 0.75 });
  vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
    urls.push(String(url));
    const body = JSON.parse(init.body) as DecideRequest & { controls?: ElementRow[] };
    if (String(url).includes('/api/decide')) {
      const more = body.snapshot.rows.find((r) => r.name === 'Load more')!;
      const res: DecideResponse = { model: 'jev-test', ms: 1, usage: { input_tokens: 1, output_tokens: 1 }, labelStyle: 'described', heads: { kind: head('ACTION'), operation: head('CLICK'), click_target: head(more.id) } };
      return { ok: true, json: async () => res } as Response;
    }
    const scores = Object.fromEntries(body.controls!.map((c) => [c.id, answer(c.name)]));
    return { ok: true, json: async () => ({ model: 'jev-test', ms: 1, usage: { input_tokens: 1, output_tokens: 1 }, scores }) } as Response;
  });
});

const drive = () => runLoop({ utterance: 'load more', leash: 'single', maxSteps: 1, heard: { final: 0 } }, hooks());
// The covered check in these tests treats the pop-up itself as reachable: its own buttons are inside it.

describe('a pop-up covers the target', () => {
  it('Jev picks the guilt-trip refusal, Subscribe is never pressed, and the action is tried again', async () => {
    page('<button>Subscribe and save</button><button>No thanks, I\'d rather pay full price</button>');
    const trace = await drive();
    expect(pressed).toEqual(["No thanks, I'd rather pay full price", 'Load more']);
    expect(trace.result).toBe('acted');
    expect(trace.blocker).toMatchObject({ trigger: 'covered', by: 'jev', dismissed: true, removed: ['Subscribe and save'] });
    expect(trail).toEqual(['Dismissed a pop-up', 'Pressed Load more']);
    expect(urls).toEqual(['/api/decide', '/api/dismiss']);
  });

  it('Jev never even sees the accepting control', async () => {
    page('<button>Subscribe and save</button><button>No thanks, I\'d rather pay full price</button>');
    const seen: string[] = [];
    answer = (name) => { seen.push(name); return { refuses: 0.9, accepts: 0.05 }; };
    await drive();
    expect(seen).toEqual(["No thanks, I'd rather pay full price"]);
  });

  it('an exact "Reject all" is taken in code, with no model call', async () => {
    page('<button>Accept all</button><button>Reject all</button>');
    const trace = await drive();
    expect(pressed).toEqual(['Reject all', 'Load more']);
    expect(trace.blocker).toMatchObject({ by: 'code', dismissed: true });
    expect(urls).toEqual(['/api/decide']);
  });

  it('when no control clearly refuses, nothing inside it is pressed and the action fails honestly', async () => {
    page('<button>Subscribe and save</button><button>Tell me more</button>');
    const trace = await drive();
    expect(pressed).toEqual([]);
    expect(trace.result).toBe('failed');
    expect(trace.blocker).toMatchObject({ by: 'nobody', dismissed: false });
  });

  it('a page with nothing in the way makes no dismiss call at all', async () => {
    page('');
    document.getElementById('popup')!.remove();
    const trace = await drive();
    expect(pressed).toEqual(['Load more']);
    expect(trace.blocker).toBeUndefined();
    expect(urls).toEqual(['/api/decide']);
  });
});

describe('what is not a blocker, and what must not happen after stop (M5 review)', () => {
  it('a fixed app shell that CONTAINS the target is not a pop-up: none of its buttons is pressed', async () => {
    document.body.innerHTML = '<div id="app" style="position: fixed"><button>Decline</button><div id="tip">tooltip</div><button id="more">Load more</button></div><div id="tandem"></div>';
    overlay = document.getElementById('tandem')!;
    document.querySelectorAll('button').forEach((x) => x.addEventListener('click', () => pressed.push(x.textContent ?? '')));
    (document as unknown as { elementsFromPoint: () => Element[] }).elementsFromPoint = () => [document.getElementById('tip')!];
    const trace = await drive();
    expect(pressed).toEqual([]); // "Decline" is the page's own button (a meeting invite, say), not ours to press
    expect(trace.result).toBe('failed');
    expect(trace.blocker).toBeUndefined();
  });

  it('if the user says stop while a pop-up is being closed, the original click does not land', async () => {
    page('<button>Subscribe and save</button><button>No thanks, I\'d rather pay full price</button>');
    const controller = new AbortController();
    const h = hooks();
    h.onTrail = (t) => { trail.push(t); if (t === 'Dismissed a pop-up') controller.abort(); };
    await runLoop({ utterance: 'load more', leash: 'single', maxSteps: 1, heard: { final: 0 }, signal: controller.signal }, h);
    expect(pressed).toEqual(["No thanks, I'd rather pay full price"]); // Load more was never pressed
  });

  it('drive mode: a command that cannot be carried out inside an open pop-up dismisses it and looks again, once', async () => {
    page('<button>Subscribe and save</button><button>No thanks, I\'d rather pay full price</button>');
    document.getElementById('popup')!.setAttribute('aria-modal', 'true');
    let decides = 0;
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      urls.push(String(url));
      const body = JSON.parse(init.body) as DecideRequest & { controls?: ElementRow[] };
      if (String(url).includes('/api/dismiss')) return { ok: true, json: async () => ({ ms: 1, scores: Object.fromEntries(body.controls!.map((c) => [c.id, answer(c.name)])) }) } as Response;
      decides += 1;
      const more = body.snapshot.rows.find((r) => r.name === 'Load more');
      const heads = more ? { kind: head('ACTION'), operation: head('CLICK'), click_target: head(more.id) } : { kind: head('ACTION'), operation: head('STUCK') };
      return { ok: true, json: async () => ({ model: 'jev-test', ms: 1, usage: { input_tokens: 1, output_tokens: 1 }, labelStyle: 'described', heads }) } as Response;
    });
    const trace = await drive();
    expect(decides).toBe(2); // once inside the pop-up, once on the page behind it
    expect(pressed).toEqual(["No thanks, I'd rather pay full price", 'Load more']);
    expect(trace.blocker).toMatchObject({ trigger: 'modal', dismissed: true }); // the inspector keeps the row
  });

  it('speech that was not for the agent never closes anything', async () => {
    page('<button>Subscribe and save</button><button>No thanks, I\'d rather pay full price</button>');
    document.getElementById('popup')!.setAttribute('aria-modal', 'true');
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(String(url));
      const weak = { choice: 'NOT_FOR_ME', confidence: 0.4, probabilities: { NOT_FOR_ME: 0.45 } };
      return { ok: true, json: async () => ({ model: 'jev-test', ms: 1, usage: { input_tokens: 1, output_tokens: 1 }, labelStyle: 'described', heads: { kind: weak, operation: head('STUCK') } }) } as Response;
    });
    const trace = await runLoop({ utterance: 'hmm what now', leash: 'single', maxSteps: 1, heard: { final: 0 } }, hooks());
    expect(pressed).toEqual([]);
    expect(trace.result).toBe('ignored');
    expect(urls).toEqual(['/api/decide']);
  });
});

describe('a modal open at task start is dismissed before anything else', () => {
  it('runs before the clean slate and the parse', async () => {
    page('<button>Subscribe and save</button><button>No thanks, I\'d rather pay full price</button>');
    document.getElementById('popup')!.setAttribute('aria-modal', 'true');
    const order: string[] = [];
    const h = hooks();
    h.parseGoal = async () => { order.push(`parse (pop-up ${document.getElementById('popup') ? 'open' : 'gone'})`); return { constraints: {}, llm: { ok: true, ms: 1 } }; };
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      urls.push(String(url));
      const body = JSON.parse(init.body) as { controls?: ElementRow[] };
      if (String(url).includes('/api/dismiss')) return { ok: true, json: async () => ({ ms: 1, scores: Object.fromEntries(body.controls!.map((c) => [c.id, answer(c.name)])) }) } as Response;
      const res: DecideResponse = { model: 'jev-test', ms: 1, usage: { input_tokens: 1, output_tokens: 1 }, labelStyle: 'described', heads: { operation: head('DONE') } };
      return { ok: true, json: async () => res } as Response;
    });
    const trace = await runLoop({ goal: 'find me white sneakers', leash: 'task', maxSteps: 3, heard: { final: 0 } }, h);
    expect(urls[0]).toBe('/api/dismiss');
    expect(order).toEqual(['parse (pop-up gone)']);
    expect(pressed).toEqual(["No thanks, I'd rather pay full price"]);
    expect(trace.result).toBe('done');
  });
});

describe('blockerOf', () => {
  it('finds the dialog or the fixed box a covering element belongs to, and nothing for plain page content', () => {
    page('<button>Close</button>');
    expect(blockerOf(document.querySelector('#popup button')!)?.id).toBe('popup');
    expect(blockerOf(document.getElementById('more')!)).toBeUndefined();
  });
});
