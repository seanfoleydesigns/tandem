// @vitest-environment jsdom
// Safety rules that read the DOM (M5 step 3 review): what counts as a secret, what counts as a search form,
// and that a secret's value never leaves the page.
import { beforeAll, describe, expect, it } from 'vitest';
import * as exec from '../agent/execute';
import { takeSnapshot } from '../agent/snapshot';
import { asksFor } from '../shared/policy';

beforeAll(() => {
  Element.prototype.getBoundingClientRect = () => ({ x: 10, y: 10, left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30, toJSON() {} }) as DOMRect;
  Element.prototype.scrollIntoView = () => {};
});
const page = (html: string) => {
  document.body.innerHTML = `${html}<div id="tandem"></div>`;
  (document as unknown as { elementsFromPoint: () => Element[] }).elementsFromPoint = () => []; // jsdom has no layout
  return document.getElementById('tandem')!;
};
const hit = (el: Element) => { (document as unknown as { elementsFromPoint: () => Element[] }).elementsFromPoint = () => [el]; };

describe('secrets', () => {
  it('recognises password and payment fields the way real checkouts mark them', () => {
    page(`<input id="a" type="password"><input id="b" autocomplete="section-payment cc-number"><input id="c" autocomplete="billing cc-csc">
      <input id="d" type="tel" name="cardnumber" placeholder="Card number" autocomplete="off"><label for="e">CVV</label><input id="e">
      <input id="f" type="text" name="password"><input id="g" placeholder="Expiry date"><input id="h" type="search" placeholder="Search"><input id="i" name="email">`);
    const sensitive = (id: string) => exec.isSensitive(document.getElementById(id)!);
    expect(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(sensitive)).toEqual(Array(7).fill(true));
    expect(['h', 'i'].map(sensitive)).toEqual([false, false]);
  });

  it('never sends what was typed into one: the row says "filled", and it is not a target', () => {
    const overlay = page('<form><label>Email <input name="email" value="sean@example.com"></label><label>Password <input type="password" value="hunter2secret"></label><label>Card number <input name="cc" value="4242424242424242"></label></form>');
    const rows = takeSnapshot({ overlay }).snapshot.rows;
    const text = JSON.stringify(rows);
    expect(text).not.toContain('hunter2secret');
    expect(text).not.toContain('4242');
    expect(rows.find((r) => r.name === 'Password')).toMatchObject({ state: 'filled', sensitive: true });
    expect(rows.find((r) => r.name === 'Email')?.state).toBe('value: sean@example.com'); // ordinary fields still show their value
  });

  it('refuses to type into one, whoever asks', () => {
    const overlay = page('<input id="p" type="password">');
    const el = document.getElementById('p') as HTMLInputElement;
    hit(el);
    expect(exec.type(el, 'hello', overlay)).toMatchObject({ ok: false });
    expect(el.value).toBe('');
  });
});

describe('a search form, strictly', () => {
  it('a form that says it is one, or whose only field is a search field', () => {
    page(`<form role="search"><input id="q1" type="search"><button id="b1">Search</button></form>
      <form><input id="q2" placeholder="Search the docs"><button id="b2">Go</button></form>`);
    expect(exec.submitsForm(document.getElementById('b1')!)).toBe(false);
    expect(exec.submitsForm(document.getElementById('b2')!)).toBe(false);
  });
  it('not a registration form with a tag picker in it, nor a checkout with an address search', () => {
    page(`<form><input name="name"><input type="search" role="searchbox" aria-label="Pick tags"><button id="register">Register</button></form>
      <form action="/orders" method="post"><input id="addr" placeholder="Search for your address"><input name="cardname"><button id="continue">Continue</button></form>`);
    expect(exec.submitsForm(document.getElementById('register')!)).toBe(true);
    expect(exec.submitsForm(document.getElementById('continue')!)).toBe(true);
  });
  it('typing into a search-like field of an ordinary form leaves the words there and submits nothing', () => {
    const overlay = page('<form id="f" action="/orders" method="post"><input id="addr" placeholder="Search for your address"><input name="cardname"><button>Continue</button></form>');
    let submitted = 0;
    document.getElementById('f')!.addEventListener('submit', (e) => { submitted += 1; e.preventDefault(); });
    const el = document.getElementById('addr') as HTMLInputElement;
    hit(el);
    expect(exec.type(el, 'white sneakers', overlay)).toEqual({ ok: true });
    expect(el.value).toBe('white sneakers');
    expect(submitted).toBe(0);
  });
  it('a real search form is still submitted', () => {
    const overlay = page('<form id="s" role="search"><input id="q" type="search"><button>Search</button></form>');
    let submitted = 0;
    document.getElementById('s')!.addEventListener('submit', (e) => { submitted += 1; e.preventDefault(); });
    const el = document.getElementById('q') as HTMLInputElement;
    hit(el);
    exec.type(el, 'alan turing', overlay);
    expect(submitted).toBe(1);
  });
});

describe('asksFor: the goal has to ask to press it, not merely contain its words', () => {
  it.each([
    ['find me a sign in sheet', 'Sign in'], ['find the post about rust', 'Post'], ['find out how to delete my account', 'Delete my account'],
    ['show me how to apply for a visa', 'Apply'], ['find the log in page', 'Log in'], ['find articles about how to send money abroad', 'Send'], ['where do i register to vote', 'Register'],
  ])('%j does not unlock %j', (goal, name) => expect(asksFor(goal, name)).toBe(false));
  it.each([
    ['open a product, pick a size and then add to cart', 'Add to cart'], ['sign in for me', 'Sign in'], ['fill in the form and press submit', 'Submit'], ['click the register button', 'Register'],
  ])('%j does unlock %j', (goal, name) => expect(asksFor(goal, name)).toBe(true));
});
