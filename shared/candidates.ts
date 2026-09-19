import type { ElementRow, Snapshot } from './types';

// Which rows each target head may choose from. The server builds labels from this, and the agent
// builds the same map to get back from a label to an element. A label is only ever looked up.

export const NONE = 'none';
export const NO_SPAN = '(none)'; // spans have their edge punctuation stripped, so this cannot collide

const TEXT_ROLES = new Set(['textbox', 'searchbox', 'spinbutton']);

export type SelectCandidate = { label: string; rowId: string; optionId: string; row: ElementRow; optionLabel: string };

export type Candidates = {
  click: ElementRow[];
  type: ElementRow[];
  select: SelectCandidate[];
};

export function candidates(snapshot: Snapshot): Candidates {
  const click: ElementRow[] = [];
  const type: ElementRow[] = [];
  const select: SelectCandidate[] = [];
  for (const row of snapshot.rows) {
    if (row.options) {
      for (const o of row.options) {
        select.push({ label: `${row.id}_${o.id}`, rowId: row.id, optionId: o.id, row, optionLabel: o.label });
      }
    } else if (row.sensitive) continue; // a password or payment field is never a target
    else if (TEXT_ROLES.has(row.role)) type.push(row);
    else click.push(row);
  }
  return { click, type, select };
}

// "role · name · state · group · ordinal". Rows outside the viewport say so, so visible rows win ties.
export function describeRow(row: ElementRow): string {
  const parts = [row.role, row.name || '(no name)'];
  if (row.state) parts.push(row.state);
  if (row.required) parts.push('required');
  if (row.group) parts.push(row.group);
  if (row.ordinal) parts.push(row.ordinal);
  else if (row.offscreen) parts.push(`off-screen ${row.offscreen}`);
  return parts.join(' · ');
}

// One line of state per row. Dropdown options are listed with the labels the select head uses.
export function rowLine(row: ElementRow): string {
  const options = row.options
    ? ` · options: ${row.options.map((o) => `${row.id}_${o.id} ${o.label}`).join('; ')}`
    : '';
  return `${row.id} | ${describeRow(row)}${options}`;
}

// The group a label belongs to, for the ambiguity rule.
export function groupsByLabel(c: Candidates): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const r of [...c.click, ...c.type]) out[r.id] = r.group;
  for (const s of c.select) out[s.label] = s.row.group;
  return out;
}
