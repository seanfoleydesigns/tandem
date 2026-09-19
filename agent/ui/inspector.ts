// Inspector: a plain table. Model id, timings, each head's top three, and the policy reason in words.
import { MET_MIN } from '../../shared/config';
import { NONE, NO_SPAN } from '../../shared/candidates';
import type { LabelStyle } from '../../shared/config';
import type { Head, LlmCall } from '../../shared/types';
import type { Trace } from '../loop';

const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const ms = (a?: number, b?: number) => (a === undefined || b === undefined ? '–' : `${Math.round(b - a)} ms`);

// LLM latency and tokens, shown next to Jev's.
// A pop-up or banner was in the way: what it was, what code removed, who chose, and how sure Jev was.
const blockerCell = (b: NonNullable<Trace['blocker']>) => [
  `${b.kind}${b.title ? ` "${b.title}"` : ''}`, b.trigger === 'covered' ? 'covered the target' : 'a modal was open',
  `${b.offered.length} offered${b.removed.length ? `, ${b.removed.length} removed in code (${b.removed.join(', ')})` : ''}`,
  b.scores ? `Jev ${b.ms} ms: ${b.scores.map((c) => `${c.name} ${c.dismisses.toFixed(2)} (refuses ${c.refuses.toFixed(2)}, accepts ${c.accepts.toFixed(2)})`).join('; ')}` : '',
  b.note, b.dismissed ? 'dismissed' : 'left in place',
].filter(Boolean).join(' · ');

const llmCell = (c: LlmCall) => (c.ok ? `${c.ms} ms · ${c.input_tokens} in / ${c.output_tokens} out · ${esc(c.model ?? '')}` : `unavailable (${esc(c.error ?? 'no answer')}) · ${c.ms} ms`);

const HEAD_FOR_OP: Record<string, string[]> = {
  CLICK: ['click_target'], TYPE: ['type_target', 'typed_span'], SELECT: ['select_target'], ASK_USER: ['ask_group'],
};

function headRow(name: string, head: Head, used: boolean, names: Map<string, string>): string {
  const top3 = Object.entries(head.probabilities).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([label, p]) => {
      const hint = names.get(label);
      return `${esc(label)}${hint ? ` <i>${esc(hint)}</i>` : ''} ${p.toFixed(2)}`;
    }).join('<br>');
  const top = head.probabilities[head.choice] ?? 0;
  return `<tr class="${used ? 'used' : ''}"><th>${name}</th><td>${esc(head.choice)}</td>
    <td class="num">${head.confidence.toFixed(2)}</td><td class="num">${top.toFixed(2)}</td><td>${top3}</td></tr>`;
}

export function renderInspector(trace: Trace | undefined, labelStyle: LabelStyle): string {
  const title = `<h2>Tandem inspector <button data-action="toggle-style" title="Switch label style for the next decision">label style: ${labelStyle}</button></h2>`;
  if (!trace) return `${title}<p>No decision yet. Press / and type a command, or turn the mic on.</p>`;

  const r = trace.response;
  const { heard, t1, t2, t3 } = trace;
  const lead = Math.round(heard.final - t1);
  const speculative =
    trace.speculative === 'hit' ? `used: decide was fired ${lead} ms before the final transcript`
    : trace.speculative === 'miss' ? 'fired, but the final transcript differed or the call failed; decided again'
    : 'not fired';
  const summary = `
    <table>
      <tr><th>${trace.leash === 'task' ? `goal · step ${trace.step + 1}` : 'heard'}</th><td>${esc(trace.utterance)}</td></tr>
      <tr><th>result</th><td>${esc(trace.result)}${trace.resolution ? ` · ${esc(trace.resolution.type)}` : ''}</td></tr>
      <tr><th>policy</th><td>${esc(trace.note)}</td></tr>
      ${trace.winner ? `<tr><th>winning row</th><td>${esc(trace.winner)}</td></tr>` : ''}
      ${trace.disambiguation ? `<tr><th>one or two</th><td>${trace.disambiguation.options.map((o, i) => `${i + 1}: ${esc(o.line)}`).join('<br>')}</td></tr>` : ''}
      ${trace.fit ? `<tr><th>fit check</th><td>${trace.fit.asked} candidates asked, ${trace.fit.ms} ms, ${trace.fit.fits.length ? 'fit: ' + trace.fit.fits.map((f) => `${esc(f.line.split(' · ')[1] ?? f.line)} ${f.noul.toFixed(2)}`).join(', ') : 'none fit'}</td></tr>` : ''}
      ${r?.met ? `<tr><th>DONE gate</th><td>${Object.entries(r.met).map(([k, p]) => `${esc(k)} ${p.toFixed(2)}`).join(' · ')} · DONE needs every one at ${MET_MIN} or more</td></tr>` : ''}
      ${trace.blocker ? `<tr><th>blocker</th><td>${esc(blockerCell(trace.blocker))}</td></tr>` : ''}
      <tr><th>model</th><td>${esc(r?.model ?? '–')} · label style ${esc(r?.labelStyle ?? labelStyle)} · ${trace.rows} rows · ${r ? `${r.usage.input_tokens} tokens in` : ''}</td></tr>
    </table>
    <table>
      <tr><th>final transcript → action</th><td class="num"><b>${ms(heard.final, t3)}</b></td></tr>
      <tr><th>last interim change → action</th><td class="num"><b>${ms(heard.lastInterim, t3)}</b></td></tr>
      <tr><th>last interim change → final transcript</th><td class="num">${ms(heard.lastInterim, heard.final)}</td></tr>
      <tr><th>speculative decide</th><td>${speculative}</td></tr>
      <tr><th>decide round trip (t2 − t1)</th><td class="num">${ms(t1, t2)}, of which Jev ${r ? `${r.ms} ms · ${r.usage.input_tokens} in` : '–'}</td></tr>
      ${trace.llm?.parse ? `<tr><th>LLM parse (task start)</th><td class="num">${llmCell(trace.llm.parse)}</td></tr>` : ''}
      ${trace.llm?.verify ? `<tr><th>LLM verify (task end)</th><td class="num">${llmCell(trace.llm.verify)}</td></tr>` : ''}
      ${trace.constraints ? `<tr><th>constraints</th><td class="num">${esc(JSON.stringify(trace.constraints))}</td></tr>` : ''}
      ${trace.verdict ? `<tr><th>verdict</th><td class="num">${trace.verdict.ok ? 'ok' : `not ok: ${esc(trace.verdict.issues.join('; '))}`}</td></tr>` : ''}
      <tr><th>snapshot · act · settle</th><td class="num">${trace.snapshotMs} ms · ${ms(Math.max(t2, heard.final), t3)} · ${trace.settleMs ?? '–'} ms</td></tr>
    </table>`;
  if (!r) return title + summary;

  const op = r.heads.operation.choice;
  const used = new Set(['kind', 'operation', ...(HEAD_FOR_OP[op] ?? [])]);
  const heads = Object.entries(r.heads)
    .map(([name, head]) => headRow(name, head as Head, trace.result === 'acted' && used.has(name), trace.rowNames))
    .join('');
  const needs = r.needs && Object.keys(r.needs).length
    ? `<table><tr><th>group</th><th class="num">personal</th><th class="num">given by goal</th><th class="num">needs (ask at 0.70)</th></tr>${Object.entries(r.needs).sort((a, b) => b[1] - a[1]).map(([g, p]) => {
      const parts = r.needsParts?.[g];
      return `<tr><td>${esc(g)}</td><td class="num">${(parts?.personal ?? 0).toFixed(2)}</td><td class="num">${(parts?.given ?? 0).toFixed(2)}</td><td class="num">${p.toFixed(2)}</td></tr>`;
    }).join('')}</table>`
    : '';
  return `${title}${summary}${needs}
    <table><tr><th>head</th><th>choice</th><th class="num">confidence</th><th class="num">top p</th><th>top three</th></tr>${heads}</table>
    <p>Shaded rows are the heads the policy read. The others were speculative. ${esc(NONE)} / ${esc(NO_SPAN)} mean nothing fits.</p>`;
}
