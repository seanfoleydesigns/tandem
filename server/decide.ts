import { z } from 'zod';
import { candidates, rowLine } from '../shared/candidates';
import { DECIDE_RETRIES, DECIDE_TIMEOUT_MS, LABEL_STYLE } from '../shared/config';
import { kindQuestion, operationQuestionSingle, targetQuestions, typedSpanQuestion, type ChoiceQuestion } from '../shared/questions';
import { wordSpans } from '../shared/spans';
import type { DecideRequest, DecideResponse, Head, Heads } from '../shared/types';
import { ask } from './jev';

const row = z.object({
  id: z.string(), role: z.string(), name: z.string(),
  state: z.string().optional(), group: z.string().optional(), ordinal: z.string().optional(),
  offscreen: z.enum(['above', 'below']).optional(), required: z.boolean().optional(),
  options: z.array(z.object({ id: z.string(), label: z.string(), selected: z.boolean() })).optional(),
});

export const decideRequest = z.object({
  leash: z.enum(['single', 'task']),
  utterance: z.string().max(2000).optional(),
  goal: z.string().optional(),
  constraints: z.record(z.string(), z.unknown()).optional(),
  prefs: z.array(z.object({ label: z.string(), value: z.string(), scope: z.string(), ts: z.number() })).default([]),
  history: z.array(z.record(z.string(), z.unknown())).default([]),
  pending: z.object({ group: z.string() }).optional(),
  snapshot: z.object({
    url: z.string(), title: z.string(), headings: z.array(z.string()), notices: z.array(z.string()),
    rows: z.array(row).max(120), focused: z.string().optional(),
  }),
  labelStyle: z.enum(['described', 'ids']).optional(),
});

const TEXT_ROLES = new Set(['textbox', 'searchbox']);

// One Jev request per decision cycle: every head at once, all over the same state.
export async function decide(req: DecideRequest): Promise<DecideResponse> {
  if (req.leash !== 'single') throw new Error('The task leash arrives in M3.');
  const labelStyle = req.labelStyle ?? LABEL_STYLE;
  const { snapshot } = req;
  const utterance = req.utterance ?? '';

  // Send only what the questions name. Rows are one line of text each.
  const state = {
    utterance,
    ...(req.pending ? { pending: req.pending } : {}),
    snapshot: {
      url: snapshot.url,
      title: snapshot.title,
      headings: snapshot.headings,
      notices: snapshot.notices,
      ...(snapshot.focused ? { focused: snapshot.focused } : {}),
      rows: snapshot.rows.map(rowLine),
    },
  };

  const focused = snapshot.rows.find((r) => r.id === snapshot.focused);
  const questions: Record<string, ChoiceQuestion> = {
    kind: kindQuestion({ hasPending: !!req.pending, textboxFocused: !!focused && TEXT_ROLES.has(focused.role) }),
    operation: operationQuestionSingle(),
    ...targetQuestions(candidates(snapshot), labelStyle),
  };
  const spans = wordSpans(utterance);
  if (spans.length) questions.typed_span = typedSpanQuestion(spans);

  const r = await ask(state, questions, { timeout: DECIDE_TIMEOUT_MS, retry: { maxRetries: DECIDE_RETRIES[req.leash] } });

  const heads: Record<string, Head> = {};
  for (const [name, a] of Object.entries(r.answers)) {
    heads[name] = { choice: a.choice, confidence: a.confidence, probabilities: a.probabilities };
  }
  return { model: r.model, ms: r.ms, usage: r.usage, labelStyle, heads: heads as Heads };
}
