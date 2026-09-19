// Accessible name and role of an element. Pure DOM reads with no layout, so it runs under jsdom.

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
      else out += ` ${textOf(el, skip)} `;
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
      name = clean(ids.split(' ').map((id) => textOf(el.ownerDocument.getElementById(id) ?? el.ownerDocument.createTextNode(''))).join(' '));
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
  return ids ? clean(ids.split(' ').map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '').join(' ')) : '';
}

// Group label: fieldset legend, then a labelled ARIA group or section, then the nearest heading before the element.
export function groupOf(el: Element): string | undefined {
  for (let a = el.parentElement; a && a.tagName !== 'BODY'; a = a.parentElement) {
    if (a.tagName === 'FIELDSET') {
      const legend = a.querySelector(':scope > legend');
      if (legend) return clean(textOf(legend)).slice(0, 60) || undefined;
    }
    if (GROUP_TAGS.has(a.tagName) || GROUP_ROLES.has(a.getAttribute('role') ?? '')) {
      const label = labelOf(a);
      if (label) return label.slice(0, 60);
    }
  }
  for (let a = el.parentElement; a && a.tagName !== 'BODY'; a = a.parentElement) {
    const headings = a.querySelectorAll('h1,h2,h3,h4,h5,h6');
    let last: Element | undefined;
    headings.forEach((h) => {
      if (h.compareDocumentPosition(el) & 4 /* el follows h */ && !h.contains(el)) last = h;
    });
    if (last) return clean(last.textContent).slice(0, 60) || undefined;
  }
  return undefined;
}
