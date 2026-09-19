import { readCart, removeFromCart } from '../cart';
import { findProduct, money, title } from '../catalog';
import { esc } from '../html';

export function renderCart(main: HTMLElement, onCartChange: () => void) {
  const lines = readCart();
  let total = 0;

  const items = lines
    .map((l, i) => {
      const p = findProduct(l.id);
      if (!p) return '';
      total += p.price * l.qty;
      return `<li class="cart-line">
        <a href="/product/${esc(p.id)}">${esc(p.name)}</a>
        <span>${esc(title(p.colour))}, size ${esc(l.size)}</span>
        <span>Qty ${l.qty}</span>
        <span>${money(p.price * l.qty)}</span>
        <button type="button" data-remove="${i}" aria-label="Remove ${esc(p.name)} size ${esc(l.size)}">Remove</button>
      </li>`;
    })
    .join('');

  main.innerHTML = `
    <h1>Your cart</h1>
    ${lines.length === 0
      ? `<p>Your cart is empty.</p><p><a href="/">Continue shopping</a></p>`
      : `<ul class="cart-lines">${items}</ul>
         <p class="cart-total">Total: <strong>${money(total)}</strong></p>
         <p><a href="/">Continue shopping</a></p>
         <button type="button" id="checkout" class="primary">Checkout</button>`}
    <dialog id="demo-dialog" aria-labelledby="demo-title">
      <h2 id="demo-title">Demo only</h2>
      <p>Footnote is a demo shop. Nothing can be bought here.</p>
      <form method="dialog"><button>Close</button></form>
    </dialog>`;

  main.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((b) =>
    b.addEventListener('click', () => {
      removeFromCart(Number(b.dataset.remove));
      onCartChange();
      renderCart(main, onCartChange);
    }),
  );
  main.querySelector('#checkout')?.addEventListener('click', () => {
    main.querySelector<HTMLDialogElement>('#demo-dialog')!.showModal();
  });
}
