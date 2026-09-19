// @vitest-environment jsdom
// Web components: the snapshot walks OPEN shadow roots and clicks resolve inside them. Closed roots stay invisible.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { composedClosest, composedContains, deepQueryAll } from '../agent/dom';
import * as exec from '../agent/execute';
import { takeSnapshot } from '../agent/snapshot';

// A small custom element, the way component libraries build a filter: its controls live in a shadow root,
// the label of one control comes through a <slot>, and a label is tied to its input by an id inside the root.
class ShopFilter extends HTMLElement {
  clicks: string[] = [];
  connectedCallback() {
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <fieldset><legend>Colour</legend>
        <label><input type="checkbox" name="colour" value="white"> White</label>
        <input type="checkbox" id="black" name="colour" value="black"><label for="black">Black</label>
      </fieldset>
      <span id="apply-label">Apply filters</span>
      <button id="apply" aria-labelledby="apply-label"></button>
      <button id="slotted"><slot></slot></button>
      <nested-note></nested-note>`;
    root.querySelector('#apply')!.addEventListener('click', () => this.clicks.push('apply'));
  }
}
class NestedNote extends HTMLElement {
  connectedCallback() { this.attachShadow({ mode: 'open' }).innerHTML = '<a href="/help">Help with filters</a>'; }
}
class ClosedBox extends HTMLElement {
  connectedCallback() { this.attachShadow({ mode: 'closed' }).innerHTML = '<button>Secret button</button>'; }
}

let overlay: HTMLElement;

beforeAll(() => {
  customElements.define('shop-filter', ShopFilter);
  customElements.define('nested-note', NestedNote);
  customElements.define('closed-box', ClosedBox);
  // jsdom has no layout: give every element a box, so the snapshot does not drop it as invisible.
  Element.prototype.getBoundingClientRect = () => ({ x: 10, y: 10, left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30, toJSON() {} }) as DOMRect;
  Element.prototype.scrollIntoView = () => {};
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
});

beforeEach(() => {
  document.body.innerHTML = '<main><h1>Shoes</h1><button>Load more</button><shop-filter>Reject all</shop-filter><closed-box></closed-box></main><div id="tandem"></div>';
  overlay = document.getElementById('tandem')!;
  overlay.attachShadow({ mode: 'open' }).innerHTML = '<button>Stop</button>'; // the agent's own overlay must never be read
  (document as unknown as { elementsFromPoint: () => Element[] }).elementsFromPoint = () => [];
});

const snap = () => takeSnapshot({ overlay });
const names = () => snap().snapshot.rows.map((r) => `${r.role} ${r.name}`);

describe('snapshot through open shadow roots', () => {
  it('collects the controls inside a custom element, and inside one nested in it', () => {
    expect(names()).toEqual(expect.arrayContaining(['button Load more', 'checkbox White', 'checkbox Black', 'button Apply filters', 'link Help with filters']));
  });

  it('names a control from its <slot>, as the user reads it', () => expect(names()).toContain('button Reject all'));

  it('takes the group from a legend inside the shadow root', () => {
    const white = snap().snapshot.rows.find((r) => r.name === 'White');
    expect(white).toMatchObject({ role: 'checkbox', group: 'Colour', state: 'unchecked' });
  });

  it('never sees inside a closed root, and never reads its own overlay', () => {
    expect(names()).not.toContain('button Secret button');
    expect(names()).not.toContain('button Stop');
  });

  it('a page without shadow roots takes the plain path and gives the same rows in the same order', () => {
    document.body.innerHTML = '<main><a href="/a">A</a><button>B</button><input type="checkbox" aria-label="C"></main><div id="tandem"></div>';
    overlay = document.getElementById('tandem')!;
    expect(deepQueryAll(document, 'a,button,input', overlay)).toEqual(Array.from(document.querySelectorAll('a,button,input')));
  });
});

describe('acting inside an open shadow root', () => {
  it('the id maps to the real node, and a click lands on it', () => {
    const s = snap();
    const host = document.querySelector('shop-filter') as ShopFilter;
    const row = s.snapshot.rows.find((r) => r.name === 'Apply filters')!;
    const el = s.nodes.get(row.id)!;
    expect(el.getRootNode()).toBe(host.shadowRoot);
    // A browser's document.elementsFromPoint stops at the host; the executor must look inside it.
    (document as unknown as { elementsFromPoint: () => Element[] }).elementsFromPoint = () => [host];
    (host.shadowRoot as unknown as { elementsFromPoint: () => Element[] }).elementsFromPoint = () => [el];
    expect(exec.click(el, overlay)).toEqual({ ok: true });
    expect(host.clicks).toEqual(['apply']);
  });

  it('still refuses a target that something else covers', () => {
    const s = snap();
    const el = s.nodes.get(s.snapshot.rows.find((r) => r.name === 'Apply filters')!.id)!;
    const banner = document.createElement('div');
    document.body.append(banner);
    (document as unknown as { elementsFromPoint: () => Element[] }).elementsFromPoint = () => [banner];
    expect(exec.click(el, overlay)).toMatchObject({ ok: false, reason: expect.stringContaining('covered') });
  });

  it('ancestors are followed through the host', () => {
    const host = document.querySelector('shop-filter')!;
    const white = host.shadowRoot!.querySelector('input')!;
    expect(composedClosest(white, 'main')).toBe(document.querySelector('main'));
    expect(composedContains(document.querySelector('main')!, white)).toBe(true);
    expect(composedContains(overlay, white)).toBe(false);
  });
});

// Result cards built as components: <li><shop-card>#shadow <a>…</a></shop-card></li>.
class ShopCard extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    this.attachShadow({ mode: 'open' }).innerHTML = `<span id="t">Open</span><a href="/p" aria-labelledby="t n"><span id="n">${this.getAttribute('name')}</span></a>`;
  }
}

describe('lists of component cards', () => {
  beforeAll(() => customElements.define('shop-card', ShopCard));
  beforeEach(() => {
    document.body.innerHTML = `<main><h2>Results</h2><span id="t">WRONG</span><ul>
      <li><shop-card name="Court Classic"></shop-card></li><li><shop-card name="Arco Low"></shop-card></li><li><shop-card name="Trail Pro"></shop-card></li>
      </ul><a href="/next">Next page</a></main><div id="tandem"></div>`;
    overlay = document.getElementById('tandem')!;
  });

  it('gives ordinals to cards whose links live in shadow roots, in reading order, grouped by the heading outside', () => {
    const rows = takeSnapshot({ overlay }).snapshot.rows;
    expect(rows.map((r) => r.name)).toEqual(['Open Court Classic', 'Open Arco Low', 'Open Trail Pro', 'Next page']);
    expect(rows.slice(0, 3).map((r) => [r.group, r.ordinal?.split(' ')[0]])).toEqual([['Results', 'first'], ['Results', 'second'], ['Results', 'third']]);
  });

  it('resolves aria-labelledby inside the element\'s own root, not in the document', () => {
    expect(takeSnapshot({ overlay }).snapshot.rows[0]!.name).toBe('Open Court Classic'); // the light-DOM #t says WRONG
  });

  it('marks the focused row when focus is inside a shadow root', async () => {
    const { deepActiveElement } = await import('../agent/dom');
    const link = document.querySelector('shop-card')!.shadowRoot!.querySelector('a')!;
    link.focus();
    expect(document.activeElement).toBe(document.querySelector('shop-card')); // the document only sees the host
    expect(deepActiveElement()).toBe(link);
    const s = takeSnapshot({ overlay, focused: deepActiveElement() });
    expect(s.snapshot.focused).toBe(s.snapshot.rows[0]!.id);
  });
});

// A cookie banner built as a component, and a dialog whose content is slotted in from outside (M5 review).
class CookieBar extends HTMLElement {
  connectedCallback() { if (!this.shadowRoot) this.attachShadow({ mode: 'open' }).innerHTML = '<p>We use cookies.</p><button>Reject all</button>'; }
}
class SlotDialog extends HTMLElement {
  connectedCallback() { if (!this.shadowRoot) this.attachShadow({ mode: 'open' }).innerHTML = '<div role="dialog" aria-modal="true"><button>Close</button><slot></slot></div>'; }
}

describe('a snapshot scoped to a component', () => {
  beforeAll(() => { customElements.define('cookie-bar', CookieBar); customElements.define('slot-dialog', SlotDialog); });

  it('reads the scope element\'s own shadow root', () => {
    document.body.innerHTML = '<main><button>Load more</button></main><cookie-bar></cookie-bar><div id="tandem"></div>';
    overlay = document.getElementById('tandem')!;
    const within = document.querySelector('cookie-bar')!;
    expect(takeSnapshot({ overlay, within, wide: true }).snapshot.rows.map((r) => r.name)).toEqual(['Reject all']);
  });

  it('follows a <slot> to the content put between the tags, once', () => {
    document.body.innerHTML = '<slot-dialog><button>No thanks</button></slot-dialog><div id="tandem"></div>';
    overlay = document.getElementById('tandem')!;
    const dialog = document.querySelector('slot-dialog')!.shadowRoot!.querySelector('[role=dialog]')!;
    expect(takeSnapshot({ overlay, within: dialog, wide: true }).snapshot.rows.map((r) => r.name)).toEqual(['Close', 'No thanks']);
    expect(takeSnapshot({ overlay, wide: true }).snapshot.rows.map((r) => r.name)).toEqual(['Close', 'No thanks']); // scoped to the open modal, no duplicates
  });
});
