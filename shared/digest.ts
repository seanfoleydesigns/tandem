// A small, text-only digest of the page for the LLM at the edges. Pure. Built from a wide snapshot.
import { controlGroups, isChosen } from './groups';
import { parsePrice, pricedCards } from './price';
import type { PageDigest, Snapshot } from './types';


export function pageDigest(snapshot: Snapshot): PageDigest {
  // Navigation: groups of three or more plain links that are not result cards.
  const links = snapshot.rows.filter((r) => r.role === 'link' && r.group && !r.ordinal && parsePrice(r.name) === undefined);
  const byGroup = new Map<string, typeof links>();
  for (const l of links) byGroup.set(l.group!, [...(byGroup.get(l.group!) ?? []), l]);
  const categories = [...byGroup.values()].filter((g) => g.length >= 3)
    .flatMap((g) => g.map((l) => (/(^|, )current/.test(l.state ?? '') ? `${l.name} (current)` : l.name)));

  return {
    title: snapshot.title,
    headings: snapshot.headings,
    notices: snapshot.notices,
    categories: categories.slice(0, 40),
    filters: controlGroups(snapshot).slice(0, 30).map((g) => ({
      group: g.label,
      options: g.rows.map((r) => r.name).slice(0, 60),
      set: g.rows.filter(isChosen).map((r) => r.name),
    })),
    results: pricedCards(snapshot).map((c) => c.row.name).slice(0, 8),
  };
}
