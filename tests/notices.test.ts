import { describe, expect, it } from 'vitest';
import { noMatches } from '../shared/notices';

describe('noMatches: code reads the result notice', () => {
  it.each(['0 results', 'Showing 0 results', 'No results found', 'No matches', 'Sorry, nothing matches these filters', '0 items'])(
    'sees an empty list in %j', (n) => expect(noMatches([n])).toBe(true),
  );
  it.each(['Showing 8 of 8 results', '10 results', 'Showing 20 of 120 results', '1,000 results', 'Added 1 × size 10.5 to your cart.'])(
    'does not see one in %j', (n) => expect(noMatches([n])).toBe(false),
  );
  it('checks every notice', () => expect(noMatches(['Cookie settings saved', '0 results'])).toBe(true));
});
