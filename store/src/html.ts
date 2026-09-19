const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = (s: string | number) => String(s).replace(/[&<>"']/g, (c) => ENTITIES[c]!);

const TINTS: Record<string, string> = {
  white: '#f4f4f0', black: '#26262b', grey: '#9a9ca3', navy: '#27356b', brown: '#7a4e2d',
  tan: '#c9a071', red: '#c0392f', green: '#4f7a4a', blue: '#3f7fc4',
};

// Placeholder product image: a shoe silhouette tinted by colour.
export function shoeImage(colour: string): string {
  const fill = TINTS[colour] ?? '#888';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220">` +
    `<rect width="320" height="220" fill="#eceae4"/>` +
    `<path d="M44 150c0-20 10-34 30-38l52-10 26-40c6-9 20-10 28-2l18 20c16 16 40 24 66 28 20 3 30 14 30 30v8c0 8-6 14-14 14H58c-8 0-14-6-14-10z" fill="${fill}" stroke="#1d1d22" stroke-width="3"/>` +
    `<path d="M48 166h244" stroke="#1d1d22" stroke-width="6" stroke-linecap="round"/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
