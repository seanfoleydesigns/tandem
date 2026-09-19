# Build notes

One entry per milestone: what was built, what broke, what changed in the Jev wording and why, and anything surprising about Jev's behaviour.

## 2026-09-19 · Before M0: spec against the Jev docs, and decisions

I read the core sections of `docs/jev/llms-full.md` (API reference, quick start, primitives, confidence, state, models, fan-out, Jev 1.13 jaggedness, JS SDK). Eight parallel readers then cross-checked every assumption in SPEC section 2, and a skeptic pass tried to refute each claimed mismatch. Result: **no hard conflict between the spec and the docs.** What the check did turn up:

- **`confidence` is not the top probability.** The formula is undocumented (docs L1158 to 1164). Docs examples: top 0.84 gives confidence 0.596 (quick start); top 0.99 gives 0.97 (jaggedness page). A 0.5 confidence floor is stricter than it looks.
- **255 choice labels is a hard cap**, and one cookbook says a Choice "works reliably up to roughly 240 options" (L3917, written against an earlier model).
- **SDK defaults do not suit a hot path:** 10 s timeout per attempt, 2 retries, 500 ms first backoff.
- **A `none` label is a weak "nothing fits" signal.** Choice probabilities always sum to 1, so something always ranks first (L11150). The docs pair the Choice with a Noul in the same request.
- **The docs disagree with themselves twice.** Token budget: "around 32,000" on the Primitives page, 64k / 32k on the Models page (the spec matches Models). The `model` field: prose says versioned id, every example shows `jev-latest`. The live API settles the second one: it returns `jev-1.13.0`.
- Numeric forms are a documented weak spot, so ordinals go to Jev in words.
- Heads in one request cannot see each other's answers, so each target head states its own premise.

Decisions agreed with Sean (SPEC.md is patched to match):

| Topic | Decision |
|---|---|
| Thresholds | Rules 2, 3, 5 gate on `confidence` (`OP_MIN`, `TARGET_MIN`). Rule 4 gates on top probability. Inspector shows both for every head. |
| `none` | Built as specified. Left out of the 80% mass set. A confident `none` in drive mode is ignored with a "?". Fallback if it misfires: a paired Noul. |
| typed_span | Cap 200 spans (covers 19 words). Fallback if overlapping spans split probability: two heads, first word and last word of the text, each described with neighbouring words. |
| `/api/decide` | 2500 ms timeout. No retry on the single leash, one quick retry on the task leash. Stay under 32k tokens per request. |
| Select labels | `e12_o3`, not `e12>o3` (no evidence in the docs for `>` in a label). |
| Ordinals | Follow what the user can see: "second visible (tenth of 24 in Results)". On screen means at least half visible. Other rows are marked off-screen in state so visible rows win ties. Unit tested (M1). |
| Label style | Config flag from the start: `described` (descriptions inside each head) or `ids` (bare ids, rows held once in state). A/B in the inspector. |
| Near the viewport | Within one viewport above or below. `execute` scrolls an off-screen target into view before the covered check. |
| M1 policy scope | `resolve()` rules 1 to 5 and 8 with tests. Badges UI in M2. Rules 6 and 7 and `ask_group` in M3. `kind` is sent and shown from M1, routed on from M2. |
| Task-leash TYPE | Not offered until a text source exists (saved preference, or `search_query` in M4). |
| Dependencies | `@types/node` and `@types/express` approved. No `dotenv`: `tsx --env-file=.env`. |
| Git | Commits on `master`, no remote, nothing pushed. |
| Process | No multi-agent cross-checks during build milestones unless asked. |

## 2026-09-19 · M0: scaffold, handshake, store

**Built**

- Scaffold: Vite 8 (root `store/`), TypeScript 7 strict, Express 5 under `tsx watch --env-file=.env`, `concurrently` for `npm run dev`. Vite proxies `/api` to :8787.
- The single touchpoint: the store's HTML has one tag, `<script type="module" src="/agent.js">`. In dev a five-line `resolveId` plugin in `vite.config.ts` serves `agent/index.ts` at that URL. `npm run build:agent` builds the IIFE `dist/agent.js`. The agent is a boot stub for now.
- `server/jev.ts`: one lazily created `TypeSafeClient`, an `ask()` wrapper that times the call and logs `model`, ms and token usage for every response, and an error describer that never includes headers or the key.
- `/api/health`: one real Jev call, a four-label Choice over `{ "utterance": "scroll down a bit" }`. The wording lives in `shared/questions.ts` as plain objects in the documented request shape, so `shared/` needs no SDK import.
- `shared/config.ts`: thresholds, caps, `MAX_SPANS 200`, decide timeout and retries, and the `LABEL_STYLE` flag.
- Footnote store: 36 products from a seeded throwaway generator (not in the repo), listing with Colour / Size / Brand / Closure / Price filters and a native sort `<select>`, filters in the query string, `role="status"` result count, 24 per page plus "Load more", search, category nav, product page with a required Size group and an inline `role="alert"` error, cart with a Checkout button that opens a "Demo only" `<dialog>`. Semantic HTML, no agent hooks. Each card is one `<a href>`, so one snapshot row per product.

**Acceptance**

- `GET /api/health` returns `{ ok: true, model: "jev-1.13.0", answer: { choice: "SCROLL_DOWN", confidence: 1, probabilities: {…} } }`. Pass.
- By hand in the browser: check White (8 results, `?colour=white`), size 10.5, sort by price low to high (prices ascending, all three in the URL), open a product, Add to cart with no size shows "Please choose a size.", pick 10.5, add, cart shows the line and total, Checkout opens "Demo only", Back twice returns to the filtered listing with its controls restored. Search "running shoes" returns the 7 running shoes. Pass.
- `.env` is git-ignored (`git check-ignore`). Pass. `npm run typecheck` clean, `npm run build:agent` builds, `npm test` runs (no tests yet).

**Jev behaviour**

- Latency for this tiny request, measured on the server around the SDK call: 443 ms cold, then 315, 174 and 201 ms warm. That is above the docs' "about 100 ms", so roughly a third of the 600 ms budget goes to the round trip from this machine before the request grows. M1 must measure t2 − t1 with the full head set.
- 382 input tokens for a one-line state and one four-label question, so there is a fixed overhead of a few hundred tokens per question.
- The answer was fully peaked: probability 1.0 on SCROLL_DOWN, confidence 1.

**Broke / surprises**

- Nothing blocking. `npm install` pulled current majors (Vite 8, TypeScript 7, Express 5, zod 4, vitest 5); all worked unchanged.
- No Jev wording changes yet beyond the health question.
