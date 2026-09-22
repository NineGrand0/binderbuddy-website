import type { Card } from '../types';
import { makeId } from './ids';

const DATA_BASE = 'https://cdn.jsdelivr.net/gh/PokemonTCG/pokemon-tcg-data@master';

interface GitHubCard {
  id: string;
  name: string;
  number: string;
  rarity?: string;
  images: { small: string; large: string };
}

interface GitHubSet {
  id: string;
  name: string;
  series?: string;
  releaseDate: string;
  printedTotal?: number;
  total?: number;
}

export interface PokemonSetResult {
  id: string;
  name: string;
  series: string;
  releaseDate: string;
  printedTotal?: number;
  total?: number;
}

export function isPromoSet(set: { name: string; series?: string }) {
  const name = set.name.toLowerCase();
  const series = (set.series ?? '').toLowerCase();
  return (
    series === 'pop' ||
    name.includes('promo') ||
    name.includes("mcdonald") ||
    name.startsWith('pop series')
  );
}

function mapRarity(rarity?: string): Card['rarity'] {
  const r = (rarity ?? '').toLowerCase();
  if (r.includes('secret') || r.includes('special illustration') || r.includes('futuristic')) return 'secret';
  if (r.includes('ultra') || r.includes('amazing') || r.includes('illustration')) return 'ultra';
  if (r.includes('rare') || r.includes('holo')) return 'rare';
  if (r.includes('uncommon')) return 'uncommon';
  return 'common';
}

function githubToCard(card: GitHubCard, setName: string): Card {
  return {
    id: makeId('pkmn'),
    name: card.name,
    set: setName,
    number: card.number,
    rarity: mapRarity(card.rarity),
    game: 'Pokémon TCG',
    imageHue: 48,
    imageUrl: card.images.large || card.images.small,
    externalId: card.id,
    addedAt: new Date().toISOString(),
  };
}

export const SHOWCASE_POKEMON = [
  { name: 'Charizard', set: 'Base', number: '4', rarity: 'rare' as const, imageUrl: 'https://images.pokemontcg.io/base1/4_hires.png', externalId: 'base1-4' },
  { name: 'Pikachu', set: 'Base', number: '58', rarity: 'common' as const, imageUrl: 'https://images.pokemontcg.io/base1/58_hires.png', externalId: 'base1-58' },
  { name: 'Blastoise', set: 'Base', number: '2', rarity: 'rare' as const, imageUrl: 'https://images.pokemontcg.io/base1/2_hires.png', externalId: 'base1-2' },
  { name: 'Venusaur', set: 'Base', number: '15', rarity: 'rare' as const, imageUrl: 'https://images.pokemontcg.io/base1/15_hires.png', externalId: 'base1-15' },
  { name: 'Mewtwo', set: 'Base', number: '10', rarity: 'rare' as const, imageUrl: 'https://images.pokemontcg.io/base1/10_hires.png', externalId: 'base1-10' },
  { name: 'Gyarados', set: 'Base', number: '6', rarity: 'rare' as const, imageUrl: 'https://images.pokemontcg.io/base1/6_hires.png', externalId: 'base1-6' },
  { name: 'Alakazam', set: 'Base', number: '1', rarity: 'rare' as const, imageUrl: 'https://images.pokemontcg.io/base1/1_hires.png', externalId: 'base1-1' },
  { name: 'Nidoking', set: 'Base', number: '11', rarity: 'rare' as const, imageUrl: 'https://images.pokemontcg.io/base1/11_hires.png', externalId: 'base1-11' },
  { name: 'Raichu', set: 'Base', number: '14', rarity: 'rare' as const, imageUrl: 'https://images.pokemontcg.io/base1/14_hires.png', externalId: 'base1-14' },
];

function seedPokemonCards(
  cards: Array<{
    name: string;
    set?: string;
    number: string;
    rarity: Card['rarity'];
    imageUrl: string;
    externalId: string;
  }>,
  setName: string,
): Card[] {
  return cards.map((c) => ({
    id: makeId('pkmn'),
    name: c.name,
    set: c.set ?? setName,
    number: c.number,
    rarity: c.rarity,
    game: 'Pokémon TCG',
    imageHue: 48,
    imageUrl: c.imageUrl,
    externalId: c.externalId,
    addedAt: new Date().toISOString(),
  }));
}

export function createShowcasePokemonCards(): Card[] {
  return seedPokemonCards(SHOWCASE_POKEMON, 'Base');
}

/** Hits from Pokémon TCG: 30th Celebration (me55) for demo catalogues. */
export const CELEBRATION_DEMO_POKEMON = [
  { name: 'Ho-Oh', number: '12', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-12/large', externalId: 'me55-12' },
  { name: 'Reshiram', number: '14', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-14/large', externalId: 'me55-14' },
  { name: 'Fuecoco ex', number: '15', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-15/large', externalId: 'me55-15' },
  { name: 'Kyogre', number: '19', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-19/large', externalId: 'me55-19' },
  { name: 'Palkia', number: '20', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-20/large', externalId: 'me55-20' },
  { name: 'Greninja ex', number: '21', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-21/large', externalId: 'me55-21' },
  { name: 'Pikachu', number: '23', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-23/large', externalId: 'me55-23' },
  { name: 'Pikachu', number: '30', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-30/large', externalId: 'me55-30' },
  { name: 'Pikachu', number: '40', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-40/large', externalId: 'me55-40' },
  { name: 'Pikachu', number: '50', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-50/large', externalId: 'me55-50' },
  { name: 'Pikachu ex', number: '53', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-53/large', externalId: 'me55-53' },
  { name: 'Pikachu ex', number: '54', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-54/large', externalId: 'me55-54' },
  { name: 'Zekrom', number: '56', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-56/large', externalId: 'me55-56' },
  { name: 'Miraidon', number: '62', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-62/large', externalId: 'me55-62' },
  { name: 'Mewtwo', number: '63', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-63/large', externalId: 'me55-63' },
  { name: 'Mewtwo ex', number: '64', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-64/large', externalId: 'me55-64' },
  { name: 'Mew', number: '65', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-65/large', externalId: 'me55-65' },
  { name: 'Mew ex', number: '66', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-66/large', externalId: 'me55-66' },
  { name: 'Espeon ex', number: '70', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-70/large', externalId: 'me55-70' },
  { name: 'Sylveon ex', number: '71', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-71/large', externalId: 'me55-71' },
  { name: 'Xerneas', number: '76', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-76/large', externalId: 'me55-76' },
  { name: 'Lunala', number: '80', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-80/large', externalId: 'me55-80' },
  { name: 'Gimmighoul', number: '81', rarity: 'common' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-81/large', externalId: 'me55-81' },
  { name: 'Groudon', number: '82', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-82/large', externalId: 'me55-82' },
  { name: 'Koraidon', number: '86', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-86/large', externalId: 'me55-86' },
  { name: 'Gengar ex', number: '90', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-90/large', externalId: 'me55-90' },
  { name: 'Umbreon ex', number: '92', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-92/large', externalId: 'me55-92' },
  { name: 'Yveltal', number: '100', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-100/large', externalId: 'me55-100' },
  { name: 'Jirachi ex', number: '102', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-102/large', externalId: 'me55-102' },
  { name: 'Dialga', number: '103', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-103/large', externalId: 'me55-103' },
  { name: 'Solgaleo', number: '105', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-105/large', externalId: 'me55-105' },
  { name: 'Zacian', number: '106', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-106/large', externalId: 'me55-106' },
  { name: 'Zamazenta', number: '107', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-107/large', externalId: 'me55-107' },
  { name: 'Salamence ex', number: '109', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-109/large', externalId: 'me55-109' },
  { name: 'Kangaskhan', number: '114', rarity: 'common' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-114/large', externalId: 'me55-114' },
  { name: 'Ditto', number: '115', rarity: 'common' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-115/large', externalId: 'me55-115' },
  { name: 'Lugia', number: '121', rarity: 'rare' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-121/large', externalId: 'me55-121' },
  { name: 'Alolan Exeggutor', number: '129', rarity: 'ultra' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-129/large', externalId: 'me55-129' },
  { name: 'Moltres', number: '130', rarity: 'ultra' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-130/large', externalId: 'me55-130' },
  { name: 'Lapras', number: '131', rarity: 'ultra' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-131/large', externalId: 'me55-131' },
  { name: 'Articuno', number: '132', rarity: 'ultra' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-132/large', externalId: 'me55-132' },
  { name: 'Zapdos', number: '133', rarity: 'ultra' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-133/large', externalId: 'me55-133' },
  { name: 'Toxtricity', number: '134', rarity: 'ultra' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-134/large', externalId: 'me55-134' },
  { name: 'Morpeko', number: '135', rarity: 'ultra' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-135/large', externalId: 'me55-135' },
  { name: 'Drifloon', number: '136', rarity: 'ultra' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-136/large', externalId: 'me55-136' },
  { name: 'Chandelure', number: '137', rarity: 'ultra' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-137/large', externalId: 'me55-137' },
  { name: 'Lycanroc', number: '138', rarity: 'ultra' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-138/large', externalId: 'me55-138' },
  { name: 'Alolan Meowth', number: '139', rarity: 'ultra' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-139/large', externalId: 'me55-139' },
  { name: 'Scraggy', number: '140', rarity: 'ultra' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-140/large', externalId: 'me55-140' },
  { name: 'Galarian Meowth', number: '141', rarity: 'ultra' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-141/large', externalId: 'me55-141' },
  { name: 'Gholdengo', number: '142', rarity: 'ultra' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-142/large', externalId: 'me55-142' },
  { name: 'Kommo-o', number: '143', rarity: 'ultra' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-143/large', externalId: 'me55-143' },
  { name: 'Meowth', number: '144', rarity: 'ultra' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-144/large', externalId: 'me55-144' },
  { name: 'Hisuian Zorua', number: '145', rarity: 'ultra' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-145/large', externalId: 'me55-145' },
  { name: 'Maushold', number: '146', rarity: 'ultra' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-146/large', externalId: 'me55-146' },
  { name: 'Fuecoco ex', number: '147', rarity: 'secret' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-147/large', externalId: 'me55-147' },
  { name: 'Greninja ex', number: '148', rarity: 'secret' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-148/large', externalId: 'me55-148' },
  { name: 'Pikachu ex', number: '149', rarity: 'secret' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-149/large', externalId: 'me55-149' },
  { name: 'Pikachu ex', number: '150', rarity: 'secret' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-150/large', externalId: 'me55-150' },
  { name: 'Mewtwo ex', number: '151', rarity: 'secret' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-151/large', externalId: 'me55-151' },
  { name: 'Mew ex', number: '152', rarity: 'secret' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-152/large', externalId: 'me55-152' },
  { name: 'Sylveon ex', number: '153', rarity: 'secret' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-153/large', externalId: 'me55-153' },
  { name: 'Gengar ex', number: '154', rarity: 'secret' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-154/large', externalId: 'me55-154' },
  { name: 'Jirachi ex', number: '155', rarity: 'secret' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-155/large', externalId: 'me55-155' },
  { name: 'Salamence ex', number: '156', rarity: 'secret' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-156/large', externalId: 'me55-156' },
  { name: 'Mewtwo ex', number: '157', rarity: 'secret' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-157/large', externalId: 'me55-157' },
  { name: 'Mew ex', number: '158', rarity: 'secret' as const, imageUrl: 'https://images.scrydex.com/pokemon/me55-158/large', externalId: 'me55-158' },
];

export function create30thCelebrationDemoCards(): Card[] {
  return seedPokemonCards(CELEBRATION_DEMO_POKEMON, '30th Celebration');
}

export function has30thCelebrationDemo(collection: Card[]) {
  return collection.some((c) => c.externalId?.startsWith('me55-'));
}

let setsPromise: Promise<GitHubSet[]> | null = null;
const setCardsCache = new Map<string, GitHubCard[]>();

async function loadSets(): Promise<GitHubSet[]> {
  if (!setsPromise) {
    setsPromise = fetch(`${DATA_BASE}/sets/en.json`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Could not load Pokémon sets (${res.status})`);
        return (await res.json()) as GitHubSet[];
      })
      .catch((err) => {
        setsPromise = null;
        throw err;
      });
  }
  return setsPromise;
}

async function loadSetCards(setId: string): Promise<GitHubCard[]> {
  const cached = setCardsCache.get(setId);
  if (cached) return cached;
  const res = await fetch(`${DATA_BASE}/cards/en/${setId}.json`);
  if (!res.ok) {
    setCardsCache.set(setId, []);
    return [];
  }
  const cards = (await res.json()) as GitHubCard[];
  setCardsCache.set(setId, cards);
  return cards;
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function setMatchesQuery(set: { id: string; name: string }, query: string) {
  const q = normalizeText(query);
  if (!q) return false;
  const name = normalizeText(set.name);
  const id = normalizeText(set.id);
  if (name.includes(q) || id.includes(q)) return true;
  return q.split(' ').filter(Boolean).every((t) => name.includes(t) || id.includes(t));
}

function prioritizeSets(sets: GitHubSet[]): GitHubSet[] {
  const classic = new Set(['base1', 'base2', 'base3', 'cel25', 'sv8pt5', 'me55', 'sv1', 'sv8']);
  const classics = sets.filter((s) => classic.has(s.id));
  const rest = [...sets].filter((s) => !classic.has(s.id)).sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
  const seen = new Set<string>();
  const ordered: GitHubSet[] = [];
  for (const s of [...classics, ...rest]) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    ordered.push(s);
  }
  return ordered;
}

export async function listAllPokemonSets(): Promise<PokemonSetResult[]> {
  const sets = await loadSets();
  return [...sets]
    .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))
    .map((set) => ({
      id: set.id,
      name: set.name,
      series: set.series ?? 'Other',
      releaseDate: set.releaseDate,
      printedTotal: set.printedTotal,
      total: set.total,
    }));
}

/** Sets whose printed/total size matches a collector-number denominator (e.g. 185 → Vivid Voltage). */
export async function findSetsByCardCount(denom: number): Promise<PokemonSetResult[]> {
  if (!Number.isFinite(denom) || denom < 1) return [];
  const sets = await listAllPokemonSets();
  return sets.filter(
    (s) => s.printedTotal === denom || s.total === denom,
  );
}

export async function getCardsFromSet(setId: string, pageSize = 500): Promise<Card[]> {
  const sets = await loadSets();
  const set = sets.find((s) => s.id === setId);
  if (!set) throw new Error('Set not found.');
  const cards = await loadSetCards(setId);
  if (cards.length === 0) throw new Error(`No cards found for ${set.name}.`);
  return cards.slice(0, pageSize).map((card) => githubToCard(card, set.name));
}

export async function searchPokemonCards(query: string, pageSize = 12): Promise<Card[]> {
  const q = query.trim().toLowerCase();
  if (!q || q.length < 2) return [];
  const qNorm = normalizeText(q);

  // Never treat a single Pokémon species word as a set title
  const looksLikeSetQuery = q.includes(' ') && q.split(/\s+/).length >= 2;

  if (looksLikeSetQuery && q.length >= 5) {
    const matchingSets = (await loadSets()).filter((set) => setMatchesQuery(set, q));
    const exactSet = matchingSets.find((s) => normalizeText(s.name) === qNorm);
    if (exactSet) {
      const cards = await loadSetCards(exactSet.id);
      return cards.slice(0, pageSize).map((card) => githubToCard(card, exactSet.name));
    }
  }

  const sets = prioritizeSets(await loadSets());
  const exact: Card[] = [];
  const partial: Card[] = [];

  for (let i = 0; i < Math.min(sets.length, 120) && exact.length + partial.length < pageSize * 2; i += 8) {
    const batch = sets.slice(i, i + 8);
    const loaded = await Promise.all(
      batch.map(async (set) => ({ set, cards: await loadSetCards(set.id) })),
    );
    for (const { set, cards } of loaded) {
      for (const card of cards) {
        const name = normalizeText(card.name);
        const base = name.replace(/\s+(ex|gx|v|vmax|vstar)$/i, '').trim();
        if (name === qNorm || base === qNorm) {
          exact.push(githubToCard(card, set.name));
        } else if (name.includes(qNorm) || qNorm.includes(base)) {
          partial.push(githubToCard(card, set.name));
        }
        if (exact.length >= pageSize) return exact.slice(0, pageSize);
      }
    }
  }

  return [...exact, ...partial].slice(0, pageSize);
}
