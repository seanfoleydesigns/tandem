// The extension's decisions, without Chrome: who is on, when a task resumes, and what may reach the network.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SavedTask } from '../agent/env';
import { API_BASE, badgeFor, hello, mayCallApi, maySpeak, OFF, onClick, onLoaded, originPattern, RESUME_MS, TTS_FINAL, type TabState } from '../extension/state';

const task = (ts: number): SavedTask => ({ goal: 'find the article about Alan Turing', constraints: { search_query: 'Alan Turing' }, history: [], asked: [], step: 2, parsed: true, ts });
const ON: TabState = { on: true };

describe('per-site grants: only the current site is ever asked for', () => {
  it('asks for scheme and host, nothing wider, and only for http and https', () => {
    expect(originPattern('https://en.wikipedia.org/wiki/Alan_Turing?x=1')).toBe('https://en.wikipedia.org/*');
    expect(originPattern('http://localhost:5173/?gym=hard')).toBe('http://localhost:5173/*');
    for (const url of ['chrome://extensions', 'chrome-extension://abc/page.html', 'file:///C:/x.html', 'about:blank', '', undefined]) expect(originPattern(url)).toBeUndefined();
  });
});

describe('the toolbar click', () => {
  it('off -> on when the site was granted; stays off when it was not', () => {
    expect(onClick(OFF, true, 1000)).toMatchObject({ next: { on: true, paused: false }, action: 'inject' });
    expect(onClick(OFF, false, 1000)).toEqual({ next: OFF, action: 'none' });
  });
  it('on -> off, and the task and constraints go with it', () => {
    expect(onClick({ on: true, task: task(0), constraints: { max_price: 100 } }, true, 1000)).toEqual({ next: { on: false, constraints: undefined }, action: 'off' });
  });
  it('paused -> one click grants and resumes, and the time spent paused does not age the task', () => {
    const paused: TabState = { on: true, paused: true, pausedAt: 50_000, task: task(40_000) };
    const { next, action } = onClick(paused, true, 170_000); // two minutes later
    expect(action).toBe('inject');
    expect(next).toMatchObject({ on: true, paused: false, task: { ts: 160_000 } });
    expect(hello(next, 170_000).task).toBeDefined(); // ten seconds old by its own clock: resumed
    expect(onClick(paused, false, 170_000)).toEqual({ next: paused, action: 'none' }); // declined: still paused
  });
});

describe('an enabled tab loads a page', () => {
  it('a granted site keeps working', () => expect(onLoaded(ON, true, 0)).toEqual({ next: ON, action: 'inject' }));
  it('a site that was not granted pauses Tandem and any task', () => {
    const { next, action } = onLoaded({ on: true, task: task(0) }, false, 5000);
    expect(action).toBe('pause');
    expect(next).toMatchObject({ on: true, paused: true, pausedAt: 5000 });
    expect(hello(next, 6000)).toEqual({ on: false }); // nothing runs, nothing resumes, while paused
    expect(onLoaded(next, false, 9000).next.pausedAt).toBe(5000); // the pause started once
  });
  it('coming back to a granted site ends the pause', () => {
    expect(onLoaded({ on: true, paused: true, pausedAt: 1 }, true, 2)).toMatchObject({ next: { on: true, paused: false }, action: 'inject' });
  });
  it('a tab that is off is left alone', () => expect(onLoaded(OFF, true, 0).action).toBe('none'));
});

describe('resume: a task younger than 60 s continues on the next page', () => {
  it('fresh: handed to the content script; stale: dropped', () => {
    expect(hello({ on: true, task: task(1000) }, 1000 + RESUME_MS - 1).task?.step).toBe(2);
    expect(hello({ on: true, task: task(1000) }, 1000 + RESUME_MS).task).toBeUndefined();
  });
  it('the last constraints come back too, so price dimming survives a page load', () => {
    expect(hello({ on: true, constraints: { max_price: 100 } }, 0)).toEqual({ on: true, constraints: { max_price: 100 } });
  });
});

describe('page text leaves the browser only for a tab that is on, and only to the Tandem routes', () => {
  it('on: the /api routes', () => expect(['/api/decide', '/api/parse', '/api/dismiss'].every((p) => mayCallApi(ON, p))).toBe(true));
  it('off or paused: nothing', () => {
    expect(mayCallApi(OFF, '/api/decide')).toBe(false);
    expect(mayCallApi({ on: true, paused: true }, '/api/decide')).toBe(false);
  });
  it('never anything but a plain /api route', () => {
    for (const p of ['/api/../secret', 'http://evil.example/api/decide', '/api/decide?x=1', '//evil.example/api', '/other', 42, undefined]) expect(mayCallApi(ON, p)).toBe(false);
  });
});

describe('voice across page loads: the mic and the voice belong to the tab, not to the page', () => {
  it('the next page is told the mic was on, so it starts listening by itself', () => {
    expect(hello({ on: true, mic: true }, 0)).toEqual({ on: true, mic: true });
    expect(hello({ on: true, mic: false }, 0)).toEqual({ on: true });
  });
  it('listening and resuming are independent: a page can be told both, either, or neither', () => {
    expect(hello({ on: true, mic: true, task: task(0) }, 1000)).toMatchObject({ on: true, mic: true, task: { step: 2 } });
    expect(hello({ on: true, task: task(0) }, 1000)).toMatchObject({ on: true, task: { step: 2 } });
  });
  it('a paused tab is told nothing, and turning Tandem off forgets the mic', () => {
    expect(hello({ on: true, paused: true, mic: true }, 0)).toEqual({ on: false });
    expect(onClick({ on: true, mic: true }, true, 0).next).toEqual({ on: false, constraints: undefined });
  });
  it('mute is kept the same way: told to the next page, hidden while paused, forgotten when Tandem is turned off', () => {
    expect(hello({ on: true, muted: true }, 0)).toEqual({ on: true, muted: true });
    expect(hello({ on: true, paused: true, muted: true }, 0)).toEqual({ on: false });
    expect(onClick({ on: true, muted: true }, true, 0).next.muted).toBeUndefined();
    expect(onClick(onLoaded({ on: true, muted: true }, false, 10).next, true, 20).next).toMatchObject({ on: true, paused: false, muted: true });
  });
  it('the mic setting survives a pause on a site without access', () => {
    const paused = onLoaded({ on: true, mic: true }, false, 10).next;
    expect(onClick(paused, true, 20).next).toMatchObject({ on: true, paused: false, mic: true });
  });
  it('the browser speaks only for a tab that is on, and only short phrases', () => {
    expect(maySpeak(ON, 'Your turn.')).toBe(true);
    expect(maySpeak(OFF, 'Your turn.')).toBe(false);
    expect(maySpeak({ on: true, paused: true }, 'Your turn.')).toBe(false);
    for (const text of ['', 'x'.repeat(401), 42, undefined]) expect(maySpeak(ON, text)).toBe(false);
  });
  it('every way a phrase can end lowers the echo guard', () => expect(TTS_FINAL).toEqual(['end', 'interrupted', 'cancelled', 'error']));
});

describe('the badge', () => {
  it('says on, off when paused, and nothing when off', () => {
    expect(badgeFor(ON).text).toBe('on');
    expect(badgeFor({ on: true, paused: true })).toMatchObject({ text: 'off', title: expect.stringContaining('turn it on for this site') });
    expect(badgeFor(OFF).text).toBe('');
  });
});

describe('the manifest', () => {
  const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'extension/manifest.json'), 'utf8'));
  it('is off by default: no content scripts, no host access beyond the local server, no popup', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.content_scripts).toBeUndefined();
    expect(manifest.host_permissions).toEqual([`${API_BASE}/*`]); // the same literal host the worker fetches
    expect(manifest.optional_host_permissions).toEqual(['<all_urls>']);
    expect(manifest.permissions.sort()).toEqual(['activeTab', 'scripting', 'storage', 'tts']); // no "tabs", no "webNavigation": no history warning; "tts" shows none
    expect(manifest.action.default_popup).toBeUndefined(); // a popup would stop action.onClicked from firing
  });
});
