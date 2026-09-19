// Wording probe for the blocker question, through the real /api/dismiss route of the running dev server.
// It calls Jev, so it is a script, not a test.    npx tsx scripts/probe-dismiss.ts
// Two Nouls per control, combined in code: refuses × (1 − accepts).
// Note: in the agent, code removes accepting controls before Jev sees them (shared/blockers.ts). Here they are
// left in on purpose, to see what Jev does on its own.
import { dismisses, pickDismiss } from '../shared/blockers';
import { DISMISS_MIN } from '../shared/config';
import type { DismissResponse, ElementRow } from '../shared/types';

const API = 'http://localhost:8787';
const cookie = { kind: 'cookie banner', title: '', text: 'We value your privacy. We and our 214 partners use cookies to personalise ads and measure how the shop is used.' };
const news = { kind: 'pop-up', title: 'Get 10% off your first order', text: 'Get 10% off your first order. Join the Footnote list for early access and offers. Email address' };
const login = { kind: 'pop-up', title: 'Sign in to continue', text: 'Sign in to continue. Save articles and follow topics.' };

const FIXTURES: { blocker: typeof cookie; names: string[]; want: string }[] = [
  { blocker: cookie, names: ['Accept all', 'Reject all', 'Manage preferences'], want: 'Reject all' },
  { blocker: cookie, names: ['Accept all', 'Manage preferences'], want: 'none' },
  { blocker: cookie, names: ['Allow all', 'Use necessary cookies only'], want: 'Use necessary cookies only' },
  { blocker: cookie, names: ['Got it'], want: 'none' },
  { blocker: cookie, names: ['Learn more', 'Privacy policy'], want: 'none' },
  { blocker: cookie, names: ['Manage preferences', 'Continue without accepting'], want: 'Continue without accepting' },
  { blocker: news, names: ['Subscribe and save', "No thanks, I'd rather pay full price"], want: "No thanks, I'd rather pay full price" },
  { blocker: news, names: ["No thanks, I'd rather pay full price"], want: "No thanks, I'd rather pay full price" },
  { blocker: news, names: ['Yes, sign me up', "No, I don't like saving money"], want: "No, I don't like saving money" },
  { blocker: news, names: ['Yes, sign me up', '(no name)'], want: 'none' },
  { blocker: login, names: ['Log in', 'Create account', 'Close'], want: 'Close' },
];

let ok = 0;
for (const f of FIXTURES) {
  const controls: ElementRow[] = f.names.map((name, i) => ({ id: `e${i + 1}`, role: /policy|more|preferences/i.test(name) ? 'link' : 'button', name }));
  const res = await fetch(`${API}/api/dismiss`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ blocker: f.blocker, controls }) });
  const r = (await res.json()) as DismissResponse;
  const acted = pickDismiss(r.scores, controls)?.name ?? 'none';
  const pass = acted === f.want;
  ok += pass ? 1 : 0;
  const detail = controls.map((c) => `${c.name}: ${dismisses(r.scores[c.id]).toFixed(2)} (refuses ${r.scores[c.id]!.refuses.toFixed(2)}, accepts ${r.scores[c.id]!.accepts.toFixed(2)})`).join(' | ');
  console.log(`${pass ? 'ok  ' : 'FAIL'} acts on: ${acted}   want: ${f.want}   ${r.ms} ms
       ${detail}`);
}
console.log(`${ok} of ${FIXTURES.length} as wanted at DISMISS_MIN ${DISMISS_MIN}`);
