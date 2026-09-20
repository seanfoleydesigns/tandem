# Tandem

A voice copilot for the web page in front of you. You can **drive** it ("scroll down", "open the second one") or **delegate** to it ("find me white sneakers under a hundred dollars"). It asks when only you know the answer, remembers what you told it, and hands the page back. It never buys.

A local prototype. The rule it is built on: **code calculates, Jev judges, the LLM thinks slowly at the edges.** `SPEC.md` is the design, `NOTES.md` is the build diary, including what broke.

## Run it

```bash
npm install
```

Put two keys in `.env` (see `.env.example`): `TYPESAFE_API_KEY` for Jev and `ANTHROPIC_API_KEY` for the LLM at the edges. Without the second one everything still works; tasks just start without parsed constraints and end without a spoken summary.

```bash
npm run dev
```

That starts the local API on `:8787` and the demo shop on `http://localhost:5173`. Press `/` to type a command, `i` for the inspector, or click the microphone. `http://localhost:5173/?gym=hard` adds a cookie banner, a newsletter pop-up, filters behind a disclosure and a custom sort listbox; `?gym=easy` goes back.

```bash
npm test
```

Unit tests, no network. The scripts in `scripts/` do call Jev: `probe-heads.ts` saves every production score so a rewording can be compared before and after.

## The Chrome extension

The same agent, on any website.

### What leaves your browser, and when

**Tandem is off until you click its toolbar button, and it is on for that tab only.** While it is off, nothing is injected into any page and nothing is read.

On a tab where you turned it on, each command sends a text table of the page's visible controls (names of links, buttons and fields, and what ordinary fields contain; a password or payment field only ever says "filled"), the page's title and headings, and its address without the values in its query string, to the Tandem server **on your own computer** (`http://localhost:8787`). That server sends it to TypeSafe (Jev) to choose the next action, and, for a task, a short digest of the page to Anthropic at the start and at the end. **Page text goes to TypeSafe and to the LLM only from tabs where you turned Tandem on.** The extension itself talks to nothing but `localhost:8787`; it holds no keys. The background worker enforces this, not the page: it refuses to forward anything for a tab that is off or paused.

Speech recognition is Chrome's own (`webkitSpeechRecognition`), which sends audio to Google while the microphone is on. The agent's voice is Chrome's text-to-speech, spoken by the extension itself (`chrome.tts`), not by the page: Chrome lets a page speak only after you have clicked on it, and a page that has just loaded has had no click.

### Sites are granted one at a time

The first time you turn Tandem on at a site, Chrome asks whether it may "read and change your data on" **that site only**. Chrome remembers the answer; you can take it back in the Extensions menu or at `chrome://extensions` → Tandem → Details → Site access.

Inside a tab where Tandem is on, moving to a site you have already granted just keeps working, and a task that was running carries on after the page loads. Moving to a site you have not granted **pauses** Tandem and any task: the badge says `off` and its tooltip says "Tandem is paused. Click to turn it on for this site." One click grants and resumes; the time spent paused does not count against the task.

One thing differs from what was planned: on a site that has not been granted, Chrome lets an extension draw nothing at all, so the capsule cannot say "Paused" there. Only the toolbar badge can. The capsule does say "Paused. Turn me on for this site." when you take a site's access away while its page is open.

### Load it

1. `npm install`, fill in `.env`, then start the server and leave it running: `npm run dev`
2. Build the extension: `npm run build:ext` (this writes `extension/dist/content.js` and `extension/dist/background.js`)
3. In Chrome open `chrome://extensions` and switch on **Developer mode** (top right).
4. Click **Load unpacked** and choose the `extension` folder of this project (the one with `manifest.json` in it, not `extension/dist`).
5. Pin it: the puzzle-piece icon → the pin next to "Tandem (local prototype)". It has no icon of its own, so Chrome shows a grey "T".
6. Open a page, for example `https://en.wikipedia.org`, and click the Tandem button. Chrome asks for that site; allow it. The badge turns to `on` and the capsule appears at the bottom of the page: "Tandem is on for this tab".
7. Click the microphone in the capsule (Chrome asks for the microphone once per site; choose **Allow while visiting the site**, not "Allow this time", or it is forgotten at the next page load), or press `/` and type. Press `i` for the inspector. Click the toolbar button again to turn Tandem off.
8. The microphone stays on for the tab: after a page loads, Tandem starts listening again by itself and the capsule says "Listening". On a site that has not been given the microphone it says "Click the mic to allow it on this site." instead; it never makes Chrome's permission prompt pop up by itself. Where the microphone is blocked (by you, or by the site's own policy) it says so, because a click cannot help there. Mute is kept for the tab in the same way.

After changing code: `npm run build:ext`, then the reload arrow on the extension's card at `chrome://extensions`, then reload the page you are testing. Reloading the extension forgets which tabs were on and any running task (they live in session storage), and pages opened before the reload hold a dead copy of the script until they are reloaded.

If commands fail with "the Tandem server on this computer is not answering", `npm run dev` is not running. If the server is running and calls still fail, check Chrome's **Local network access** setting for the extension (`chrome://extensions` → Details → Site settings); Chrome 142 and later restrict requests to `localhost`, and the documentation does not say clearly whether extensions are exempt.

### Safety rules that are code, not judgement

- It never types into a password or payment field, whoever asks, and never sends what such a field contains. It recognises them by `type=password`, by `autocomplete` (`cc-…`, `current-password` and the like), and by the field's own words (card number, CVV, expiry, password, PIN).
- On a task it types only to search: only when the request yields something to search for, only into a search field, and it submits only that search form.
- On a task it never submits any other form unless your request names the button in so many words ("…and add to cart").
- Anything that buys, pays, subscribes or checks out is never pressed on a task; in drive mode it asks for a second, explicit yes.
- A cookie banner or pop-up is dismissed only with one of its own controls that refuses or closes. Controls that accept are removed in code before any model sees them.

The script for the real-site trial (Wikipedia, Hacker News, one real shop) is in `TRIAL.md`.

## Known limits

- **There is a short deaf gap while a page loads.** The recognizer lives in the page and dies with it; the next page starts a new one once it has loaded and the worker has told it the microphone was on. What you say in between is lost.
- **Microphone permission is per site, and it goes to the site, not only to Tandem.** Recognition runs inside the page, so Chrome attributes the microphone to the website: every new site asks once, the site itself could then use the microphone too, a site that forbids the microphone in its own policy (`Permissions-Policy: microphone=()`) cannot be listened on at all, and recognition needs an `https` page. See the first item under Next steps.
- **Only the tab you are looking at listens.** Chrome runs one speech-recognition session for the whole browser, so a tab in the background lets go of the microphone and picks it up again when you come back to it.
- **One voice for the whole browser.** The extension speaks with Chrome's own text-to-speech, which is a single queue for every tab. With Tandem on in two tabs, a phrase spoken for the tab in the background can be heard by the recognizer of the tab in front, and Stop or Mute in one tab can cut off what the other was saying. Use the voice in one Tandem tab at a time.
- **Nothing can be shown on a site that has not been granted** (see above); the badge is the only signal.
- **Closed shadow roots and iframes are invisible** to the agent. Open shadow roots are read.
- **Dense pages: 240 controls at most are sent per decision.** At or under that, everything near the viewport; over it, what is on screen is kept first, so a control you can see but that is more than half clipped by the edge of the window, or the last of more than 240 on screen at once, can still be missed, and something off screen that you name from memory may need "scroll down" first. Measured: the Hacker News front page has 227, the top of a long Wikipedia article 197. Decisions on such pages cost more: Hacker News's 227 rows are about 8,700 input tokens as bare rows (`scripts/probe-dense.ts`; Jev answered in 220 to 480 ms), and the real snapshot adds an ordinal or an off-screen mark to about half of them, so expect roughly 10,000 to 12,000; 240 rows shaped like the demo store's are about 19,800 (p50 261 ms). Each row is sent twice (once in the state, once as the label Jev chooses), so a page where nearly all 240 rows carry long names under long headings can pass Jev's limit of 32,000 tokens; every decision on it then fails with "I couldn't reach the model" until you scroll somewhere less dense, or switch the inspector's label style to `ids`, which sends each row once. Housekeeping (clearing filters left from the last search, the page digest for the LLM, dimming) still reads only the first 120 controls of the page, which on a very large page is the header and the side bar.
- **A text field with no label of its own is not recognised as a search box.** Hacker News's is `Search: <input name="q">`, with the word as loose text beside it. Tandem sees the field but not what it is for: on a task it never types there, and "search for rust" in drive mode may type the words and send nothing. Naming a field from the text just before it is about ten lines, and was left out deliberately: it would have been a third fix, and it changes what fields are called on every page.
- **Rows Jev cannot tell apart stay that way.** Hacker News has 30 upvote arrows with no name and 30 links called "hide". Commands aimed at those end in two badges to choose from, or "I can't find that".
- **A page's own modal dialog makes the capsule unclickable** while it is open (the browser makes everything outside a modal inert). Voice still works.
- **A banner whose only button is "OK" or "Got it" stays**, because pressing it usually means consent. An icon-only close button with no accessible name cannot be judged.
- **Each site is its own origin.** `en.wikipedia.org` and `en.m.wikipedia.org` are different sites to Chrome, and so are `http` and `https`. Following a link to a new site pauses Tandem until you click.
- **A task resumes only within 60 seconds** of its last step, and only what was decided survives the page load; the trail of what was done starts again. A task that goes Back into a page Chrome kept in its back/forward cache ends there.
- **The capsule cannot be driven by scripts** on real sites (closed shadow root, made-up events ignored). That is deliberate, and it also means browser-automation tools cannot type into it; use the keyboard, the mouse or your voice.
- **The clean slate** (clearing filters left over from the last search) costs a page load per filter on a site that reloads for every filter: the task starts again on each new page until nothing is left to clear, and each restart parses the request again (about a second).
- **On a task, typing is for searching only.** It will not fill in forms.
- In the demo shop's hard mode, the saved size is not applied while Size is hidden behind "More filters", and code cannot sort by price through the custom listbox.

## Next steps

1. **Move listening out of the page, into a page the extension owns** (an offscreen document, or a side panel). One microphone permission, given to Tandem and not to every website; listening that carries on across page loads, with no deaf gap; and the website never gets the microphone. This is the right fix for the three microphone limits above. Chrome's offscreen documents have a `USER_MEDIA` reason and no time limit for it, but the documentation does not mention speech recognition there, and a permission prompt cannot be shown in an offscreen document (it would have to be granted once from a page of the extension opened in a tab). So: the intended direction, to be prototyped before it is promised.
2. The two failures in the demo shop's hard mode: apply the saved size when Size sits behind "More filters", and sort by price through a custom listbox.
3. Say the counts in code when the LLM is unavailable, instead of ending a task with a bare "Your turn."
4. Name a text field that has no label of its own from the text just before it (`Search: <input name="q">` on Hacker News). Designed and attacked already, about ten lines plus five tests (NOTES, trial fix 2); left out because both trial fixes were spent.
5. Guard Jev's 32,000-token budget on very dense pages: fall back to the `ids` label style, which sends each row once, when the rows would not fit twice.
