// The LLM thinks slowly, at the edges: once at task start (parse) and once at task end (verify).
// It is never between the user's voice and an action, and nothing in drive mode reaches this file.
// Callers see two plain functions; the provider sits behind them.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { LLM_TIMEOUT_MS, SPOKEN_MAX_WORDS } from '../shared/config';
import { attributesFromPairs, correctAttributes } from '../shared/constraints';
import { mentionsPrice, wanted } from '../shared/price';
import type { Constraints, LlmCall, ParseRequest, ParseResponse, VerifyRequest, VerifyResponse } from '../shared/types';

// The model id lives here and nowhere else. Verified against the provider's Models API on 2026-09-19:
// claude-haiku-4-5-20251001 is "Claude Haiku 4.5" (alias claude-haiku-4-5), 200k context.
const LLM_MODEL = process.env.LLM_MODEL?.trim() || 'claude-haiku-4-5';

let client: Anthropic | undefined;
const hasKey = () => !!process.env.ANTHROPIC_API_KEY?.trim();
const getClient = () => (client ??= new Anthropic()); // reads ANTHROPIC_API_KEY

// Structured outputs want every property present, so "not stated" is null rather than missing. They also
// cannot express a free-form record (every object is closed), so attributes arrive as {name, value} pairs
// and become a record in code. A z.record here would not fail: it would silently always come back empty.
const ParsedGoal = z.object({
  attributes: z.array(z.object({ name: z.string(), value: z.string() })),
  max_price: z.number().nullable(),
  min_price: z.number().nullable(),
  search_query: z.string().nullable(),
  visual_prefs: z.array(z.string()),
});

const Verdict = z.object({ ok: z.boolean(), issues: z.array(z.string()), spoken: z.string() });

// The page may be any kind of site. Shopping appears only as examples.
const PARSE_SYSTEM = `You turn a user's spoken request into constraints for the web page they are on. The page may be any kind of site: a shop, a news list, a reference site, a web app.
Return only what the request states. Use null, or an empty list, for anything it does not state. The page is given only for its vocabulary: where the user is now, and what is already selected there, is not part of the request.
- attributes: one {name, value} pair for each property the request states that the page could narrow by. For name, use the label of the matching filter group in page.filters, in lower case (for example "colour", "brand", "language"); use "category" for the kind of thing or the section asked for. For value, use the page's own word when one in page.categories or page.filters matches what the user said (shop example: "trainers" becomes "Sneakers"); otherwise use the user's word. Never put a price in attributes.
- Prices are plain numbers: "under a hundred dollars" is max_price 100; "between fifty and eighty" is min_price 50 and max_price 80. A vague word such as "cheap" states no number, so both stay null.
- search_query: the words to type into the site's search box, when the request asks to search for something, or names a specific thing to find that the page does not already list (for example "find the article about Alan Turing" gives "Alan Turing"). Otherwise null.
- visual_prefs: looks that no filter captures (shop example: "no big logo"). Usually an empty list.
- A request that only adjusts the current results (shop example: "only the ones under a hundred and fifty") states just that adjustment.`;

const VERIFY_SYSTEM = `You check whether a web page now shows what the user asked for, and you write one short sentence that will be spoken aloud. The page may be any kind of site; a shop is only one example.
You are given the goal, the constraints, a digest of the page, and counts that were computed by code.
- Never count anything yourself. Use only the numbers in "counts". "shown" is how many results are on the page; "within_price" is how many of them are inside the price limit.
- ok is false only when the page plainly does not match the goal: the wrong section or kind of item, a filter named in constraints.attributes that is not applied (shop example: a colour), or a search or list with no results. When the goal was to open or reach one page rather than to list results, judge by the title and headings, and "shown" being 0 is not an issue.
- A price limit is never applied as a filter on the page. The assistant dims the results outside the limit on the user's screen instead, and that is the intended outcome. So results outside the limit, or a price filter that is not set, are never an issue and never make ok false. The one exception: when "within_price" is 0, ok is false, because nothing fits the price.
- issues: short phrases; an empty list when ok is true.
- spoken: at most ${SPOKEN_MAX_WORDS} words, plain and friendly, no lists, and never name individual results. For a list of results, say how many there are. Only when constraints has max_price or min_price, also say how many are within it; otherwise never mention a price. Shop examples: with a price limit, "Nine white sneakers in your size, six under a hundred dollars."; without one, "Nine white sneakers in your size." For a single page, say what is now open. When ok is false, say what is off instead.`;

async function call<T extends z.ZodType>(system: string, payload: unknown, schema: T): Promise<{ data?: z.infer<T>; llm: LlmCall }> {
  const started = performance.now();
  const done = (extra: Partial<LlmCall>): LlmCall => ({ ok: false, model: LLM_MODEL, ms: Math.round(performance.now() - started), ...extra });
  if (!hasKey()) return { llm: done({ error: 'no ANTHROPIC_API_KEY' }) };
  try {
    const response = await getClient().messages.parse(
      {
        model: LLM_MODEL,
        max_tokens: 1024, // both answers are a few dozen tokens; this is headroom, not a target
        system,
        messages: [{ role: 'user', content: JSON.stringify(payload) }],
        output_config: { format: zodOutputFormat(schema) },
      },
      { timeout: LLM_TIMEOUT_MS, maxRetries: 0 }, // fail fast: the task carries on without the LLM
    );
    const usage = { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens };
    console.log(`[llm] model=${response.model} ms=${Math.round(performance.now() - started)} in=${usage.input_tokens} out=${usage.output_tokens} stop=${response.stop_reason}`);
    if (response.stop_reason === 'refusal' || !response.parsed_output) return { llm: done({ ...usage, error: `no usable answer (${response.stop_reason})` }) };
    return { data: response.parsed_output as z.infer<T>, llm: done({ ok: true, model: response.model, ...usage }) };
  } catch (err) {
    // Typed SDK errors, most specific first. The message never contains the key.
    const error =
      err instanceof Anthropic.APIConnectionTimeoutError ? `timed out after ${LLM_TIMEOUT_MS} ms`
      : err instanceof Anthropic.AuthenticationError ? 'the API key was rejected'
      : err instanceof Anthropic.RateLimitError ? 'rate limited'
      : err instanceof Anthropic.APIError ? `API error ${err.status ?? ''}: ${err.message}`.trim()
      : err instanceof Error ? err.message : 'unknown error';
    console.log(`[llm] failed: ${error}`);
    return { llm: done({ error }) };
  }
}

// Task start: a fuzzy request becomes constraints. Any failure means "no constraints", never an error.
export async function parseGoal(req: ParseRequest): Promise<ParseResponse> {
  const { data, llm } = await call(PARSE_SYSTEM, req, ParsedGoal);
  const constraints: Constraints = {};
  if (data) {
    // Code corrects the LLM where the goal literally says one of the page's own words and the LLM picked another.
    const attributes = correctAttributes(attributesFromPairs(data.attributes), req.goal, req.page);
    if (Object.keys(attributes).length) constraints.attributes = attributes;
    if (data.max_price !== null && data.max_price > 0) constraints.max_price = data.max_price;
    if (data.min_price !== null && data.min_price > 0) constraints.min_price = data.min_price;
    if (data.search_query) constraints.search_query = data.search_query;
    if (data.visual_prefs.length) constraints.visual_prefs = data.visual_prefs;
  }
  return { constraints, llm };
}

// Task end: check the page against the goal and write the spoken summary. Counts come from code.
export async function verifyAndSummarise(req: VerifyRequest): Promise<VerifyResponse> {
  const { data, llm } = await call(VERIFY_SYSTEM, req, Verdict);
  if (!data) return { ok: true, issues: [], spoken: '', llm };
  const words = data.spoken.trim().split(/\s+/).filter(Boolean);
  // The limit is enforced in code. A sentence that runs long is dropped rather than cut mid-thought.
  // A price in the summary when the goal set none is invented (the model once echoed the prompt's example): say nothing instead.
  const invented = !wanted(req.constraints) && mentionsPrice(data.spoken);
  const spoken = words.length <= SPOKEN_MAX_WORDS && !invented ? data.spoken.trim() : '';
  return { ok: data.ok, issues: data.issues, spoken, llm };
}
