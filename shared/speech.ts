// What code can decide about a transcript without a model: stop words, and "one" or "two".

export const normalise = (s: string) =>
  s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

const STOP_PHRASES = ['stop', 'cancel', 'wait', 'hold on'];
const STOP_WORDS = new Set(['stop', 'cancel', 'wait', 'hold', 'on']);
const FILLER = new Set(['please', 'tandem', 'ok', 'okay', 'now', 'just', 'hey', 'no']);

// Stop is code. Checked on interim transcripts too, so stopping is immediate. It errs toward stopping.
export function isStop(text: string): boolean {
  const words = normalise(text).split(' ').filter((w) => w && !FILLER.has(w));
  if (!words.length) return false;
  const phrase = words.join(' ');
  if (STOP_PHRASES.includes(phrase)) return true;
  if (words.every((w) => STOP_WORDS.has(w))) return true; // "stop stop", "wait wait hold on"
  const first = words[0]!;
  const last = words[words.length - 1]!;
  if ((first === 'stop' || first === 'cancel') && words.length <= 3) return true; // "stop it", "cancel that"
  if (last === 'stop' || last === 'cancel') return true; // "scroll down… stop"
  return phrase.endsWith('hold on');
}

const ONE = new Set(['one', '1', 'first', 'first one', 'the first one', 'number one', 'option one', 'won']);
const TWO = new Set(['two', '2', 'second', 'second one', 'the second one', 'number two', 'option two', 'to', 'too']);

// The reply to "one or two?". Returns the index of the chosen candidate.
export function pickOneOrTwo(text: string): 0 | 1 | undefined {
  const t = normalise(text);
  if (ONE.has(t)) return 0;
  if (TWO.has(t)) return 1;
  return undefined;
}
