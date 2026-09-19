import data from './data/products.json';

export type Product = {
  id: string;
  name: string;
  brand: string;
  category: string;
  colour: string;
  closure: string;
  price: number;
  material: string;
  sizes: string[];
  description: string;
};

export const products = data as Product[];

export const CATEGORIES = ['sneakers', 'boots', 'running', 'loafers', 'sandals'];
export const COLOURS = ['white', 'black', 'grey', 'navy', 'brown', 'tan', 'red', 'green', 'blue'];
export const BRANDS = ['Northfield', 'Arco', 'Pace & Co', 'Lumen', 'Tidewater'];
export const CLOSURES = ['laces', 'slip-on', 'velcro', 'zip'];
export const SIZES = ['7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5', '12', '12.5', '13'];
export const PRICE_RANGES = [
  { id: 'under-75', label: 'Under $75', min: 0, max: 74.99 },
  { id: '75-125', label: '$75 to $125', min: 75, max: 125 },
  { id: '125-175', label: '$125 to $175', min: 125.01, max: 175 },
  { id: 'over-175', label: 'Over $175', min: 175.01, max: Infinity },
];
export const SORTS = [
  { id: 'featured', label: 'Featured' },
  { id: 'price-asc', label: 'Price low to high' },
  { id: 'price-desc', label: 'Price high to low' },
  { id: 'name', label: 'Name A to Z' },
];

export const PAGE_SIZE = 24;

export type Filters = {
  q: string;
  category: string;
  colour: string[];
  size: string;
  brand: string[];
  closure: string[];
  price: string;
  sort: string;
};

const list = (v: string | null) => (v ? v.split(',').filter(Boolean) : []);

// Filters live in the query string, so every listing state has a URL.
export function parseFilters(search: string): Filters {
  const p = new URLSearchParams(search);
  return {
    q: p.get('q') ?? '',
    category: p.get('category') ?? '',
    colour: list(p.get('colour')),
    size: p.get('size') ?? '',
    brand: list(p.get('brand')),
    closure: list(p.get('closure')),
    price: p.get('price') ?? '',
    sort: p.get('sort') ?? 'featured',
  };
}

export function toQuery(f: Filters): string {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.category) p.set('category', f.category);
  if (f.colour.length) p.set('colour', f.colour.join(','));
  if (f.size) p.set('size', f.size);
  if (f.brand.length) p.set('brand', f.brand.join(','));
  if (f.closure.length) p.set('closure', f.closure.join(','));
  if (f.price) p.set('price', f.price);
  if (f.sort && f.sort !== 'featured') p.set('sort', f.sort);
  const s = p.toString();
  return s ? `?${s}` : '';
}

const stem = (w: string) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean).map(stem);

// Every product is footwear, so "white shoes" should find white products.
function haystack(p: Product): Set<string> {
  return new Set(words(`${p.name} ${p.brand} ${p.category} ${p.colour} ${p.closure} ${p.material} ${p.description} shoes footwear`));
}

export function applyFilters(all: Product[], f: Filters): Product[] {
  const terms = words(f.q);
  const range = PRICE_RANGES.find((r) => r.id === f.price);
  const out = all.filter((p) => {
    if (f.category && p.category !== f.category) return false;
    if (f.colour.length && !f.colour.includes(p.colour)) return false;
    if (f.size && !p.sizes.includes(f.size)) return false;
    if (f.brand.length && !f.brand.includes(p.brand)) return false;
    if (f.closure.length && !f.closure.includes(p.closure)) return false;
    if (range && (p.price < range.min || p.price > range.max)) return false;
    if (terms.length) {
      const hay = haystack(p);
      if (!terms.every((t) => hay.has(t))) return false;
    }
    return true;
  });
  if (f.sort === 'price-asc') out.sort((a, b) => a.price - b.price);
  else if (f.sort === 'price-desc') out.sort((a, b) => b.price - a.price);
  else if (f.sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export const findProduct = (id: string) => products.find((p) => p.id === id);
export const money = (n: number) => `$${n}`;
export const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
