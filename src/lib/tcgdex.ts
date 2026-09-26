/**
 * TCGdex (https://tcgdex.dev) — free, keyless card database that tracks new sets and promos
 * faster than PokemonTCG/pokemon-tcg-data. Used to fill catalogue gaps, not as the primary source.
 */

const TCGDEX = 'https://api.tcgdex.net/v2/en';

export type TcgdexSetBrief = {
  id: string;
  name: string;
  cardCount?: { total?: number; official?: number };
};

export type TcgdexCardBrief = {
  id: string;
  localId: string;
  name: string;
  image?: string;
};

export type TcgdexSet = TcgdexSetBrief & {
  releaseDate?: string;
  serie?: { id: string; name: string };
  abbreviation?: { official?: string };
  cards: TcgdexCardBrief[];
};

// Pokémon TCG Pocket (digital-only) sets — not collectable physical cards
const DIGITAL_ONLY = /^(A\d|B\d|P-A$)/;

let setsPromise: Promise<TcgdexSetBrief[]> | null = null;
const setCache = new Map<string, Promise<TcgdexSet | null>>();

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${TCGDEX}${path}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Physical-card sets on TCGdex (empty list if the API is unreachable). */
export function listTcgdexSets(): Promise<TcgdexSetBrief[]> {
  if (!setsPromise) {
    setsPromise = getJson<TcgdexSetBrief[]>('/sets').then((sets) => {
      if (!sets) {
        setsPromise = null;
        return [];
      }
      return sets.filter((s) => !DIGITAL_ONLY.test(s.id));
    });
  }
  return setsPromise;
}

export function getTcgdexSet(id: string): Promise<TcgdexSet | null> {
  let hit = setCache.get(id);
  if (!hit) {
    hit = getJson<TcgdexSet>(`/sets/${encodeURIComponent(id)}`).then((set) => {
      if (!set) setCache.delete(id);
      return set;
    });
    setCache.set(id, hit);
  }
  return hit;
}

/** TCGdex ids → PokemonTCG-style ids: sv08 → sv8, me02.5 → me2pt5. */
export function tcgdexIdToCatalogueId(id: string): string {
  return id
    .toLowerCase()
    .replace(/\.5$/, 'pt5')
    .replace(/([a-z])0+(\d)/g, '$1$2');
}

/** TCGdex dates are 2024-11-08; the catalogue uses 2024/11/08. */
export function tcgdexDate(date?: string): string {
  return (date ?? '').replace(/-/g, '/');
}

export function tcgdexImage(card: TcgdexCardBrief, size: 'high' | 'low'): string | undefined {
  return card.image ? `${card.image}/${size}.webp` : undefined;
}
