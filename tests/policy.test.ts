import { describe, expect, it } from 'vitest';
import { massSet, resolve, type PolicyContext } from '../shared/policy';
import type { Head, Heads } from '../shared/types';

// Build a head from probabilities. Confidence is given separately because it is NOT the top probability.
function head(probabilities: Record<string, number>, confidence: number): Head {
  const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]![0];
  return { choice, confidence, probabilities };
}

const drive: PolicyContext = { leash: 'single', useKind: false, groups: {}, utterance: 'x' };
const task: PolicyContext = { ...drive, leash: 'task' };
const sure = (label: string, others: string[] = ['none']) =>
  head(Object.fromEntries([[label, 0.95], ...others.map((o) => [o, 0.05 / others.length] as [string, number])]), 0.9);

describe('rule 1: kind', () => {
  const heads: Heads = { kind: sure('TASK', ['ACTION']), operation: sure('CLICK'), click_target: sure('e1') };
  it('is ignored until kind routing is switched on (M1)', () => {
    expect(resolve(heads, drive).type).toBe('Act');
  });
  it('routes TASK, STOP and NOT_FOR_ME when switched on', () => {
    const on = { ...drive, useKind: true, utterance: 'find me white shoes' };
    expect(resolve(heads, on)).toMatchObject({ type: 'StartTask', goal: 'find me white shoes' });
    expect(resolve({ ...heads, kind: sure('STOP', ['ACTION']) }, on)).toMatchObject({ type: 'HandBack', outcome: 'stopped' });
    expect(resolve({ ...heads, kind: sure('NOT_FOR_ME', ['ACTION']) }, on).type).toBe('Ignore');
  });
});

describe('rule 2: operation confidence gates on confidence, not on top probability', () => {
  const heads: Heads = { operation: head({ CLICK: 0.84, SCROLL_DOWN: 0.16 }, 0.45), click_target: sure('e1') };
  it('drive mode ignores', () => expect(resolve(heads, drive).type).toBe('Ignore'));
  it('task mode is stuck', () => expect(resolve(heads, task)).toMatchObject({ type: 'HandBack', outcome: 'stuck' }));
});

describe('operations without a target', () => {
  it('acts on scroll and back without reading any target head', () => {
    for (const op of ['SCROLL_DOWN', 'SCROLL_UP', 'GO_BACK'] as const) {
      // click_target is confidently wrong here; it is a speculative head and must not be read.
      const r = resolve({ operation: sure(op), click_target: sure('e9') }, drive);
      expect(r).toMatchObject({ type: 'Act', op });
      expect(r).not.toHaveProperty('target');
    }
  });
  it('hands back on DONE and gives up on STUCK', () => {
    expect(resolve({ operation: sure('DONE') }, task)).toMatchObject({ type: 'HandBack', outcome: 'done' });
    expect(resolve({ operation: sure('STUCK') }, drive).type).toBe('Ignore');
  });
});

describe('rule 3: target heads', () => {
  it('acts on a confident click target', () => {
    expect(resolve({ operation: sure('CLICK'), click_target: sure('e7') }, drive)).toMatchObject({ type: 'Act', op: 'CLICK', target: 'e7' });
  });
  it('uses the select head for SELECT', () => {
    expect(resolve({ operation: sure('SELECT'), select_target: sure('e12_o1'), click_target: sure('e1') }, drive)).toMatchObject({ target: 'e12_o1' });
  });
  it('gives up when the page offers no candidate for the head', () => {
    expect(resolve({ operation: sure('SELECT') }, drive).type).toBe('Ignore');
  });
  it('treats a confident none as nothing fits, without badging near-zero rows', () => {
    const heads: Heads = { operation: sure('CLICK'), click_target: head({ none: 0.9, e1: 0.06, e2: 0.04 }, 0.8) };
    expect(resolve(heads, drive).type).toBe('Ignore');
    expect(resolve(heads, task)).toMatchObject({ type: 'HandBack', outcome: 'stuck' });
  });
});

describe('rule 4: ambiguity inside one group becomes a question', () => {
  const groups = { e1: 'Size', e2: 'Size', e3: 'Size', e4: 'Colour' };
  const split: Heads = { operation: sure('CLICK'), click_target: head({ e1: 0.45, e2: 0.4, e4: 0.05, none: 0.1 }, 0.3) };

  it('leaves none out of the 80% mass set', () => {
    expect(massSet(split.click_target!)).toEqual(['e1', 'e2']);
  });
  it('task mode asks about the shared group', () => {
    expect(resolve(split, { ...task, groups })).toMatchObject({ type: 'Ask', group: 'Size' });
  });
  it('drive mode disambiguates the top two', () => {
    expect(resolve(split, { ...drive, groups })).toMatchObject({ type: 'Disambiguate', candidates: ['e1', 'e2'] });
  });
  it('reads the top probability, so a peaked head is not ambiguous even with modest confidence', () => {
    const peaked: Heads = { operation: sure('CLICK'), click_target: head({ e1: 0.7, e2: 0.25, none: 0.05 }, 0.55) };
    expect(resolve(peaked, { ...task, groups })).toMatchObject({ type: 'Act', target: 'e1' });
  });
  it('does not ask when the candidates span groups', () => {
    const mixed: Heads = { operation: sure('CLICK'), click_target: head({ e1: 0.45, e4: 0.45, none: 0.1 }, 0.3) };
    expect(resolve(mixed, { ...task, groups })).toMatchObject({ type: 'HandBack', outcome: 'stuck' });
  });
});

describe('rule 5: other low-confidence targets', () => {
  const mixed: Heads = { operation: sure('CLICK'), click_target: head({ e1: 0.5, e4: 0.4, none: 0.1 }, 0.35) };
  it('drive mode disambiguates the top two', () => {
    expect(resolve(mixed, drive)).toMatchObject({ type: 'Disambiguate', candidates: ['e1', 'e4'] });
  });
  it('task mode is stuck', () => expect(resolve(mixed, task)).toMatchObject({ type: 'HandBack', outcome: 'stuck' }));
  it('a weak none with one real candidate is ignored in drive mode', () => {
    const heads: Heads = { operation: sure('CLICK'), click_target: head({ none: 0.55, e1: 0.45 }, 0.1) };
    expect(resolve(heads, drive).type).toBe('Ignore');
  });
});

describe('TYPE needs a field and the words', () => {
  const base: Heads = { operation: sure('TYPE'), type_target: sure('e3') };
  it('types the chosen span into the chosen field', () => {
    const heads = { ...base, typed_span: sure('running shoes', ['search for running shoes', '(none)']) };
    expect(resolve(heads, drive)).toMatchObject({ type: 'Act', op: 'TYPE', target: 'e3', text: 'running shoes' });
  });
  it('gives up when no span is chosen', () => {
    expect(resolve({ ...base, typed_span: sure('(none)', ['shoes']) }, drive).type).toBe('Ignore');
    expect(resolve(base, drive).type).toBe('Ignore');
  });
});
