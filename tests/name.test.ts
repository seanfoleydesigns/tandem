// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { accessibleName, groupOf, roleOf } from '../agent/name';

const $ = (sel: string) => document.querySelector(sel)!;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('accessibleName: aria-label, labelledby, <label>, alt/title, placeholder, then text', () => {
  it('prefers aria-label over everything else', () => {
    document.body.innerHTML = `<label for="q">Search shoes</label><input id="q" aria-label="Find" placeholder="Type here">`;
    expect(accessibleName($('#q'))).toBe('Find');
  });

  it('resolves aria-labelledby across several ids', () => {
    document.body.innerHTML = `<span id="a">Remove</span><span id="b">Court Classic</span><button aria-labelledby="a b">x</button>`;
    expect(accessibleName($('button'))).toBe('Remove Court Classic');
  });

  it('uses a <label for>, and a wrapping label without the control’s own text', () => {
    document.body.innerHTML = `
      <label for="sort">Sort by</label><select id="sort"><option>Featured</option><option>Price low to high</option></select>
      <label><input type="checkbox" id="white"> White</label>`;
    expect(accessibleName($('#sort'))).toBe('Sort by');
    expect(accessibleName($('#white'))).toBe('White');
  });

  it('falls back to title, then placeholder', () => {
    document.body.innerHTML = `<button title="Close dialog"></button><input id="p" placeholder="Search shoes">`;
    expect(accessibleName($('button'))).toBe('Close dialog');
    expect(accessibleName($('#p'))).toBe('Search shoes');
  });

  it('uses visible text last, including image alt text, skipping aria-hidden parts', () => {
    document.body.innerHTML = `<a href="/p"><img alt="Arco Plaza Low"><span>White sneakers</span> <span aria-hidden="true">★</span> $95</a>`;
    expect(accessibleName($('a'))).toBe('Arco Plaza Low White sneakers $95');
  });

  it('uses the value of a submit input', () => {
    document.body.innerHTML = `<input type="submit" value="Add to cart">`;
    expect(accessibleName($('input'))).toBe('Add to cart');
  });

  it('collapses whitespace and caps the name at 80 characters', () => {
    document.body.innerHTML = `<button>  lots \n of   space ${'x'.repeat(100)}</button>`;
    const name = accessibleName($('button'));
    expect(name.startsWith('lots of space x')).toBe(true);
    expect(name).toHaveLength(80);
  });
});

describe('roleOf', () => {
  it('maps native elements to roles and respects an explicit role', () => {
    document.body.innerHTML = `<a href="#">x</a><select></select><input type="search"><input type="radio"><input><div role="switch"></div>`;
    expect(Array.from(document.body.children).map(roleOf)).toEqual(['link', 'combobox', 'searchbox', 'radio', 'textbox', 'switch']);
  });
});

describe('groupOf', () => {
  it('uses the fieldset legend', () => {
    document.body.innerHTML = `<fieldset><legend>Size <span>(required)</span></legend><label><input type="radio" id="s"> 10.5</label></fieldset>`;
    expect(groupOf($('#s'))).toBe('Size (required)');
  });

  it('uses a labelled section or nav', () => {
    document.body.innerHTML = `
      <nav aria-label="Categories"><a id="n" href="#">Boots</a></nav>
      <section aria-labelledby="rh"><h2 id="rh">Results</h2><ul><li><a id="c" href="#">Card</a></li></ul></section>`;
    expect(groupOf($('#n'))).toBe('Categories');
    expect(groupOf($('#c'))).toBe('Results');
  });

  it('falls back to the nearest heading before the element, and to nothing when there is none', () => {
    document.body.innerHTML = `<header><input id="q"></header><main><div><h2>Details</h2><p><button id="b">Buy</button></p></div><h2>Later</h2></main>`;
    expect(groupOf($('#b'))).toBe('Details');
    expect(groupOf($('#q'))).toBeUndefined();
  });
});
