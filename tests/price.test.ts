import { describe, expect, it } from 'vitest';
import { controlGroups } from '../shared/groups';
import { amount, countResults, exactOption, mentionsPrice, parsePrice, priceLimit, parseRange, priceGroup, sortAscending, wanted, within, withoutPriceGroup } from '../shared/price';
import type { ElementRow, Snapshot } from '../shared/types';

const row = (id: string, role: string, name: string, group?: string, extra: Partial<ElementRow> = {}): ElementRow => ({ id, role, name, group, state: 'unchecked', ...extra });
const snapshot: Snapshot = {
  url: '/', title: '', headings: [], notices: [],
  rows: [
    row('e1', 'checkbox', 'White', 'Colour'), row('e2', 'checkbox', 'Black', 'Colour'),
    row('e3', 'radio', 'Under $75', 'Price'), row('e4', 'radio', '$75 to $125', 'Price'),
    row('e5', 'radio', '$125 to $175', 'Price'), row('e6', 'radio', 'Over $175', 'Price'),
    row('e7', 'combobox', 'Sort by', 'Results', { options: [
      { id: 'o0', label: 'Featured', selected: true }, { id: 'o1', label: 'Price low to high', selected: false }, { id: 'o2', label: 'Price high to low', selected: false },
    ] }),
    row('e8', 'link', 'Northfield Court Classic White sneakers $89', 'Results', { ordinal: 'first visible (item 1 of 4 in Results)' }),
    row('e9', 'link', 'Arco Plaza Low White sneakers $95', 'Results', { ordinal: 'second visible (item 2 of 4 in Results)' }),
    row('e10', 'link', 'Pace & Co Daybreak White sneakers $72', 'Results', { ordinal: 'third visible (item 3 of 4 in Results)' }),
    row('e11', 'link', 'Lumen Halo White sneakers $110', 'Results', { ordinal: 'fourth visible (item 4 of 4 in Results)' }),
  ],
};
const groups = controlGroups(snapshot);

describe('parseRange: code reads the numbers in the option labels', () => {
  it('reads the ways shops write price ranges', () => {
    expect(parseRange('Under $75')).toEqual({ min: 0, max: 75 });
    expect(parseRange('$75 to $125')).toEqual({ min: 75, max: 125 });
    expect(parseRange('$125 - $175')).toEqual({ min: 125, max: 175 });
    expect(parseRange('Over $175')).toEqual({ min: 175, max: Infinity });
    expect(parseRange('$200+')).toEqual({ min: 200, max: Infinity });
    expect(parseRange('Up to $1,000')).toEqual({ min: 0, max: 1000 });
  });
  it('is not fooled by sizes or plain words', () => {
    expect(parseRange('10.5')).toBeUndefined();
    expect(parseRange('White')).toBeUndefined();
  });
});

describe('parsePrice', () => {
  it('reads the price on a card, and the lower one when there are two', () => {
    expect(parsePrice('Northfield Court Classic White sneakers $89')).toBe(89);
    expect(parsePrice('Was $120 now $89.50')).toBe(89.5);
    expect(parsePrice('Arco Chelsea 9')).toBeUndefined();
  });
});

describe('price constraints', () => {
  it('builds the wanted range from the constraints', () => {
    expect(wanted({ max_price: 100 })).toEqual({ min: 0, max: 100 });
    expect(wanted({ min_price: 50, max_price: 150 })).toEqual({ min: 50, max: 150 });
    expect(wanted({ attributes: { colour: 'white' } })).toBeUndefined();
    expect([100, 100.01].map((p) => within(p, { min: 0, max: 100 }))).toEqual([true, false]);
  });

  it('finds the price group by its options', () => expect(priceGroup(groups)?.label).toBe('Price'));

  it('selects an option only on an exact match: "Under $75" is not "under a hundred"', () => {
    expect(exactOption(priceGroup(groups), { min: 0, max: 100 })).toBeUndefined();
    expect(exactOption(priceGroup(groups), { min: 0, max: 75 })?.name).toBe('Under $75');
    expect(exactOption(priceGroup(groups), { min: 75, max: 125 })?.name).toBe('$75 to $125');
  });

  it('finds a cheapest-first sort option', () => {
    expect(sortAscending(snapshot)).toMatchObject({ optionId: 'o1', label: 'Price low to high', already: false });
  });

  it('counts in code, so the LLM never has to', () => {
    expect(countResults(snapshot, { min: 0, max: 100 })).toEqual({ shown: 4, priced: 4, within_price: 3 });
    expect(countResults(snapshot, undefined)).toEqual({ shown: 4, priced: 4 });
  });

  it('counts a list of one: too short for ordinals, but a link with a price is still a result', () => {
    const one: Snapshot = { ...snapshot, rows: [row('e1', 'checkbox', 'White', 'Colour'), row('e20', 'link', 'Sneakers', 'Shop'), row('e10', 'link', 'Pace & Co Daybreak White sneakers $72', 'Results')] };
    expect(countResults(one, { min: 0, max: 75 })).toEqual({ shown: 1, priced: 1, within_price: 1 });
  });

  it('never offers Jev the price group when a price constraint exists', () => {
    const hidden = withoutPriceGroup(snapshot, groups, { max_price: 100 });
    expect(hidden.rows.some((r) => r.group === 'Price')).toBe(false);
    expect(hidden.rows).toHaveLength(snapshot.rows.length - 4);
    expect(withoutPriceGroup(snapshot, groups, { attributes: { colour: 'white' } })).toBe(snapshot);
  });
});

describe('priceLimit: with the LLM away, code reads the limit itself', () => {
  it('reads amounts in digits and in number words', () => {
    expect(['100 dollars', '$1,250', 'a hundred', 'a hundred and fifty', 'seventy five', 'seventy-five bucks', 'one fifty', 'one twenty five', 'two hundred', 'a grand', 'ninety']
      .map(amount)).toEqual([100, 1250, 100, 150, 75, 75, 150, 125, 200, 1000, 90]);
    expect(amount('the banner')).toBeUndefined();
    expect(amount('')).toBeUndefined();
  });
  it('reads upper and lower limits and ranges', () => {
    expect(priceLimit('find me white sneakers under a hundred dollars')).toEqual({ max_price: 100 });
    expect(priceLimit('only the ones under a hundred and fifty')).toEqual({ max_price: 150 });
    expect(priceLimit('show me shoes under $80')).toEqual({ max_price: 80 });
    expect(priceLimit('no more than 120')).toEqual({ max_price: 120 });
    expect(priceLimit('boots over two hundred')).toEqual({ min_price: 200 });
    expect(priceLimit('over 50 and under 100')).toEqual({ min_price: 50, max_price: 100 });
    expect(priceLimit('between fifty and a hundred')).toEqual({ min_price: 50, max_price: 100 });
    expect(priceLimit('between a hundred and fifty and two hundred dollars')).toEqual({ min_price: 150, max_price: 200 });
  });
  it('gives nothing when there is no number to read', () => {
    expect(priceLimit('find me white sneakers')).toBeUndefined();
    expect(priceLimit('open the one under the banner')).toBeUndefined();
  });
});

describe('mentionsPrice: a price limit is routed in code, never to Jev on the single leash', () => {
  it.each([
    'only the ones under a hundred and fifty', 'only the ones under a hundred dollars', 'show me shoes under $80',
    'between fifty and a hundred', 'nothing over 120', 'at most two hundred', 'check under seventy five', 'find me boots for less than 150 bucks',
  ])('sees a price limit in %j', (t) => expect(mentionsPrice(t)).toBe(true));
  it.each([
    'scroll down', 'open the second one', 'go back', 'check white', 'sort by price low to high', 'search for running shoes',
    'size ten and a half', 'find me white shoes', 'open the one under the banner', 'only the cheap ones',
  ])('sees none in %j', (t) => expect(mentionsPrice(t)).toBe(false));
});
