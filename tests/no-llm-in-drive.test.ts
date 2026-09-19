// @vitest-environment jsdom
// Guarantee: nothing in drive mode calls the LLM. This test fails if it ever does.
// It runs the real loop on both leashes with the network mocked, and it checks the server's imports.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runLoop, type LoopHooks } from '../agent/loop';
import type { DecideResponse } from '../shared/types';

const head = (choice: string) => ({ choice, confidence: 0.99, probabilities: { [choice]: 0.99 } });
const decide = (operation: string): DecideResponse => ({
  model: 'jev-test', ms: 1, usage: { input_tokens: 1, output_tokens: 1 }, labelStyle: 'described',
  heads: { kind: head('ACTION'), operation: head(operation) },
});

let urls: string[];
let llmHookCalls: string[];

function hooks(): LoopHooks {
  return {
    overlay: document.createElement('div'), labelStyle: () => 'described', pageFocus: () => null,
    onRing() {}, onStep() {}, onTrail() {}, onDriving() {}, prefs: () => [], savePref() {},
    ask: async () => ({ type: 'skip' }), matchOption: async () => undefined,
    parseGoal: async () => { llmHookCalls.push('parse'); return { constraints: {}, llm: { ok: true, ms: 1 } }; },
    verify: async () => { llmHookCalls.push('verify'); return { ok: true, issues: [], spoken: 'Done.', llm: { ok: true, ms: 1 } }; },
    onThinking() {}, lastConstraints: () => ({}), setConstraints() {},
  };
}

beforeEach(() => {
  urls = [];
  llmHookCalls = [];
  document.body.innerHTML = '<main><button>Load more</button></main>';
  // jsdom has no layout: give the loop the few browser calls it touches.
  (document as unknown as { elementsFromPoint: () => Element[] }).elementsFromPoint = () => [];
  window.scrollBy = (() => {}) as typeof window.scrollBy;
  vi.stubGlobal('fetch', async (url: string) => {
    urls.push(String(url));
    const body = String(url).includes('/api/decide') ? decide(urls.filter((u) => u.includes('/api/decide')).length === 1 ? 'SCROLL_DOWN' : 'DONE') : {};
    return { ok: true, status: 200, json: async () => body } as Response;
  });
});

const heard = { final: 0 };
const llmUrls = () => urls.filter((u) => /\/api\/(parse|verify)/.test(u));

describe('the LLM sits at the edges of a task, never in drive mode', () => {
  it('drive mode: one action, Jev only, no LLM hook and no LLM route', async () => {
    const trace = await runLoop({ utterance: 'scroll down', leash: 'single', maxSteps: 1, heard }, hooks());
    expect(trace.result).toBe('acted');
    expect(urls).toEqual(['/api/decide']);
    expect(llmHookCalls).toEqual([]);
    expect(llmUrls()).toEqual([]);
    expect(trace.llm).toBeUndefined();
  });

  it('drive mode stays LLM-free for every kind of outcome Jev can return', async () => {
    for (const operation of ['SCROLL_UP', 'GO_BACK', 'STUCK', 'CLICK', 'TYPE', 'SELECT']) {
      vi.stubGlobal('fetch', async (url: string) => { urls.push(String(url)); return { ok: true, status: 200, json: async () => decide(operation) } as Response; });
      window.history.back = () => {};
      await runLoop({ utterance: 'anything', leash: 'single', maxSteps: 1, heard }, hooks());
    }
    expect(llmHookCalls).toEqual([]);
    expect(llmUrls()).toEqual([]);
  });

  it('the task leash does reach it, at the start and at DONE, so this test would notice a leak', async () => {
    const trace = await runLoop({ goal: 'find me white sneakers', leash: 'task', maxSteps: 5, heard }, hooks());
    expect(trace.result).toBe('done');
    expect(llmHookCalls).toEqual(['parse', 'verify']);
  });
});

describe('on the server, only llm.ts knows the LLM', () => {
  const root = process.cwd(); // vitest runs from the repo root
  const src = (f: string) => readFileSync(resolve(root, 'server', f), 'utf8');
  it('no other server file imports the LLM SDK', () => {
    const importers = readdirSync(resolve(root, 'server')).filter((f) => /@anthropic-ai\/sdk/.test(src(f)));
    expect(importers).toEqual(['llm.ts']);
  });
  it('the Jev paths used in drive mode never import llm.ts', () => {
    for (const f of ['decide.ts', 'jev.ts']) expect(src(f)).not.toMatch(/from '\.\/llm'/);
  });
  it('index.ts calls the LLM only from /api/parse and /api/verify', () => {
    const index = src('index.ts');
    const routes = index.split(/\napp\.(?:get|post)\(/).slice(1).map((r) => ({ path: r.match(/^'([^']+)'/)?.[1], usesLlm: /parseGoal\(|verifyAndSummarise\(/.test(r) }));
    expect(routes.filter((r) => r.usesLlm).map((r) => r.path)).toEqual(['/api/parse', '/api/verify']);
  });
  it('the agent and shared code never import the LLM SDK', () => {
    for (const dir of ['agent', 'shared', 'agent/ui']) {
      for (const f of readdirSync(resolve(root, dir)).filter((n) => n.endsWith('.ts'))) {
        expect(readFileSync(resolve(root, dir, f), 'utf8'), f).not.toMatch(/@anthropic-ai\/sdk/);
      }
    }
  });
});
