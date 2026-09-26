import type { Card } from '../types';
import { makeId } from './ids';
import { SUPPLEMENTAL_SETS } from '../data/firstPartnerCollection';
import {
  getTcgdexSet,
  listTcgdexSets,
  tcgdexDate,
  tcgdexIdToCatalogueId,
  tcgdexImage,
} from './tcgdex';
import {
  buildIdentifiers,
  nameCompatibility,
  normalizeCardTitle,
  parseNameSuffix,
  type CardIdentifiers,
} from './cardIdentifiers';

const DATA_BASE = 'https://cdn.jsdelivr.net/gh/PokemonTCG/pokemon-tcg-data@master';

interface GitHubCard {
  id: string;
  name: string;
  number: string;
  rarity?: string;
  images: { small: string; large: string };
  hp?: string;
  attacks?: Array<{ name?: string }>;
  abilities?: Array<{ name?: string }>;
}

interface GitHubSet {
  id: string;
  name: string;
  series?: string;
  releaseDate: string;
  printedTotal?: number;
  total?: number;
  ptcgoCode?: string;
}

export interface PokemonSetResult {
  id: string;
  name: string;
  series: string;
  releaseDate: string;
  printedTotal?: number;
  total?: number;
  ptcgoCode?: string;
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
const setCardsCache = new Map<string, Promise<GitHubCard[]>>();
/** Catalogue set id → TCGdex set id, for sets TCGdex can add or top up. */
const tcgdexSource = new Map<string, string>();
/** Sets that exist only on TCGdex (no pokemon-tcg-data file to fetch). */
const tcgdexOnlySets = new Set<string>();

function setNameTokens(name: string): string[] {
  return normalizeText(name)
    .replace(/\b(black star|promos?|collection|pokemon|the|and|hs)\b/g, ' ')
    .split(' ')
    .filter(Boolean);
}

function sameSetName(a: string, b: string, totalA?: number, totalB?: number) {
  const ta = setNameTokens(a);
  const tb = setNameTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  if (ta.join(' ') === tb.join(' ')) return true;
  // “30th Classic Collection” vs “30th Celebration: Classic Collection” — same size, subset name
  if (totalA == null || totalA !== totalB) return false;
  const [small, big] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return small.every((t) => big.includes(t));
}

/** Add sets PokemonTCG data is missing, and flag sets TCGdex has more cards for. */
async function mergeTcgdexSets(sets: GitHubSet[]): Promise<GitHubSet[]> {
  const extra = await listTcgdexSets();
  if (extra.length === 0) return sets;
  const byId = new Map(sets.map((s) => [s.id, s]));
  const added: Array<{ id: string; tcgdexId: string }> = [];
  const toppedUp = new Map<string, number>();

  for (const t of extra) {
    const mappedId = tcgdexIdToCatalogueId(t.id);
    const total = t.cardCount?.total ?? 0;
    const match =
      byId.get(mappedId) ?? sets.find((s) => sameSetName(s.name, t.name, s.total, total));
    if (match) {
      if (total > (match.total ?? 0)) {
        tcgdexSource.set(match.id, t.id);
        toppedUp.set(match.id, total);
      }
      continue;
    }
    const id = byId.has(mappedId) ? `${mappedId}-tcgdex` : mappedId;
    tcgdexSource.set(id, t.id);
    tcgdexOnlySets.add(id);
    added.push({ id, tcgdexId: t.id });
  }

  const details = await Promise.all(added.map((a) => getTcgdexSet(a.tcgdexId)));
  const newSets: GitHubSet[] = [];
  added.forEach((a, i) => {
    const d = details[i];
    if (!d || d.cards.length === 0) return;
    newSets.push({
      id: a.id,
      name: d.name,
      series: d.serie?.name,
      releaseDate: tcgdexDate(d.releaseDate),
      printedTotal: d.cardCount?.official,
      total: d.cardCount?.total ?? d.cards.length,
      ptcgoCode: d.abbreviation?.official,
    });
  });
  const merged = sets.map((s) => (toppedUp.has(s.id) ? { ...s, total: toppedUp.get(s.id) } : s));
  return [...merged, ...newSets];
}

async function loadSets(): Promise<GitHubSet[]> {
  if (!setsPromise) {
    setsPromise = fetch(`${DATA_BASE}/sets/en.json`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Could not load Pokémon sets (${res.status})`);
        const sets = (await res.json()) as GitHubSet[];
        const known = new Set(sets.map((s) => s.id));
        const withLocal = [
          ...sets,
          ...SUPPLEMENTAL_SETS.map((s) => s.set).filter((s) => !known.has(s.id)),
        ];
        return mergeTcgdexSets(withLocal);
      })
      .catch((err) => {
        setsPromise = null;
        throw err;
      });
  }
  return setsPromise;
}

function catalogueNumber(localId: string) {
  return /^\d+$/.test(localId) ? String(Number(localId)) : localId;
}

async function fetchSetCards(setId: string): Promise<GitHubCard[]> {
  await loadSets();
  const local = SUPPLEMENTAL_SETS.find((s) => s.set.id === setId)?.cards ?? [];
  let remote: GitHubCard[] = [];
  if (!tcgdexOnlySets.has(setId)) {
    const res = await fetch(`${DATA_BASE}/cards/en/${setId}.json`).catch(() => null);
    remote = res?.ok ? ((await res.json()) as GitHubCard[]) : [];
  }
  const cards = [...remote];
  const haveIds = new Set(cards.map((c) => c.id));
  for (const c of local) {
    if (!haveIds.has(c.id)) {
      cards.push(c);
      haveIds.add(c.id);
    }
  }

  const tcgdexId = tcgdexSource.get(setId);
  if (tcgdexId) {
    const t = await getTcgdexSet(tcgdexId);
    const haveNumbers = new Set(cards.map((c) => catalogueNumber(c.number).toLowerCase()));
    for (const card of t?.cards ?? []) {
      const num = catalogueNumber(card.localId);
      const id = `${setId}-${num}`;
      if (haveIds.has(id) || haveNumbers.has(num.toLowerCase())) continue;
      cards.push({
        id,
        name: card.name,
        number: card.localId,
        images: {
          small: tcgdexImage(card, 'low') ?? `https://images.scrydex.com/pokemon/${id}/small`,
          large: tcgdexImage(card, 'high') ?? `https://images.scrydex.com/pokemon/${id}/large`,
        },
      });
      haveIds.add(id);
    }
  }
  return cards;
}

async function loadSetCards(setId: string): Promise<GitHubCard[]> {
  let hit = setCardsCache.get(setId);
  if (!hit) {
    hit = fetchSetCards(setId).catch(() => {
      setCardsCache.delete(setId);
      return [];
    });
    setCardsCache.set(setId, hit);
  }
  return hit;
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
  const classic = new Set([
    'base1',
    'base2',
    'base3',
    'cel25',
    'sv8pt5',
    'me55',
    'sv1',
    'sv8',
    'svp',
    'swshp',
    'smp',
    'xyp',
  ]);
  const classics = sets.filter((s) => classic.has(s.id));
  const rest = [...sets]
    .filter((s) => !classic.has(s.id))
    .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
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
      ptcgoCode: set.ptcgoCode,
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

export interface PokemonMatchCandidate {
  externalId: string;
  name: string;
  set: string;
  number: string;
  rarity?: Card['rarity'];
  imageUrl: string;
  score: number;
  /** Why this printing was kept (dev / UI diagnostics). */
  reason?: string;
}

export type MatchReject = {
  externalId?: string;
  name: string;
  set?: string;
  number?: string;
  reason: string;
};

export type PrintingMatchResult = {
  candidates: PokemonMatchCandidate[];
  /** Extra plausible hits beyond the display cap (for “Show more”). */
  moreCandidates: PokemonMatchCandidate[];
  rejects: MatchReject[];
  mode: 'exact' | 'filtered' | 'name-only' | 'empty';
  note: string;
  needsCollectorNumber: boolean;
};

let catalogueWarm: Promise<void> | null = null;

async function loadAllSetCards(): Promise<Array<{ set: GitHubSet; cards: GitHubCard[] }>> {
  const sets = prioritizeSets(await loadSets());
  const out: Array<{ set: GitHubSet; cards: GitHubCard[] }> = [];
  for (let i = 0; i < sets.length; i += 16) {
    const batch = sets.slice(i, i + 16);
    const loaded = await Promise.all(
      batch.map(async (set) => ({ set, cards: await loadSetCards(set.id).catch(() => []) })),
    );
    out.push(...loaded);
  }
  return out;
}

/** Start downloading the whole catalogue in the background so the first match is fast. */
export function warmPokemonCatalogue(): Promise<void> {
  if (!catalogueWarm) {
    catalogueWarm = loadAllSetCards()
      .then(() => undefined)
      .catch(() => {
        catalogueWarm = null;
      });
  }
  return catalogueWarm;
}

function extractHp(text: string): string | undefined {
  return text.match(/\bhp\s*(\d{2,3})\b/i)?.[1];
}

/**
 * Attack / ability names that appear in the OCR text. Matches on the significant words
 * (4+ letters) so foil noise like “ax Volt Tackle” still hits “G-Max Volt Tackle”.
 * `minChars` is the least total significant-letter count a move needs to count.
 */
function matchedMoves(
  card: GitHubCard,
  hay: string,
  minChars: number,
): { names: string[]; points: number } {
  if (!hay) return { names: [], points: 0 };
  const padded = ` ${hay} `;
  const names: string[] = [];
  let points = 0;
  for (const move of [...(card.attacks ?? []), ...(card.abilities ?? [])]) {
    const tokens = normalizeText(move.name ?? '')
      .split(' ')
      .filter((t) => t.length >= 4);
    const chars = tokens.reduce((n, t) => n + t.length, 0);
    if (tokens.length === 0 || chars < minChars) continue;
    if (!tokens.every((t) => padded.includes(` ${t} `))) continue;
    names.push(move.name!);
    points += Math.min(70, chars * 5);
  }
  return { names, points };
}

/** Every catalogue card whose attack / ability text is backed by the OCR (evidence score only). */
async function collectTextHits(ocrText: string, minChars: number): Promise<RankedHit[]> {
  const hay = normalizeText(ocrText);
  if (hay.length < 6) return [];
  const hp = extractHp(ocrText);
  const hits: RankedHit[] = [];
  for (const { set, cards } of await loadAllSetCards()) {
    for (const card of cards) {
      const moves = matchedMoves(card, hay, minChars);
      if (moves.names.length === 0) continue;
      const hpHit = Boolean(hp && card.hp === hp);
      hits.push({
        externalId: card.id,
        name: card.name,
        set: set.name,
        number: card.number,
        rarity: mapRarity(card.rarity),
        imageUrl: card.images.large || card.images.small,
        score: moves.points + (hpHit ? 35 : 0),
        reason: `text: ${moves.names.join(', ')}${hpHit ? ` · HP ${hp}` : ''}`,
        releaseDate: set.releaseDate,
      });
    }
  }
  return hits;
}

type RankedHit = PokemonMatchCandidate & { releaseDate: string };

const TEXT_ONLY_MIN_CHARS = 7;

function finishRanking(hits: RankedHit[]): PokemonMatchCandidate[] {
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      b.releaseDate.localeCompare(a.releaseDate) ||
      a.number.localeCompare(b.number, undefined, { numeric: true }),
  );
  const seen = new Set<string>();
  const unique: PokemonMatchCandidate[] = [];
  for (const { releaseDate: _releaseDate, ...hit } of hits) {
    if (seen.has(hit.externalId)) continue;
    seen.add(hit.externalId);
    unique.push(hit);
  }
  return unique;
}

function nameCompatibilityOk(ocrName: string, catalogName: string) {
  const compat = nameCompatibility(ocrName, catalogName);
  return compat !== 'no' && compat !== 'suffix-conflict';
}

function isClearWinner(ranked: PokemonMatchCandidate[]) {
  if (ranked.length === 1) return true;
  return ranked.length > 1 && ranked[0].score - ranked[1].score >= 40;
}

/**
 * No readable name: match attack / ability names from the OCR text (rainbow foils).
 */
export async function matchByAttackText(
  ocrText: string,
  options?: { limit?: number; moreLimit?: number },
): Promise<PrintingMatchResult | null> {
  const limit = options?.limit ?? 3;
  const moreLimit = options?.moreLimit ?? 200;
  // Short move names (“Bubble”, “Tackle”) are too common to identify a card on their own
  const ranked = finishRanking(await collectTextHits(ocrText, TEXT_ONLY_MIN_CHARS));
  if (ranked.length === 0) return null;
  // Keep only printings sharing the best evidence — one weak move hit elsewhere is noise
  const focused = ranked.filter((h) => h.score >= ranked[0].score - 30).slice(0, moreLimit);
  return {
    candidates: focused.slice(0, limit),
    moreCandidates: focused.slice(limit),
    rejects: [],
    mode: isClearWinner(focused) ? 'exact' : 'filtered',
    note:
      focused.length === 1
        ? `Matched ${focused[0].name} · ${focused[0].set} from the attack text on the card. Confirm to accept.`
        : `Name was unreadable — ${focused.length} printings share the attack text on the card. Pick yours.`,
    needsCollectorNumber: false,
  };
}

/**
 * Match catalogue printings from name + suffix, ranked by the other identifiers
 * (set symbol / code, attack & ability text, HP). Collector numbers are not used —
 * every printing that fits the name is returned so the user can pick.
 */
export async function matchPokemonPrintings(
  identifiers: CardIdentifiers,
  options?: { limit?: number; moreLimit?: number; ocrText?: string },
): Promise<PrintingMatchResult> {
  const limit = options?.limit ?? 3;
  const moreLimit = options?.moreLimit ?? 200;
  const ocrText = options?.ocrText ?? '';
  const name = identifiers.name?.trim();

  if (!name || name.length < 2) {
    const byText = ocrText ? await matchByAttackText(ocrText, { limit, moreLimit }) : null;
    if (byText) return byText;
    return {
      candidates: [],
      moreCandidates: [],
      rejects: [],
      mode: 'empty',
      note: 'Could not read a Pokémon name. Crop tighter on the title, or search manually.',
      needsCollectorNumber: false,
    };
  }

  const hay = normalizeText(ocrText);
  const hp = extractHp(ocrText);
  const wantSet = identifiers.set ? normalizeCardTitle(identifiers.set) : '';
  const wantCode = identifiers.setCode?.toUpperCase();

  const primary: RankedHit[] = [];
  const fallback: RankedHit[] = [];
  const rejects: MatchReject[] = [];

  for (const { set, cards } of await loadAllSetCards()) {
    const setNorm = normalizeCardTitle(set.name);
    const setHit =
      Boolean(wantSet) && (setNorm === wantSet || setNorm.includes(wantSet) || wantSet.includes(setNorm));
    const codeHit = Boolean(wantCode) && set.ptcgoCode?.toUpperCase() === wantCode;

    for (const card of cards) {
      const compat = nameCompatibility(name, card.name);
      if (compat === 'no') continue;

      const suffixFits =
        compat === 'exact' ||
        compat === 'same-suffix' ||
        (compat === 'base-only' && identifiers.suffix === 'v');

      let score = compat === 'exact' ? 100 : compat === 'same-suffix' ? 85 : compat === 'base-only' ? 50 : 30;
      const reasons: string[] = [`name ${compat}`];
      if (setHit) {
        score += 60;
        reasons.push(`set ${set.name}`);
      } else if (codeHit) {
        score += 40;
        reasons.push(`set code ${wantCode}`);
      }
      const moves = matchedMoves(card, hay, 5);
      if (moves.names.length) {
        score += moves.points;
        reasons.push(`text: ${moves.names.join(', ')}`);
      }
      const hpHit = Boolean(hp && card.hp === hp);
      if (hpHit) {
        score += 35;
        reasons.push(`HP ${hp}`);
      }

      const hit: RankedHit = {
        externalId: card.id,
        name: card.name,
        set: set.name,
        number: card.number,
        rarity: mapRarity(card.rarity),
        imageUrl: card.images.large || card.images.small,
        score,
        reason: reasons.join(' · '),
        releaseDate: set.releaseDate,
      };
      if (suffixFits) primary.push(hit);
      else {
        fallback.push(hit);
        rejects.push({
          externalId: card.id,
          name: card.name,
          set: set.name,
          number: card.number,
          reason: `Suffix differs from OCR “${name}”`,
        });
      }
    }
  }

  // OCR suffixes are noisy (“ex” from foil glare) — keep other-suffix printings the card text backs up
  const backedFallback = fallback.filter((h) => /text:|HP /.test(h.reason ?? ''));
  const usedFallback = primary.length === 0;
  const pool = usedFallback ? fallback : [...primary, ...backedFallback];

  // Weak name read (fuzzy, or no printing with that suffix): foil titles invent species,
  // so let other printings the attack text points at compete on evidence.
  let textLed = false;
  if (usedFallback || identifiers.confidence.name === 'low') {
    const inPool = new Set(pool.map((h) => h.externalId));
    const readSuffix = identifiers.suffix;
    for (const hit of await collectTextHits(ocrText, TEXT_ONLY_MIN_CHARS)) {
      if (inPool.has(hit.externalId)) continue;
      // The suffix logo often survives even when the species name doesn't
      const hitSuffix = parseNameSuffix(hit.name).suffix;
      // A lone “V” is as likely a clipped VMAX/VSTAR logo as a plain V
      const suffixBoost =
        readSuffix && hitSuffix === readSuffix
          ? 25
          : readSuffix === 'v' && (hitSuffix === 'vmax' || hitSuffix === 'vstar')
            ? 25
            : 0;
      pool.push({ ...hit, score: 40 + hit.score + suffixBoost });
      textLed = true;
    }
  }
  const ranked = finishRanking(pool).slice(0, moreLimit);

  if (ranked.length === 0) {
    return {
      candidates: [],
      moreCandidates: [],
      rejects: rejects.slice(0, 40),
      mode: 'empty',
      note: `No catalogue printing found for “${name}”. It may be too new for the catalogue — search manually or save it unidentified.`,
      needsCollectorNumber: false,
    };
  }

  const candidates = ranked.slice(0, limit);
  const moreCandidates = ranked.slice(limit);
  const winner = isClearWinner(ranked);
  const base = parseNameSuffix(name).base;

  let note: string;
  if (ranked.length === 1) {
    note = `Found ${candidates[0].name} · ${candidates[0].set}. Confirm to accept.`;
  } else if (textLed && !nameCompatibilityOk(name, candidates[0].name)) {
    note = `Title read as “${name}”, but the attack text points to ${candidates[0].name}. ${ranked.length} printings below — pick yours.`;
  } else if (usedFallback) {
    note = `No “${name}” printing in the catalogue — showing all ${ranked.length} printings named ${base}. Pick yours.`;
  } else if (winner) {
    note = `Best match: ${candidates[0].name} · ${candidates[0].set} (${candidates[0].reason}). ${ranked.length - 1} other printings below.`;
  } else {
    note = `${ranked.length} printings of “${name}” found — ranked by set, attack text and HP. Pick the one that matches your card.`;
  }

  return {
    candidates,
    moreCandidates,
    rejects: rejects.slice(0, 40),
    mode: winner ? 'exact' : 'filtered',
    note,
    needsCollectorNumber: false,
  };
}

/**
 * Back-compat wrapper: builds identifiers then runs tight printing match.
 */
export async function rankPokemonCardMatches(input: {
  name: string;
  number?: string;
  set?: string;
  setCode?: string;
  limit?: number;
  identifiers?: CardIdentifiers;
}): Promise<PokemonMatchCandidate[]> {
  const identifiers =
    input.identifiers ??
    buildIdentifiers({
      name: input.name,
      number: input.number,
      set: input.set,
      setCode: input.setCode,
      setSource: input.set ? 'text' : null,
    });
  const result = await matchPokemonPrintings(identifiers, {
    limit: input.limit ?? 3,
    moreLimit: Math.max(12, input.limit ?? 3),
  });
  return [...result.candidates, ...result.moreCandidates].slice(0, input.limit ?? 8);
}
