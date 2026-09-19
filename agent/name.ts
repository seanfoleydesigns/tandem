// Accessible name and role of an element. Pure DOM reads with no layout, so it runs under jsdom.
// Works inside open shadow roots: ids resolve in the element's own tree, ancestors are followed through the host.
import { byId, composedParent, hostOf } from './dom';

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

const FORM_CONTROLS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);

// Text a user would read: text nodes and image alt text, skipping hidden parts and nested form controls.
function textOf(node: Node, skip?: Element): string {
  let out = '';
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) out += child.textContent ?? '';
    else if (child.nodeType === 1) {
      const el = child as Element;
      if (el === skip || el.getAttribute('aria-hidden') === 'true' || FORM_CONTROLS.has(el.tagName)) return;
      if (el.tagName === 'IMG') out += ` ${el.getAttribute('alt') ?? ''} `;
      // A component's <slot> shows the text its user put between the tags: <fancy-button>Reject all</fancy-button>.
      else if (el.tagName === 'SLOT' && (el as HTMLSlotElement).assignedNodes?.({ flatten: true }).length) {
        for (const n of (el as HTMLSlotElement).assignedNodes({ flatten: true })) out += n.nodeType === 3 ? n.textContent ?? '' : ` ${textOf(n, skip)} `;
      }
      else out += ` ${textOf(el.shadowRoot ?? el, skip)} `; // a component shows what its shadow root renders
    }
  });
  return out;
}

// Order: aria-label, aria-labelledby, <label>, alt/title, placeholder, then text. 80 characters at most.
export function accessibleName(el: Element): string {
  let name = clean(el.getAttribute('aria-label'));

  if (!name) {
    const ids = clean(el.getAttribute('aria-labelledby'));
    if (ids) {
      name = clean(ids.split(' ').map((id) => textOf(byId(el, id) ?? el.ownerDocument.createTextNode(''))).join(' '));
    }
  }
  if (!name) {
    const labels = (el as HTMLInputElement).labels;
    if (labels?.length) name = clean(Array.from(labels).map((l) => textOf(l, el)).join(' '));
  }
  if (!name) name = clean(el.getAttribute('alt')) || clean(el.getAttribute('title'));
  if (!name) name = clean(el.getAttribute('placeholder'));
  if (!name) {
    const input = el as HTMLInputElement;
    const isButtonInput = el.tagName === 'INPUT' && ['submit', 'button', 'reset'].includes(input.type);
    name = isButtonInput ? clean(input.value) : clean(textOf(el));
  }
  return name.slice(0, 80);
}

const INPUT_ROLES: Record<string, string> = {
  checkbox: 'checkbox', radio: 'radio', search: 'searchbox', submit: 'button', button: 'button',
  reset: 'button', image: 'button', range: 'slider', number: 'spinbutton',
};

export function roleOf(el: Element): string {
  const explicit = clean(el.getAttribute('role'));
  if (explicit) return explicit.split(' ')[0]!;
  switch (el.tagName) {
    case 'A': return 'link';
    case 'BUTTON': return 'button';
    case 'SELECT': return 'combobox';
    case 'TEXTAREA': return 'textbox';
    case 'INPUT': return INPUT_ROLES[(el as HTMLInputElement).type] ?? 'textbox';
    default: return el.tagName.toLowerCase();
  }
}

const GROUP_TAGS = new Set(['SECTION', 'NAV', 'ASIDE', 'FORM', 'UL', 'OL']);
const GROUP_ROLES = new Set(['group', 'radiogroup', 'region', 'navigation', 'search', 'form', 'list', 'listbox', 'toolbar', 'tablist', 'menu']);

function labelOf(el: Element): string {
  const direct = clean(el.getAttribute('aria-label'));
  if (direct) return direct;
  const ids = clean(el.getAttribute('aria-labelledby'));
  return ids ? clean(ids.split(' ').map((id) => byId(el, id)?.textContent ?? '').join(' ')) : '';
}

function lastHeadingBefore(scope: ParentNode, anchor: Element): Element | undefined {
  let last: Element | undefined;
  scope.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => {
    if (h.compareDocumentPosition(anchor) & 4 /* anchor follows h */ && !h.contains(anchor)) last = h;
  });
  return last;
}

// Group label: fieldset legend, then a labelled ARIA group or section, then the nearest heading before the element.
export function groupOf(el: Element): string | undefined {
  for (let a = composedParent(el); a && a.tagName !== 'BODY'; a = composedParent(a)) {
    if (a.tagName === 'FIELDSET') {
      const legend = Array.from(a.children).find((c) => c.tagName === 'LEGEND'); // a direct child; no :scope, which jsdom gets wrong inside shadow roots
      if (legend) return clean(textOf(legend)).slice(0, 60) || undefined;
    }
    if (GROUP_TAGS.has(a.tagName) || GROUP_ROLES.has(a.getAttribute('role') ?? '')) {
      const label = labelOf(a);
      if (label) return label.slice(0, 60);
    }
  }
  // One tree at a time, because document order means nothing across a shadow boundary: look inside the element's
  // own tree, then step out to the host and look again with the host standing in for the element.
  for (let n: Element | null = el; n; n = hostOf(n)) {
    for (let a = n.parentElement; a && a.tagName !== 'BODY'; a = a.parentElement) {
      const h = lastHeadingBefore(a, n);
      if (h) return clean(h.textContent).slice(0, 60) || undefined;
    }
    const root = n.getRootNode();
    const h = root instanceof ShadowRoot ? lastHeadingBefore(root, n) : undefined;
    if (h) return clean(h.textContent).slice(0, 60) || undefined;
  }
  return undefined;
}
