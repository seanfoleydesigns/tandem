import { describe, expect, it } from 'vitest';
import { blockerKind, codeFirst, dismissCandidates, dismissTrail, newBudget, pickDismiss, spend } from '../shared/blockers';
import { DISMISS_MIN, MAX_DISMISSALS } from '../shared/config';
import { accepts, declines, denied, resolve } from '../shared/policy';
import type { ElementRow, Head } from '../shared/types';

const row = (id: string, name: string, role = 'button'): ElementRow => ({ id, role, name });

describe('what may never be pressed to get a pop-up out of the way', () => {
  it.each(['Accept all', 'Allow all', 'I agree', 'Subscribe', 'Subscribe and save', 'Sign up', 'Yes, sign me up', 'Join now', 'Buy now', 'Checkout', 'Confirm my choices', 'Pay now - no fees'])(
    'removes %j in code', (name) => expect(accepts(name)).toBe(true));

  it.each(['Reject all', 'Necessary only', 'Accept only necessary cookies', 'No thanks', 'Not now', 'Close', '×', "No thanks, I'd rather pay full price",
    "No, I don't want to subscribe", 'No thanks, I prefer paying full price', 'Continue without accepting', 'Manage preferences', 'Got it'])(
    'keeps %j for the choice', (name) => expect(accepts(name)).toBe(false));

  it('a refusal is a refusal however it is worded: the refusing word comes first', () => {
    expect(declines("No thanks, I'd rather pay full price")).toBe(true);
    expect(declines("No, I don't like saving money")).toBe(true);
    expect(declines('Pay now - no fees')).toBe(false); // pays first
    expect(declines('Subscribe')).toBe(false);
  });

  // Word order is not enough (M5 review): these put a refusing word first and still accept or spend.
  it.each(['No thanks, continue to checkout', 'Skip to checkout', "Don't miss out - Subscribe now", "Don't wait - Buy now", 'No, take me to checkout', 'Not now - buy later',
    'Close and accept', 'Dismiss and subscribe', 'Never miss a deal - Sign me up', 'Skip and pay', 'Accept all necessary and marketing cookies', 'Allow all cookies, including non-essential',
    'No account? Checkout as guest', 'No, I want to buy now'])('%j is not a refusal', (name) => {
    expect(declines(name)).toBe(false);
    expect(accepts(name)).toBe(true);
  });

  it.each(["No thanks, I'd rather pay full price", "No, I don't want to subscribe", 'No thanks, I prefer paying full price', 'Not now, I’ll pay full price', 'Accept only essential cookies', 'Allow necessary cookies'])(
    '%j is a refusal, whatever else it mentions', (name) => expect(declines(name)).toBe(true));

  it('a link named X is not a close button', () => {
    expect(codeFirst([{ id: 'e1', role: 'link', name: 'X' }, { id: 'e2', role: 'link', name: 'Instagram' }])).toBeUndefined();
    expect(codeFirst([{ id: 'e1', role: 'button', name: 'X' }])?.id).toBe('e1');
    expect(codeFirst([{ id: 'e1', role: 'link', name: '×' }])?.id).toBe('e1'); // <a class="close">×</a> is common, and × is nobody's brand
  });
  it('the global deny-list itself is not weakened', () => {
    expect(denied("No thanks, I'd rather pay full price", 'find me shoes')).toBe(true); // only the blocker path and inBlocker lift it
    expect(denied('Checkout', 'go to checkout')).toBe(true);
  });
});

describe('choosing among the blocker\'s own controls', () => {
  const budget = newBudget();
  it('offers buttons and links only, without the accepting ones', () => {
    const rows = [row('e1', 'Accept all'), row('e2', 'Reject all'), row('e3', 'Manage preferences', 'link'), row('e4', 'Email address', 'textbox')];
    const { offered, removed } = dismissCandidates(rows, 'cookie banner', budget);
    expect(offered.map((r) => r.name)).toEqual(['Reject all', 'Manage preferences']);
    expect(removed).toEqual(['Accept all']);
  });

  it('takes an exact, plain refusal in code, and prefers a refusal to a close', () => {
    expect(codeFirst([row('e1', 'Manage preferences'), row('e2', 'Necessary only')])?.name).toBe('Necessary only');
    expect(codeFirst([row('e1', 'Close'), row('e2', 'Reject all')])?.name).toBe('Reject all');
    expect(codeFirst([row('e1', '×')])?.name).toBe('×');
  });

  it('leaves anything less plain to Jev', () => {
    expect(codeFirst([row('e1', "No thanks, I'd rather pay full price")])).toBeUndefined();
    expect(codeFirst([row('e1', 'Manage preferences'), row('e2', 'Learn more', 'link')])).toBeUndefined();
  });

  it('acts on Jev only when refuses × (1 − accepts) reaches DISMISS_MIN, and only on an offered id', () => {
    const offered = [row('e1', 'Manage preferences'), row('e2', "No thanks, I'd rather pay full price")];
    expect(pickDismiss({ e1: { refuses: 0.35, accepts: 0.75 }, e2: { refuses: 0.88, accepts: 0.08 } }, offered)?.id).toBe('e2');
    expect(pickDismiss({ e1: { refuses: 0.35, accepts: 0.75 }, e2: { refuses: 0.78, accepts: 0.52 } }, offered)).toBeUndefined(); // 0.37
    expect(pickDismiss({ e9: { refuses: 0.99, accepts: 0 } }, offered)).toBeUndefined();
    expect(DISMISS_MIN).toBe(0.6);
  });

  it('spends the budget on every attempt and never offers the same control twice', () => {
    const b = newBudget();
    expect(b.left).toBe(MAX_DISMISSALS);
    spend(b, 'pop-up', 'No thanks');
    expect(b.left).toBe(MAX_DISMISSALS - 1);
    expect(dismissCandidates([row('e1', 'No thanks'), row('e2', 'Maybe later')], 'pop-up', b).offered.map((r) => r.name)).toEqual(['Maybe later']);
  });

  it('names what it closed in plain words', () => {
    expect(dismissTrail(blockerKind('We use cookies to personalise ads', false))).toBe('Closed the cookie banner');
    expect(dismissTrail(blockerKind('Get 10% off your first order', true))).toBe('Dismissed a pop-up');
    expect(dismissTrail(blockerKind('Free shipping this week', false))).toBe('Closed a banner');
  });
});

describe('the deny-list must not block a decline, however guilt-trippy its wording', () => {
  const head = (choice: string): Head => ({ choice, confidence: 0.95, probabilities: { [choice]: 0.95 } });
  const heads = { kind: head('ACTION'), operation: head('CLICK'), click_target: head('e2') };
  const ctx = { leash: 'single' as const, utterance: 'no thanks', useKind: true, groups: {}, names: { e1: 'Subscribe and save', e2: "No thanks, I'd rather pay full price" } };

  it('inside a pop-up, a decline is simply pressed', () => {
    expect(resolve(heads, { ...ctx, inBlocker: ['e2'] })).toMatchObject({ type: 'Act', op: 'CLICK', target: 'e2' });
  });
  it('outside a pop-up the same words still ask for a second yes', () => {
    expect(resolve(heads, ctx)).toMatchObject({ type: 'Confirm' });
  });
  it('an accepting control inside a pop-up is still confirmed first', () => {
    expect(resolve({ ...heads, click_target: head('e1') }, { ...ctx, inBlocker: ['e1'] })).toMatchObject({ type: 'Confirm' });
  });
  it('on the task leash too: a decline inside a pop-up is not handed back', () => {
    const task = { leash: 'task' as const, goal: 'find me white sneakers', useKind: false, groups: {}, names: ctx.names };
    expect(resolve({ operation: head('CLICK'), click_target: head('e2') }, { ...task, inBlocker: ['e2'] })).toMatchObject({ type: 'Act' });
    expect(resolve({ operation: head('CLICK'), click_target: head('e2') }, task)).toMatchObject({ type: 'HandBack', outcome: 'yours' });
  });
});
