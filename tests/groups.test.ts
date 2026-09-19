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
