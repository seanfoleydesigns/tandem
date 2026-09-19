import { describe, expect, it } from 'vitest';
import { planSlate, setOptions } from '../shared/slate';
import type { ElementRow, Preference, Snapshot } from '../shared/types';

const row = (id: string, role: string, name: string, group: string, state: string): ElementRow => ({ id, role, name, group, state });
// Sean's real-voice run: filters piled up across tasks, on the Running page, giving 0 results.
const snapshot: Snapshot = {
  url: '/?category=running', title: 'Running shoes', headings: [], notices: ['0 results'],
  rows: [
    row('e1', 'checkbox', 'White', 'Colour', 'checked'), row('e2', 'checkbox', 'Black', 'Colour', 'unchecked'),
    row('e3', 'checkbox', 'Grey', 'Colour', 'checked'), row('e4', 'checkbox', 'Brown', 'Colour', 'checked'),
    row('e5', 'radio', '10', 'Size', 'unchecked'), row('e6', 'radio', '10.5', 'Size', 'checked'),
    row('e7', 'checkbox', 'Arco', 'Brand', 'checked'), row('e8', 'checkbox', 'Lumen', 'Brand', 'unchecked'),
    row('e9', 'radio', 'Under $75', 'Price', 'unchecked'), row('e10', 'radio', '$75 to $125', 'Price', 'checked'),
  ],
};
const prefs: Preference[] = [{ label: 'Size', value: '10.5', scope: 'localhost', ts: 0 }];
const set = setOptions(snapshot);

describe('clean slate', () => {
  it('finds every filter option that is on', () => {
    expect(set.map((o) => `${o.group}: ${o.option}`)).toEqual(['Colour: White', 'Colour: Grey', 'Colour: Brown', 'Size: 10.5', 'Brand: Arco', 'Price: $75 to $125']);
  });

  it('new search: clears what the goal does not ask for, keeps what it asks for and the saved preference', () => {
    const plan = planSlate(set, { refines: 0.25, namesProduct: 0.94, asks: { e1: 0.87, e3: 0.03, e4: 0.02, e6: 0.03, e7: 0.03, e10: 0.04 } }, prefs);
    expect(plan.refinement).toBe(false);
    expect(plan.clear.map((o) => o.option)).toEqual(['Grey', 'Brown', 'Arco']);
    expect(plan.keptPrefs.map((o) => o.option)).toEqual(['10.5']);
    expect(plan.stuck.map((o) => o.option)).toEqual(['$75 to $125']); // a radio cannot be clicked off
  });

  it('refinement: keeps everything', () => {
    const plan = planSlate(set, { refines: 0.9, namesProduct: 0.13, asks: {} }, prefs);
    expect(plan).toMatchObject({ refinement: true, clear: [], stuck: [] });
    expect(plan.keptPrefs.map((o) => o.option)).toEqual(['10.5']);
  });

  it('a goal that names a product is a new search even when some set filters match it', () => {
    // "I need grey running shoes from Arco": refines 0.55, names a product 0.93
    const plan = planSlate(set, { refines: 0.55, namesProduct: 0.93, asks: { e3: 0.93, e7: 0.93 } }, prefs);
    expect(plan.refinement).toBe(false);
    expect(plan.clear.map((o) => o.option)).toEqual(['White', 'Brown']);
  });

  it('a list of actions is neither a refinement nor a search, so nothing is cleared', () => {
    const plan = planSlate(set, { refines: 0.2, namesProduct: 0.15, asks: {} }, prefs);
    expect(plan).toMatchObject({ refinement: false, clear: [], stuck: [] });
  });

  it('without a saved preference the size is just another leftover, and it is a radio', () => {
    const plan = planSlate(set, { refines: 0.1, namesProduct: 0.9, asks: { e1: 0.9 } }, []);
    expect(plan.keptPrefs).toEqual([]);
    expect(plan.stuck.map((o) => o.option)).toEqual(['10.5', '$75 to $125']);
  });
});
