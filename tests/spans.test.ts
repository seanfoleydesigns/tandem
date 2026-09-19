import { describe, expect, it } from 'vitest';
import { wordSpans } from '../shared/spans';

describe('wordSpans', () => {
  it('generates every contiguous span, longest first', () => {
    expect(wordSpans('search for running shoes')).toEqual([
      'search for running shoes',
      'search for running', 'for running shoes',
      'search for', 'for running', 'running shoes',
      'search', 'for', 'running', 'shoes',
    ]);
  });

  it('strips punctuation at word edges but keeps it inside words', () => {
    expect(wordSpans('type "ten-and-a-half", please.')).toContain('ten-and-a-half');
    expect(wordSpans('Search for boots!')).toContain('boots');
  });

  it('deduplicates repeated spans', () => {
    const out = wordSpans('red red red');
    expect(out).toEqual(['red red red', 'red red', 'red']);
  });

  it('caps the list at 200 by default and keeps the longest spans', () => {
    const words = Array.from({ length: 30 }, (_, i) => `w${i}`).join(' ');
    const out = wordSpans(words);
    expect(out).toHaveLength(200);
    expect(out[0]).toBe(words);
  });

  it('covers a 19-word utterance completely under the cap', () => {
    const words = Array.from({ length: 19 }, (_, i) => `w${i}`).join(' ');
    expect(wordSpans(words)).toHaveLength(190);
  });

  it('returns nothing for an empty utterance', () => expect(wordSpans('  ')).toEqual([]));
});
