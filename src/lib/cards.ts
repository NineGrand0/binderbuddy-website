import type { Card } from '../types';
import { makeId } from './ids';

const DEMO_NAMES = [
  ['Ember Drake', 'Ignition', '012'],
  ['Tide Caller', 'Depths', '045'],
  ['Iron Sentinel', 'Forge', '088'],
  ['Moss Warden', 'Canopy', '023'],
  ['Storm Viper', 'Tempest', '067'],
  ['Glass Oracle', 'Mirage', '101'],
  ['Ash Phoenix', 'Embers', '150'],
  ['Rune Beetle', 'Relics', '034'],
  ['Night Courier', 'Veil', '076'],
  ['Solar Knight', 'Radiance', '002'],
  ['Frost Lynx', 'Tundra', '055'],
  ['Echo Mage', 'Resonance', '119'],
];

const RARITIES: Card['rarity'][] = [
  'common', 'uncommon', 'rare', 'ultra', 'secret', 'rare',
  'uncommon', 'common', 'ultra', 'rare', 'uncommon', 'secret',
];

export function createDemoCards(): Card[] {
  return DEMO_NAMES.map(([name, set, number], i) => ({
    id: makeId('card'),
    name,
    set,
    number,
    rarity: RARITIES[i],
    game: 'Aether League',
    imageHue: (i * 47 + 18) % 360,
    addedAt: new Date(Date.now() - i * 86400000).toISOString(),
  }));
}

export function createCardFromScan(partial?: Partial<Card>): Card {
  const i = Math.floor(Math.random() * DEMO_NAMES.length);
  const [name, set, number] = DEMO_NAMES[i];
  return {
    id: makeId('card'),
    name: partial?.name ?? name,
    set: partial?.set ?? set,
    number: partial?.number ?? number,
    rarity: partial?.rarity ?? RARITIES[i],
    game: partial?.game ?? 'Aether League',
    imageHue: partial?.imageHue ?? (i * 47 + 18) % 360,
    imageDataUrl: partial?.imageDataUrl,
    addedAt: new Date().toISOString(),
  };
}

export function detectCardsFromPageImage(count = 9): Card[] {
  const n = Math.min(count, DEMO_NAMES.length);
  const shuffled = [...DEMO_NAMES.keys()].sort(() => Math.random() - 0.5).slice(0, n);
  return shuffled.map((i) => {
    const [name, set, number] = DEMO_NAMES[i];
    return {
      id: makeId('card'),
      name,
      set,
      number,
      rarity: RARITIES[i],
      game: 'Aether League',
      imageHue: (i * 47 + 18) % 360,
      addedAt: new Date().toISOString(),
    };
  });
}
