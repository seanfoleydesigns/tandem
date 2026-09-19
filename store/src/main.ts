import './styles.css';
import { cartCount } from './cart';
import { CATEGORIES, parseFilters, title } from './catalog';
import { esc } from './html';
import { renderCart } from './pages/cart';
import { renderListing } from './pages/listing';
import { renderProduct } from './pages/product';

const app = document.getElementById('app')!;

function header(): string {
  const f = parseFilters(location.search);
  const onListing = location.pathname === '/';
  const cats = CATEGORIES.map((c) => {
    const current = onListing && f.category === c ? ' aria-current="page"' : '';
    return `<a href="/?category=${c}"${current}>${title(c)}</a>`;
  }).join('');
  return `
    <header class="site-header">
      <a class="logo" href="/">Footnote</a>
      <form role="search" id="search-form">
        <label for="q" class="visually-hidden">Search shoes</label>
        <input type="search" id="q" name="q" placeholder="Search shoes" value="${esc(onListing ? f.q : '')}">
        <button type="submit">Search</button>
      </form>
      <nav aria-label="Categories" class="cats">${cats}</nav>
      <a href="/cart" class="cart-link" id="cart-link">Cart (${cartCount()})</a>
    </header>`;
}

function updateCartLink() {
  const link = document.getElementById('cart-link');
  if (link) link.textContent = `Cart (${cartCount()})`;
}

function route() {
  app.innerHTML = `${header()}<main id="main"></main><footer class="site-footer">Footnote is a demo shop with invented brands.</footer>`;
  const main = document.getElementById('main')!;
  const path = location.pathname;
  const product = path.match(/^\/product\/([^/]+)\/?$/);

  if (product) renderProduct(main, decodeURIComponent(product[1]!), updateCartLink);
  else if (path === '/cart') renderCart(main, updateCartLink);
  else if (path === '/') renderListing(main);
  else main.innerHTML = `<h1>Page not found</h1><p><a href="/">Back to all shoes</a></p>`;

  document.title = `${main.querySelector('h1')?.textContent ?? 'Shoes'} · Footnote`;

  document.getElementById('search-form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = (document.getElementById('q') as HTMLInputElement).value.trim();
    navigate(q ? `/?q=${encodeURIComponent(q)}` : '/');
  });
}

function navigate(url: string) {
  history.pushState(null, '', url);
  route();
  window.scrollTo(0, 0);
}

// Real <a href> links, routed client-side with the History API.
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a || a.target || a.hasAttribute('download') || a.origin !== location.origin) return;
  e.preventDefault();
  // Choosing a category keeps the filters already applied on the listing.
  if (a.closest('.cats') && location.pathname === '/') {
    const params = new URLSearchParams(location.search);
    params.delete('q');
    params.set('category', new URLSearchParams(a.search).get('category') ?? '');
    return navigate(`/?${params}`);
  }
  navigate(a.pathname + a.search);
});

window.addEventListener('popstate', route);

route();
