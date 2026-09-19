import { describe, expect, it } from 'vitest';
import { attributesFromPairs, flatConstraints, mergeConstraints } from '../shared/constraints';

describe('attributesFromPairs: the LLM gives pairs, code builds the record', () => {
  it('normalises names the way control group keys are', () => {
    expect(attributesFromPairs([{ name: 'Colour', value: 'White' }, { name: ' Category ', value: 'Sneakers' }, { name: 'Size (required)', value: '10.5' }]))
      .toEqual({ colour: 'White', category: 'Sneakers', size: '10.5' });
  });
  it('drops empties, keeps both values of a property stated twice, and never takes a price', () => {
    expect(attributesFromPairs([{ name: '', value: 'x' }, { name: 'topic', value: ' ' }, { name: 'topic', value: 'rust' }, { name: 'Topic', value: 'go' }, { name: 'Max price', value: '100' }]))
      .toEqual({ topic: 'rust, go' });
  });
  it('a price or a Constraints field never becomes an attribute, however it is spelled', () => {
    expect(attributesFromPairs([{ name: 'max_price', value: 'cheap' }, { name: 'price_max', value: '50' }, { name: 'search_query', value: 'x' }, { name: 'Visual prefs', value: 'y' }, { name: 'colour', value: 'White' }]))
      .toEqual({ colour: 'White' });
  });
});

describe('mergeConstraints: a refinement keeps what it does not restate', () => {
  const last = { attributes: { category: 'Sneakers', colour: 'White' }, max_price: 100 };
  it('a new price keeps the attributes', () => expect(mergeConstraints(last, { max_price: 150 })).toEqual({ attributes: { category: 'Sneakers', colour: 'White' }, max_price: 150 }));
  it('a new colour replaces only the colour', () => expect(mergeConstraints(last, { attributes: { colour: 'Black' } })).toEqual({ attributes: { category: 'Sneakers', colour: 'Black' }, max_price: 100 }));
  it('nothing stated changes nothing', () => expect(mergeConstraints(last, {})).toEqual(last));
  it('no attributes on either side leaves none', () => expect(mergeConstraints({ max_price: 80 }, { min_price: 20 })).toEqual({ max_price: 80, min_price: 20 }));
});

describe('flatConstraints: what Jev reads', () => {
  it('shows attributes as plain top-level keys', () => {
    expect(flatConstraints({ attributes: { category: 'Sneakers', colour: 'White' }, max_price: 100 })).toEqual({ category: 'Sneakers', colour: 'White', max_price: 100 });
    expect(flatConstraints(undefined)).toEqual({});
  });
});
