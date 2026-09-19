import { describe, expect, it } from 'vitest';
import { attributesFromPairs, correctAttributes, flatConstraints, mergeConstraints } from '../shared/constraints';

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

describe('correctAttributes: code corrects the LLM with the words of the page, and never adds any', () => {
  const page = { categories: ['Sneakers', 'Boots', 'Running (current)', 'Loafers'], filters: [{ group: 'Colour', options: ['White', 'Black', 'Grey'] }, { group: 'Size', options: ['10', '10.5', '11'] }, { group: 'Price', options: ['Under $75', '$75 to $125'] }] };
  it('puts back the section the goal literally names when the LLM picked another section of the page', () => {
    expect(correctAttributes({ category: 'Running', colour: 'White' }, 'find me white sneakers', page)).toEqual({ category: 'Sneakers', colour: 'White' });
    expect(correctAttributes({ category: 'Sneakers' }, 'find me a black boot', page)).toEqual({ category: 'Boots' });
  });
  it('leaves the LLM alone when it is right, when the goal says two, and when the word is fuzzy', () => {
    expect(correctAttributes({ category: 'Sneakers' }, 'find me white sneakers', page)).toEqual({ category: 'Sneakers' });
    expect(correctAttributes({ category: 'Running' }, 'find me white running sneakers', page)).toEqual({ category: 'Running' });
    expect(correctAttributes({ category: 'Sneakers' }, 'find me some trainers', page)).toEqual({ category: 'Sneakers' });
    expect(correctAttributes({ topic: 'rust' }, 'show me stories about rust', page)).toEqual({ topic: 'rust' }); // not one of the page's groups
  });
  it('never adds an attribute: ordinary words are link names too', () => {
    const news = { categories: ['Home', 'News', 'Sport', 'Business', 'Culture', 'Search', 'Help', 'About'], filters: [] };
    expect(correctAttributes({}, 'find the article about business in china', news)).toEqual({});
    expect(correctAttributes({}, 'find me the new iphone review', news)).toEqual({});
    expect(correctAttributes({ category: 'Business' }, 'find me the new iphone review', news)).toEqual({ category: 'Business' }); // "new" does not say "News"
    expect(correctAttributes({}, 'find me white sneakers under $75', page)).toEqual({}); // and never a price
  });
});
