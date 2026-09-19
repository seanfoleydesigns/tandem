import { describe, expect, it } from 'vitest';
import { denied, looping, needy, resolve, type PolicyContext } from '../shared/policy';
import type { ActionRecord, Head, Heads } from '../shared/types';

function head(probabilities: Record<string, number>, confidence: number): Head {
  const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]![0];
  return { choice, confidence, probabilities };
}
const sure = (label: string) => head({ [label]: 0.95, none: 0.05 }, 0.9);

const task: PolicyContext = {
  leash: 'task', useKind: false, goal: 'find me white shoes',
  groups: { e1: 'Colour', e2: 'Size', e3: 'Size (required)', e9: undefined },
  names: { e1: 'White', e2: '10.5', e3: '10.5', e9: 'Checkout' },
  needs: {}, asked: [], history: [],
};

describe('asking: needs_* Nouls decide, because a Choice collapses onto one winner', () => {
  it('lists groups at or above ASK_MIN that were not asked or skipped, highest first', () => {
    expect(needy({ size: 0.93, brand: 0.2, width: 0.75, price: 0.7 }, ['width'])).toEqual([['size', 0.93], ['price', 0.7]]);
  });

  it('acts on a click outside the needy group first (colour before size)', () => {
    const heads: Heads = { operation: sure('CLICK'), click_target: sure('e1') };
    expect(resolve(heads, { ...task, needs: { size: 0.9 } })).toMatchObject({ type: 'Act', target: 'e1' });
  });

  it('asks instead of clicking inside the needy group, whatever suffix the legend has', () => {
    for (const target of ['e2', 'e3']) {
      const heads: Heads = { operation: sure('CLICK'), click_target: sure(target) };
      expect(resolve(heads, { ...task, needs: { size: 0.9 } })).toMatchObject({ type: 'Ask', group: 'size' });
    }
  });

  it('accepts DONE only when no needs_* is at or above ASK_MIN', () => {
    const done: Heads = { operation: sure('DONE') };
    expect(resolve(done, { ...task, needs: { size: 0.9 } })).toMatchObject({ type: 'Ask', group: 'size' });
    expect(resolve(done, { ...task, needs: { size: 0.69 } })).toMatchObject({ type: 'HandBack', outcome: 'done' });
  });

  it('does not ask again about a group that was asked or skipped in this task', () => {
    const done: Heads = { operation: sure('DONE') };
    expect(resolve(done, { ...task, needs: { size: 0.9 }, asked: ['size'] })).toMatchObject({ type: 'HandBack', outcome: 'done' });
  });

  it('turns STUCK or a weak operation into a question when there is one to ask', () => {
    expect(resolve({ operation: sure('STUCK') }, { ...task, needs: { size: 0.8 } }).type).toBe('Ask');
    expect(resolve({ operation: head({ CLICK: 0.5, DONE: 0.5 }, 0.2) }, { ...task, needs: { size: 0.8 } }).type).toBe('Ask');
    expect(resolve({ operation: sure('STUCK') }, task)).toMatchObject({ type: 'HandBack', outcome: 'stuck' });
  });

  it('never asks on the single leash', () => {
    const heads: Heads = { operation: sure('CLICK'), click_target: sure('e2') };
    expect(resolve(heads, { ...task, leash: 'single', needs: { size: 0.99 } })).toMatchObject({ type: 'Act', target: 'e2' });
  });
});

describe('kind floors', () => {
  const heads: Heads = { operation: sure('SCROLL_DOWN') };
  const on: PolicyContext = { leash: 'single', useKind: true, groups: {}, utterance: 'with a leather sole' };
  it('DICTATION needs its own probability to reach DICTATION_MIN', () => {
    expect(resolve({ ...heads, kind: head({ DICTATION: 0.38, ACTION: 0.35, NOT_FOR_ME: 0.27 }, 0.1) }, on)).toMatchObject({ type: 'Act' });
    expect(resolve({ ...heads, kind: head({ DICTATION: 0.6, ACTION: 0.4 }, 0.3) }, on)).toMatchObject({ type: 'Dictate', text: 'with a leather sole' });
  });
});

describe('rule 6: deny-list (task mode)', () => {
  it('never clicks buy, checkout, pay and the like', () => {
    for (const name of ['Checkout', 'Buy now', 'Place order', 'Pay $72', 'Confirm', 'Subscribe', 'Check out']) expect(denied(name, 'find me shoes')).toBe(true);
    for (const name of ['White', 'Load more', 'Payment options explained', 'Northfield Court Classic']) expect(denied(name, 'find me shoes')).toBe(false);
  });
  it('allows Add to cart only when the goal literally asks for it', () => {
    expect(denied('Add to cart', 'find me white shoes')).toBe(true);
    expect(denied('Add to cart', 'add to cart the white court classic')).toBe(false);
  });
  it('hands back with "yours" instead of clicking', () => {
    const heads: Heads = { operation: sure('CLICK'), click_target: sure('e9') };
    expect(resolve(heads, task)).toMatchObject({ type: 'HandBack', outcome: 'yours' });
    // Drive mode: confirm instead of block. Speech can be misheard, so spending money needs a second yes.
    expect(resolve(heads, { ...task, leash: 'single', utterance: 'check out' })).toMatchObject({ type: 'Confirm', name: 'Checkout', target: 'e9' });
  });
});

describe('rule 7: loop detection', () => {
  const rec = (op: ActionRecord['op'], target: string | undefined, outcome: ActionRecord['outcome']): ActionRecord => ({ op, target, outcome, ts: 0 });
  it('stops at the same operation on the same target three times', () => {
    const h = [rec('CLICK', 'White', 'changed'), rec('CLICK', 'White', 'changed')];
    expect(looping(h, { op: 'CLICK', target: 'White' })).toMatch(/three times/);
    expect(looping(h, { op: 'CLICK', target: 'Black' })).toBeUndefined();
  });
  it('stops after three actions that changed nothing', () => {
    const h = [rec('SCROLL_DOWN', undefined, 'no_change'), rec('SCROLL_DOWN', undefined, 'no_change'), rec('CLICK', 'x', 'failed')];
    expect(looping(h, { op: 'SCROLL_UP' })).toMatch(/changed nothing/);
  });
  it('is wired into resolve on the task leash', () => {
    const heads: Heads = { operation: sure('CLICK'), click_target: sure('e1') };
    const history = [rec('CLICK', 'White', 'changed'), rec('CLICK', 'White', 'changed')];
    expect(resolve(heads, { ...task, history })).toMatchObject({ type: 'HandBack', outcome: 'stuck' });
  });
});

describe('never silent: an Ignore says why', () => {
  const drive: PolicyContext = { leash: 'single', useKind: true, groups: {}, utterance: 'x' };
  it('not_found when the operation is STUCK or the target is a confident none', () => {
    expect(resolve({ operation: sure('STUCK') }, drive)).toMatchObject({ type: 'Ignore', why: 'not_found' });
    expect(resolve({ operation: sure('CLICK'), click_target: head({ none: 0.9, e1: 0.1 }, 0.8) }, drive)).toMatchObject({ type: 'Ignore', why: 'not_found' });
    expect(resolve({ operation: sure('SELECT') }, drive)).toMatchObject({ type: 'Ignore', why: 'not_found' });
  });
  it('unsure when the operation confidence is low, or a weak NOT_FOR_ME may have been a command', () => {
    expect(resolve({ operation: head({ CLICK: 0.5, TYPE: 0.5 }, 0.2) }, drive)).toMatchObject({ type: 'Ignore', why: 'unsure' });
    expect(resolve({ operation: sure('CLICK'), kind: head({ NOT_FOR_ME: 0.45, ACTION: 0.4, TASK: 0.15 }, 0.2) }, drive)).toMatchObject({ type: 'Ignore', why: 'unsure' });
  });
  it('stays quiet about speech that is confidently not for it', () => {
    expect(resolve({ operation: sure('CLICK'), kind: head({ NOT_FOR_ME: 0.97, ACTION: 0.03 }, 0.9) }, drive)).toMatchObject({ type: 'Ignore', why: 'not_for_me' });
  });
});
