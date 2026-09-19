// Thresholds and caps. Tune with the inspector; note every change in NOTES.md.

// Rules 2, 3 and 5 gate on Jev's `confidence`. Rule 4 gates on the top probability.
// The two are different numbers: confidence summarises the shape of the whole distribution.
export const OP_MIN = 0.5; // operation.confidence below this: ignore (drive) or STUCK (task)
// Raised from 0.5 in M2: clear commands score 0.92 and up, ambiguous ones 0.46 to 0.65 (NOTES.md).
export const TARGET_MIN = 0.75; // target.confidence below this, or a choice of `none`: low confidence
export const AMBIG_TOP = 0.55; // top probability below this: look for a shared group (rule 4)
export const AMBIG_MASS = 0.8; // probability mass the candidate set must cover (rule 4)

// Fit check: when a target is uncertain, one follow-up request asks a yes/no question per candidate
// in the same group. Jev does not split a Choice across equally good candidates, so this is how we
// learn which ones fit.
export const FIT_MIN = 0.5; // a candidate fits when its Noul reaches this
export const FIT_POOL = 40; // candidates checked at most

// kind is biased toward ACTION, because a wrong TASK is the costlier mistake. An utterance is routed
// to a task only when TASK's own probability reaches this. Below it, the single leash runs.
export const TASK_MIN = 0.7;
export const DICTATION_MIN = 0.6; // DICTATION has a floor too: below it the utterance is treated as a command

// Asking. One needs_* Noul per unset control group rides on every task-leash decide request.
// A group is asked about when its Noul reaches this and it has not been asked or skipped in this task.
export const ASK_MIN = 0.7;
export const MAX_UNCLEAR = 2; // unclear answers to one question before handing back

export const MAX_STEPS = 25;
export const MAX_TASK_MS = 60_000;

export const MAX_ROWS = 120; // snapshot rows, in reading order
export const MAX_SPANS = 200; // typed_span candidates, longest first (hard API cap is 255 labels)

// Jev calls on the hot path fail fast instead of retrying.
export const DECIDE_TIMEOUT_MS = 2500;
export const DECIDE_RETRIES = { single: 0, task: 1 } as const;

// Voice
export const INTERIM_STABLE_MS = 300; // fire a speculative decide when an interim transcript has not changed for this long
export const ECHO_GUARD_MS = 250; // keep recognition paused this long after the agent stops speaking
export const WARM_EVERY_MS = 3000; // an idle connection to Jev closes after a few seconds; a cold one costs about 180 ms

// How target heads describe their candidates. A/B this in the inspector.
//   described: each label carries `role · name · state · group · ordinal` as its criteria description
//   ids:       labels are bare ids (null descriptions); the rows are held once in state
export type LabelStyle = 'described' | 'ids';
export const LABEL_STYLE: LabelStyle = 'described';
