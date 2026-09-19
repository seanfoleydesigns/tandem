// Constraints are generic: what the goal states about the things it wants, on any kind of site. On a shop the
// attributes are category and colour; on a news list they might be topic or date. Prices stay numbers, for code.
import { labelKey } from './groups';
import type { Constraints } from './types';

// The LLM returns attributes as {name, value} pairs, because a structured-output schema cannot express a
// free-form record. Names are normalised the way control group keys are, so "Colour" and "colour" are one key.
const RESERVED = new Set(['searchquery', 'attributes', 'visualprefs', 'maxprice', 'minprice']);

export function attributesFromPairs(pairs: { name: string; value: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { name, value } of pairs) {
    const key = labelKey(name);
    const words = key.replace(/_/g, ' ');
    // A price is max_price / min_price, for code; and no attribute may shadow a Constraints field once flattened.
    if (!key || !value.trim() || /\b(price|budget|cost)\b/.test(words) || RESERVED.has(key.replace(/[ _]/g, ''))) continue;
    const v = value.trim();
    if (!out[key]) out[key] = v;
    else if (!out[key].split(', ').includes(v)) out[key] += `, ${v}`; // "white or black" keeps both
  }
  return out;
}

// A refinement adjusts the last search, so it keeps whatever it does not restate. Attributes merge key by key:
// "make them black" after "white sneakers" keeps the category and replaces the colour.
export function mergeConstraints(last: Constraints, stated: Constraints): Constraints {
  const attributes = { ...last.attributes, ...stated.attributes };
  const { attributes: _a, ...rest } = { ...last, ...stated };
  return Object.keys(attributes).length ? { ...rest, attributes } : rest;
}

// What Jev reads: attributes as plain top-level keys, { category, colour, max_price }, one flat thing to read literally.
export function flatConstraints(c: Constraints | undefined): Record<string, unknown> {
  const { attributes, ...rest } = c ?? {};
  return { ...attributes, ...rest };
}
