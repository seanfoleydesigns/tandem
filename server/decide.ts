import type { EntryType } from '@typesafe-ai/sdk';
import { z } from 'zod';
import { candidates, describeRow, rowLine } from '../shared/candidates';
import { DECIDE_RETRIES, DECIDE_TIMEOUT_MS, FIT_POOL, LABEL_STYLE } from '../shared/config';
import { unsetGroups } from '../shared/groups';
import {
  fitQuestions, kindQuestion, matchQuestion, needsQuestions, operationQuestionSingle, operationQuestionTask,
  targetQuestions, typedSpanQuestion, type ChoiceQuestion, type NoulQuestion,
} from '../shared/questions';
import { wordSpans } from '../shared/spans';
import type { DecideRequest, DecideResponse, FitsRequest, FitsResponse, Head, Heads, MatchRequest, MatchResponse } from '../shared/types';
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
  goal: z.string().max(2000).optional(),
  constraints: z.record(z.string(), z.unknown()).optional(),
  prefs: z.array(z.object({ label: z.string(), value: z.string(), scope: z.string(), ts: z.number() })).default([]),
  history: z.array(z.record(z.string(), z.unknown())).default([]),
  pending: z.object({ group: z.string() }).optional(),
  snapshot: z.object({
    url: z.string(), title: z.string(), headings: z.array(z.string()), notices: z.array(z.string()),
    rows: z.array(row).max(120), focused: z.string().optional(),
  }),
  asked: z.array(z.string()).optional(),
  labelStyle: z.enum(['described', 'ids']).optional(),
});

const TEXT_ROLES = new Set(['textbox', 'searchbox']);
const PERSONAL = 'personal_'; // question id prefixes; ids are never sent to the model
const GIVEN = 'given_';

// One Jev request per decision cycle: every head at once, all over the same state.
export async function decide(req: DecideRequest): Promise<DecideResponse> {
  const labelStyle = req.labelStyle ?? LABEL_STYLE;
  const { snapshot } = req;
  const task = req.leash === 'task';

  // Send only what the questions name. Rows are one line of text each.
  const page = {
    url: snapshot.url,
    title: snapshot.title,
    headings: snapshot.headings,
    notices: snapshot.notices,
    ...(snapshot.focused ? { focused: snapshot.focused } : {}),
    rows: snapshot.rows.map(rowLine),
  };
  const state = task
    ? {
        goal: req.goal ?? '',
        constraints: req.constraints ?? {},
        prefs: req.prefs.map((p) => ({ label: p.label, value: p.value })),
        history: req.history,
        snapshot: page,
      }
    : { utterance: req.utterance ?? '', ...(req.pending ? { pending: req.pending } : {}), snapshot: page };

  const questions: Record<string, ChoiceQuestion | NoulQuestion> = {
    ...targetQuestions(candidates(snapshot), labelStyle, req.leash),
  };
  const groupKeys: string[] = [];
  if (task) {
    questions.operation = operationQuestionTask();
    // Two Nouls per unset control group that has not been asked or skipped in this task.
    for (const g of unsetGroups(snapshot)) {
      if (req.asked?.includes(g.key)) continue;
      const q = needsQuestions({ label: g.label, options: g.rows.map((r) => r.name) });
      questions[`${PERSONAL}${groupKeys.length}`] = q.personal;
      questions[`${GIVEN}${groupKeys.length}`] = q.given;
      groupKeys.push(g.key);
    }
  } else {
    const focused = snapshot.rows.find((r) => r.id === snapshot.focused);
    questions.kind = kindQuestion({ hasPending: !!req.pending, textboxFocused: !!focused && TEXT_ROLES.has(focused.role) });
    questions.operation = operationQuestionSingle();
    const spans = wordSpans(req.utterance ?? '');
    if (spans.length) questions.typed_span = typedSpanQuestion(spans);
  }

  // Plain JSON by construction; optional fields that are absent are simply left out when serialised.
  const r = await ask(state as unknown as EntryType, questions, { timeout: DECIDE_TIMEOUT_MS, retry: { maxRetries: DECIDE_RETRIES[req.leash] } });

  const heads: Record<string, Head> = {};
  for (const [name, a] of Object.entries(r.answers)) {
    if (a.type === 'choice') heads[name] = { choice: a.choice, confidence: a.confidence, probabilities: a.probabilities };
  }
  // needs = personal × (1 − given): the user must supply it, and the goal has not already.
  const needs: Record<string, number> = {};
  const needsParts: Record<string, { personal: number; given: number }> = {};
  groupKeys.forEach((key, i) => {
    const personal = (r.answers[`${PERSONAL}${i}`] as { noul: number }).noul;
    const given = (r.answers[`${GIVEN}${i}`] as { noul: number }).noul;
    needsParts[key] = { personal, given };
    needs[key] = personal * (1 - given);
  });
  return { model: r.model, ms: r.ms, usage: r.usage, labelStyle, heads: heads as Heads, ...(task ? { needs, needsParts } : {}) };
}

export const fitsRequest = z.object({ utterance: z.string().max(2000), rows: z.array(row).min(1).max(FIT_POOL) });

// Which of these candidates fit? One Noul per candidate, all in one request.
export async function fits(req: FitsRequest): Promise<FitsResponse> {
  const questions = fitQuestions(req.rows.map((r) => ({ label: r.id, text: describeRow(r) })));
  const r = await ask({ utterance: req.utterance }, questions, { timeout: DECIDE_TIMEOUT_MS, retry: { maxRetries: 0 } });
  const out: Record<string, number> = {};
  for (const [label, a] of Object.entries(r.answers)) out[label] = a.noul;
  return { model: r.model, ms: r.ms, usage: r.usage, fits: out };
}

export const matchRequest = z.object({
  group: z.string().max(200), options: z.array(z.string().max(200)).min(1).max(250), answer: z.string().max(500),
});

// Which option does the spoken answer mean? One Choice over the group's own option names, plus skip and unclear.
export async function match(req: MatchRequest): Promise<MatchResponse> {
  const r = await ask({ group: req.group, options: req.options, answer: req.answer }, { match: matchQuestion(req.options) }, {
    timeout: DECIDE_TIMEOUT_MS, retry: { maxRetries: 1 },
  });
  const { choice, confidence, probabilities } = r.answers.match;
  return { model: r.model, ms: r.ms, usage: r.usage, head: { choice, confidence, probabilities } };
}
