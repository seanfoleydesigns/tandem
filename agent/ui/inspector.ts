// Inspector: a plain table. Model id, timings, each head's top three, and the policy reason in words.
import { NONE, NO_SPAN } from '../../shared/candidates';
import type { LabelStyle } from '../../shared/config';
import type { Head } from '../../shared/types';
import type { Trace } from '../loop';

const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const ms = (a?: number, b?: number) => (a === undefined || b === undefined ? '–' : `${Math.round(b - a)} ms`);

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

export function renderInspector(trace: Trace | undefined, labelStyle: LabelStyle, rowNames: Map<string, string>): string {
  const title = `<h2>Tandem inspector <button data-action="toggle-style" title="Switch label style for the next decision">label style: ${labelStyle}</button></h2>`;
  if (!trace) return `${title}<p>No decision yet. Press / and type a command.</p>`;

  const r = trace.response;
  const { t0, t1, t2, t3 } = trace.t;
  const summary = `
    <table>
      <tr><th>heard</th><td>${esc(trace.utterance)}</td></tr>
      <tr><th>result</th><td>${esc(trace.result)}${trace.resolution ? ` · ${esc(trace.resolution.type)}` : ''}</td></tr>
      <tr><th>policy</th><td>${esc(trace.note)}</td></tr>
      ${trace.winner ? `<tr><th>winning row</th><td>${esc(trace.winner)}</td></tr>` : ''}
      ${trace.candidates ? `<tr><th>top two</th><td>${trace.candidates.map(esc).join('<br>')}</td></tr>` : ''}
      <tr><th>model</th><td>${esc(r?.model ?? '–')} · label style ${esc(r?.labelStyle ?? labelStyle)} · ${trace.rows} rows · ${r ? `${r.usage.input_tokens} tokens in` : ''}</td></tr>
    </table>
    <table>
      <tr><th>t1 − t0 snapshot</th><td class="num">${ms(t0, t1)}</td><th>t2 − t1 decide</th><td class="num">${ms(t1, t2)}</td></tr>
      <tr><th>of which Jev</th><td class="num">${r ? `${r.ms} ms` : '–'}</td><th>t3 − t2 act</th><td class="num">${ms(t2, t3)}</td></tr>
      <tr><th>t3 − t0 total</th><td class="num"><b>${ms(t0, t3)}</b></td><th>settle after t3</th><td class="num">${trace.settleMs ?? '–'}${trace.settleMs === undefined ? '' : ' ms'}</td></tr>
    </table>`;
  if (!r) return title + summary;

  const op = r.heads.operation.choice;
  const used = new Set(['operation', ...(HEAD_FOR_OP[op] ?? [])]);
  const heads = Object.entries(r.heads)
    .map(([name, head]) => headRow(name, head as Head, trace.result === 'acted' && used.has(name), rowNames))
    .join('');
  return `${title}${summary}
    <table><tr><th>head</th><th>choice</th><th class="num">confidence</th><th class="num">top p</th><th>top three</th></tr>${heads}</table>
    <p>Shaded rows are the heads the policy read. The others were speculative. ${esc(NONE)} / ${esc(NO_SPAN)} mean nothing fits.</p>`;
}
