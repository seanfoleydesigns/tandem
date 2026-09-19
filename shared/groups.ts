// Control groups: sets of checkboxes, radios or switches that share a label ("Size", "Colour").
// Pure. The question card, the needs_* Nouls, memory and the "Narrow by" chips are all built from these.
import type { ElementRow, Snapshot } from './types';

const CONTROL_ROLES = new Set(['radio', 'checkbox', 'switch', 'option']);

// "Size (required)" and "size" are the same label.
export const labelKey = (s: string) =>
  s.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[*:]/g, ' ').replace(/\s+/g, ' ').trim();

export const cleanLabel = (s: string) => s.replace(/\([^)]*\)/g, ' ').replace(/[*:]/g, ' ').replace(/\s+/g, ' ').trim();

export type ControlGroup = { label: string; key: string; rows: ElementRow[]; set: boolean };

// "Any price", "All brands": the option that means no filter. Chosen, it leaves the group unset.
export const isNeutral = (row: ElementRow) => /^(any|all)\b/i.test(row.name);
export const isChosen = (row: ElementRow) => /(^|, )(checked|selected)($|,)/.test(row.state ?? '') && !isNeutral(row);

export function controlGroups(snapshot: Snapshot): ControlGroup[] {
  const byKey = new Map<string, ControlGroup>();
  for (const row of snapshot.rows) {
    if (!row.group || !CONTROL_ROLES.has(row.role)) continue;
    const key = labelKey(row.group);
    const g = byKey.get(key) ?? { label: cleanLabel(row.group), key, rows: [], set: false };
    g.rows.push(row);
    if (isChosen(row)) g.set = true;
    byKey.set(key, g);
  }
  return [...byKey.values()].filter((g) => g.rows.length >= 2);
}

export const unsetGroups = (snapshot: Snapshot) => controlGroups(snapshot).filter((g) => !g.set);
