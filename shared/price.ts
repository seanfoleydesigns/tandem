// Price is code's job, not Jev's. Jev cannot compare numbers: asked for "under a hundred dollars" it chose
// "Under $75", which hides every shoe from $75 to $100 (NOTES.md M3.1). Code parses the numbers instead.
import type { ControlGroup } from './groups';
import type { Constraints, ElementRow, Snapshot } from './types';

export type Range = { min: number; max: number }; // inclusive bounds; max may be Infinity

const NUM = /(\d[\d,]*(?:\.\d+)?)/g;
const numbers = (s: string) => [...s.matchAll(NUM)].map((m) => Number(m[1]!.replace(/,/g, '')));

// "Under $75", "$75 to $125", "$125 - $175", "Over $175", "$200+", "Up to $100", "Less than $50".
export function parseRange(label: string): Range | undefined {
  if (!/[$€£]|\bprice\b/i.test(label)) return undefined;
  const n = numbers(label);
  if (n.length === 0) return undefined;
  if (n.length >= 2) return { min: Math.min(n[0]!, n[1]!), max: Math.max(n[0]!, n[1]!) };
  if (/\b(under|below|less than|up to|max(imum)?)\b/i.test(label)) return { min: 0, max: n[0]! };
  if (/\b(over|above|more than|from|min(imum)?)\b|\+\s*$/i.test(label)) return { min: n[0]!, max: Infinity };
  return undefined;
}

// The price shown on a card. With "was $120 now $89", the lower one is what it costs.
export function parsePrice(text: string): number | undefined {
  const prices = [...text.matchAll(/[$€£]\s?(\d[\d,]*(?:\.\d+)?)/g)].map((m) => Number(m[1]!.replace(/,/g, '')));
  return prices.length ? Math.min(...prices) : undefined;
}

export function wanted(c: Constraints | undefined): Range | undefined {
  if (c?.max_price === undefined && c?.min_price === undefined) return undefined;
  return { min: c.min_price ?? 0, max: c.max_price ?? Infinity };
}

export const within = (price: number, r: Range) => price >= r.min && price <= r.max;

// The control group whose options are price ranges.
export function priceGroup(groups: ControlGroup[]): ControlGroup | undefined {
  return groups.find((g) => g.rows.filter((r) => parseRange(r.name)).length >= Math.max(2, g.rows.length / 2));
}

// Select a price option only when its range matches the constraint exactly. "Under $75" is not "under $100".
export function exactOption(group: ControlGroup | undefined, want: Range): ElementRow | undefined {
  return group?.rows.find((row) => {
    const r = parseRange(row.name);
    return !!r && r.min === want.min && r.max === want.max;
  });
}

// A sort dropdown with a cheapest-first option, so the matches come to the top when no filter fits.
export function sortAscending(snapshot: Snapshot): { row: ElementRow; optionId: string; label: string; already: boolean } | undefined {
  for (const row of snapshot.rows) {
    if (!row.options || !/sort|order/i.test(row.name)) continue;
    const option = row.options.find((o) => /price/i.test(o.label) && /(low|asc|cheap)/i.test(o.label) && !/high\s*to\s*low|desc/i.test(o.label));
    if (option) return { row, optionId: option.id, label: option.label, already: option.selected };
  }
  return undefined;
}

// Result cards, with the price on each: the rows of the repeated collections (they carry an ordinal), and any
// other link that shows a price. A list of one or two results is too short to get ordinals; its cards still count.
export function pricedCards(snapshot: Snapshot): { row: ElementRow; price: number | undefined }[] {
  return snapshot.rows
    .map((row) => ({ row, price: parsePrice(row.name) }))
    .filter((c) => c.row.ordinal || (c.row.role === 'link' && c.price !== undefined));
}

// Counts are computed in code. The LLM must not count.
export function countResults(snapshot: Snapshot, want: Range | undefined): { shown: number; priced: number; within_price?: number } {
  const cards = pricedCards(snapshot);
  const priced = cards.filter((c) => c.price !== undefined);
  return { shown: cards.length, priced: priced.length, ...(want ? { within_price: priced.filter((c) => within(c.price!, want)).length } : {}) };
}

// Jev must never be offered the price group when a price constraint exists.
export function withoutPriceGroup(snapshot: Snapshot, groups: ControlGroup[], c: Constraints | undefined): Snapshot {
  const group = wanted(c) ? priceGroup(groups) : undefined;
  if (!group) return snapshot;
  const hidden = new Set(group.rows.map((r) => r.id));
  return { ...snapshot, rows: snapshot.rows.filter((r) => !hidden.has(r.id)) };
}

// Routing a price is code's job too. An utterance that sets a price limit never goes to Jev on the single
// leash, where it would pick a range by feel ("under a hundred and fifty" became "$75 to $125"). It goes to
// the task path, where the LLM reads the number and code applies it.
const MONEY = /[$€£]\s?\d|\b(dollars?|bucks|euros?|pounds?|quid)\b/i;
const COMPARE = /\b(under|below|over|above|less than|more than|cheaper than|no more than|at most|at least|up to|max(?:imum)?(?: of)?|min(?:imum)?(?: of)?|between)\b(.*)$/i;
const NUMBERISH = /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|grand)\b/i;

export function mentionsPrice(utterance: string): boolean {
  if (MONEY.test(utterance)) return true;
  const after = utterance.match(COMPARE)?.[2];
  return !!after && NUMBERISH.test(after);
}

// When the LLM is away (no key, a timeout), code reads the limit itself, so a price never falls to Jev.
// It reads digits ("under $100") and plain number words ("under a hundred and fifty", "one twenty").
const UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const BIG = /^(hundred|thousand|grand)$/;

// The amount at the start of a phrase: "100 dollars" -> 100, "a hundred and fifty" -> 150, "seventy five" -> 75.
export function amount(phrase: string): number | undefined {
  const words = phrase.toLowerCase().replace(/(\d),(\d)/g, '$1$2').replace(/[$€£]/g, ' ').replace(/-/g, ' ').trim().split(/\s+/);
  if (/^\d+(\.\d+)?$/.test(words[0] ?? '')) return Number(words[0]);
  let total = 0, current = 0, seen = false, hundreds = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!, next = words[i + 1] ?? '';
    const unit = UNITS.indexOf(w), ten = TENS.indexOf(w);
    if ((w === 'a' || w === 'an') && BIG.test(next)) current += 1;
    else if (w === 'and' && hundreds && (UNITS.includes(next) || TENS.includes(next))) continue;
    else if (unit >= 0) current += unit;
    else if (ten >= 2) current = current >= 1 && current <= 9 && !hundreds ? current * 100 + ten * 10 : current + ten * 10; // "one fifty" is 150
    else if (w === 'hundred') { current = (current || 1) * 100; hundreds = true; }
    else if (w === 'thousand' || w === 'grand') { total += (current || 1) * 1000; current = 0; hundreds = true; }
    else break;
    seen = true;
  }
  return seen ? total + current : undefined;
}

const UPPER = /\b(?:under|below|less than|cheaper than|no more than|at most|up to|max(?:imum)?(?: of)?)\s+(.*)$/i;
const LOWER = /\b(?:over|above|(?<!no )more than|at least|min(?:imum)?(?: of)?)\s+(.*)$/i;

export function priceLimit(utterance: string): Pick<Constraints, 'min_price' | 'max_price'> | undefined {
  const between = utterance.match(/\bbetween\s+(.*)$/i)?.[1];
  if (between) {
    // "a hundred and fifty and two hundred": take the first "and" that leaves a smaller amount on its left.
    const parts = between.split(/\s+and\s+/i);
    for (let i = 1; i < parts.length; i++) {
      const low = amount(parts.slice(0, i).join(' and ')), high = amount(parts.slice(i).join(' and '));
      if (low !== undefined && high !== undefined && low < high) return { min_price: low, max_price: high };
    }
  }
  const max = amount(utterance.match(UPPER)?.[1] ?? ''), min = amount(utterance.match(LOWER)?.[1] ?? '');
  if (max === undefined && min === undefined) return undefined;
  return { ...(min !== undefined ? { min_price: min } : {}), ...(max !== undefined ? { max_price: max } : {}) };
}
