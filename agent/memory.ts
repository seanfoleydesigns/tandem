// Preferences the user has told us, kept in localStorage and scoped to the site they were given on.
import { labelKey } from '../shared/groups';
import type { Preference } from '../shared/types';

const KEY = 'tandem.prefs';
const scope = () => location.hostname;

function readAll(): Preference[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as Preference[]) : [];
  } catch {
    return [];
  }
}

function writeAll(prefs: Preference[]) {
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* storage may be blocked */ }
}

export const listPrefs = (): Preference[] => readAll().filter((p) => p.scope === scope());

export function savePref(label: string, value: string) {
  const rest = readAll().filter((p) => !(p.scope === scope() && labelKey(p.label) === labelKey(label)));
  writeAll([...rest, { label, value, scope: scope(), ts: Date.now() }]);
}

export function deletePref(label: string) {
  writeAll(readAll().filter((p) => !(p.scope === scope() && labelKey(p.label) === labelKey(label))));
}
