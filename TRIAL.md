# Real-site trial (M5, step 4)

A voice test script for three kinds of site. Say each line (or press `/` and type it). Keep the inspector open (`i`). For each line note: **worked / wrong / nothing**, and the inspector's `result`, `policy` and `final transcript → action` rows when it did not work. I fix at most the two cheapest failures (the mic across page loads was the first); the rest goes into the README as known limits.

Before starting: `npm run dev` running, `npm run build:ext` done, the extension reloaded, the page reloaded.

On every site, three numbers in the inspector's `model` row are worth writing down once: **rows** (the snapshot stops at 120, in reading order; a page with more controls than that is only partly seen), **tokens in**, and the Jev time in `decide round trip`.

## 1. A simple reference site: Wikipedia

Start at `https://en.wikipedia.org/wiki/Alan_Turing`, window wide enough that the search box is a box and not a magnifier icon.

| # | Say | Expect | In the inspector |
|---|---|---|---|
| D1 | "scroll down" | The page moves one screen, well under a second. | `result` acted, operation SCROLL_DOWN. `rows`: is it 120? |
| D2 | "search for Grace Hopper" | The words go into Wikipedia's search box, the form is submitted, the article (or a results page) loads. After the load the capsule says "Listening" by itself. | operation TYPE; `typed_span` is exactly "Grace Hopper"; the winning row is the search box (it is an ARIA combobox on a text input; step 3 made that a text field). |
| D3 | "go back" | Back on Alan Turing. The capsule comes back with the page, still on, still listening. | operation GO_BACK, no element head used. |
| T1 | "find the article about Ada Lovelace" | Driver frame on, "On it". Types "Ada Lovelace" into the search box, the page loads, the trail says "Carried on after the page loaded", then "Your turn." on the article, spoken aloud although nobody clicked on the new page. | `LLM parse`: `search_query: "Ada Lovelace"`, no attributes. After the load: `goal · step 2` or later, and a DONE. `verdict` ok. If a donation banner is up: a `blocker` row, closed by its own close control. |

## 2. A simple list site: Hacker News

Start at `https://news.ycombinator.com`. It is one big table with no headings and no landmarks, so this is where ordinals are most likely to break.

| # | Say | Expect | In the inspector |
|---|---|---|---|
| D1 | "open the third one" | The third story opens (its own site, or its comments page for an Ask HN). On a site you have not granted, the badge goes to `off`; that is correct. Come back with the browser's back button. | operation CLICK with an ordinal. Code computes "third" over a group: which group did it find? Each story row has a title link, a site link, and below it "hide", "past", "comments". If it opens the wrong thing, the `winning row` says what it counted. |
| D2 | "click new" | The "new" page in the top bar. | target `new` with high confidence, or a `one or two` row if it wavers between "new" and another link with "new" in it. |
| D3 | "scroll down", then "click more" | The next thirty stories. | "More" is the last link on the page: is it inside the 120 rows? If not, this fails with nothing found, and that is the limit to write down. |
| T1 | "find stories about Rust" | The only search box is at the very bottom ("Search:"), and it submits to another site, `hn.algolia.com`. Expect: types "Rust", submits, badge goes `off` on the new site. Click the toolbar button within a minute and allow the site: the capsule appears and the task carries on, then "Your turn." on the results. | `LLM parse`: `search_query: "Rust"`. Whether the search box made it into the snapshot (rows). After the grant: "Carried on after the page loaded". If it ends "stuck" before typing, either the box was beyond the snapshot's 120 rows, or Tandem did not take it for a search field: it has no label of its own (the word "Search:" is loose text beside it, and its `name` is just `q`). I expect this one to fail; how it fails is the finding. |

## 3. One real shop (yours to choose)

Written so that it fits any shop. Start on the shop's home page, not signed in, with an empty basket. **Nothing here buys anything**: on a task, Tandem never presses a control that submits a form unless the goal names it, and never types into password or payment fields.

| # | Say | Expect | In the inspector |
|---|---|---|---|
| D1 | "search for running shoes" | Typed into the shop's search box, submitted, results load, "Listening" again. If a cookie banner or sign-up pop-up covers the box, it is dismissed first with its own decline or close control, never with "Accept". | A `blocker` row: which control it chose and its two scores (refuses, accepts). operation TYPE into a search-like field. |
| D2 | "open the second one" | The second product in the grid. | Which group the ordinal was counted over. Shops put sponsored tiles, carousels and "recently viewed" strips before the grid; the `winning row` shows what it took for number two. |
| D3 | "go back", then "scroll down" | Results again; scrolls. | `rows` and `tokens in` on a results page. Filters in a side rail often come after 120 rows of header and mega-menu. |
| T1 | "find me white sneakers under 100 dollars" | "On it". Searches "white sneakers" (or uses the shop's own colour and category filters if it can see them), asks "Which size?" with the shop's own size options if it finds a size filter (answer by voice), dims products over $100 if it can read the prices, then "Your turn." with a spoken summary. It must never press Add to basket, Checkout, Sign in or Subscribe. | `LLM parse`: `search_query`, `attributes` (colour), `max_price: 100`. `DONE gate` row: each attribute with a score, all 0.75 or more for DONE. `constraints` and `verdict`. The trail line for the saved size on a second task ("find me black boots"). |

Things to watch for on the shop in particular, because they are what real shops do and the demo store does not: filters that are custom widgets without roles (nothing to press), prices split across several elements (dimming reads nothing), product tiles inside closed shadow roots or iframes (invisible to Tandem), infinite scroll, a search box that only appears after pressing an icon, and a page so large that 120 rows end before the products begin.

## What to send back

For each of the twelve lines: worked / wrong / nothing, plus one line of what happened when it was not "worked". Screenshots of the inspector for the failures are the most useful thing.
