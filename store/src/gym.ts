// `?gym=hard` adds the friction real sites have: a cookie banner, a newsletter pop-up after five seconds,
// Size tucked behind "More filters", and a custom listbox for the sort. Default is easy mode.
// Nothing here knows about the agent: this is how shops behave towards people.
const KEY = 'footnote.gym';
const SEEN = 'footnote.gym.seen'; // what the shopper has already dismissed in this session

// Decided once per document. `?gym=hard` switches it on and any other value off. With no parameter it is kept
// across a reload or back/forward (filter changes strip the query), but a fresh visit to the shop starts easy.
let hard: boolean | undefined;
export function gymHard(): boolean {
  if (hard !== undefined) return hard;
  const asked = new URLSearchParams(location.search).get('gym');
  const fresh = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type === 'navigate';
  try {
    if (asked === 'hard') sessionStorage.setItem(KEY, 'hard');
    else if (asked || fresh) { sessionStorage.removeItem(KEY); sessionStorage.removeItem(SEEN); }
    hard = sessionStorage.getItem(KEY) === 'hard';
  } catch {
    hard = asked === 'hard';
  }
  return hard;
}

const seen = (what: string) => { try { return (sessionStorage.getItem(SEEN) ?? '').split(',').includes(what); } catch { return false; } };
const markSeen = (what: string) => { try { sessionStorage.setItem(SEEN, [sessionStorage.getItem(SEEN), what].filter(Boolean).join(',')); } catch { /* private mode */ } };

function cookieBanner() {
  if (seen('cookies') || document.getElementById('cookie-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'cookie-banner';
  banner.className = 'cookie-banner';
  banner.setAttribute('role', 'region');
  banner.setAttribute('aria-label', 'Cookies');
  banner.innerHTML = `
    <p><strong>We value your privacy.</strong> We and our 214 partners use cookies to personalise ads and measure how the shop is used.</p>
    <p class="cookie-small">With your consent we and our partners store and read information on your device, such as cookies and device identifiers, to show personalised ads and content, measure them, and learn about our audience. You can change your choice at any time.</p>
    <div class="cookie-actions">
      <button type="button" class="primary" data-choice="all">Accept all</button>
      <button type="button" data-choice="necessary">Necessary only</button>
      <a href="/cookies" data-choice="manage">Manage preferences</a>
    </div>`;
  banner.addEventListener('click', (e) => {
    const choice = (e.target as Element).closest<HTMLElement>('[data-choice]')?.dataset.choice;
    if (!choice) return;
    e.preventDefault();
    e.stopPropagation();
    if (choice === 'manage') return; // a real one opens a long settings page; this one just stays
    markSeen('cookies');
    banner.remove();
  });
  document.body.append(banner);
}

function newsletter() {
  if (seen('newsletter') || document.getElementById('newsletter')) return;
  const dialog = document.createElement('dialog');
  dialog.id = 'newsletter';
  dialog.setAttribute('aria-labelledby', 'newsletter-title');
  dialog.innerHTML = `
    <h2 id="newsletter-title">Get 10% off your first order</h2>
    <p>Join the Footnote list for early access and offers.</p>
    <form method="dialog" class="newsletter-form">
      <label for="newsletter-email">Email address</label>
      <input type="email" id="newsletter-email" name="email" autocomplete="email" placeholder="you@example.com">
      <button type="submit" class="primary" value="subscribe">Subscribe and save</button>
      <button type="submit" class="linklike" value="decline">No thanks, I'd rather pay full price</button>
    </form>`;
  // Done on submit and on Esc, not on the dialog's "close" event: browsers deliver that one with the next frame,
  // which a background tab never paints.
  const done = () => { markSeen('newsletter'); queueMicrotask(() => dialog.remove()); };
  dialog.querySelector('form')!.addEventListener('submit', done);
  dialog.addEventListener('cancel', done);
  document.body.append(dialog);
  dialog.showModal();
}

let timer: ReturnType<typeof setTimeout> | undefined;

// Called after every route change.
export function gym() {
  if (!gymHard()) return;
  cookieBanner();
  if (!seen('newsletter') && !timer) timer = setTimeout(newsletter, 5000);
}
