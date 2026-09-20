// @vitest-environment jsdom
// Found on nike.com: "click on the Air Jordan 12" ended in "I couldn't do that here." Jev had named the right product.
// A Nike card stacks three controls for one product: a link stretched over the whole card, a second link to the same
// product around the picture, and the product's name as a third "link" underneath. Whichever one is named, another
// is at its centre, and the executor called that "covered by something else".
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as exec from '../agent/execute';

let overlay: HTMLElement;
let clicked: string[];
const el = (id: string) => document.getElementById(id)!;
const onTop = (id: string) => { (document as unknown as { elementsFromPoint: () => Element[] }).elementsFromPoint = () => [el(id)]; };

beforeAll(() => {
  Element.prototype.getBoundingClientRect = () => ({ x: 10, y: 10, left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30, toJSON() {} }) as DOMRect;
  Element.prototype.scrollIntoView = () => {};
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  // Once: the body outlives every test. Which element received the click, and no navigation in jsdom.
  document.body.addEventListener('click', (e) => { e.preventDefault(); clicked.push((e.target as Element).id); });
});

beforeEach(() => {
  document.body.innerHTML = `
    <div class="product-card"><figure>
      <a id="stretched" href="/t/air-jordan-12">Air Jordan 12 Retro</a>
      <a id="picture" href="/t/air-jordan-12" aria-label="Air Jordan 12 Retro"><img id="img" alt=""></a>
      <div><div id="title" role="link">Air Jordan 12 Retro</div><div id="subtitle" role="link">Men's Shoes</div><div id="price" role="link">$215</div></div>
    </figure></div>
    <a id="kobe" href="/t/kobe-3">Kobe III Low Protro</a>
    <div id="popup" style="position: fixed"><p id="pitch">Join us and save</p><button id="join">Join us</button></div>
    <div id="tandem"></div>`;
  overlay = el('tandem');
  clicked = [];
});

describe('controls stacked on top of each other for one thing', () => {
  it('a link under another link to the same place is not covered: the one on top is pressed, as a person would', () => {
    onTop('img'); // the picture, inside the second link to the same product
    expect(exec.click(el('stretched'), overlay)).toEqual({ ok: true });
    expect(clicked).toEqual(['picture']);
  });

  it("the product's name under the stretched link with the same name: the stretched link is pressed", () => {
    onTop('stretched');
    expect(exec.click(el('title'), overlay)).toEqual({ ok: true });
    expect(clicked).toEqual(['stretched']);
  });

  it('on top of itself, nothing changes: the element is pressed', () => {
    onTop('img');
    expect(exec.click(el('picture'), overlay)).toEqual({ ok: true });
    expect(clicked).toEqual(['picture']);
  });
});

describe('covered by something else is still covered', () => {
  it('a different link on top: refused, and what covers it is reported', () => {
    onTop('kobe');
    const out = exec.click(el('stretched'), overlay);
    expect(out).toMatchObject({ ok: false, coveredBy: el('kobe') });
    expect(clicked).toEqual([]);
  });

  it("a pop-up's button or its text on top: refused, so the loop can close the pop-up first", () => {
    for (const top of ['join', 'pitch']) {
      onTop(top);
      expect(exec.click(el('kobe'), overlay)).toMatchObject({ ok: false, coveredBy: el(top) });
    }
    expect(clicked).toEqual([]);
  });

  it('a control with a different name and no destination of its own stays refused (the price under the stretched link)', () => {
    onTop('stretched');
    expect(exec.click(el('price'), overlay)).toMatchObject({ ok: false, coveredBy: el('stretched') });
    expect(clicked).toEqual([]);
  });

  it('a same-named button on top that would submit a form is not pressed in place of one that would not', () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="fake" role="button">Subscribe</div><form action="/newsletter"><input name="email"><button id="real">Subscribe</button></form>');
    onTop('real');
    expect(exec.click(el('fake'), overlay)).toMatchObject({ ok: false, coveredBy: el('real') }); // the submit rule was checked on the target only
    expect(clicked).toEqual([]);
  });

  // The review of this fix. Every rule upstream judged the TARGET, so a twin must not be able to mean anything else.
  it('placeholder destinations are not destinations: every href="#" on a page resolves to the same address', () => {
    document.body.insertAdjacentHTML('beforeend', `<a id="more" href="#">Show more</a><a id="accept" href="#">Accept all cookies</a>
      <a id="guide" href="javascript:void(0)">Size guide</a><a id="buy" href="javascript:void(0)">Buy now</a><a id="details" href="">Details</a><a id="delete" href="">Delete account</a>`);
    for (const [target, top] of [['more', 'accept'], ['guide', 'buy'], ['details', 'delete']] as const) {
      onTop(top);
      expect(exec.click(el(target), overlay)).toMatchObject({ ok: false, coveredBy: el(top) });
    }
    expect(clicked).toEqual([]);
  });

  it("a same-named control inside a pop-up or a sticky bar is the pop-up's, not a twin: the loop gets its coveredBy", () => {
    document.body.insertAdjacentHTML('beforeend', `<a id="signup" href="/account/register">Sign up</a>
      <div role="dialog"><input><button id="popup-signup" type="button">Sign Up</button></div>
      <a id="cart" href="/cart">Cart</a><header style="position: sticky"><a id="bar-cart" href="/cart">Cart</a></header>`);
    onTop('popup-signup');
    expect(exec.click(el('signup'), overlay)).toMatchObject({ ok: false, coveredBy: el('popup-signup') });
    onTop('bar-cart');
    expect(exec.click(el('cart'), overlay)).toMatchObject({ ok: false, coveredBy: el('bar-cart') });
    expect(clicked).toEqual([]);
  });

  it('two real links with the same name and different destinations are different controls (a carousel of "Shop now")', () => {
    document.body.insertAdjacentHTML('beforeend', '<a id="hidden-slide" href="/sale/boots">Shop now</a><a id="shown-slide" href="/sale/coats">Shop now</a>');
    onTop('shown-slide');
    expect(exec.click(el('hidden-slide'), overlay)).toMatchObject({ ok: false, coveredBy: el('shown-slide') });
    expect(clicked).toEqual([]);
  });

  it('a disabled twin is not pressed, and nothing is reported as done', () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="apply" role="button">Apply</div><button id="apply-off" disabled>Apply</button><button id="apply-aria" aria-disabled="true">Apply</button>');
    for (const top of ['apply-off', 'apply-aria']) {
      onTop(top);
      expect(exec.click(el('apply'), overlay).ok).toBe(false);
    }
  });

  it('the same-named submit button of another form is not a twin', () => {
    document.body.insertAdjacentHTML('beforeend', '<form action="/a"><input name="x"><input name="y"><button id="save-a">Save</button></form><form action="/b"><input name="x"><input name="y"><button id="save-b">Save</button></form>');
    onTop('save-b');
    expect(exec.click(el('save-a'), overlay)).toMatchObject({ ok: false, coveredBy: el('save-b') });
  });

  it('only a click goes through a twin: a field under a same-named link is covered', () => {
    document.body.insertAdjacentHTML('beforeend', '<input id="field" aria-label="Search"><a id="search-link" href="/search">Search</a>');
    onTop('search-link');
    expect(exec.type(el('field'), 'boots', overlay)).toMatchObject({ ok: false, coveredBy: el('search-link') });
    expect((el('field') as HTMLInputElement).value).toBe('');
  });

  it('with a twin on top the target is still brought to the middle first, in case the twin was only a sticky bar passing over', () => {
    let scrolled = 0;
    Element.prototype.scrollIntoView = () => { scrolled += 1; };
    onTop('img');
    exec.click(el('stretched'), overlay);
    expect(scrolled).toBe(1);
    Element.prototype.scrollIntoView = () => {};
  });

  it('two nameless controls are not the same control', () => {
    document.body.insertAdjacentHTML('beforeend', '<button id="a"></button><button id="b"></button>');
    onTop('b');
    expect(exec.click(el('a'), overlay).ok).toBe(false);
  });
});
