// Types shared by the server and the agent. No imports from agent/, store/ or any SDK.
import type { LabelStyle } from './config';

export type ElementRow = {
  id: string; // "e7", never reused across snapshots
  role: string;
  name: string; // accessible name, 80 chars max
  state?: string; // "checked" | "unchecked" | "selected: Price low to high" | "value: …" | "expanded"
  group?: string; // fieldset legend, ARIA group label, or nearest section heading
  ordinal?: string; // "second visible (item 10 of 24 in Results)", computed in code
  offscreen?: 'above' | 'below'; // set when less than half of the element is in the viewport
  required?: boolean;
  options?: { id: string; label: string; selected: boolean }[]; // native <select> only
};

export type Snapshot = {
  url: string;
  title: string;
  headings: string[]; // visible h1 to h3
  notices: string[]; // result counts, alerts, validation errors, dialog titles
  rows: ElementRow[];
  focused?: string; // id of the focused row
};

export type Leash = 'single' | 'task';

export type Operation =
  | 'CLICK' | 'TYPE' | 'SELECT' | 'SCROLL_DOWN' | 'SCROLL_UP' | 'GO_BACK' | 'ASK_USER' | 'DONE' | 'STUCK';

export type Kind = 'ACTION' | 'TASK' | 'ANSWER' | 'DICTATION' | 'STOP' | 'NOT_FOR_ME';

export type Preference = { label: string; value: string; scope: string; ts: number };

export type Constraints = {
  category?: string; colour?: string; max_price?: number; min_price?: number;
  search_query?: string; visual_prefs?: string[];
};

// Ids change with every snapshot, so a target is remembered by what it was, not by its id.
export type ActionRecord = {
  op: Operation;
  target?: string; // "role · name · group"
  value?: string; // typed text or chosen option
  outcome: 'changed' | 'no_change' | 'failed';
  usedPref?: string;
  ts: number;
};

// One Jev Choice answer.
export type Head = {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};

export type Heads = {
  kind?: Head; // single leash only
  operation: Head;
  click_target?: Head; // a target head is left out when the page offers no candidate for it
  type_target?: Head;
  select_target?: Head;
  typed_span?: Head; // single leash only
};

export type DecideRequest = {
  leash: Leash;
  utterance?: string;
  goal?: string;
  constraints?: Constraints;
  prefs: Preference[];
  history: ActionRecord[];
  pending?: { group: string };
  snapshot: Snapshot;
  asked?: string[]; // group keys already asked or skipped in this task; they get no needs_* Noul
  labelStyle?: LabelStyle; // inspector override for A/B runs
};

export type JevUsage = { input_tokens: number; output_tokens: number };

export type DecideResponse = {
  model: string;
  ms: number; // t2 − t1, measured on the server around the Jev call
  usage: JevUsage;
  labelStyle: LabelStyle;
  heads: Heads;
  needs?: Record<string, number>; // task leash: group key -> personal × (1 − given): the user must supply its value
  needsParts?: Record<string, { personal: number; given: number }>; // the two Nouls behind each needs value
};

export type HealthResponse =
  | { ok: true; model: string; ms: number; usage: JevUsage; answer: Head }
  | { ok: false; status?: number; error: string };

export type ApiError = { ok: false; status?: number; error: string };

// Fit check: which of these candidates could the utterance be referring to? One Noul each.
export type FitsRequest = { utterance: string; rows: ElementRow[] };
export type FitsResponse = { model: string; ms: number; usage: JevUsage; fits: Record<string, number> };

// Answer matching: which option does the spoken answer mean? One Choice over the option names.
export type MatchRequest = { group: string; options: string[]; answer: string };
export type MatchResponse = { model: string; ms: number; usage: JevUsage; head: Head };
