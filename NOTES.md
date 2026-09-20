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

Started 14:15, finished 14:28 EDT (about 13 min against a 25 min box). Real-voice acceptance is Sean's to run in Chrome: the Browser pane I test in blocks the microphone. Everything below was checked with the dev simulator, which feeds the same pipeline as the recognizer.

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

**Sean's real-voice run in Chrome (reported before M3).** All six M1 commands work by voice. Real finalisation delay is about 610 ms from the last interim to the final transcript. The speculative decide hit and was ready about 300 ms before the final; final to action was 2 ms; Jev was 171 ms of a 175 ms round trip. So end of speech to action is about 0.6 s, nearly all of it Chrome's finalisation. Stop on an interim, badges with "two" and the echo guard all worked, and recognition restarted by itself after silence. One bug found: the search box in the sticky header was marked "off-screen above" while visible (fixed in M3).

## 2026-09-19 · M3: delegate

Started 14:42, finished 14:59 EDT (about 17 min against a 50 min box). Checked with the dev simulator; the spec's M3 acceptance by real voice is Sean's to run in Chrome.

**Bug fix first: sticky header controls marked "off-screen above".** Visibility was already measured with `getBoundingClientRect` against the viewport, but I subtract the strip a sticky or fixed header covers, so that a card scrolled under the header does not count as "first visible". That strip was also being subtracted for the header's own controls, so the search box (top 14 px, inside a 67 px header) came out as hidden. `placement()` now takes a `pinned` flag, set for elements inside the bar, which are measured against the plain viewport. Unit tested with the search box's real geometry.

**Built**

- Asking, redesigned around the M2 finding that a Choice collapses onto one winner. The `ask_group` Choice and the ASK_USER operation are gone. Every task-leash decide request carries two Nouls per unset control group, and code combines them: `needs = personal × (1 − given)`. Policy: any `needs` at or above `ASK_MIN` 0.7, for a group not yet asked or skipped in this task, is an Ask about the highest one. That beats DONE, STUCK, a weak operation, and a click inside that group; a confident click elsewhere goes first. DONE is accepted only when nothing reaches `ASK_MIN`.
- `shared/groups.ts`: control groups from the snapshot (two or more checkboxes, radios or switches under one label), set or unset, with "Size (required)" and "Size" treated as one label.
- Memory in code, before Jev: at the start of each task step, an unset group whose label equals a saved preference's label gets the option whose name equals the saved value clicked; if no name matches exactly, `/api/match` decides. One attempt per group per task. Trail chip "Used your saved size: 10.5". No model call.
- Task leash: the same `runLoop`, 25 steps, 60 s with waiting time excluded. Task state is `goal`, `constraints`, `prefs`, `history`, `snapshot`. TYPE is not offered (no text source until M4). The task-leash fit check: several fitting options in one unset group is an Ask; one fit, act; otherwise STUCK.
- Question card built from the group's own label and option names, "Which size?" spoken, tap or say, Skip. `/api/match` with `skip` and `unclear`; an exact option name is matched in code first. Unclear pulses the chips and says "Tap one, or say it again."; two failures hand back.
- Preferences in localStorage scoped to the hostname; memory panel with delete. Hand-back says "Your turn." and shows "Narrow by" chips from the unset groups; a chip can be tapped or said, asks that group, applies the answer and stays in drive mode (not saved as a preference).
- Deny-list and loop detection in `shared/policy.ts` (pure, tested). Stop button visible whenever the agent drives or waits; Esc and the stop words do the same and also settle an open question. The driving frame appears only when a second step begins. Status pill: "You're driving" / "Tandem is driving. Say stop." / "Waiting for you". Action trail: the last five things done.
- `DICTATION_MIN` 0.6, like TASK's floor.
- Store: a category link now keeps the filters already applied (it used to drop them), as a well-made shop would.
- 94 unit tests (added: groups, needs precedence, DONE gating, deny-list, loop detection, DICTATION floor, pinned visibility).

**Acceptance, by simulated voice**

| Check | Result |
|---|---|
| Hero run 1: "find me white shoes" | Colour: White, then the frame appeared at the second step, then "Which size?" with the store's 13 size chips after 1.4 s, pill "Waiting for you", Stop visible. "ten and a half" → 10.5 selected and saved. DONE, "Your turn.", Narrow by Brand, Closure, Price. URL `/?colour=white&size=10.5`. |
| Hero run 2, same session: "find me black boots" from a fresh listing | Never asked for size. Trail: "Used your saved size: 10.5" (memory chip), "Opened Boots", "Colour: Black". 4 black boots in 10.5, "Your turn." in 2.1 s. |
| A third task, unplanned: "find me brown loafers" | Saved size, Loafers, Colour: Brown. Done. |
| "stop" mid-task | Said after the first action landed: no further action, result stopped, "Stopped. Your turn." |
| Task that reaches the cart: "I need to buy the shoes in my cart" | Jev chose CLICK Checkout at confidence 1.00. Deny-list handed back: "This one's yours." The dialog never opened. |
| Delete the saved size | Memory (1) → Delete → Memory (0). The next task asked "Which size?" again. |
| Skip | "Size: skipped", DONE, nothing saved, Size then listed under Narrow by. |
| Narrow by, by voice: "brand" | Card "Which brand?" with the store's five brands. "the purple one maybe" → chips pulsed, card stayed open. "arco please" → Brand: Arco applied, not saved. |

**What broke, and the wording changes**

1. **The specified needs sentence did not clear 0.7.** "A value for Size is essential for the results to be usable by this user (for example a size that must fit), and neither `goal`, `constraints` nor `prefs` determines it" gave Size 0.26 to 0.39, against 0.10 to 0.21 for Brand, Closure and Price: the right order, nowhere near `ASK_MIN`. The first hero run sailed past size to DONE. Wording before thresholds, so I probed variants (`scripts/probe-needs.ts`, four goals, all groups, one request each):
   - "essential…" or "results that ignore it would be unusable" on their own are read as "relevant to the goal": Size 0.20 to 0.25 normally, 0.91 when the goal *mentions* a size. Backwards.
   - "`goal` states which Size the user wants": 0.93 when it does, 0.03 when it does not. Brand 0.92 for "…from Arco". Price 0.33 to 0.39 for "cheap".
   - "Size is a measurement of the person who will use the product, such as a shoe size or clothing size that must fit. It is not a preference such as colour, brand, style, material or price.": Size 0.92 to 0.98, every other group 0.02 to 0.03, whatever the goal says. It does not mention the goal at all, which is why it does not drift.
   The docs' advice for exactly this (literal reading, negations, indirection) is to split into literal questions and combine in code. So: two Nouls, `needs = personal × (1 − given)`. "find me white shoes" gives Size about 0.89; "…in size 10" gives about 0.07. `prefs` needs no question because code applies saved preferences first. `ASK_MIN` stays at the 0.7 Sean set.
   Limit, stated plainly: *personal* is about things that must fit a person. A different kind of essential value (a delivery date, a storage size) would need its own statement.
2. My test harness hung once: it waited for the trail to grow, but the trail only ever shows five chips. The agent was fine. Noted because the first symptom looked like a stuck task.

**Surprises about Jev**

- `/api/match` mapped "ten and a half" to "10.5" and "arco please" to "Arco", and returned `unclear` for "the purple one maybe".
- On the task leash Jev's operation and target heads were decisive: 0.98 to 1.00 for White, Boots, Black, Checkout and DONE. The uncertainty in this milestone was all in *whether to ask*, which is why that moved to Nouls.
- Task steps cost about one decide each (roughly 200 to 450 ms) plus settle; the second hero run took 2.1 s for three actions and a DONE.

**Open items**

- In drive mode the deny-list does not apply, as specified: "get me checked out" was routed as an ACTION and clicked Checkout (the demo dialog opened). If "it never buys" should hold in drive mode too, that is a one-line change; Sean's call.
- If the second task starts on a page where Size is already set from the first answer, memory has nothing to apply and no memory chip appears. The run above started from a fresh listing.
- `ids` label style was not re-tested on the task leash.

## 2026-09-19 · M3.1: behaviour fixes from Sean's real-voice run

Started 15:10, finished 15:22 EDT (about 12 min). Checked with the dev simulator.

**What Sean's run found.** (1) Filters piled up across tasks: Brown, Grey and White all checked, plus a leftover Brand: Arco and Size 10.5, on the Running page, giving 0 results. The agent only ever added. (2) "Open a product, pick a size and then add to cart" was routed ACTION at 0.97 and then ignored.

**Built**

- Clean slate (`shared/slate.ts`, `/api/slate`, `cleanSlate()` in the loop). Once at task start, one request: *refines*, *names a product*, and one Noul per filter option that is on. Refinement keeps everything; a new search switches off what the goal does not ask for, except a saved preference, with one chip ("Cleared 3 old filters"); anything else leaves the page alone. "Kept your saved size: 10.5" when the preference is already set. The snapshot gained a `wide` option so filters scrolled out of view are still seen.
- kind reworded: ACTION is *exactly one* action; TASK also covers an utterance that lists several actions one after another.
- Never silent: `Ignore` now carries `why` (`not_found`, `unsure`, `not_for_me`), and the pipeline says it in the capsule and by voice. `shared/notices.ts` reads the page's result notice for "No matches with these filters."
- Drive-mode deny-list is a confirmation: a `Confirm` resolution, a "Click Checkout?" card with Yes and No, and `pickYesOrNo()` in code. Task mode is still a hard hand-back.
- "Narrow by" answers are saved only when the group's *personal* Noul reaches `SAVE_MIN` 0.7; the pipeline keeps the latest personal score per group from the task's decide responses. After a Narrow-by answer the remaining chips are offered again.
- Saved preferences are now tried once per group **per page**, not per task: the listing's Size filter and a product page's Size selector are different controls.
- On the task leash, when several things to open fit equally and the goal does not say which ("open a product"), the agent takes the first.
- 116 unit tests (added: slate planning, yes / no, Ignore reasons, result notices).

**Acceptance, by simulated voice**

| Check | Result |
|---|---|
| Clean slate: Running + White, Grey, Brown, Arco, 10.5 (saved) → "find me white sneakers" | Trail: "Kept your saved size: 10.5", "Cleared 3 old filters", "Opened Sneakers". Ends on `/?category=sneakers&colour=white&size=10.5`, 4 results, DONE 0.97, 1.8 s. Passed on the third attempt; see below. |
| Then "only the ones under a hundred dollars" | Routed as one ACTION: Price: Under $75 added, White and 10.5 kept. Phrased as a task ("show me only the ones…"): refinement, nothing cleared, same result. |
| "Open a product, pick a size and then add to cart" | TASK. Saved size on the listing, first product opened, saved size on the product page with no question, Add to cart clicked (the goal asks for it), "Added 1 × size 10.5 to your cart", DONE. 2.1 s. |
| Never silent | "open the purple elephant" (STUCK 0.90) and "sort by customer rating" (select `none` 1.00): "I can't find that on this page.", spoken. "flibber the wug" and "yeah so anyway I told him no" (NOT_FOR_ME 0.80 and 0.99): named in the capsule, not spoken. "find me red boots" ends on 0 results: "No matches with these filters. Your turn." |
| Confirm before spending | "check out" → "Click Checkout?" Yes / No, pill "Waiting for you". "no" → "Left Checkout alone." "yes" → clicked, trail "Clicked Checkout (you confirmed)". |
| What is remembered | Narrow by Size, "thirteen" → "Size: 13 (saved)". Brand answers are not saved (personal 0.02). |

**What broke, and the wording changes**

1. **Wording probe first, as asked** (`scripts/probe-slate.ts`, seven goals). *refines* as Sean worded it: 0.08, 0.08, 0.25 for new searches, 0.72 to 0.90 for refinements, but 0.55 for "I need grey running shoes from Arco", because two set filters happened to match the goal. Its mirror, "`goal` names a kind of product to look for", scored 0.93 to 0.95 for new searches and 0.13 to 0.62 for refinements. Requiring `refines ≥ 0.6` and `refines` above the mirror gets all seven right with a margin of 0.10 or more; the single threshold leaves 0.05. The per-option sentence as worded was crisp: 0.87 to 0.93 for options the goal asks for, 0.05 or less otherwise.
2. **The slate cleared the filters but the task ended on Running, not Sneakers.** The stale category is a link with `aria-current`, not a control, so the slate cannot clear it, and Jev chose DONE (0.79, below its usual 0.98) with the Sneakers link at only 0.35. DONE never told it to check the kind of product. Fix in wording: DONE now says the kind of product the goal names must be the current category, and it is not done while the page shows a different one; CLICK names the category link as a valid next step.
3. **Then the fit check rejected the Sneakers link.** With the operation right (CLICK 0.80), the target was torn between the category and opening a white running shoe (0.40), so it went to the fit check, which asked whether the *utterance refers to* the element. A goal does not refer to the Sneakers link; clicking it is just a useful step. The task leash now has its own fit wording ("would clicking this page element be a useful next step toward that goal… answer no for an element whose state already matches the goal"), and click_target says to choose a filter or category before a single product unless the goal asks to open, view or buy one. After both: DONE 0.97 on Sneakers.
4. The compound command first cleared the White filter before doing anything, because a list of actions is neither a refinement nor a search. The slate now clears only when *names a product* is at least 0.5.
5. On the product page it asked "Which size?" although 10.5 was saved: memory was tried once per group per task and had been used on the listing. Now once per group per page.
6. A regex I injected through a shell script lost its backslashes (`\b` became a backspace character). It is now `shared/notices.ts` with tests, and I scanned the source for stray control characters (none left).

**Decisions taken, worth a second look**

- A confident NOT_FOR_ME is shown but not spoken. Saying "Didn't catch that." to every sentence of a side conversation would be worse than silence. A weak NOT_FOR_ME (confidence under 0.5) is treated as "Didn't catch that."
- No new gate on kind confidence. The bias toward ACTION depends on letting a weak TASK or DICTATION fall through to the operation head, and the operation's own confidence already produces "Didn't catch that."
- "Take the first" on the task leash applies to things to open, never to a control group. In the hero scenario Jev chooses DONE at 0.97 to 0.99 and does not try to open a product, but this is the rule to watch.
- Limits of the clean slate: a leftover radio that is not a saved preference cannot be clicked off, and a search query in the URL is not a control either.

## 2026-09-19 · M3b: visual pass

Started 15:22, finished 15:32 EDT (about 10 min). No behaviour changes: `agent/ui/` and the CSS variables file, plus the words of the confirmations.

**Built**

- States gallery first, dev only: `/gallery.html` renders 14 overlay states side by side (idle, listening, heard, confirmation, agent driving, waiting for me, thinking, question card, badges, memory panel, stuck, never silent, typing, no matches), with switches for the scheme (system, light, dark) and the page behind (white, black, half and half). It lives in `agent/ui/` and is served by a small middleware in `vite.config.ts`, so `store/` holds nothing of the agent's. `dist/agent.js` contains neither the gallery nor `__tandem`.
- To put many overlays on one page, `mountOverlay` takes a parent element. A gallery cell is the containing block for the overlay's fixed parts (`contain: layout paint`), and the ring and badges are placed relative to the host's own origin, which is (0, 0) on a real page.
- One capsule: mic (an icon when off, a four-bar blue waveform when listening, moving on `speechstart` and interim results and still when silent), the state in words, what was heard or done, Stop with its Esc hint, sound, memory. The words are also the command field: press `/` or click them. It widens for the transcript and morphs into the question card through `interpolate-size: allow-keywords`, so the height animates to the card's natural size.
- The driver frame: a conic gradient (violet, magenta, amber) rotating once every 8 s through a registered `--t-angle` property, masked to an inset edge with a 6px bright core fading over 40px. Waiting: the glow stops and becomes a 3px blue frame. Thinking: it dims and breathes. Hand-back: a 400 ms fade. `@property` inside a shadow root is ignored by the browser, so the property is registered from script with `CSS.registerProperty`.
- The action ring takes the element's own corner radius plus 4px, scales from 1.06 to 1 and fades over 600 ms; blue in drive mode, the agent's solid violet in task mode.
- Question card: 22px semibold title, chips at least 44px tall with a 14px radius (card radius 28 minus padding 14, so the corners are concentric), a selected chip fills blue with a check, a quiet Skip, the footnote "Say it, or tap." Chips are a radiogroup with arrow-key movement.
- Confirmations in plain past-tense words, from the element's role: Opened, Pressed, Checked / Unchecked, Chose size 10.5, Sorted by…, Searched for…, Typed…, "Used your saved size, 10.5", "Kept your saved size, 10.5", "Size 10.5. I'll remember that." Memory rows end in "Forget".
- Accessibility floor as specified, including an `aria-live` region that announces mode changes, questions and confirmations.

**Contrast check (`scripts/contrast.ts`).** It reads the tokens from `styles.css`, composites the 86% material over a white page and a black page, and checks 12 pairs in each of the four combinations. Two failed with the values as given, both in the dark scheme over a white page, where the material composites to a mid grey (about `#3C3C3D`):

| Pair | Was | Fix | Now |
|---|---|---|---|
| Secondary text on a hovered icon | 4.18 : 1 | dark `--t-text-2` `#B9B9C4` → `#CDCDD6` | passes |
| Blue waveform and focus ring on the material | 2.14 : 1 | new token `--t-you-mark`: `#2563EB` in light, `#8AB4FF` in dark | passes |

`#2563EB` itself is unchanged, because white text on it (selected chips, badges) needs it as it is; only blue *marks drawn on the dark material* use the lighter value. All 48 pairs pass.

**What broke**

- The Narrow-by chips were nearly invisible: they sit on the page, not on the capsule, so a 10% fill had nothing behind it. They now carry the material themselves.
- The gallery scrolled itself on load because badges scroll their target into view; it now returns to the top.

**Not verified here**

- The Browser pane I test in follows a dark system scheme and has no microphone, so the live waveform and the light scheme on the real store were reviewed only in the gallery. Reduced motion, reduced transparency, increased contrast and forced colours are written to the spec but I could not switch those settings on in this browser; they need a look in Chrome's rendering emulation.

## 2026-09-19 · M4: LLM at the edges

**Start 15:43 · End 16:10**

**Built**

- `server/llm.ts`: the only file that knows the provider. `parseGoal` and `verifyAndSummarise` through `@anthropic-ai/sdk` 0.127 (`messages.parse` with a zod output format), 4 s timeout, no retries, typed errors, refusal check. It always answers; on any failure `llm.ok` is false and the caller carries on. The model id is read once, from `LLM_MODEL`. I checked it against the provider before using it: `models.retrieve('claude-haiku-4-5-20251001')` answers "Claude Haiku 4.5". The key is never logged; the log line is model, ms, tokens, stop reason.
- `/api/parse` at task start, in parallel with the clean-slate check. The agent says "On it", the frame dims and breathes (thinking). A refinement keeps the last constraints and overrides what it restates. Constraints travel in every task-leash decide request.
- `/api/verify` at DONE: goal, constraints, a page digest (`shared/digest.ts`) and counts computed in code (`shown`, `priced`, `within_price`). Returns `{ ok, issues, spoken }`; `spoken` over 20 words is dropped in code. The hand-back says it before "Your turn."
- `shared/price.ts`, price is code's job: parse the ranges in the option labels, select an option only on an exact match, otherwise sort ascending once and dim the cards outside the range (`overlay.dim`: a veil and a small tag, page untouched, kept current by a debounced observer). Jev is never offered the price group while a price constraint exists, on either leash, and the task state carries `handled_by_code` so Jev does not wait for a price control before DONE.
- Inspector: "LLM parse (task start)" and "LLM verify (task end)" rows with ms, tokens in and out and the model, next to Jev's ms and tokens; plus constraints and verdict.
- `tests/no-llm-in-drive.test.ts`: runs the real loop on both leashes with the network mocked. It fails if the single leash reaches `/api/parse`, `/api/verify` or either hook, if any server file but `llm.ts` imports the SDK, or if any route but those two uses it. The task-leash case proves the test would notice a leak.

**Acceptance (simulator, real Jev and real LLM)**

| Check | Result |
|---|---|
| "find me white sneakers under a hundred dollars" | Pass. Sneakers, White, saved size 10.5, sorted cheapest first; cards $72 $89 $95 $110, the $110 one dimmed "Over $100"; spoken "Four white sneakers found, three under a hundred dollars. Your turn." About 4 to 6 s end to end. |
| "only the ones under a hundred and fifty" as a refinement | Failed at first, passes now (see below). Filters kept, constraints became Sneakers, White, max 150, nothing dimmed, "Four white sneakers in your size, all under a hundred fifty dollars." About 2 s. Also tried: under ninety (2 dimmed), under sixty (`ok` false, "No white sneakers in your size are under sixty dollars…"), back to a hundred (1 dimmed). |
| Drive-mode timings unchanged from M2 | Pass. Six commands with interims and a 610 ms finalisation delay: all speculative hits, final to action 1 to 3 ms, last interim to action 613 to 628 ms, Jev 162 to 208 ms. Requests made: `/api/warm` and `/api/decide` only. |
| Key removed: M3 hero still passes | Pass. Server started with the key blanked by an environment override (`.env` untouched): "find me white sneakers" ends on Sneakers, White, 10.5 in 1.5 s, hand-back "Your turn." Timeout path checked separately against an unroutable address: gives up at 4.0 s with `ok` false. |

**What broke**

- **The refinement went to Jev, and Jev picked a price.** "only the ones under a hundred and fifty" was routed `kind: ACTION`, so no parse ran, the single leash still offered the price group, and Jev clicked "$75 to $125" (which hid the $72 shoe). Same lesson as M3.1: Jev cannot compare numbers. This time the fix is not wording, because the right answer is that Jev should never be asked: (1) routing a price is code's job, `mentionsPrice` sends an utterance with a price limit straight to the task path, and no speculative decide is fired for it; (2) the price group is hidden from Jev on the single leash too while a price constraint is held. No LLM call was added to drive mode; the guarantee test still passes.
- **Without the LLM, a price request fell back to Jev** and it chose "Under $75" for "under a hundred dollars", then got stuck. A timeout would do the same. Code now reads the limit itself when the LLM does not answer (`priceLimit`: digits and plain number words, under / over / between). With the key removed the priced hero now lands correctly in 1.3 s, with the dimming but without a spoken summary.
- **Verify flagged the dimming as a problem.** With 2 of 4 within the limit it said `ok: false`, "Need to filter by price", though with 3 of 4 it was happy. The prompt now says plainly that a price limit is never a page filter, that dimming is the intended outcome, and that only `within_price: 0` makes it not ok.
- **A list of one result counted as zero.** Result cards were recognised by their ordinal, and a list shorter than three gets no ordinals, so after code chose "Under $75" (an exact match for "under seventy five dollars") the counts said 0 and the summary said "no white sneakers under seventy five dollars" next to a $72 shoe. A card is now a row with an ordinal, or any link that shows a price. Unit test added.
- **A price option chosen in code could not be taken back.** The store's price radios had no "Any price", so once "Under $75" was set, "actually under a hundred dollars" left it on and Jev, not shown the price group, had nothing to do. The store now has an "Any price" radio, as real shops do (it is a shopper feature, not an agent hook). In code: an option named "Any…" or "All…" never counts as set (`isNeutral` in `shared/groups.ts`), and when a leftover price option does not match the constraint, code chooses the neutral one and says "Cleared price Under $75". Without a neutral option the filter is left alone.
- My own tooling, twice: a `\b` written through a shell heredoc arrived in the file as a backspace character (the test caught it; regexes now go through the editor), and the test pane reported a 0 by 0 viewport after I cleared the emulated size, so every snapshot was empty and a healthy build looked broken.
- The echo guard lifted after the first of two queued phrases ("On it", then the summary). It now counts queued phrases.
- The first parse call with a new schema took 3.5 s (the provider compiles the schema once), close to the 4 s timeout. Warm calls take 0.8 to 1.5 s. If a first call ever times out, the code fallback above covers the price and the task carries on.

**Jev wording changed**

- Task-leash `operation`: one sentence added. "If `handled_by_code` is present, it lists parts of `goal` that the assistant already takes care of outside the page: ignore those parts when choosing, and do not wait for them before DONE." Without it Jev kept looking for a price control. No thresholds changed in M4.

**Surprises**

- Haiku parses "a hundred and fifty" correctly every time, and maps "white sneakers" onto the page's own category and colour names because the parse sees the page's categories and filter groups.
- The LLM is 4 to 8 times slower than Jev (0.8 to 1.5 s against 0.16 to 0.25 s), which is the whole argument for keeping it at the edges: a task pays for it twice, a drive-mode command never does.

**Known limits**

- Constraints live in memory. A full page load forgets them, and the dimming with them (the demo store navigates without reloading).
- With the LLM away there is no spoken summary; code has the counts and could say them, but that was not asked for.
- `mentionsPrice` is a plain pattern. "check the under 75 price filter" goes to the task path too (code then selects "Under $75" because it matches exactly), which is right but slower than a drive-mode click.

## 2026-09-19 · M5, steps 1 and 2: de-shop the core, open shadow roots, blockers

**Start 16:23 · End of step 2 17:14** (M5 continues: the Chrome extension and the real-site trial follow.)

Sean redefined M5: take the same agent to the real web through a Chrome extension. The old stretch list (vision pass) is dropped. The store demo must keep working exactly as it does. Sean asked for workflows on this milestone, so two ran: a read-only audit and design pass (4 agents: wording in `questions.ts`, prompts and the `Constraints` ripple, shadow DOM, blockers) while I built the gym and took the baselines, and an adversarial review of the finished diff (findings at the end of this entry).

**How the scores were compared.** The two older probes hard-code their wording, so re-running them re-measures old sentences. New: `scripts/probe-heads.ts` sends fixed requests through the real routes of the running server (`/api/decide` on both leashes, `/api/slate`, `/api/fits`, `/api/match`), saves all 264 scores, and diffs two files. Two identical runs already differ on 4 scores (noise floor: a typed_span confidence by 0.10, one operation by 0.14, and "task white set" flips between DONE and CLICK at about 0.5), so a move counts only when it shows against both baseline runs.

**Step 1 · De-shop the core**

- *Jev wording, seven sentences.* "kind of product" became "kind of item (for example, on a shop, the kind of product)" in the task-leash CLICK and DONE criteria; the click_target rule became "a single result in a list, for example a single product on a shop … or names that exact result" (without that escape "find the article on Alan Turing" would never open a search result); the `personal` Noul lost "who will use the product"; `refines` and `names_product` were reworded. Kept as they were, on the auditor's advice: the kind question, both fit questions, the match question, the `handled_by_code` sentence, and "it is not a preference such as colour, brand, style, material or price", which holds the non-size groups at 0.02 to 0.03.
- *LLM prompts.* "a shopper … a shop page" became "a user … the web page they are on; the page may be any kind of site". Verify no longer treats "no results" as a failure when the goal was to reach one page, and says what is open instead of forcing a count. `search_query` now covers "names a specific thing to find that the page does not already list".
- *`Constraints` is generic:* `{ search_query?, attributes?, max_price?, min_price?, visual_prefs?[] }`. Category and colour are attributes. `shared/constraints.ts` holds the three pure pieces: pairs to record, key-by-key merge for a refinement ("make them black" keeps the category), and the flat form Jev reads, so Jev's state has the same shape it had in M4.

**Scores that moved by more than 0.1** (against both baseline runs):

| Score | Before | After | Decision changed? |
|---|---|---|---|
| slate "show me the arco ones in white" · names product | 0.68 | 0.41 | No. Still a refinement; the margin under *refines* (0.75) grew from 0.06 to 0.34 |
| slate "only the ones under a hundred and fifty" · names product | 0.18 | 0.35 | No. *refines* is 0.90 |

Nothing else moved beyond the noise floor: every kind, operation and target head, the needs Nouls (the reworded `personal` sentence, added to `probe-needs.ts` as D5, is within 0.02 of the old one on every group and goal), fits and match. One consistent non-score change: on a fixture where the operation is DONE, the unused click_target head names `none` where it used to name "Under $75".

**What broke in step 1**

- **The first neutral `names_product` flipped a refinement into a new search.** "names a kind of item to look for" is broader than "kind of product": "show me the arco ones in white" rose from 0.68 to 0.84, above its *refines* score of 0.75, which would have cleared filters. Fixed in the wording, not the threshold. Four variants probed (`probe-slate.ts`, R3b to R3d); the winner asks for a NOUN: "`goal` contains a noun for the kind of thing to look for (on a shop, a kind of product…; on a news site, a kind of story). A brand, a colour, a price or a word such as "ones" is not such a noun." New searches 0.75 to 0.90, refinements 0.30 to 0.50, "find the notification settings" 0.27, "show me the newest stories about rust" 0.85. It separates better than the shop wording did ("the leather ones" 0.62 before, 0.44 now).
- **A free-form record cannot go into a structured-output schema, and it fails silently.** The SDK forces `additionalProperties: false` on every object, so `z.record` becomes an object with no properties: the model could only ever answer `{}`, which still validates. The auditor found this by running `zodOutputFormat` locally. The LLM now returns `{name, value}` pairs.
- A new schema pays a one-time compile: the first parse took 3.9 s against the 4 s timeout, then about 1 s. I warmed it before the acceptance run.
- jsdom gets `:scope > legend` wrong inside a shadow root (the group came back as the page heading). The legend is now found among the fieldset's children, which means the same thing.

**Open shadow roots.** `agent/dom.ts`: deep query in reading order (never into the agent's own overlay), composed parent / closest / contains, deep hit-testing, deep active element, id lookup in the element's own root. The design agent caught what my first pass missed: the heading lookup compared document positions across trees, which is arbitrary (now one tree at a time, with the host standing in for the element); synthetic `input` and Enter events were not `composed`; collections, `main` and the search-field check still stopped at the boundary. A page without shadow roots takes the plain `querySelectorAll` path. `tests/shadow.test.ts` (11 cases) uses small custom elements: controls, a `<slot>` name, a nested component, component cards in a list (ordinals, group from the heading outside), `aria-labelledby` scoped to the root, focus inside a root, a click that resolves through the host, a covered target still refused, a closed root never seen, the overlay never read.

**Step 2 · Blockers**

- `?gym=hard` did not exist; built it as the spec describes (`store/src/gym.ts`): cookie banner, newsletter `<dialog>` after five seconds with "Subscribe and save" and "No thanks, I'd rather pay full price" and no close button, Size and Closure behind "More filters", the sort as a custom listbox. Easy mode renders the same markup as before.
- Code removes what may never be pressed (accept, agree, allow, subscribe, sign up, join, register, buy, and the deny-list) unless a refusing word comes first or the name keeps only what is necessary. An exact plain refusal or close is taken in code. The rest goes to Jev.

**Jev on blockers, three attempts**

1. One Choice over the controls, with a long instruction listing what qualifies and what does not. It named the right control every time but without conviction: confidence 0.47 to 0.74, with 0.17 to 0.39 on `none`, and it refused a lone guilt-trip link outright (`none` 0.52). Same lesson as the needs Noul in M3: a compound with negatives scores poorly.
2. Two literal Nouls per control, *refuses* and *accepts*, combined in code as refuses × (1 − accepts). Probed with the control as a state key: every refusal or close 0.74 to 0.85 ("No thanks, I'd rather pay full price" 0.81, "Close" 0.81, "Continue without accepting" 0.78), everything else 0.48 or less ("Got it" 0.04, "Manage preferences" 0.09, "(no name)" 0.27).
3. The same two Nouls in ONE request for all controls, with each control's name written into its instruction: every score sank to between 0.2 and 0.36. **The thing being judged has to be a state key, not part of the instruction.** So it is one small request per control, sent in parallel (150 to 380 ms for the lot, 6 controls at most). Through the real route: 10 of 11 fixtures as wanted at `DISMISS_MIN` 0.6. The miss is "Use necessary cookies only" at 0.37 (Jev reads "use … cookies" as accepting something), which is one of the exact names code takes before Jev is asked.

**Acceptance, `?gym=hard`, by simulator**

| Check | Result |
|---|---|
| Pop-up open at task start, "find me white sneakers" | Pass. "Dismissed a pop-up", "Checked White", "Opened Sneakers", done. |
| Pop-up arrives mid-task (priced hero started at 3 s) | Pass. It landed between the snapshot and the click, so the covered check caught it: Subscribe removed in code, Jev scored the refusal 0.87 (refuses 0.93, accepts 0.06) in 178 ms, the click was retried, done in 3.3 s with a correct summary. |
| Drive mode, pop-up open, "check white" | Failed at first: Jev was only unsure (operation 0.40), not "not found", so my retry condition missed it. Now any ignore except "not for me" dismisses and looks once more. "Dismissed a pop-up", "Checked White", 1.4 s. |
| Cookie banner covers "Load more" | First run: the banner only half-covered the button, its centre was clear, and the click went through with no dismissal, which is correct. With the banner as tall as real ones: "Closed the cookie banner" ("Necessary only", chosen in code, no model call), "Pressed Load more", 0.6 s. |
| "Subscribe and save", "Accept all" | Never pressed, never shown to Jev. |

Not passing in hard mode, and left alone: the saved size is not applied, because Size sits behind "More filters" and the agent only uses groups it can see; and code cannot sort cheapest-first, because the sort is a custom listbox rather than a `<select>`.

**Store acceptance re-run, easy mode, after all of the above: all pass.** M3: hero run 1 asks "Which size?" with the page's chips, "ten and a half" is saved as 10.5; run 2 ("find me black boots") keeps the saved size and never asks; the clean slate case (Running + Grey, Brown, Arco, 10.5) clears 3 old filters, keeps the size, checks White, opens Sneakers, DONE 0.98, three times out of three; "open a product, pick a size and then add to cart" done in 4.1 s; a task in the cart hands back "This one's yours"; "click checkout" in drive mode asks "Click Checkout?" and "no" leaves it alone; Esc stops a task; an impossible command says "I can't find that on this page." M4: the priced hero ends on Sneakers, White, 10.5, sorted, one card dimmed "Over $100", "Four white sneakers in your size, three under a hundred dollars."; the refinement keeps `{ category, colour }` and nothing is dimmed at 150. Drive mode: six commands, all speculative hits, final to action 1 to 4 ms, Jev 167 to 241 ms, and only `/api/warm` and `/api/decide` were called.

**The adversarial review** (3 finders by dimension, one sceptic per finding, 17 agents): 14 findings, all 14 confirmed, none refuted, all fixed before the commit, each with a test.

- *Safety.* `declines()` only compared word positions, so inside a pop-up "No thanks, continue to checkout", "Skip to checkout" and "Don't wait - Buy now" lost the deny-list, and "Close and accept" or "Dismiss and subscribe" were not removed before Jev. A refusal is now recognised by its shape (the guilt trip in the first person, or necessary-only), which fails towards asking. The exemption reached any fixed or sticky box, including the store's own sticky header; it now reaches dialogs and cookie boxes only. A link named "X" was pressed as a close button. Hidden text inside a pop-up reached Jev through `textContent`; it is `innerText` now, and `control` is declared page content too (re-probed: still 10 of 11).
- *Correctness.* A web app's fixed shell was taken for the blocker, so a page button named "Decline" could be pressed in code: a blocker never contains its target. The drive-mode second look was skipped when the fit check gave up first, and it could fire on background speech weakly classed as not-for-me and close a dialog the user had opened on purpose. The retried click could land after "stop". A timer pop-up that appeared during an action's settle was adopted as part of the flow and never dismissed. The inspector lost the blocker row on the drive retry. A snapshot scoped to a component did not enter the component's own shadow root or follow its slots, so a web-component cookie banner had no controls.
- *Store and constraints.* Hard mode stuck to the tab after a plain reload of "/", which would have run the easy-mode acceptance against the wrong shop; it is decided once per document now. The price guard missed "max_price"-style attribute names, and an attribute could shadow a Constraints field once flattened. "White or black" lost its second value; repeated values are joined.

**One more, mine:** on the last easy-mode pass the summary for the unpriced hero said "all under a hundred dollars" (one shoe is $110). The model had echoed the shop example in the verify prompt. The prompt now says to mention a price only when the constraints have one, with an example of each kind, and code drops a summary that mentions a price when the goal set none.

**Found on the way, not caused by M5.** From "Running + Grey + 10.5" (one old filter, not three) the task clears Grey, checks White and then says DONE at 0.89 while still on Running. I put the old M4 sentences back to check: same result, 0.89 to 0.90. The page state is identical to the passing case; only the history line differs ("cleared 1 old filters" against "cleared 3"). Recorded as a known weak spot, not fixed here.

**Surprises**

- Chrome delivers a dialog's `close` event with the next frame, so in a background tab it never arrives. The gym pop-up now cleans up on submit and on Esc instead. My test pane is a background tab, which is also why an emulated viewport is needed for every browser check.
- The first time the covered path ran for real it was not the case I had built it for: the pop-up appeared between the snapshot and the click.

**Known limits after steps 1 and 2** (they go into the README with step 4)

- Closed shadow roots and iframes are invisible. Group labels follow ancestors through the host, not through slots.
- A banner whose only control is "OK" or "Got it" stays, because pressing it usually means consent. An icon-only close button with no accessible name cannot be judged.
- A native modal makes the rest of the page inert, including the agent's own capsule: it cannot be clicked while a page's modal is open. Voice still works.
- The task leash cannot type. `search_query` is parsed but nothing uses it yet, so "find the article about Alan Turing" can only click. This will dominate the real-site trial; proposed for the next step: TYPE on the task leash, with the text from `search_query` (written by the LLM at the edge, never by Jev) and the criterion left out when there is no query, so the store's questions stay word for word the same.
- The clean slate is still only proven on the shop. With the noun wording a settings request scores 0.27, so it does nothing there, which is the safe direction.

## 2026-09-19 · M5, step 3: the DONE gate, typing on the task leash, the Chrome extension

**Start 17:32 · End 18:17** (step 4, the real-site trial, follows Sean's run.)

Sean's decisions going in: per-site grants instead of either of my two options; typing on the task leash with guardrails in code; a DONE gate as one Noul per attribute; the two hard-mode failures wait until after the trial. Three workflows again, all small: MV3 facts checked against Chrome's docs (3 agents, in the background while I built the gate), and an adversarial review of the finished diff.

**The DONE gate, and what the weak spot really was**

- Probed first (`scripts/probe-met.ts`, five page states, two attributes). Sean's wording, "The page is currently showing results for {name}: {value}", got 9 of 10 on the right side of 0.5. A more literal one, "In `snapshot`, {value} is already applied for {name}: it is the current section, a checked or selected option, or the words already in the search field", also 9 of 10 but with more room: applied 0.89 to 0.91, not applied 0.05 to 0.57. With the bar at `MET_MIN` 0.75 it is 10 of 10. The one hard case for every wording: All shoes + White with the Sneakers section never opened, where the result list happens to be mostly sneakers (0.57).
- **A reversal worth keeping.** For the blockers the thing judged had to be a state key; written into the instruction the scores turned to mush. Here it is the other way round: with the attribute as a state key (`attribute`) only 6 of 10 came out right, and written into the statement 9 of 10. My reading: a control's name is an arbitrary string Jev must not interpret, while "White … for colour" is something the statement is about. I would not have guessed either result.
- **Then the gate showed that the Choice was not the culprit.** From Running + Grey + 10.5 the three runs still ended on Running, and the gate agreed they were done: `category: Running 0.89`. The constraints themselves were wrong. The LLM parse had answered `category: Running` for "find me white sneakers", because the page digest told it which section was current, and Jev was faithfully following a wrong constraint. Through the route directly: Sneakers, Running, Sneakers, Sneakers, Running. Removing the "(current)" marker and the set filters from what the parse sees was not enough (still 2 of 5 wrong; the page title "Running shoes" primes it too).
- The fix is the project's rule applied once more: **exact matches are computable, so they are code's job**, as a correction. For an attribute the LLM itself returned, when its value is one of the page's options but the goal literally says a different one, and only that one, code puts the said one back (`correctAttributes`); the LLM keeps "trainers". My first version also ADDED attributes from any goal word that matched a link, and the review showed what that does off the shop: "find the article about business in china" became `category: Business, About`, and "the new iphone" matched News. After that: 3 runs of 3 end on Sneakers, DONE 0.98, and the gate's Nouls follow the page step by step (category 0.08, then 0.87 after the click, 0.92 at DONE; colour 0.04, 0.92).
- The gate stays, as the backstop it was meant to be: unit tested, at most two refusals per task, then DONE is accepted and verify says what is off. The `unmet` sentence is in the operation question only when something is unmet.

**Typing on the task leash.** TYPE is offered only with words that are not Jev's (the LLM's `search_query`, or a `typed_span` over the goal when the parse is unavailable), only into a search-like field that code picks, once per task for the same words. Through the real route on a Wikipedia-like page: TYPE 0.99 with a query; on the fallback TYPE 1.00 and typed_span "Alan Turing" 0.77; with nothing on offer Jev would have clicked a link (CLICK 0.89); after the search it opens the "Alan Turing" result. On the store Jev preferred the Brand filter to searching for "the Northfield Court Classic", which is a fair route there. `tests/questions-pinned.test.ts` holds the store's wording to what it was at 22ac82b when there is no query: written before I touched anything.

Also: an ARIA combobox on a text input (Wikipedia's search box) is now a text field, not a dropdown; the verify summary no longer names individual results.

**Safety, in code.** Password and payment fields are listed but never a target, and the executor refuses them on either leash. On the task leash a control that submits a form is pressed only when the goal names it; the store's "Add to cart" is a submit button, so the compound-command acceptance exercises exactly that path. A search form is the exception.

**The extension**

- `agent/env.ts` is the only seam: API calls, preferences, the saved task. `agent/boot.ts` is what `index.ts` used to do at import time, as a function, so the content script can set the environment first. The agent never asks where it is.
- Per-site grants work the way Sean asked, with one thing that cannot: **on a site that has not been granted, an extension can draw nothing, so the capsule cannot say "Paused" there.** `activeTab` is revoked on a cross-origin navigation and there is no host permission yet. The badge and its tooltip carry the message; the capsule says it when access is taken away while the page is open. `permissions.request` from the toolbar click does work in a service worker: Chromium's own browser test does exactly that. It has to be the first statement of the handler, so the worker asks before it knows whether the click means on or off; asking for a granted site answers true with no prompt, so that costs nothing.
- Other facts from the docs that shaped the code: without the `tabs` permission a tab's URL is simply absent for sites without access, and that absence is the pause signal; per-tab badges are cleared on navigation; `storage.session` is not visible to content scripts; an `onMessage` listener must not be async; custom elements do not exist in a content script's world (the overlay host was already a plain element); a constructed stylesheet is not subject to the page's CSP.
- Resume: the loop saves the task after every step and, just before every action, again with that action recorded as done, because a click on a link unloads the page before anything after it can run.
- **What I could check, and what I could not.** I cannot load an unpacked extension into my test pane. So `extension/dev/harness.ts` runs the real content script on the demo store with a stand-in worker built on the same `state.ts`, and makes every link a full page load. There the hero task used the saved size from the stand-in `chrome.storage.local`, checked White, clicked Sneakers, died with the page, and on the new page said "Carried on after the page loaded", decided, verified and cleared the task, with no second parse and no second clean slate; styles came in through `adoptedStyleSheets` (one sheet, no style element). Chrome's own side, the prompt, injection, the badge, pause and resume across real sites, is Sean's to check; the README has the steps.

**What broke**

- A heredoc ate my escaped backticks once more, in a probe script; caught by the compiler. Anything with a backtick goes through the editor.
- The extension wrote the tab's state after injecting, so the content script's first question ("am I on?") could be answered "no". State is written first now, and rolled back if injection fails. The load flag was also left set when the answer was no, which would have blocked the next injection.

**The adversarial review** (3 finders, one sceptic per finding, 18 agents): 14 findings, all 14 confirmed, none refuted, all fixed before the commit, with tests where a test can reach.

- *The one that mattered most:* the snapshot sent every input's current VALUE, so a typed password or card number would have gone to the local server and on to Jev. A secret's row now says "filled" and nothing else, and secrets are recognised the way real checkouts mark them (section- and billing-prefixed autocomplete tokens, and the field's own words when autocomplete is off). On real sites the snapshot also reports only the URL's path and parameter names.
- *Real multi-page sites:* after a click that starts a page load the old document lingers, looking unchanged, so the loop kept deciding on the dying page, overwrote the saved "done" record with "no change", and could end the task before the new page arrived. My localhost harness commits too fast to show this. Now, once `beforeunload` fires, nothing more is decided on that page. Actions taken in code (memory, price, the clean slate, an answered question) are saved before they act too; a task whose clean slate reloads the page is marked fresh and starts again properly on the next page. A page woken from the back/forward cache no longer carries on an old task.
- *Forms:* any form that merely contained a search input counted as a search form (a registration form with a tag picker would have been submitted), `type()` submitted whatever form enclosed a search-like field (a checkout with "Search for your address"), and `asksFor` accepted any goal containing the button's words ("find me a sign in sheet"). All three are strict now.
- *A hostile page* could have driven the capsule with made-up events, or pressed "Yes" on the confirm card. In the extension the shadow root is closed and untrusted events are ignored. A consequence: my own tools cannot type into it either, so the harness starts a task by handing the stand-in worker a saved one, which is the resume path anyway.
- *The worker:* two saves in one tick both read the old record and the second undid the first (the constraints never survived); every change to a tab's record now goes through one queue, and injection happens outside it so a slow page cannot block other tabs. Injection no longer waits for the load event. A repeat injection re-syncs instead of doing nothing, which fixes the capsule staying hidden after Back from a paused site. An orphaned content script's `sendMessage` throws rather than rejects; caught.

**Acceptance after all of it, by simulator:** the gate case 3 of 3 on Sneakers (DONE 0.97 to 0.98); M3 hero runs 1 and 2, the clean slate (3 old filters), the compound command through the submit rule, Checkout never clicked on a task, the confirm card, stop; M4 priced hero (1 dimmed, "three under a hundred dollars") and the refinement (attributes kept, nothing dimmed); six drive commands, all speculative hits, final to action 1 to 4 ms (48 ms once, behind a 320 ms Jev call), only `/api/warm` and `/api/decide` called; hard mode: pop-up dismissed in drive and task mode. 300 unit tests.

**Not verified by me:** anything that needs Chrome's extension system. The per-site prompt from the toolbar click, injection, the badge, pause on an ungranted site and resume after the grant are built from Chrome's documentation and Chromium's own test, not from a run.

## 2026-09-19 · M5, step 4, trial fix 1: the mic and the voice across page loads

**Start 21:31 · End 22:05** (the first of the two trial fixes. Found by Sean in his own Chrome run, not by me: I cannot load an extension into my test pane.)

What Sean saw: on every page load the mic turned off and he had to click it again. The content script dies with the page, and the mic's on/off lived only in it. He also predicted the next failure before it happened: once he stops clicking the mic, a freshly loaded page has had no click at all, and Chrome would not let the agent speak.

**Checked against Chrome's docs before writing code** (a small docs workflow, as for step 3)

- *Speech output: Sean was right where it matters.* Since Chrome 71, `speechSynthesis.speak()` in a document that has had no user activation gets an `error` event, `not-allowed`, and says nothing. The nuance: activation carries over a same-site navigation that the page itself started (a click on a link), so on a single site the page's voice would often have kept working. It is lost on a new site, a typed address and a reload, which is exactly where M5 lives.
- `chrome.tts` needs the `tts` permission (no install warning), needs no gesture, and works from the service worker. Three details shaped the code. It **defaults to `enqueue: false`**, which cuts off whatever is being spoken, so "On it" followed by "Which size?" would have lost the first phrase; we pass `enqueue: true`. A phrase can end four ways (`end`, `interrupted`, `cancelled`, `error`) and no voice is obliged to send any event, and speaking does not keep the worker alive, so the echo guard cannot depend on the events alone. And `chrome.tts.stop()` is global, not per tab.
- *Recognition: the surprise, and it changed the design Sean described.* `SpeechRecognition.start()` needs no gesture. On a site that has never been asked it does **not** fail with `not-allowed`: it makes Chrome's microphone prompt pop up, on page load, by itself. "Start, and if it fails say so" would have meant a permission prompt jumping out at Sean on every new site. So the page first asks `navigator.permissions.query({ name: 'microphone' })`, starts only when the answer is "granted", and otherwise shows Sean's sentence, "Click the mic to allow it on this site."; the click is then the gesture, and the prompt appears because he asked for it. Where the permission cannot be queried it starts, and a refusal shows the same sentence.
- *Second surprise:* Chrome runs **one** recognition session for the whole browser. With the mic remembered per tab, two enabled tabs would have taken it from each other for ever through the restart-on-end. Listening now follows the visible tab: a hidden tab lets go and picks it up again when shown.
- "Allow this time" is forgotten at the next navigation (the README now says to choose "Allow while visiting the site"). A site that sends `Permissions-Policy: microphone=()` cannot be listened on from a content script at all.

**What was built**

- `agent/env.ts` gains two things the agent does not need to know the origin of: `speech` (speak with start and end callbacks, cancel) and `mic.save`. The store's defaults are `speechSynthesis` and nothing; `dist/agent.js` still contains no `chrome.*`.
- The worker keeps `mic` in the tab's record. **Only the user's own toggle is saved.** A stop the agent makes for its own reasons (the toolbar turning Tandem off, a pause on a site without access, being refused the microphone) is not the user's choice, so `setMic` takes `remember: false` for those. Turning Tandem off forgets the mic; a pause keeps it.
- On load the worker's `hello` answers `{ on, task?, constraints?, mic? }`, and the content script does two independent things: `if (hello.task) resume`, `if (hello.mic) listen`. Neither awaits the other; a resumed task is already deciding while the permission query is still out.
- Speech: the page sends `tts:speak` with an id; the worker speaks only for a tab that is on and not paused, and only a short string (`maySpeak`); `start` and every final event go back to the tab under that id. The echo guard goes up when the agent decides to speak, a failsafe (800 ms plus 90 ms per character) is re-armed when the phrase really starts, and any final event lowers it. If the worker cannot speak, the page's own voice is tried. A page on its way out does not send `tts:stop`, or stopping the old page's loop would silence what the new page has begun to say.
- Tests without Chrome: `tests/voice.test.ts` (guard, queued phrases, a lost end event, a late start, remember semantics for mic and mute, the visible-tab rule, the `listen()` cases for granted, prompt, denied and refused) and a voice block in `tests/extension-state.test.ts`. 325 tests pass.
- `TRIAL.md`: the voice test script for step 4 (Wikipedia, Hacker News, and a shop section written to fit whichever shop Sean picks), so the trial does not wait on another round trip.

**Jev wording:** untouched. Nothing here asks Jev anything.

**The adversarial review** (2 finders, one sceptic per finding, 10 agents): 8 findings, all confirmed, none refuted; 6 distinct. One more I found myself on a re-read. Fixed before the commit, with tests where a test can reach:

- *The one the fix itself caused:* **the worker's voice outlives the page.** A page's own voice died with the page; `chrome.tts` keeps talking. The next page listened at once, with its echo guard down, and would have heard the tail of "…sorted by price. Your turn." as a command. A page that has just loaded now asks the worker whether the browser is still speaking and waits until it is quiet (10 s at most) before listening by itself; a click on the mic during the wait wins; the resumed task waits for none of it.
- *A hole my own test had hidden:* a phrase queued behind a long one could start after its failsafe had fired, and the start only re-armed a spent timer, so "Which brand?" was spoken with the recognizer live. A late start now takes the guard back. My test "counts the time from when the phrase really started" passed only because its wait was shorter than the failsafe.
- *Sean's sentence was wrong for one state.* "Click the mic to allow it on this site." is right where Chrome would ask, and false where the microphone is blocked (by the user once, or by the site's `Permissions-Policy`): there a click cannot help, and the capsule now says it is blocked and where to allow it. The hint also never went away: a user who had clicked and was listening was still being told to click, which would have turned the mic off. It is replaced by "Listening". Writing the test for this found an ordering surprise: the recognizer reports "listening" before Chrome has answered, so "clicked and still refused" needs its own flag.
- *The same bug as Sean's, one button to the right:* mute lived in the page too, and until now nobody could notice, because a freshly loaded page was silent anyway. With the worker speaking, a muted agent would have talked again after every load. Mute is kept per tab like the mic; restoring it cancels nothing, because `chrome.tts.stop()` is browser-wide.
- The mic also comes back after a pause and re-grant in the same document, and after a back/forward-cache restore (my own finding: that document remembers the mic as it was when it was left).
- Speak and stop go through the worker's one queue, so a "stop" cannot overtake the phrase it is meant to stop.

Written up, not fixed: one voice for the whole browser (a background tab's phrase can be heard by the tab in front; Stop or Mute in one tab can cut the other's phrase). The reviewers offered a per-tab bookkeeping fix; an extension-owned page would own the voice and the guard together, so it goes with next step 1.

**Limits written up, not fixed** (README, Known limits and Next steps, as Sean asked): a short deaf gap while a page loads; microphone permission is per site and goes to the site itself, not only to Tandem; only the visible tab listens. First under Next steps: move recognition into a page the extension owns (offscreen document or side panel). One honest caveat recorded there: offscreen documents have a `USER_MEDIA` reason, but the docs say nothing about speech recognition in one, and a permission prompt cannot be shown there, so it is a direction to prototype, not a promise.

**Not verified by me:** all of it that needs Chrome's extension system: `chrome.tts` actually speaking, the events arriving, listening starting by itself, the permission states on real sites. The store still passes its simulator run with the page's voice, re-run after the review fixes: "scroll down" acted 378 ms after the final transcript (Jev 363 ms), the guard went up for "On it" and came down, mute pressed and released, and the priced hero asked for the size, saved 10.5 and ended "Found eight white shoes, four under a hundred dollars. Your turn." with four products dimmed. Sean has a two-minute check.

## 2026-09-19 · M5, step 4, trial fix 2: dense pages

**Start 23:02 · End 23:23** (the second and last trial fix; Sean's OK at 23:02, with two decisions: spend fix two on the row cap, and write the unlabelled Hacker News search box up as a limit.)

**The pass line for the bench, written before running it** (`scripts/bench-decide.ts --rows=180,240`, store-shaped rows, 10 calls per cell). Today at 120 rows: p50 208 ms. For a row count to be accepted: p50 under 400 ms; no single call over 1,500 ms (the drive leash gives up at 2,500 ms and does not retry); operation 10/10, target 6/6, span 1/1, as at 120 rows. If 240 fails and 180 passes, the cap is 180. If 180 fails, stop and tell Sean.

**What Sean saw.** On Hacker News, "click more" did nothing and the search did nothing, with both on screen in front of him. His guess: "maybe the bottom of the screen gets clipped off". Close: not the screen, the list.

**Measured on the live pages** (my pane, his window size, 1860 x 950), before designing anything:

- Hacker News front page, scrolled to the bottom: 227 usable controls, all 227 inside the snapshot's window (one viewport above, two below), **175 of them on screen at once**. The snapshot kept the first 120 in reading order and ended around story 16. "More" is row 218, the search box row 227. Jev was never shown either.
- Wikipedia, top of the Alan Turing article: 2,550 usable controls on the page, 197 in the window, 128 on screen; on-screen rows 121 to 153 were cut. Mid-article: 123 and 45.
- The demo store: about 60. That is why three milestones never met this.
- The search box has a second, separate problem: `Search: <input type="text" name="q">`, no label, placeholder, aria-label or submit button; the word is loose text beside it.

**The design** came out of a workflow Sean's ultracode setting asked for: four independent designs (geometry, what the user said, fewer and better rows, the unlabelled field), a sceptic on each, one synthesis; 9 agents, read-only. All four survived only with repairs, and the plan that went to Sean is simpler than any of them:

- **One rule and one number.** `MAX_ROWS` 240. At or under it, every row near the viewport, in reading order, the very same array (so any page that had 120 or fewer is byte-identical, the store included). Over it, rows on screen first, then the rest, ties in reading order, and the kept rows still listed in reading order (`shared/keep.ts`, 5 lines, the same pattern as `shared/fits.ts`). Ordinals are still computed before the cut.
- Why not a cleverer anchor at 120: 175 on screen is more than 120, so any anchor cuts 55 rows the user is looking at; a bottom anchor saves "More" and breaks "the first one".
- Why 240: click_target is one Choice; the docs cap a Choice at 255 labels and call it reliable "up to roughly 240".
- Why on-screen-first at all, when no measured page passes 240: Hacker News sits at 227. Without the rule the bug Sean reported comes back word for word at row 241.
- Wide housekeeping snapshots (clean slate, digests, dimming, pop-ups) keep the first 120, exactly as before (`MAX_WIDE_ROWS`). The server's zod limit follows `MAX_ROWS`, in the same commit, or every dense page would have been a 400.
- Rejected, with the sceptics' reasons: seating rows by the words the user said (five tiers and a stop list in front of the judge, and it still cut 13 on-screen rows on Wikipedia); dropping "filler" rows (the premise was false: `describeRow` prints group and state, so same-named buttons Jev can tell apart were classed as filler); a two-budget geometry with a page-end anchor (16 tests for pages no measurement reaches).

**The bench, against the pass line above** (`scripts/bench-decide.ts --rows=120,180,240`, same session):

| rows | style | p50 ms | min | max | tokens in | operation | target | span |
|---|---|---|---|---|---|---|---|---|
| 120 | described | 210 | 191 | 298 | 9,107 | 10/10 | 6/6 | 1/1 |
| 180 | described | 259 | 220 | 276 | 14,501 | 10/10 | 6/6 | 1/1 |
| 240 | described | 261 | 238 | 379 | 19,809 | 10/10 | 6/6 | 1/1 |
| 240 | ids | 244 | 180 | 312 | 11,868 | 10/10 | 6/6 | 1/1 |

240 passes every line, so the cap is 240. Doubling the rows cost 50 ms at the median. **Surprising about Jev:** latency is nearly flat in the size of the state: from 9k to 20k input tokens the median went up by 24%.

**The real rows, not only store-shaped ones** (`scripts/probe-dense.ts`: fetches the Hacker News front page, builds its 227 rows, asks the running API): "click more" -> More, confidence 0.94; "click new" -> new, 0.86; "open the jobs page" -> jobs, 1.00; "scroll down" -> SCROLL_DOWN. About 8,700 input tokens, 224 to 480 ms. Thirty nameless upvote arrows and thirty "hide" links did not confuse it for these.

**Jev wording:** untouched. `tests/questions-pinned.test.ts` still green.

**The adversarial review** (2 finders with different lenses, one sceptic per finding, 8 agents): 6 findings, all confirmed, none refuted, 4 distinct. None was in the new rule itself; the useful ones were downstream of it.

- *Fixed: an off-by-one from M2 that this change would have walked straight into.* `fitPool` kept the first 40 alike candidates and then added the preferred row on top, so whenever the preferred row was not among the first 40 it sent 41, the server (max 40) answered 400, and the fit check failed without a sound: two raw badges on the drive leash, "stuck" on a task. On the store that never happens (its groups are small). On Hacker News every link is alike (no headings, no groups), so every row past the fortieth link had it, and every row this fix newly admits, "More" included, is past the fortieth. The preferred row now takes its seat inside the cap; test with 227 alike rows and the anchor at rows 1, 40, 41 and 218.
- *Corrected in the README:* my 8,700-token figure for Hacker News came from the probe's bare rows; the real snapshot adds an ordinal or an off-screen mark to about half of them, so roughly 10,000 to 12,000 (the reviewer's estimate; Sean reads the real number off the inspector).
- *Written up, not fixed:* rows go to Jev twice under the `described` label style (once in the state, once as the label), so 240 long-named rows under long headings can pass the 32k budget, which 120 never could; every decision on such a page would then fail. Estimated, not measured; no measured page is near it (Hacker News about 10k, the bench about 20k). One reviewer offered a four-line fallback to the `ids` style over a character budget; the other advised against changing what Jev sees inside the time box, and the design round had already rejected a budget as guarding a case no measurement reaches. README has the sentence and the workaround (the inspector's label-style switch).
- This entry itself, caught unfinished with its placeholder end time. Fair.

**Written up, not fixed** (README, Sean's decision for the search box): the unlabelled search field (about ten lines, deliberately left out: a third fix, and it renames fields on every page); more than 240 controls near the viewport; housekeeping reading only the first 120; rows Jev cannot tell apart. The two hard-mode store failures (Size behind "More filters", the custom listbox sort) are now limits too: both fixes are spent.

**Checked by me:** 337 unit tests, `tsc`, both bundles; the store by simulator on Sean's running dev server ("open the second one", "go back", "check white", then "find me black boots": cleared the old White filter, used the saved size 10.5, opened Boots, checked Black, DONE, verdict ok). **Not checked by me:** the extension in real Chrome. Sean retests "click more" on Hacker News from the bottom and from the top, "open the third one" there (Jev now sees all 30 stories instead of about 16), and a link low on the first screen of a Wikipedia article.
