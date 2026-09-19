// Typing on the task leash is for searching, nothing else. Pure.
// TYPE is offered only when there are words to type (the LLM's search_query, or the goal's own words when the
// parse is unavailable), only into a search-like field, and only once per task for the same words.
import { candidates } from './candidates';
import { normalise } from './speech';
import type { ActionRecord, ElementRow, Snapshot } from './types';

// Search-like: role searchbox (that covers type=search), or a text field whose name, placeholder or label
// says search. Never a password or payment field.
export const isSearchRow = (r: ElementRow): boolean =>
  !r.sensitive && (r.role === 'searchbox' || (r.role === 'textbox' && /\bsearch/i.test(r.name)));

// The page's search field: the first one on screen, else the first one anywhere.
export function searchField(snapshot: Snapshot): ElementRow | undefined {
  const fields = candidates(snapshot).type.filter(isSearchRow);
  return fields.find((r) => !r.offscreen) ?? fields[0];
}

export const alreadySearched = (history: ActionRecord[], text: string): boolean =>
  history.some((a) => a.op === 'TYPE' && a.outcome !== 'failed' && normalise(a.value ?? '') === normalise(text));

// Where the words come from, or nothing when TYPE must not be offered at all.
export function taskTyping(opts: { snapshot: Snapshot; history: ActionRecord[]; query?: string; parsed: boolean }): 'query' | 'span' | undefined {
  if (!searchField(opts.snapshot)) return undefined;
  if (opts.query) return alreadySearched(opts.history, opts.query) ? undefined : 'query';
  if (opts.parsed) return undefined; // the LLM read the goal and found nothing to search for
  return opts.history.some((a) => a.op === 'TYPE') ? undefined : 'span'; // one search per task on the fallback
}
