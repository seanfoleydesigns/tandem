import express from 'express';
import { z } from 'zod';
import { HEALTH_STATE, healthQuestions } from '../shared/questions';
import type { DecideRequest, DismissRequest, FitsRequest, HealthResponse, MatchRequest, SlateRequest, VerifyRequest } from '../shared/types';
import { decide, decideRequest, dismiss, dismissRequest, fits, fitsRequest, match, matchRequest, slate, slateRequest } from './decide';
import { ask, describeError, warm } from './jev';
import { parseGoal, verifyAndSummarise } from './llm';

const PORT = 8787;
const app = express();
app.use(express.json({ limit: '1mb' }));

// One real Jev call. Returns its typed answer.
app.get('/api/health', async (_req, res) => {
  try {
    const r = await ask(HEALTH_STATE, healthQuestions());
    const { choice, confidence, probabilities } = r.answers.operation;
    const body: HealthResponse = { ok: true, model: r.model, ms: r.ms, usage: r.usage, answer: { choice, confidence, probabilities } };
    res.json(body);
  } catch (err) {
    const body: HealthResponse = { ok: false, ...describeError(err) };
    res.status(502).json(body);
  }
});

// Opens the connection to TypeSafe ahead of the first decision, so it does not pay for the handshake.
app.post('/api/warm', async (_req, res) => {
  try {
    res.json({ ok: true, ms: await warm() });
  } catch (err) {
    res.status(502).json({ ok: false, ...describeError(err) });
  }
});

app.post('/api/decide', async (req, res) => {
  const parsed = decideRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    return;
  }
  try {
    res.json(await decide(parsed.data as DecideRequest));
  } catch (err) {
    res.status(502).json({ ok: false, ...describeError(err) });
  }
});

// Follow-up to an uncertain target: which candidates fit the utterance? One Noul each.
app.post('/api/fits', async (req, res) => {
  const parsed = fitsRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    return;
  }
  try {
    res.json(await fits(parsed.data as FitsRequest));
  } catch (err) {
    res.status(502).json({ ok: false, ...describeError(err) });
  }
});

// Which option does a spoken answer mean? Used by the question card and by saved preferences.
app.post('/api/match', async (req, res) => {
  const parsed = matchRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; ') });
    return;
  }
  try {
    res.json(await match(parsed.data as MatchRequest));
  } catch (err) {
    res.status(502).json({ ok: false, ...describeError(err) });
  }
});

// A pop-up or banner covers the page: which of its own controls refuses or closes it?
app.post('/api/dismiss', async (req, res) => {
  const parsed = dismissRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; ') });
    return;
  }
  try {
    res.json(await dismiss(parsed.data as DismissRequest));
  } catch (err) {
    res.status(502).json({ ok: false, ...describeError(err) });
  }
});

// Once at task start: is the goal a refinement, and which set filter options does it ask for?
app.post('/api/slate', async (req, res) => {
  const parsed = slateRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; ') });
    return;
  }
  try {
    res.json(await slate(parsed.data as SlateRequest));
  } catch (err) {
    res.status(502).json({ ok: false, ...describeError(err) });
  }
});

// M4: the LLM at the edges. Task start and task end only. Both answer 200 even when the LLM is unavailable:
// the body says so, and the task carries on without it.
const parseRequest = z.object({
  goal: z.string().max(2000),
  page: z.object({
    title: z.string(), categories: z.array(z.string()).max(40),
    filters: z.array(z.object({ group: z.string(), options: z.array(z.string()).max(60), set: z.array(z.string()) })).max(30),
  }),
});
app.post('/api/parse', async (req, res) => {
  const parsed = parseRequest.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: 'bad request' }); return; }
  res.json(await parseGoal(parsed.data));
});

const verifyRequest = z.object({
  goal: z.string().max(2000),
  constraints: z.record(z.string(), z.unknown()),
  page: z.object({
    title: z.string(), headings: z.array(z.string()), notices: z.array(z.string()), categories: z.array(z.string()).max(40),
    filters: z.array(z.object({ group: z.string(), options: z.array(z.string()).max(60), set: z.array(z.string()) })).max(30),
    results: z.array(z.string()).max(12),
  }),
  counts: z.object({ shown: z.number(), priced: z.number(), within_price: z.number().optional() }),
});
app.post('/api/verify', async (req, res) => {
  const parsed = verifyRequest.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: 'bad request' }); return; }
  res.json(await verifyAndSummarise(parsed.data as VerifyRequest));
});

app.listen(PORT, () => console.log(`[api] listening on http://localhost:${PORT}`));
