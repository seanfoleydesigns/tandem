// Preferences the user has told us, scoped to the site they were given on.
import { labelKey } from '../shared/groups';
import type { Preference } from '../shared/types';
import { env } from './env';

const scope = () => location.hostname;

// Where they are kept is the environment's business: localStorage on a page, chrome.storage.local as an extension.
const readAll = (): Preference[] => env().prefs.read();
const writeAll = (prefs: Preference[]) => env().prefs.write(prefs);

export const listPrefs = (): Preference[] => readAll().filter((p) => p.scope === scope());

export function savePref(label: string, value: string) {
  const rest = readAll().filter((p) => !(p.scope === scope() && labelKey(p.label) === labelKey(label)));
  writeAll([...rest, { label, value, scope: scope(), ts: Date.now() }]);
}

export function deletePref(label: string) {
  writeAll(readAll().filter((p) => !(p.scope === scope() && labelKey(p.label) === labelKey(label))));
}
