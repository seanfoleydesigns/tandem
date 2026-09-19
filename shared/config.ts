// Thresholds and caps. Tune with the inspector; note every change in NOTES.md.

// Rules 2, 3 and 5 gate on Jev's `confidence`. Rule 4 gates on the top probability.
// The two are different numbers: confidence summarises the shape of the whole distribution.
export const OP_MIN = 0.5; // operation.confidence below this: ignore (drive) or STUCK (task)
export const TARGET_MIN = 0.5; // target.confidence below this, or a choice of `none`: low confidence
export const AMBIG_TOP = 0.55; // top probability below this: look for a shared group (rule 4)
export const AMBIG_MASS = 0.8; // probability mass the candidate set must cover (rule 4)

export const MAX_STEPS = 25;
export const MAX_TASK_MS = 60_000;

export const MAX_ROWS = 120; // snapshot rows, in reading order
export const MAX_SPANS = 200; // typed_span candidates, longest first (hard API cap is 255 labels)

// Jev calls on the hot path fail fast instead of retrying.
export const DECIDE_TIMEOUT_MS = 2500;
export const DECIDE_RETRIES = { single: 0, task: 1 } as const;

// How target heads describe their candidates. A/B this in the inspector.
//   described: each label carries `role · name · state · group · ordinal` as its criteria description
//   ids:       labels are bare ids (null descriptions); the rows are held once in state
export type LabelStyle = 'described' | 'ids';
export const LABEL_STYLE: LabelStyle = 'described';
