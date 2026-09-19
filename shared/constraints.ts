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

// Exact matches are code's job, as a CORRECTION only. The LLM once in three read "sneakers" as the Running section
// (both are the page's own words, and the page was on Running). So: for an attribute the LLM itself returned, when
// its value is one of the page's options for that group but the goal literally says a different one, and only that
// one, code puts the said one back. It never adds an attribute: ordinary goal words ("about", "search", "new") are
// also link names on real sites, and an invented attribute would send the DONE gate after a navigation link.
type Vocabulary = { categories: string[]; filters: { group: string; options: string[] }[] };
const CURRENT = / \(current\)$/; // how the page digest marks the open section
const plain = (s: string) => s.replace(CURRENT, '').toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim();

export function correctAttributes(attributes: Record<string, string>, goal: string, page: Vocabulary): Record<string, string> {
  const words = ` ${plain(goal)} `;
  const said = (option: string) => {
    const o = plain(option);
    if (o.length < 3 || /^[\d. ]+$/.test(o)) return false; // too short, or a bare number that could be a price or a size
    const singular = o.endsWith('s') && o.length >= 5 ? o.slice(0, -1) : o; // "boots" is said by "boot"; "news" is not said by "new"
    return words.includes(` ${o} `) || words.includes(` ${singular} `) || words.includes(` ${o}s `);
  };
  const out = { ...attributes };
  for (const [key, value] of Object.entries(attributes)) {
    const options = (key === 'category' ? page.categories : page.filters.find((f) => labelKey(f.group) === key)?.options ?? []).map((o) => o.replace(CURRENT, ''));
    const hits = options.filter(said);
    const isOption = options.some((o) => plain(o) === plain(value));
    if (isOption && hits.length === 1 && plain(hits[0]!) !== plain(value)) out[key] = hits[0]!;
  }
  return out;
}
