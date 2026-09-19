export type CartLine = { id: string; size: string; qty: number };

const KEY = 'footnote.cart';

export function readCart(): CartLine[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as CartLine[];
  } catch {
    return [];
  }
}

function writeCart(lines: CartLine[]) {
  localStorage.setItem(KEY, JSON.stringify(lines));
}

export function addToCart(id: string, size: string, qty: number) {
  const lines = readCart();
  const line = lines.find((l) => l.id === id && l.size === size);
  if (line) line.qty += qty;
  else lines.push({ id, size, qty });
  writeCart(lines);
}

export function removeFromCart(index: number) {
  const lines = readCart();
  lines.splice(index, 1);
  writeCart(lines);
}

export const cartCount = () => readCart().reduce((n, l) => n + l.qty, 0);
