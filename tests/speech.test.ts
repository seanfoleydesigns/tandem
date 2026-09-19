import { describe, expect, it } from 'vitest';
import { isStop, normalise, pickOneOrTwo } from '../shared/speech';

describe('normalise', () => {
  it('makes an interim and a final transcript comparable', () => {
    expect(normalise('Open the second one.')).toBe(normalise('open the second one'));
    expect(normalise('  Sort by price,  low to high! ')).toBe('sort by price low to high');
  });
});

describe('isStop: stop is code', () => {
  it.each(['stop', 'Stop.', 'cancel', 'wait', 'hold on', 'Hold on!', 'stop stop', 'please stop', 'okay stop now', 'no no stop', 'stop it', 'cancel that', 'scroll down stop', 'wait wait hold on'])(
    'stops on %j', (t) => expect(isStop(t)).toBe(true),
  );
  it.each(['', 'scroll down', 'open the second one', 'wait for the results to load', 'stop the video on this page please', 'one', 'search for bus stops near me'])(
    'does not stop on %j', (t) => expect(isStop(t)).toBe(false),
  );
});

describe('pickOneOrTwo', () => {
  it('reads one and two in the ways people say them', () => {
    expect(['one', 'One.', 'the first one', 'number one', '1'].map(pickOneOrTwo)).toEqual([0, 0, 0, 0, 0]);
    expect(['two', 'Two!', 'second', 'the second one', 'too', '2'].map(pickOneOrTwo)).toEqual([1, 1, 1, 1, 1, 1]);
  });
  it('returns nothing for anything else, so it is treated as a new command', () => {
    expect(pickOneOrTwo('scroll down')).toBeUndefined();
    expect(pickOneOrTwo('open the second one please')).toBeUndefined();
  });
});
