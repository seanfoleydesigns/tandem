import express from 'express';
import { HEALTH_STATE, healthQuestions } from '../shared/questions';
import type { HealthResponse } from '../shared/types';
import { ask, describeError } from './jev';

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

app.listen(PORT, () => console.log(`[api] listening on http://localhost:${PORT}`));
