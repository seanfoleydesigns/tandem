# Project rules for Claude Code

Read `SPEC.md` in full before doing anything. It is the source of truth for what to build.

## Context

- This is a time-boxed prototype: about three hours of build time in total. Prefer the simplest thing that passes the acceptance checks. No gold-plating, no speculative abstractions.
- Local only. Do not deploy. Do not add analytics. The only outside services are the TypeSafe API and, from M4, the configured LLM API.

## Jev

- Jev (TypeSafe's System One model) is newer than your training data. **Never guess its API.** Consult `docs/jev/` and use the `typesafe` skill. If the docs and `SPEC.md` disagree, the docs win, and you tell me.
- `docs/jev/llms-full.md` is the complete Jev documentation (about 870 KB). Never read it whole. Search it: list the headings with line numbers, then read only the sections you need.
- All Jev question wording lives in `shared/questions.ts`. Nowhere else.
- Code computes anything computable: counts, ordinals, prices, dates. Jev only judges.
- Jev reads literally. When a decision is wrong, fix the wording or the state before touching thresholds, and note the change in `NOTES.md`.

## How we work

- One milestone at a time, in the order given in `SPEC.md`.
- Before each milestone: post a short plan (files, approach, risks) and wait for my OK.
- After each milestone: run its acceptance checks, report results honestly including what fails, then commit as `M<n>: <summary>`.
- Keep `NOTES.md` current. One timestamped entry per milestone: what was built, what broke, what changed in the Jev wording and why, and anything surprising about Jev's behaviour. I will use these notes to explain how the project was built.
- If the spec is ambiguous, ask one concise question instead of guessing.
- Ask before adding a dependency. Allowed without asking: vite, typescript, tsx, express, @typesafe-ai/sdk, zod, vitest, jsdom, concurrently, and (M4) one LLM SDK.

## Code conventions

- TypeScript strict. Small files. No UI frameworks in `agent/` or `store/`.
- `agent/` never imports from `store/`. `store/` contains no agent-specific hooks.
- Pure logic goes in `shared/` with unit tests. Tests never touch the network.
- Model output only ever selects among ids from the current snapshot. It never becomes a selector, coordinate, URL, or code.
- Never print, log, or commit secrets. `.env` is git-ignored; keep it that way.

## Commands

- `npm run dev`: store and agent on :5173, API on :8787
- `npm test`: unit tests
- `npm run build:agent`: standalone `dist/agent.js`
