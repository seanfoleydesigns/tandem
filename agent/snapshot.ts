// Observe: the page as a table of interactive elements, read once per cycle in one pass.
import { MAX_ROWS } from '../shared/config';
import { describeOrdinals, placement, type Placement, type Viewport } from '../shared/ordinals';
import type { ElementRow, Snapshot } from '../shared/types';
import { accessibleName, groupOf, roleOf } from './name';

const INTERACTIVE =
  'a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[role=checkbox],[role=radio],' +
  '[role=tab],[role=switch],[role=option],[role=combobox],[role=menuitem]';

// "The second one" refers to a repeated collection of things to open, not to a filter group.
const ORDINAL_ROLES = new Set(['link', 'button', 'tab', 'menuitem', 'option']);
const MIN_COLLECTION = 3;

// `options` maps a select label such as e12_o3 to its <option>, so a label is only ever looked up.
export type Snap = { snapshot: Snapshot; nodes: Map<string, Element>; options: Map<string, HTMLOptionElement>; ms: number };

let nextId = 1; // ids are never reused across snapshots

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

function isUsable(el: Element): boolean {
  if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return false;
  if (el.closest('[inert],[aria-hidden="true"]')) return false;
  return (el as HTMLElement).checkVisibility?.({ visibilityProperty: true }) ?? true;
}

// A fixed or sticky bar across the top of the viewport hides what is under it.
function topBar(overlay: Element): { el?: Element; bottom: number } {
  for (const hit of document.elementsFromPoint(window.innerWidth / 2, 2)) {
    if (hit === overlay || overlay.contains(hit)) continue;
    for (let n: Element | null = hit; n && n !== document.body; n = n.parentElement) {
      const position = getComputedStyle(n).position;
      if (position === 'fixed' || position === 'sticky') {
        const r = n.getBoundingClientRect();
        if (r.top <= 0 && r.bottom < window.innerHeight / 2) return { el: n, bottom: r.bottom };
      }
    }
    break;
  }
  return { bottom: 0 };
}

function stateOf(el: Element, role: string): string | undefined {
  const parts: string[] = [];
  const input = el as HTMLInputElement;
  if (role === 'checkbox' || role === 'radio' || role === 'switch') {
    const checked = el.hasAttribute('aria-checked') ? el.getAttribute('aria-checked') === 'true' : input.checked;
    parts.push(checked ? 'checked' : 'unchecked');
  } else if (el.tagName === 'SELECT') {
    const select = el as HTMLSelectElement;
    parts.push(`selected: ${clean(select.selectedOptions[0]?.textContent)}`);
  } else if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && input.value) {
    parts.push(`value: ${input.value.slice(0, 40)}`);
  }
  const expanded = el.getAttribute('aria-expanded');
  if (expanded) parts.push(expanded === 'true' ? 'expanded' : 'collapsed');
  if (el.getAttribute('aria-current') && el.getAttribute('aria-current') !== 'false') parts.push('current');
  if (el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-selected') === 'true') parts.push('selected');
  return parts.length ? parts.join(', ') : undefined;
}

type Item = { el: Element; role: string; place: Placement; top: number; bottom: number; group?: string; ordinal?: string };

export function takeSnapshot(opts: { overlay: Element; focused?: Element | null }): Snap {
  const started = performance.now();
  const bar = topBar(opts.overlay);
  const vp: Viewport = { width: window.innerWidth, height: window.innerHeight, insetTop: bar.bottom };
  const modal = Array.from(document.querySelectorAll('dialog[open]')).find((d) => d.matches(':modal'));
  const scope: ParentNode = modal ?? document;

  // Every usable interactive element, in reading order. Collections need the ones far off screen too.
  const items: Item[] = [];
  scope.querySelectorAll(INTERACTIVE).forEach((el) => {
    if (!isUsable(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    // Controls inside the sticky bar are on screen; only content scrolled under it is hidden.
    items.push({ el, role: roleOf(el), place: placement(r, vp, !!bar.el?.contains(el)), top: r.top, bottom: r.bottom });
  });

  // Ordinals for repeated siblings, inside the main content when the page marks it.
  const main = document.querySelector('main,[role=main]');
  const collections = new Map<Element, Map<string, Item[]>>();
  for (const item of items) {
    if (!ORDINAL_ROLES.has(item.role) || (main && !main.contains(item.el))) continue;
    const container = item.el.closest('li')?.parentElement ?? item.el.parentElement;
    if (!container) continue;
    const byRole = collections.get(container) ?? new Map<string, Item[]>();
    collections.set(container, byRole);
    byRole.set(item.role, [...(byRole.get(item.role) ?? []), item]);
  }
  for (const byRole of collections.values()) {
    for (const siblings of byRole.values()) {
      if (siblings.length < MIN_COLLECTION) continue;
      const group = groupOf(siblings[0]!.el);
      const words = describeOrdinals(siblings.map((s) => s.place), group);
      siblings.forEach((s, i) => { s.group = group; s.ordinal = words[i]; });
    }
  }

  // Rows: in or near the viewport (one viewport above or below), capped, in reading order.
  const near = items.filter((i) => i.bottom >= -vp.height && i.top <= 2 * vp.height).slice(0, MAX_ROWS);
  const nodes = new Map<string, Element>();
  const options = new Map<string, HTMLOptionElement>();
  let focused: string | undefined;
  const rows: ElementRow[] = near.map((item) => {
    const { el, role } = item;
    const id = `e${nextId++}`;
    nodes.set(id, el);
    if (el === opts.focused) focused = id;
    const row: ElementRow = { id, role, name: accessibleName(el) };
    const state = stateOf(el, role);
    if (state) row.state = state;
    const group = item.group ?? groupOf(el);
    if (group) row.group = group;
    if (item.ordinal) row.ordinal = item.ordinal;
    if (item.place !== 'visible') row.offscreen = item.place;
    if ((el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true') row.required = true;
    if (el.tagName === 'SELECT') {
      row.options = Array.from((el as HTMLSelectElement).options)
        .filter((o) => !o.disabled)
        .map((o) => {
          options.set(`${id}_o${o.index}`, o);
          return { id: `o${o.index}`, label: clean(o.textContent).slice(0, 60), selected: o.selected };
        });
    }
    return row;
  });

  const visible = (el: Element) => (el as HTMLElement).checkVisibility?.() ?? true;
  const headings = Array.from(scope.querySelectorAll('h1,h2,h3'))
    .filter(visible).map((h) => clean(h.textContent).slice(0, 80)).filter(Boolean).slice(0, 10);
  const notices = Array.from(scope.querySelectorAll('[role=status],[role=alert],[aria-live]:not([aria-live=off])'))
    .filter(visible).map((n) => clean(n.textContent).slice(0, 120)).filter(Boolean).slice(0, 8);
  if (modal) notices.unshift(`Dialog open: ${clean(modal.querySelector('h1,h2,h3')?.textContent) || 'untitled'}`);

  const snapshot: Snapshot = {
    url: location.pathname + location.search,
    title: document.title,
    headings, notices, rows,
    ...(focused ? { focused } : {}),
  };
  return { snapshot, nodes, options, ms: Math.round((performance.now() - started) * 10) / 10 };
}
