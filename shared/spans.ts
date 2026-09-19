import { MAX_SPANS } from './config';

// Jev cannot write, so the text to type must come from the user's own words.
// Every contiguous word span of the utterance, deduplicated, longest first.
export function wordSpans(utterance: string, cap: number = MAX_SPANS): string[] {
  const words = utterance
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')) // drop punctuation at word edges
    .filter(Boolean);

  const seen = new Set<string>();
  const out: string[] = [];
  for (let len = words.length; len >= 1; len--) {
    for (let start = 0; start + len <= words.length; start++) {
      const span = words.slice(start, start + len).join(' ');
      if (seen.has(span)) continue;
      seen.add(span);
      out.push(span);
      if (out.length >= cap) return out;
    }
  }
  return out;
}
