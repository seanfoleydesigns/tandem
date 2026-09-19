// Dev-only states gallery: every overlay state side by side, for reviewing the look in Chrome.
// Open http://localhost:5173/gallery.html. Nothing imports this file, so it never reaches dist/agent.js.
import { mountOverlay, type Overlay } from './overlay';

type Setup = (o: Overlay, cell: HTMLElement) => void;

const SIZES = ['7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5', '12', '12.5', '13'];
const cards = (cell: HTMLElement) => [...cell.querySelectorAll<HTMLElement>('.cards a')];

const STATES: { name: string; note: string; setup: Setup }[] = [
  { name: 'Idle', note: "you're driving, no frame", setup: () => {} },
  { name: 'Listening', note: 'the waveform moves on speech, still when silent', setup: (o) => { o.setMicState('listening'); setInterval(() => o.wave(), 1600); } },
  { name: 'Heard', note: 'the capsule widens for the live transcript', setup: (o) => { o.setMicState('listening'); o.wave(); o.showInterim('open the second one'); } },
  { name: 'Confirmation', note: 'plain past-tense words, and the action ring', setup: (o, cell) => {
    o.setMicState('listening'); o.trail('Opened Tidewater Boardwalk');
    const el = cards(cell)[1]!; const show = () => o.ring(el.getBoundingClientRect(), 10); show(); setInterval(show, 1800);
  } },
  { name: 'Agent driving', note: 'rotating edge glow, Stop with its Esc hint, agent-coloured ring', setup: (o, cell) => {
    o.setMode('agent'); o.trail('Used your saved size, 10.5'); o.trail('Opened Boots'); o.trail('Checked Black');
    const el = cards(cell)[2]!; const show = () => o.ring(el.getBoundingClientRect(), 10); show(); setInterval(show, 1800);
  } },
  { name: 'Waiting for me', note: 'the glow stops and becomes a calm blue frame; a confirmation', setup: (o) => {
    o.setMode('waiting'); o.question({ heading: 'Click Checkout?', options: ['Yes', 'No'] });
  } },
  { name: 'Thinking', note: 'M4: the glow dims and breathes', setup: (o) => { o.setMode('thinking'); o.showStatus('On it'); } },
  { name: 'Question card', note: 'the capsule morphed; chips are a radiogroup; one selected', setup: (o) => {
    o.setMode('waiting'); o.question({ heading: 'Which size?', options: SIZES, skip: true, selected: 7 });
  } },
  { name: 'Badges', note: 'which one? say one or two', setup: (o, cell) => {
    o.setMode('waiting'); const [a, b] = cards(cell); o.badges([a!, b!]);
  } },
  { name: 'Memory panel', note: 'rows end in Forget', setup: (o) => {
    o.memory([{ label: 'Size', value: '10.5', scope: 'localhost', ts: 0 }, { label: 'Width', value: 'Wide', scope: 'localhost', ts: 0 }], () => {});
    o.showMemory(true); o.trail("Size 10.5. I'll remember that.");
  } },
  { name: 'Stuck', note: 'hand-back in plain words, with Narrow by chips', setup: (o) => {
    o.showStatus("Your turn. I wasn't sure what to do next."); o.narrow(['Brand', 'Closure', 'Price']);
  } },
  { name: 'Never silent', note: 'an Ignore says why', setup: (o) => { o.setMicState('listening'); o.showStatus("I can't find that on this page."); } },
  { name: 'Typing', note: 'press / and type; the capsule is the command field', setup: (o) => { o.host.shadowRoot!.querySelector('.capsule')!.classList.add('typing', 'wide'); } },
  { name: 'No matches', note: 'code reads the result notice', setup: (o) => { o.showStatus('No matches with these filters. Your turn.'); } },
];

const grid = document.getElementById('grid')!;
const value = (name: string) => (document.querySelector<HTMLInputElement>(`input[name=${name}]:checked`)!).value;

function render() {
  grid.innerHTML = '';
  const scheme = value('scheme');
  const page = value('page');
  for (const s of STATES) {
    const figure = document.createElement('figure');
    figure.innerHTML = `<figcaption>${s.name} <span>· ${s.note}</span></figcaption>
      <div class="cell ${page}"><div class="page"><h2>Results</h2><div class="cards">
        ${['Northfield Court Classic', 'Tidewater Boardwalk', 'Arco Chelsea 9', 'Lumen Flux'].map((n) => `<a href="#" onclick="return false">${n}</a>`).join('')}
      </div></div></div>`;
    grid.append(figure);
    const cell = figure.querySelector<HTMLElement>('.cell')!;
    const overlay = mountOverlay(
      { onCommand() {}, onTyping() {}, onMic() {}, onMute() {}, onStop() {} },
      { parent: cell, hotkeys: false, scheme: scheme === 'auto' ? undefined : (scheme as 'light' | 'dark') },
    );
    overlay.memory([], () => {});
    overlay.setMicState('off');
    s.setup(overlay, cell);
  }
  window.scrollTo(0, 0); // badges scroll their target into view; keep the gallery at the top
}

document.querySelectorAll('input[type=radio]').forEach((i) => i.addEventListener('change', render));
render();
