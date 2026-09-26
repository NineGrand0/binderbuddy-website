/**
 * Pokémon TCG: First Partner Illustration Collection (Series 1–3, 2026).
 * 27 Illustration Rare–style MEP black star promos (MEP 037–063), all illustrated by Saboteri.
 * Not yet in the PokemonTCG/pokemon-tcg-data catalogue, so they're merged in locally.
 * Ids follow the catalogue's `setId-number` scheme so official data dedupes against them later.
 */

export type SupplementalSet = {
  id: string;
  name: string;
  series: string;
  releaseDate: string;
  printedTotal?: number;
  total?: number;
  ptcgoCode?: string;
};

export type SupplementalCard = {
  id: string;
  name: string;
  number: string;
  rarity: string;
  hp: string;
  artist: string;
  images: { small: string; large: string };
  attacks: Array<{ name: string }>;
};

// The rest of the MEP promo line is filled in from TCGdex; these entries add HP + attacks for ranking
export const FIRST_PARTNER_SET: SupplementalSet = {
  id: 'mep',
  name: 'Mega Evolution Black Star Promos',
  series: 'Mega Evolution',
  releaseDate: '2025/09/26',
  printedTotal: 27,
  total: 27,
  ptcgoCode: 'MEP',
};

const CARDS: Array<[number: number, name: string, hp: string, attack: string]> = [
  // Series 1 — Kanto, Sinnoh, Alola
  [37, 'Bulbasaur', '80', 'Leech Seed'],
  [38, 'Charmander', '80', 'Ember'],
  [39, 'Squirtle', '80', 'Bubble'],
  [40, 'Turtwig', '90', 'Razor Leaf'],
  [41, 'Chimchar', '60', 'Fury Swipes'],
  [42, 'Piplup', '70', 'Peck'],
  [43, 'Rowlet', '70', 'Tackle'],
  [44, 'Litten', '70', 'Fire Fang'],
  [45, 'Popplio', '70', 'Disarming Voice'],
  // Series 2 — Johto, Unova, Galar
  [46, 'Chikorita', '70', 'Razor Leaf'],
  [47, 'Cyndaquil', '70', 'Tackle'],
  [48, 'Totodile', '80', 'Bite'],
  [49, 'Snivy', '60', 'Vine Whip'],
  [50, 'Tepig', '80', 'Ember'],
  [51, 'Oshawott', '70', 'Razor Shell'],
  [52, 'Grookey', '70', 'Branch Poke'],
  [53, 'Scorbunny', '70', 'Double Kick'],
  [54, 'Sobble', '70', 'Water Gun'],
  // Series 3 — Hoenn, Kalos, Paldea
  [55, 'Treecko', '70', 'Pound'],
  [56, 'Torchic', '60', 'Peck'],
  [57, 'Mudkip', '70', 'Mud-Slap'],
  [58, 'Chespin', '70', 'Pin Missile'],
  [59, 'Fennekin', '70', 'Scratch'],
  [60, 'Froakie', '70', 'Pound'],
  [61, 'Sprigatito', '70', 'Leafage'],
  [62, 'Fuecoco', '90', 'Flamethrower'],
  [63, 'Quaxly', '70', 'Wing Attack'],
];

export const FIRST_PARTNER_CARDS: SupplementalCard[] = CARDS.map(([number, name, hp, attack]) => ({
  id: `mep-${number}`,
  name,
  number: String(number).padStart(3, '0'),
  rarity: 'Illustration Rare',
  hp,
  artist: 'Saboteri',
  images: {
    small: `https://images.scrydex.com/pokemon/mep-${number}/small`,
    large: `https://images.scrydex.com/pokemon/mep-${number}/large`,
  },
  attacks: [{ name: attack }],
}));

/** Local sets merged into the catalogue, with their cards. */
export const SUPPLEMENTAL_SETS: Array<{ set: SupplementalSet; cards: SupplementalCard[] }> = [
  { set: FIRST_PARTNER_SET, cards: FIRST_PARTNER_CARDS },
];
