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

Started about 13:33, committed 13:47 EDT (about 14 min against a 20 min box).

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

## 2026-09-19 · M1: see and act

Started 13:49, finished 14:07 EDT (about 18 min against a 35 min box).

**Built**

- `shared/`: `ordinals.ts` (half-visible placement, visible-first ordinals), `spans.ts` (word spans, cap 200), `candidates.ts` (which rows each head may pick, row text, select labels `e12_o3`), `policy.ts` (`resolve()`, rules 1 to 5 and 8), `questions.ts` (kind, operation, three target heads, typed_span).
- `server/decide.ts`: zod-validated `/api/decide`. One Jev request carries every head. 2500 ms timeout, no retry on the single leash. `/api/warm` opens the connection ahead of a decision. One SDK client is reused for the life of the server.
- `agent/`: `name.ts` (accessible name, role, group; pure, tested under jsdom), `snapshot.ts` (one pass, about 1 ms on the store), `execute.ts` (scrolls an off-screen or covered target to the centre, re-checks it is reachable, native value setter, `form.requestSubmit()` for search fields, settle 120 / 800 ms), `loop.ts` (the one loop, leash of one step), `ui/` (shadow-root overlay with `pointer-events: none`, command bar on `/`, ring, plain-table inspector on `i` with the label-style toggle).
- `scripts/bench-decide.ts`: latency and accuracy bench against the running server.
- 46 unit tests: policy, spans, ordinals, naming. No network.

**Acceptance (typed into the command bar, 1280 × 800)**

| Command | Result | Winning row / note | t3 − t0 |
|---|---|---|---|
| scroll down | pass | SCROLL_DOWN conf 1.00 | 493 ms (first call, cold connection) |
| open the second one (after the scroll) | **pass after a fix**, see below | `e126 · link · Tidewater Boardwalk Tan sneakers $58 · Results · second visible (item 10 of 24 in Results)`, conf 0.99. It is the second visible card, item 10 of the list, checked against an independent DOM calculation. | 163 ms |
| go back | pass | GO_BACK conf 0.98; listing and scroll position restored | 348 ms (cold) |
| check white | pass | `checkbox · White · unchecked · Colour · off-screen above`, conf 0.95; scrolled into view, then clicked; 8 results | 213 ms |
| sort by price low to high | pass | select_target `e277_o1` conf 1.00; prices ascending | 391 ms (cold) |
| search for running shoes | pass | TYPE conf 0.73, searchbox conf 0.97, typed_span "running shoes" conf 0.99; 7 results | 314 ms |

The inspector shows model id, label style, rows, tokens, t0 to t3 with the Jev share, settle, and per head: choice, confidence, top probability and top three. Heads the policy read are shaded. The toggle switches label style for the next decision; the key scenario also passes under `ids` (same row, conf 0.98, 3,723 tokens against 5,363).

**What broke, and the wording / state changes**

1. **"open the second one" opened the wrong product.** First format: visible rows said `second visible (tenth of 24 in Results)`, off-screen rows said `off-screen above (second of 24 in Results)`. Jev chose the off-screen row at 0.76 and gave the right one 0.06. It matched the literal words "second of 24". Fix, in state and wording, not thresholds: the collection position is now in digits (`item 10 of 24`), so the word "second" appears on exactly one row, and the click question now says that a position word in `utterance` means the element described with that word followed by "visible". After the fix: 0.99 on the right row under both label styles. A clean example of Jev's literal reading, and of a documented weakness (numbers) used on purpose.
2. **kind misreads "search for running shoes" as TASK** (0.95). Not routed on until M2. I tightened ACTION ("typing or searching for the exact words given") and TASK ("leaves the steps to the assistant"); TASK fell to 0.51 but still wins. Open item for M2, where kind starts to matter.
3. Store bug: `#load-more { display: block }` beat the `hidden` attribute. Added `[hidden] { display: none !important }`.
4. Pressing `/` with the command bar already focused typed a slash. Now swallowed when the bar is empty.
5. A label was briefly parsed (`o3` to index 3). Replaced with a map from select label to `<option>`, so labels are only ever looked up.

**Latency: t2 − t1, the Jev call measured on the server, p50 of 10 calls each, connection warm**

| Rows | Label style | p50 | min | max | Input tokens | Operation | Target | Span |
|---|---|---|---|---|---|---|---|---|
| 40 | described | 225 ms | 185 | 268 | 3,592 | 10/10 | 6/6 | 1/1 |
| 40 | ids | 201 ms | 133 | 284 | 2,592 | 10/10 | 6/6 | 1/1 |
| 80 | described | 207 ms | 156 | 303 | 5,720 | 10/10 | 6/6 | 1/1 |
| 80 | ids | 177 ms | 153 | 237 | 3,856 | 10/10 | 6/6 | 1/1 |
| 120 | described | 208 ms | 171 | 247 | 9,054 | 10/10 | 6/6 | 1/1 |
| 120 | ids | 220 ms | 150 | 261 | 5,744 | 10/10 | 6/6 | 1/1 |

An earlier run of the same bench gave p50s of 210, 197, 224, 236, 220 and 210 ms. Rows are synthetic but shaped like the listing; the six commands rotate; "Target" checks the head that carries the action, including the second visible card.

Connection warm-up, 80 rows, described, each call after 8 s idle: **cold p50 366 ms** (366, 403, 361, 308, 387); **warmed first p50 187 ms** (191, 187, 176, 180, 192).

What this says:

- **The 600 ms target is met.** t3 − t0 is the Jev call plus about 5 ms (snapshot 1 ms, act 1 to 2 ms, local proxy). Warm: about 200 to 260 ms. Cold: about 350 to 500 ms.
- **Row count and label style are not latency levers.** 40 to 120 rows and either style all land within run-to-run noise of each other, which fits the docs' claim that questions run in parallel over one ingested state. `ids` saves about a third of the input tokens and scored the same here, so it is the cheaper choice if accuracy holds on real pages.
- **The connection is the lever: about 180 ms.** Node closes an idle connection after a few seconds. The agent now calls `/api/warm` (a cheap `GET /v1/models` on the same client) when the command bar takes focus and while the user types, at most every 3 s. In M2 the same call should fire on the first interim transcript. In my automated runs the command was typed instantly, so warm-up and decide overlapped and several calls still paid the cold price; a human typing or speaking gives it a head start.
- The floor from this machine is about 150 to 200 ms round trip, above the docs' "about 100 ms".

**Surprises about Jev**

- Speculative heads behave well: with "scroll down", click_target says `none` at 0.96; with "open the second one", typed_span says `(none)` at 0.90.
- Operation TYPE is the least confident of the six (0.57 to 0.73): CLICK on the "Running" category link is a fair rival for "search for running shoes".
- Confidence tracked the top probability closely on peaked heads here (0.99 / 1.00, 0.75 / 0.76), and sat lower on spread ones (0.35 confidence for a 0.51 top).

## 2026-09-19 · M2: voice

Started 14:15, finished 14:30 EDT (about 15 min against a 25 min box). Real-voice acceptance is Sean's to run in Chrome: the Browser pane I test in blocks the microphone. Everything below was checked with the dev simulator, which feeds the same pipeline as the recognizer.

**Built**

- `agent/voice.ts`: `webkitSpeechRecognition`, continuous with interim results, restart on `onend` unless the mic toggle is off, `no-speech` / `aborted` quiet, `network` quiet with a back-off, `not-allowed` shown as "Mic blocked". Speech output through `speechSynthesis`, mutable. Echo guard: recognition is aborted while the agent speaks and for 250 ms after, results arriving under the guard are dropped, and a timer releases the guard if an engine never fires `onend`.
- `agent/pipeline.ts`: one path for typed commands, the recognizer and the simulator. Order for every transcript: stop (code), "one" / "two" (code), then the loop (Jev). Warm-up on `speechstart`, on every interim and on typing, at most every 3 s.
- Stop fast path (`shared/speech.ts`, unit tested): "stop", "cancel", "wait", "hold on", also mid-sentence on an interim ("scroll down… stop"). It aborts any in-flight decide, clears badges, cancels speech and swallows the final transcript of the same utterance. No model call. Esc does the same.
- Speculative decide: when an interim transcript has not changed for 300 ms, fire `/api/decide`. If the final transcript matches after normalising (case, punctuation, spaces), act on that answer; otherwise abort it and decide again. The trace records hit, miss or not fired.
- `kind` routing is on. TASK needs probability 0.7 or more (`TASK_MIN`); below that the single leash runs. A routed task only reports itself for now: delegate mode is M3.
- Dictation: with a text field focused and kind DICTATION, the transcript is appended as it is, with no submit.
- Disambiguation: badges "1" and "2" that follow their elements; "one", "two" (and "first", "the second one", "too"…) or a tap resolves in code; anything else cancels and is treated as a new command. The agent says "One or two?".
- Fit check, `/api/fits` and `shared/fits.ts`: see below.
- Dev simulator: `await __tandem.say('open the second one', { interims: [...], interimGapMs: 150, finalDelayMs: 600 })` returns a summary of the trace. Also `__tandem.speak(text)` and `__tandem.guarded()`. Dev only; `dist/agent.js` contains no `__tandem`.
- Inspector: final transcript → action, last interim change → action, last interim → final, whether the speculative decide was used and how early it fired, decide round trip with the Jev share, snapshot · act · settle, and the fit check when one ran.
- 76 unit tests (added: speech, fits, TASK gate).

**Acceptance, by simulated voice (interims one word at a time, 150 ms apart; final 600 ms after the last interim)**

| Check | Result |
|---|---|
| The six M1 commands | All pass. Speculative decide hit six of six. Final → action 0 to 2 ms. Last interim → action 608 to 614 ms, of which 600 ms is the simulated finalisation delay. |
| Final differs from the last interim ("scroll town" → "scroll down") | Speculative answer dropped, decided again: final → action 189 ms, last interim → action 799 ms. |
| Final arrives 150 ms after the last interim (before the 300 ms window) | Nothing speculative fired: final → action 281 ms, last interim → action 435 ms. |
| "stop" on an interim, mid-sentence | Halted at once, page did not scroll, no model call, final transcript swallowed. |
| "open the white one" with 8 white shoes | Badges 1 and 2 on the first two white shoes; "two" opened Arco Plaza Low in 2 ms, in code. **Needed the fit check, see below.** |
| Never reacts to its own speech | While "One or two?" was being spoken, `__tandem.say()` was dropped by the echo guard; the guard then released. |
| Dictation | Search box focused, "blue suede shoes" → typed as it is, not submitted (DICTATION 0.77). "with a leather sole" → appended (DICTATION won at only 0.38). "scroll down" with the field focused → still a command. |
| kind routing | "find me white shoes", "I need black boots in my size", "show me options for running": TASK 1.00. "search for running shoes": ACTION 0.76 (it was TASK 0.95 before the rewording). "open the cart": ACTION 1.00. "um I think so yeah": NOT_FOR_ME. |
| Mic toggle | API present. The Browser pane blocks the microphone, so the toggle showed "Mic blocked" quietly. Listening, restart and real timings are for the Chrome run. |

**Honest reading of the two timings.** With a speculative hit, the action fires within a few milliseconds of the final transcript, so "final → action" is near zero and no longer says much. "Last interim change → action" is then almost exactly the recognizer's own finalisation delay, which we do not control; the simulator's 600 ms is a guess, and Chrome's real figure is the number to get from the live run. Without a hit, the cost is one decide: about 190 to 280 ms after the final transcript.

**What broke, and what changed**

1. **An ambiguous command did not look ambiguous.** "open the white one" with eight white shoes: Jev gave one shoe 0.46 to 0.65, put 0.31 to 0.48 on `none`, and gave the other seven about 0.00. It does not split a Choice across equally good candidates. The confidence (0.46 to 0.63) sat right on the 0.5 threshold, so the agent usually just opened the first shoe, and the runner-up was the White checkbox, so "top two by probability" would have badged the wrong thing. I tried wording first (told it "one" is not a position word: no change) and state (reversed the cards, removed ordinals, `ids` labels: same shape).
   Fix: the docs' own pattern, a Choice to pick and Nouls to decide. When a target is uncertain in drive mode, one follow-up request asks a yes/no question per candidate with the same role and group as the preferred one ("Could `utterance` be referring to this page element…? Answer yes for every element that matches…"). The eight white shoes scored 0.59 to 0.74; near-ties keep reading order, so badges land on the first two. One fit: act. None: "?". The follow-up took 145 to 184 ms and only runs when the agent is about to ask anyway.
   With that safety net, `TARGET_MIN` went from 0.5 to 0.75: clear commands in M1 and M2 scored 0.92 and up, ambiguous ones 0.65 and below, and a false alarm now costs one short request instead of a wrong click. This is a threshold change made after wording and state were tried, with the numbers above as the evidence.
2. The first fit pool force-included the policy's own two candidates, so badge 1 landed on the already-checked White checkbox (Noul 0.67). The pool now holds only candidates like the preferred one.
3. kind wording: rebuilt around who chooses the steps, with searching named under ACTION. "search for running shoes" moved from TASK 0.95 to ACTION 0.76 to 0.77.
4. The trace reported a speculative miss as "not fired". Fixed; the inspector now says which.

**Surprises about Jev**

- The "one winner plus `none`" shape for equally good candidates is the big one. It means rule 4 (top probability under 0.55, candidates sharing a group) will rarely fire from a split distribution alone. M3's "uncertainty becomes a question" should lean on the fit check too.
- Jev matched the spoken "size ten and a half" to the "10.5" size chip and clicked it (my test phrase for dictation was read as a command, fairly). Good news for `/api/match` in M3.
- Nouls over near-identical candidates are consistent but not high: 0.59 to 0.74 for eight equally white shoes. `FIT_MIN` 0.5 works here; it is a number to watch.

**Open items**

- DICTATION routes on the top choice with no floor, and once won at 0.38. If it misfires with real speech, give it a minimum like TASK's.
- Real recognizer behaviour (restart gaps, finalisation delay, how often the final differs from the last interim) is unmeasured until the Chrome run.
