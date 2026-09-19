// Clean slate. A new search starts from the filters the goal asks for, not from whatever the last task
// left behind. Jev judges (is this a refinement? does the goal ask for this option?); code decides what to clear.
import { KEEP_MIN, REFINES_MIN } from './config';
import { controlGroups, isChosen, labelKey } from './groups';
import { normalise } from './speech';
import type { ElementRow, Preference, Snapshot } from './types';

export type SetOption = { id: string; group: string; key: string; option: string; row: ElementRow };


// Every filter option that is currently on, in reading order.
export function setOptions(snapshot: Snapshot): SetOption[] {
  return controlGroups(snapshot).flatMap((g) =>
    g.rows.filter(isChosen).map((row) => ({ id: row.id, group: g.label, key: g.key, option: row.name, row })));
}

export type SlateAnswers = { refines: number; namesProduct: number; asks: Record<string, number> }; // asks: option id -> Noul

export type SlatePlan = {
  refinement: boolean;
  clear: SetOption[]; // to switch off
  stuck: SetOption[]; // the goal does not ask for them, but a radio cannot be switched off by clicking it
  keptPrefs: SetOption[]; // already set to a saved preference's value: kept, and said so
};

export function planSlate(set: SetOption[], a: SlateAnswers, prefs: Preference[]): SlatePlan {
  const isPref = (o: SetOption) => prefs.some((p) => labelKey(p.label) === o.key && normalise(p.value) === normalise(o.option));
  const keptPrefs = set.filter(isPref);
  // A refinement keeps everything. "Only the cheap ones" refines; "find me white sneakers" names a product.
  const refinement = a.refines >= REFINES_MIN && a.refines > a.namesProduct;
  // Only a new search clears: the goal names a kind of product to look for. A list of actions such as
  // "open a product, pick a size and add it to the cart" is neither, and leaves the page as it is.
  const newSearch = !refinement && a.namesProduct >= KEEP_MIN;
  if (!newSearch) return { refinement, clear: [], stuck: [], keptPrefs };
  const unwanted = set.filter((o) => !isPref(o) && (a.asks[o.id] ?? 0) < KEEP_MIN);
  return {
    refinement,
    clear: unwanted.filter((o) => o.row.role !== 'radio'),
    stuck: unwanted.filter((o) => o.row.role === 'radio'),
    keptPrefs,
  };
}
