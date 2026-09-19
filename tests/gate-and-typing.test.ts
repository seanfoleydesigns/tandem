// M5 step 3: the DONE gate, typing on the task leash (search only), and the two safety rules in code.
import { describe, expect, it } from 'vitest';
import { candidates } from '../shared/candidates';
import { MAX_GATED_DONE, MET_MIN } from '../shared/config';
import { asksFor, resolve, type PolicyContext } from '../shared/policy';
import { metQuestion, operationQuestionTask, typedSpanQuestionTask } from '../shared/questions';
import { alreadySearched, isSearchRow, searchField, taskTyping } from '../shared/search';
import type { ActionRecord, ElementRow, Head, Snapshot } from '../shared/types';

const head = (choice: string, confidence = 0.95): Head => ({ choice, confidence, probabilities: { [choice]: confidence } });
const task: PolicyContext = { leash: 'task', goal: 'find me white sneakers', useKind: false, groups: {} };
const row = (id: string, role: string, name: string, extra: Partial<ElementRow> = {}): ElementRow => ({ id, role, name, ...extra });
const snap = (rows: ElementRow[]): Snapshot => ({ url: '/', title: '', headings: [], notices: [], rows });

describe('the DONE gate: a Noul per attribute, because a Choice collapses onto DONE', () => {
  const done = { operation: head('DONE', 0.89) };
  it('refuses DONE while the page does not show an attribute, and says which', () => {
    const r = resolve(done, { ...task, met: { 'category: Sneakers': 0.2, 'colour: White': 0.9 } });
    expect(r).toMatchObject({ type: 'Continue', unmet: ['category: Sneakers'] });
  });
  it('accepts DONE when every attribute reaches MET_MIN', () => {
    expect(resolve(done, { ...task, met: { 'category: Sneakers': MET_MIN, 'colour: White': 0.93 } })).toMatchObject({ type: 'HandBack', outcome: 'done' });
  });
  it('with no attributes (no LLM, or nothing stated) it is the old behaviour', () => {
    expect(resolve(done, task)).toMatchObject({ type: 'HandBack', outcome: 'done' });
    expect(resolve(done, { ...task, met: {} })).toMatchObject({ type: 'HandBack', outcome: 'done' });
  });
  it('gives way after MAX_GATED_DONE refusals, so a wrong Noul cannot trap a task; verify then says what is off', () => {
    const r = resolve(done, { ...task, met: { 'category: Sneakers': 0.2 }, gated: MAX_GATED_DONE });
    expect(r).toMatchObject({ type: 'HandBack', outcome: 'done' });
    expect(r.reason).toContain('category: Sneakers');
  });
  it('asking still comes first', () => {
    expect(resolve(done, { ...task, needs: { size: 0.9 }, met: { 'category: Sneakers': 0.2 } })).toMatchObject({ type: 'Ask', group: 'size' });
  });
  it('the unmet sentence is in the question only when something is unmet', () => {
    expect(operationQuestionTask().instructions).not.toContain('unmet');
    expect(operationQuestionTask({ unmet: true }).instructions).toContain('`unmet`');
    expect(metQuestion('category', 'Sneakers').instructions).toContain('Sneakers is already applied for category');
  });
});

describe('typing on the task leash: only to search, only with words that are not Jev\'s', () => {
  const page = snap([row('e1', 'searchbox', 'Search Wikipedia'), row('e2', 'textbox', 'Email address'), row('e3', 'textbox', 'Password', { sensitive: true }), row('e4', 'link', 'Main page')]);
  const typed = (value: string): ActionRecord => ({ op: 'TYPE', value, outcome: 'changed', ts: 0 });

  it('a search-like field is a searchbox, or a text field whose name says search; never a sensitive one', () => {
    expect(isSearchRow(row('e1', 'searchbox', 'Find'))).toBe(true);
    expect(isSearchRow(row('e1', 'textbox', 'Search the docs'))).toBe(true);
    expect(isSearchRow(row('e1', 'textbox', 'Email address'))).toBe(false);
    expect(isSearchRow(row('e1', 'textbox', 'Search by card number', { sensitive: true }))).toBe(false);
    expect(searchField(page)?.id).toBe('e1');
  });

  it('TYPE is offered with a parsed query, once; with no query and a good parse, never; with no parse, from the goal\'s words, once', () => {
    expect(taskTyping({ snapshot: page, history: [], query: 'Alan Turing', parsed: true })).toBe('query');
    expect(taskTyping({ snapshot: page, history: [typed('alan turing')], query: 'Alan Turing', parsed: true })).toBeUndefined();
    expect(taskTyping({ snapshot: page, history: [], parsed: true })).toBeUndefined(); // the store's hero: questions unchanged
    expect(taskTyping({ snapshot: page, history: [], parsed: false })).toBe('span');
    expect(taskTyping({ snapshot: page, history: [typed('anything')], parsed: false })).toBeUndefined();
    expect(taskTyping({ snapshot: snap([row('e2', 'textbox', 'Email address')]), history: [], query: 'x', parsed: true })).toBeUndefined(); // no search field, no typing
    expect(alreadySearched([typed('Alan  Turing')], 'alan turing')).toBe(true);
  });

  it('the TYPE criterion exists only when typing is on offer', () => {
    expect(Object.keys(operationQuestionTask().criteria)).not.toContain('TYPE');
    expect(Object.keys(operationQuestionTask({ typing: 'query' }).criteria)).toEqual(['CLICK', 'TYPE', 'SELECT', 'SCROLL_DOWN', 'SCROLL_UP', 'GO_BACK', 'DONE', 'STUCK']);
    expect(operationQuestionTask({ typing: 'query' }).criteria.TYPE).toContain('constraints.search_query');
    expect(Object.keys(typedSpanQuestionTask(['alan turing', 'alan']).criteria)).toEqual(['alan turing', 'alan', '(none)']);
  });

  it('policy: the field is code\'s choice and the words are the LLM\'s query, never a Jev head', () => {
    const r = resolve({ operation: head('TYPE') }, { ...task, search: { target: 'e1', text: 'Alan Turing' }, names: { e1: 'Search Wikipedia' } });
    expect(r).toMatchObject({ type: 'Act', op: 'TYPE', target: 'e1', text: 'Alan Turing' });
  });
  it('policy: on the fallback the words are a span of the goal, and an unclear span types nothing', () => {
    const ctx = { ...task, search: { target: 'e1' }, names: { e1: 'Search Wikipedia' } };
    expect(resolve({ operation: head('TYPE'), typed_span: head('alan turing') }, ctx)).toMatchObject({ type: 'Act', text: 'alan turing' });
    expect(resolve({ operation: head('TYPE'), typed_span: head('alan turing', 0.4) }, ctx).type).not.toBe('Act');
    expect(resolve({ operation: head('TYPE'), typed_span: head('(none)') }, ctx).type).not.toBe('Act');
  });
  it('policy: TYPE with nothing on offer does nothing', () => {
    expect(resolve({ operation: head('TYPE') }, task).type).not.toBe('Act');
  });
});

describe('safety in code', () => {
  it('a password or payment field is never a target', () => {
    const c = candidates(snap([row('e1', 'textbox', 'Card number', { sensitive: true }), row('e2', 'textbox', 'Password', { sensitive: true }), row('e3', 'searchbox', 'Search')]));
    expect(c.type.map((r) => r.id)).toEqual(['e3']);
    expect(c.click).toEqual([]);
  });
  it('a form is submitted on the task leash only when the goal literally names the control', () => {
    expect(asksFor('open a product, pick a size and then add to cart', 'Add to cart')).toBe(true);
    expect(asksFor('find me white sneakers', 'Add to cart')).toBe(false);
    expect(asksFor('find me white sneakers', 'Subscribe')).toBe(false);
    expect(asksFor('sign in for me', 'Sign in')).toBe(true);
    expect(asksFor('find a sign', 'Sign in')).toBe(false); // whole words, in order
    expect(asksFor('ok go', 'OK')).toBe(false); // too short to count as asking
  });
});
