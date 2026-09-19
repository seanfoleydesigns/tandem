import {
  applyFilters, BRANDS, CLOSURES, COLOURS, money, PAGE_SIZE, parseFilters, PRICE_RANGES,
  products, SIZES, SORTS, title, toQuery, type Filters, type Product,
} from '../catalog';
import { gymHard } from '../gym';
import { esc, shoeImage } from '../html';

function checks(legend: string, name: string, values: string[], selected: string[]): string {
  const items = values
    .map((v) => `<label class="check"><input type="checkbox" name="${name}" value="${esc(v)}"${selected.includes(v) ? ' checked' : ''}> ${esc(title(v))}</label>`)
    .join('');
  return `<fieldset><legend>${legend}</legend>${items}</fieldset>`;
}

function radios(legend: string, name: string, values: { id: string; label: string }[], selected: string, chip = false): string {
  const items = values
    .map((v) => `<label class="${chip ? 'chip' : 'check'}"><input type="radio" name="${name}" value="${esc(v.id)}"${v.id === selected ? ' checked' : ''}> <span>${esc(v.label)}</span></label>`)
    .join('');
  return `<fieldset${chip ? ' class="chips"' : ''}><legend>${legend}</legend>${items}</fieldset>`;
}

function card(p: Product): string {
  return `<li><a class="card" href="/product/${esc(p.id)}">
    <img alt="" src="${shoeImage(p.colour)}" width="320" height="220">
    <span class="card-name">${esc(p.name)}</span>
    <span class="card-meta">${esc(title(p.colour))} ${esc(p.category)}</span>
    <span class="card-price">${money(p.price)}</span>
  </a></li>`;
}

function heading(f: Filters): string {
  if (f.q) return `Results for “${esc(f.q)}”`;
  if (f.category) return f.category === 'running' ? 'Running shoes' : title(f.category);
  return 'All shoes';
}

export function renderListing(main: HTMLElement) {
  let filters = parseFilters(location.search);
  let shown: number = (history.state as { shown?: number } | null)?.shown ?? PAGE_SIZE;
  const hard = gymHard();
  const size = radios('Size', 'size', SIZES.map((s) => ({ id: s, label: s })), filters.size, true);
  const closure = checks('Closure', 'closure', CLOSURES, filters.closure);
  const sortLabel = () => SORTS.find((s) => s.id === filters.sort)?.label ?? SORTS[0]!.label;

  main.innerHTML = `
    <h1>${heading(filters)}</h1>
    <div class="listing">
      <form id="filters" class="filters" aria-label="Filters">
        <h2>Filters</h2>
        ${checks('Colour', 'colour', COLOURS, filters.colour)}
        ${hard ? '' : size}
        ${checks('Brand', 'brand', BRANDS, filters.brand)}
        ${hard ? '' : closure}
        ${radios('Price', 'price', [{ id: '', label: 'Any price' }, ...PRICE_RANGES], filters.price)}
        ${hard ? `<button type="button" id="more-filters" aria-expanded="false" aria-controls="more-filters-panel">More filters</button>
        <div id="more-filters-panel" class="filters" hidden>${size}${closure}</div>` : ''}
        <button type="button" id="clear-filters">Clear all filters</button>
      </form>
      <section class="results" aria-labelledby="results-heading">
        <div class="results-bar">
          <h2 id="results-heading">Results</h2>
          <p id="result-count" role="status"></p>
          ${hard ? `<div class="sortbox">
            <button type="button" id="sort-button" aria-haspopup="listbox" aria-expanded="false" aria-controls="sort-list">Sort by: ${esc(sortLabel())}</button>
            <ul id="sort-list" role="listbox" aria-label="Sort by" tabindex="-1" hidden>
              ${SORTS.map((s) => `<li role="option" id="sort-${s.id}" data-value="${s.id}" aria-selected="${s.id === filters.sort}" tabindex="-1">${s.label}</li>`).join('')}
            </ul>
          </div>` : `<label for="sort">Sort by</label>
          <select id="sort" name="sort">
            ${SORTS.map((s) => `<option value="${s.id}"${s.id === filters.sort ? ' selected' : ''}>${s.label}</option>`).join('')}
          </select>`}
        </div>
        <ul class="grid" id="grid"></ul>
        <p id="no-results" hidden>No shoes match these filters.</p>
        <button type="button" id="load-more">Load more</button>
      </section>
    </div>`;

  const form = main.querySelector<HTMLFormElement>('#filters')!;
  const sort = main.querySelector<HTMLSelectElement>('#sort'); // easy mode: a native select
  const grid = main.querySelector<HTMLElement>('#grid')!;
  const count = main.querySelector<HTMLElement>('#result-count')!;
  const none = main.querySelector<HTMLElement>('#no-results')!;
  const more = main.querySelector<HTMLButtonElement>('#load-more')!;

  function renderResults() {
    const matches = applyFilters(products, filters);
    const visible = matches.slice(0, shown);
    grid.innerHTML = visible.map(card).join('');
    count.textContent = matches.length === 0 ? '0 results' : `Showing ${visible.length} of ${matches.length} results`;
    none.hidden = matches.length > 0;
    more.hidden = visible.length >= matches.length;
  }

  // Filter changes rewrite the current history entry, so Back leaves the listing in one step.
  function commit() {
    history.replaceState({ shown }, '', `/${toQuery(filters)}`);
    renderResults();
  }

  function readForm() {
    const data = new FormData(form);
    filters = {
      ...filters,
      colour: data.getAll('colour') as string[],
      size: (data.get('size') as string | null) ?? '',
      brand: data.getAll('brand') as string[],
      closure: data.getAll('closure') as string[],
      price: (data.get('price') as string | null) ?? '',
      sort: sort ? sort.value : filters.sort,
    };
    shown = PAGE_SIZE;
    commit();
  }

  form.addEventListener('change', readForm);
  sort?.addEventListener('change', readForm);

  // Hard mode: "More filters" is a disclosure, and the sort is a custom listbox.
  const moreFilters = main.querySelector<HTMLButtonElement>('#more-filters');
  moreFilters?.addEventListener('click', () => {
    const open = moreFilters.getAttribute('aria-expanded') !== 'true';
    moreFilters.setAttribute('aria-expanded', String(open));
    main.querySelector<HTMLElement>('#more-filters-panel')!.hidden = !open;
  });
  const sortButton = main.querySelector<HTMLButtonElement>('#sort-button');
  const sortList = main.querySelector<HTMLElement>('#sort-list');
  const openSort = (open: boolean) => { sortButton!.setAttribute('aria-expanded', String(open)); sortList!.hidden = !open; };
  sortButton?.addEventListener('click', () => openSort(sortList!.hidden === true));
  sortList?.addEventListener('click', (e) => {
    const option = (e.target as Element).closest<HTMLElement>('[role=option]');
    if (!option) return;
    filters = { ...filters, sort: option.dataset.value! };
    sortList.querySelectorAll('[role=option]').forEach((o) => o.setAttribute('aria-selected', String(o === option)));
    sortButton!.textContent = `Sort by: ${sortLabel()}`;
    openSort(false);
    shown = PAGE_SIZE;
    commit();
  });
  main.querySelector('#clear-filters')!.addEventListener('click', () => {
    form.reset();
    form.querySelectorAll<HTMLInputElement>('input').forEach((i) => (i.checked = false));
    readForm();
  });
  more.addEventListener('click', () => {
    shown += PAGE_SIZE;
    commit();
  });

  renderResults();
}
