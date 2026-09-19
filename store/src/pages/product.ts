import { addToCart } from '../cart';
import { findProduct, money, SIZES, title } from '../catalog';
import { esc, shoeImage } from '../html';

export function renderProduct(main: HTMLElement, id: string, onCartChange: () => void) {
  const p = findProduct(id);
  if (!p) {
    main.innerHTML = `<h1>Product not found</h1><p><a href="/">Back to all shoes</a></p>`;
    return;
  }

  const sizes = SIZES.map((s) => {
    const inStock = p.sizes.includes(s);
    return `<label class="chip${inStock ? '' : ' chip-out'}"><input type="radio" name="size" value="${s}" required${inStock ? '' : ' disabled'}> <span>${s}</span></label>`;
  }).join('');

  main.innerHTML = `
    <nav aria-label="Breadcrumb" class="breadcrumb"><a href="/">All shoes</a> / <a href="/?category=${esc(p.category)}">${esc(title(p.category))}</a></nav>
    <article class="product">
      <img alt="${esc(`${p.name} in ${p.colour}`)}" src="${shoeImage(p.colour)}" width="320" height="220">
      <div>
        <h1>${esc(p.name)}</h1>
        <p class="price">${money(p.price)}</p>
        <p>${esc(p.description)}</p>
        <dl class="specs">
          <dt>Brand</dt><dd>${esc(p.brand)}</dd>
          <dt>Colour</dt><dd>${esc(title(p.colour))}</dd>
          <dt>Closure</dt><dd>${esc(title(p.closure))}</dd>
          <dt>Material</dt><dd>${esc(title(p.material))}</dd>
        </dl>
        <form id="buy" novalidate>
          <fieldset class="chips" id="size-group" aria-describedby="size-error">
            <legend>Size <span class="req">(required)</span></legend>
            ${sizes}
          </fieldset>
          <p id="size-error" class="error" role="alert"></p>
          <p><label for="qty">Quantity</label>
            <select id="qty" name="qty">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}">${n}</option>`).join('')}</select></p>
          <button type="submit" class="primary">Add to cart</button>
          <p id="added" role="status"></p>
        </form>
      </div>
    </article>`;

  const form = main.querySelector<HTMLFormElement>('#buy')!;
  const error = main.querySelector<HTMLElement>('#size-error')!;
  const added = main.querySelector<HTMLElement>('#added')!;
  const group = main.querySelector<HTMLElement>('#size-group')!;

  form.addEventListener('change', () => {
    error.textContent = '';
    group.removeAttribute('aria-invalid');
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const size = data.get('size') as string | null;
    if (!size) {
      error.textContent = 'Please choose a size.';
      group.setAttribute('aria-invalid', 'true');
      added.textContent = '';
      return;
    }
    const qty = Number(data.get('qty') ?? 1);
    addToCart(p.id, size, qty);
    added.innerHTML = `Added ${qty} × size ${esc(size)} to your cart. <a href="/cart">View cart</a>`;
    onCartChange();
  });
}
