// Contrast check for the overlay tokens. Reads agent/ui/styles.css, composites the translucent material
// over a white page and a black page, and checks every text / background pair at 4.5:1 (3:1 for
// non-text marks such as rings and the waveform).   npx tsx scripts/contrast.ts
import { readFileSync } from 'node:fs';

type RGBA = [number, number, number, number];

const css = readFileSync(new URL('../agent/ui/styles.css', import.meta.url), 'utf8');

function block(after: string): Record<string, string> {
  const start = css.indexOf(after);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--t-[\w-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}
const light = block(':host {');
const dark = { ...light, ...block(":host([data-scheme='dark'])") };

function parse(v: string): RGBA {
  const hex = v.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16)).concat(1) as RGBA;
  const rgba = v.match(/rgba?\(([^)]+)\)/);
  if (rgba) { const p = rgba[1]!.split(',').map((s) => parseFloat(s)); return [p[0]!, p[1]!, p[2]!, p[3] ?? 1]; }
  throw new Error(`cannot parse ${v}`);
}
const over = (top: RGBA, under: RGBA): RGBA => [0, 1, 2].map((i) => top[i]! * top[3] + under[i]! * (1 - top[3])).concat(1) as RGBA;
const lum = (c: RGBA) => [0, 1, 2].map((i) => { const s = c[i]! / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; })
  .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
const ratio = (a: RGBA, b: RGBA) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi! + 0.05) / (lo! + 0.05); };

let failures = 0;
function check(scheme: string, page: string, name: string, fg: RGBA, bg: RGBA, min: number) {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${scheme.padEnd(5)} on ${page.padEnd(5)} ${name.padEnd(44)} ${r.toFixed(2).padStart(5)} : 1   (needs ${min})`);
}

for (const [scheme, t] of [['light', light], ['dark', dark]] as const) {
  for (const [page, pageColour] of [['white', [255, 255, 255, 1]], ['black', [0, 0, 0, 1]]] as [string, RGBA][]) {
    const material = over(parse(t['--t-material']!), pageColour);
    const fill = over(parse(t['--t-fill']!), material);
    const fillStrong = over(parse(t['--t-fill-strong']!), material);
    const text = parse(t['--t-text']!);
    const text2 = parse(t['--t-text-2']!);
    const you = parse(t['--t-you']!);
    check(scheme, page, 'text on material', text, material, 4.5);
    check(scheme, page, 'secondary text on material', text2, material, 4.5);
    check(scheme, page, 'chip text on fill', text, fill, 4.5);
    check(scheme, page, 'chip text on hovered fill', text, fillStrong, 4.5);
    check(scheme, page, 'secondary text on hovered icon', text2, fill, 4.5);
    check(scheme, page, 'selected chip and badge: white on blue', parse(t['--t-on-you']!), you, 4.5);
    check(scheme, page, 'Stop: label on button', parse(t['--t-on-stop']!), parse(t['--t-stop']!), 4.5);
    check(scheme, page, 'Stop button against material (non-text)', parse(t['--t-stop']!), material, 3);
    check(scheme, page, 'waveform and focus ring on material', parse(t['--t-you-mark']!), material, 3);
    check(scheme, page, 'action ring (you) on the page', you, pageColour, 3);
    check(scheme, page, 'action ring (agent) on the page', parse(t['--t-agent']!), pageColour, 3);
    check(scheme, page, 'badge against the page (non-text)', you, pageColour, 3);
  }
}
console.log(failures ? `\n${failures} pair(s) below their minimum` : '\nEvery pair passes.');
process.exit(failures ? 1 : 0);
