import { describe, expect, it } from 'vitest';
import { controlGroups, labelKey, unsetGroups } from '../shared/groups';
import type { ElementRow, Snapshot } from '../shared/types';

const row = (id: string, role: string, name: string, group?: string, state?: string): ElementRow => ({ id, role, name, group, state });
const snap = (rows: ElementRow[]): Snapshot => ({ url: '/', title: '', headings: [], notices: [], rows });

describe('control groups', () => {
  const s = snap([
    row('e1', 'checkbox', 'White', 'Colour', 'checked'), row('e2', 'checkbox', 'Black', 'Colour', 'unchecked'),
    row('e3', 'radio', '10', 'Size (required)', 'unchecked'), row('e4', 'radio', '10.5', 'Size (required)', 'unchecked'),
    row('e5', 'link', 'Court Classic', 'Results'), row('e6', 'link', 'Plaza Low', 'Results'),
    row('e7', 'checkbox', 'Remember me', 'Account', 'unchecked'),
  ]);
  it('groups checkboxes and radios by label, ignoring links and one-control groups', () => {
    expect(controlGroups(s).map((g) => [g.label, g.key, g.set, g.rows.length])).toEqual([['Colour', 'colour', true, 2], ['Size', 'size', false, 2]]);
  });
  it('knows which groups are still unset', () => expect(unsetGroups(s).map((g) => g.key)).toEqual(['size']));
  it('treats "Size (required)" and "size" as the same label', () => expect(labelKey('Size (required)')).toBe(labelKey(' size: ')));
});

describe('a neutral option ("Any price") means the group is not set', () => {
  const price = (any: string, under: string) => snap([
    row('e1', 'radio', 'Any price', 'Price', any), row('e2', 'radio', 'Under $75', 'Price', under), row('e3', 'radio', '$75 to $125', 'Price', 'unchecked'),
  ]);
  it('chosen, it leaves the group unset', () => expect(unsetGroups(price('checked', 'unchecked')).map((g) => g.label)).toEqual(['Price']));
  it('a real option chosen sets the group', () => expect(unsetGroups(price('unchecked', 'checked'))).toEqual([]));
});
