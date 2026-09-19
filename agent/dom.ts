// The DOM as the user sees it: light DOM plus open shadow roots (web components). A closed shadow root
// cannot be reached from a script, so whatever is inside one stays invisible to the agent. That is a limit.

const hasOpenRoots = (root: ParentNode, skip?: Element) => {
  // The scope itself may be a component, or live inside one (its content can then be slotted in from outside).
  if (root instanceof Element && (root.shadowRoot || root.getRootNode() instanceof ShadowRoot)) return true;
  for (const el of root.querySelectorAll('*')) if (el.shadowRoot && el !== skip) return true;
  return false;
};

// querySelectorAll that also descends into open shadow roots, in reading order. `skip` is the agent's own
// overlay host. A page without shadow roots takes the plain querySelectorAll path, exactly as before.
export function deepQueryAll(root: ParentNode, selector: string, skip?: Element): Element[] {
  if (!hasOpenRoots(root, skip)) return Array.from(root.querySelectorAll(selector));
  const out: Element[] = [];
  const seen = new Set<Element>(); // a slotted element is reached through its slot and again as a child of the host
  const visit = (el: Element) => {
    if (el === skip || seen.has(el)) return;
    seen.add(el);
    if (el.matches(selector)) out.push(el);
    if (el.shadowRoot) walk(el.shadowRoot); // what the component renders comes first
    if (el.tagName === 'SLOT') (el as HTMLSlotElement).assignedElements?.({ flatten: true }).forEach(visit); // shown here
    walk(el);
  };
  const walk = (node: ParentNode) => Array.from(node.children).forEach(visit);
  if (root instanceof Element && root.shadowRoot) walk(root.shadowRoot);
  walk(root);
  return out;
}

// Every open shadow root under `root`, for observers that must see changes inside components.
export function openRoots(root: ParentNode, skip?: Element): ShadowRoot[] {
  const out: ShadowRoot[] = [];
  const walk = (node: ParentNode) => {
    for (const el of node.querySelectorAll('*')) {
      if (el === skip || !el.shadowRoot) continue;
      out.push(el.shadowRoot);
      walk(el.shadowRoot);
    }
  };
  walk(root);
  return out;
}

// The host of the shadow root an element lives in, if any.
export function hostOf(el: Element): Element | null {
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

// The parent in the composed tree: a slotted element sits in its slot, and a shadow root's child sits in the host.
export function composedParent(el: Element): Element | null {
  if (el.assignedSlot) return el.assignedSlot;
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

export function composedClosest(el: Element, selector: string): Element | null {
  for (let a: Element | null = el; a; a = composedParent(a)) if (a.matches(selector)) return a;
  return null;
}

export function composedContains(container: Element, el: Element): boolean {
  for (let a: Element | null = el; a; a = composedParent(a)) if (a === container) return true;
  return false;
}

// document.elementsFromPoint stops at a shadow host. Go down into open roots to the element really under the point.
export function deepElementFromPoint(x: number, y: number, skip: Element): Element | undefined {
  let top = document.elementsFromPoint(x, y).find((h) => h !== skip && !skip.contains(h));
  while (top?.shadowRoot) {
    const inner = top.shadowRoot.elementsFromPoint?.(x, y).find((h) => h !== top && top!.shadowRoot!.contains(h));
    if (!inner) break;
    top = inner;
  }
  return top;
}

export function deepActiveElement(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

// aria-labelledby and friends resolve inside the element's own tree: the document, or its shadow root.
export function byId(el: Element, id: string): Element | null {
  const root = el.getRootNode() as Document | ShadowRoot;
  return root.getElementById?.(id) ?? el.ownerDocument.getElementById(id);
}
