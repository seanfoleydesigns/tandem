// Types shared by the server and the agent. No imports from agent/, store/ or any SDK.

export type ElementRow = {
  id: string; // "e7", never reused across snapshots
  role: string;
  name: string; // accessible name, 80 chars max
  state?: string; // "checked" | "unchecked" | "selected: Price low to high" | "value: …" | "expanded"
  group?: string; // fieldset legend, ARIA group label, or nearest section heading
  ordinal?: string; // "second visible (tenth of 24 in Results)", computed in code
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

// One Jev Choice answer.
export type Head = {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};

export type JevUsage = { input_tokens: number; output_tokens: number };

export type HealthResponse =
  | { ok: true; model: string; ms: number; usage: JevUsage; answer: Head }
  | { ok: false; status?: number; error: string };
