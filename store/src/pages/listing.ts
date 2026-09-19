import {
  applyFilters, BRANDS, CLOSURES, COLOURS, money, PAGE_SIZE, parseFilters, PRICE_RANGES,
  products, SIZES, SORTS, title, toQuery, type Filters, type Product,
} from '../catalog';
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

  main.innerHTML = `
    <h1>${heading(filters)}</h1>
    <div class="listing">
      <form id="filters" class="filters" aria-label="Filters">
        <h2>Filters</h2>
        ${checks('Colour', 'colour', COLOURS, filters.colour)}
        ${radios('Size', 'size', SIZES.map((s) => ({ id: s, label: s })), filters.size, true)}
        ${checks('Brand', 'brand', BRANDS, filters.brand)}
        ${checks('Closure', 'closure', CLOSURES, filters.closure)}
        ${radios('Price', 'price', PRICE_RANGES, filters.price)}
        <button type="button" id="clear-filters">Clear all filters</button>
      </form>
      <section class="results" aria-labelledby="results-heading">
        <div class="results-bar">
          <h2 id="results-heading">Results</h2>
          <p id="result-count" role="status"></p>
          <label for="sort">Sort by</label>
          <select id="sort" name="sort">
            ${SORTS.map((s) => `<option value="${s.id}"${s.id === filters.sort ? ' selected' : ''}>${s.label}</option>`).join('')}
          </select>
        </div>
        <ul class="grid" id="grid"></ul>
        <p id="no-results" hidden>No shoes match these filters.</p>
        <button type="button" id="load-more">Load more</button>
      </section>
    </div>`;

  const form = main.querySelector<HTMLFormElement>('#filters')!;
  const sort = main.querySelector<HTMLSelectElement>('#sort')!;
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
      sort: sort.value,
    };
    shown = PAGE_SIZE;
    commit();
  }

  form.addEventListener('change', readForm);
  sort.addEventListener('change', readForm);
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
