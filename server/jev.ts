import { TypeSafeClient, type EntryType, type Questions, type RequestOptions } from '@typesafe-ai/sdk';

const JEV_MODEL = process.env.JEV_MODEL?.trim() || 'jev-latest';

// Created on first use so the server still boots, and /api/health can report it, when the key is missing.
let client: TypeSafeClient | undefined;
function getClient(): TypeSafeClient {
  client ??= new TypeSafeClient(); // reads TYPESAFE_API_KEY
  return client;
}

// One Jev request: every question runs in parallel over the same state.
export async function ask<Q extends Questions>(state: EntryType, questions: Q, options?: RequestOptions) {
  const t1 = performance.now();
  const res = await getClient().systemOne({ state, model: JEV_MODEL, questions }, options);
  const ms = Math.round(performance.now() - t1);
  // `model` is the versioned id that answered (e.g. jev-1.13.0), even when we sent an alias.
  console.log(`[jev] model=${res.model} ms=${ms} in=${res.usage.input_tokens} out=${res.usage.output_tokens}`);
  return { model: res.model, ms, usage: res.usage, answers: res.answers };
}

// A cheap GET on the same client. It opens (or keeps open) the pooled connection that decide() reuses.
export async function warm(): Promise<number> {
  const t = performance.now();
  await getClient().models.list();
  return Math.round(performance.now() - t);
}

// Safe to return to the browser: never includes headers or the key.
export function describeError(err: unknown): { status?: number; error: string } {
  if (err instanceof Error) {
    const status = (err as { status?: unknown }).status;
    return { status: typeof status === 'number' ? status : undefined, error: `${err.name}: ${err.message}` };
  }
  return { error: 'Unknown error' };
}
