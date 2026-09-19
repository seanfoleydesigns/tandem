// Act: click, type, select, scroll, back. Then wait for the page to settle.
import { placement } from '../shared/ordinals';
import { composedClosest, composedContains, deepElementFromPoint, openRoots } from './dom';

export type ExecResult = { ok: boolean; reason?: string; coveredBy?: Element }; // coveredBy: what sits on top of the target

// Called once the target has passed its checks, just before the action, with where it is on screen.
export type OnReady = (rect: DOMRect, radius: number) => void;

const SETTLE_QUIET_MS = 120;
const SETTLE_MAX_MS = 800;

function onScreen(el: Element): boolean {
  return placement(el.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }) === 'visible';
}

// Re-check the node just before acting: still connected, visible, and not covered by something else.
function ready(el: Element, overlay: Element, onReady?: OnReady): ExecResult {
  if (!el.isConnected) return { ok: false, reason: 'the element is no longer on the page' };
  const r0 = el.getBoundingClientRect();
  if (r0.width === 0 && r0.height === 0) return { ok: false, reason: 'the element is not visible' };
  // Off screen, or tucked under a sticky header: bring it to the middle of the viewport first.
  if (!onScreen(el) || covering(el, overlay).blocked) el.scrollIntoView({ block: 'center', behavior: 'instant' });
  const cover = covering(el, overlay);
  if (cover.blocked) return { ok: false, reason: 'the element is covered by something else', coveredBy: cover.by };
  onReady?.(el.getBoundingClientRect(), parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0);
  return { ok: true };
}

// Is the element the thing under its own centre point? The agent's overlay does not count. When it is not,
// `by` is what covers it, so the loop can try to get a pop-up or banner out of the way.
function covering(el: Element, overlay: Element): { blocked: boolean; by?: Element } {
  const r = el.getBoundingClientRect();
  const top = deepElementFromPoint(r.left + r.width / 2, r.top + r.height / 2, overlay); // goes down into open shadow roots
  if (!top) return { blocked: true };
  const labels = Array.from((el as HTMLInputElement).labels ?? []);
  const own = composedContains(el, top) || composedContains(top, el) || labels.some((l) => composedContains(l, top));
  return own ? { blocked: false } : { blocked: true, by: top };
}

const formOf = (el: Element): HTMLFormElement | null => (el as HTMLInputElement).form ?? (composedClosest(el, 'form') as HTMLFormElement | null);

// A search form, strictly: it says so (role=search, itself or around it), or a search field is the only thing in it
// to fill in. A registration form with a tag picker in it, or a page-wide form that happens to hold the header's
// search box, is not one.
function isSearchForm(form: HTMLFormElement): boolean {
  if (form.getAttribute('role') === 'search' || composedClosest(form, '[role=search]')) return true;
  const fields = form.querySelectorAll('input:not([type=hidden],[type=submit],[type=button],[type=image],[type=reset]),textarea,select');
  return fields.length === 1 && fields[0]!.tagName === 'INPUT' && isSearchField(fields[0] as HTMLInputElement);
}

// Would pressing this submit a form? A search form does not count: searching is what it is for.
export function submitsForm(el: Element): boolean {
  if (!el.matches('button:not([type]),button[type=submit],input[type=submit],input[type=image]')) return false;
  const form = formOf(el);
  return !!form && !isSearchForm(form);
}

// Never type into a password or payment field, on either leash, whoever asks. Real checkouts often leave
// autocomplete off, so the field's own words count too. A false alarm only means one field the agent will not type in.
const SECRET_TOKEN = /(^|\s)(cc-|current-password|new-password|one-time-code)/;
const SECRET_WORDS = /card.?(number|no)\b|\bcvv\b|\bcvc\b|security code|expir|passw|passcode|\bpin\b|\bssn\b|social security/i;
export function isSensitive(el: Element): boolean {
  const input = el as HTMLInputElement;
  if (input.type === 'password' || SECRET_TOKEN.test((el.getAttribute('autocomplete') ?? '').trim().toLowerCase())) return true;
  if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return false;
  const labels = Array.from(input.labels ?? []).map((l) => l.textContent ?? '').join(' ');
  return SECRET_WORDS.test(`${input.name} ${el.id} ${el.getAttribute('aria-label') ?? ''} ${input.placeholder ?? ''} ${labels}`);
}

export function click(el: Element, overlay: Element, onReady?: OnReady): ExecResult {
  const check = ready(el, overlay, onReady);
  if (check.ok) (el as HTMLElement).click();
  return check;
}

// The same notion of a search field as shared/search.ts uses for rows: its type or role, or its own words.
function isSearchField(el: HTMLInputElement): boolean {
  const labels = Array.from(el.labels ?? []).map((l) => l.textContent ?? '').join(' ');
  const words = `${el.getAttribute('aria-label') ?? ''} ${el.placeholder ?? ''} ${labels} ${el.name} ${el.id}`;
  return el.type === 'search' || el.getAttribute('role') === 'searchbox' || !!composedClosest(el, '[role=search]') || /\bsearch/i.test(words);
}

// Set the value through the native setter so framework-controlled inputs see the change.
// Dictation appends to what is already there and does not submit.
export function type(
  el: Element, text: string, overlay: Element, onReady?: OnReady, opts: { append?: boolean; submit?: boolean } = {},
): ExecResult {
  if (isSensitive(el)) return { ok: false, reason: 'the agent never types into password or payment fields' };
  const check = ready(el, overlay, onReady);
  if (!check.ok) return check;
  const input = el as HTMLInputElement;
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  input.focus();
  const value = opts.append && input.value ? `${input.value.trimEnd()} ${text}` : text;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true })); // composed, as the native event is: it must leave a shadow root
  input.dispatchEvent(new Event('change', { bubbles: true }));
  if (opts.submit !== false && isSearchField(input)) {
    // A synthetic Enter does not submit a form, so submit it the way Enter would: but only a search form. In any
    // other form the words stay typed and nothing is sent.
    const form = formOf(input);
    if (form) { if (isSearchForm(form)) form.requestSubmit(); }
    else for (const t of ['keydown', 'keyup']) input.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', bubbles: true, composed: true }));
  }
  return { ok: true };
}

export function select(el: Element, option: HTMLOptionElement | undefined, overlay: Element, onReady?: OnReady): ExecResult {
  const check = ready(el, overlay, onReady);
  if (!check.ok) return check;
  const sel = el as HTMLSelectElement;
  if (!option || option.parentElement?.closest('select') !== sel) return { ok: false, reason: 'the option is no longer in the dropdown' };
  sel.value = option.value;
  sel.dispatchEvent(new Event('input', { bubbles: true }));
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true };
}

export function scroll(direction: 1 | -1): ExecResult {
  window.scrollBy({ top: direction * 0.8 * window.innerHeight, behavior: 'instant' });
  return { ok: true };
}

export function back(): ExecResult {
  history.back();
  return { ok: true };
}

// Wait until the DOM has been quiet for 120 ms, 800 ms at most. Reports whether anything changed.
export function settle(overlay: Element, before: { url: string; scrollY: number }): Promise<{ changed: boolean; ms: number }> {
  const started = performance.now();
  return new Promise((resolve) => {
    let mutated = false;
    let quiet: ReturnType<typeof setTimeout>;
    const done = () => {
      observer.disconnect();
      clearTimeout(quiet);
      clearTimeout(max);
      const changed = mutated || location.href !== before.url || window.scrollY !== before.scrollY;
      resolve({ changed, ms: Math.round(performance.now() - started) });
    };
    const observer = new MutationObserver((records) => {
      if (records.every((r) => r.target === overlay)) return;
      mutated = true;
      clearTimeout(quiet);
      quiet = setTimeout(done, SETTLE_QUIET_MS);
    });
    const watch = { subtree: true, childList: true, attributes: true, characterData: true };
    observer.observe(document.documentElement, watch);
    for (const root of openRoots(document, overlay)) observer.observe(root, watch); // a document observer does not see inside components
    quiet = setTimeout(done, SETTLE_QUIET_MS);
    const max = setTimeout(done, SETTLE_MAX_MS);
  });
}
