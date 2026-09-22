export type BinderStyle = 'black' | 'chestnut' | 'rose' | 'forest' | 'navy' | 'pokeball';
export type BinderSize = '2x2' | '3x3' | '4x3' | '5x4';

import type { BinderCoverPreset } from './lib/binderCovers';

export type { BinderCoverPreset };

export interface Card {
  id: string;
  name: string;
  set: string;
  number: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'ultra' | 'secret';
  game: string;
  imageHue: number;
  imageUrl?: string;
  imageDataUrl?: string;
  externalId?: string;
  addedAt: string;
}

export interface BinderPage {
  slots: (string | null)[];
}

export interface Binder {
  id: string;
  name: string;
  style: BinderStyle;
  size: BinderSize;
  pages: BinderPage[];
  createdAt: string;
  updatedAt: string;
  isPublic: boolean;
  /** Decorative cover preset for dashboard / share tiles */
  coverPreset?: BinderCoverPreset;
  /** Optional custom preview photo for tiles */
  previewImageDataUrl?: string;
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  password: string;
  shareCode: string;
  role?: 'admin' | 'user';
  collection: Card[];
  binders: Binder[];
}

export interface Session {
  userId: string;
}

export const SLOT_COUNTS: Record<BinderSize, number> = {
  '2x2': 4,
  '3x3': 9,
  '4x3': 12,
  '5x4': 20,
};

export const GRID_COLS: Record<BinderSize, number> = {
  '2x2': 2,
  '3x3': 3,
  '4x3': 3,
  '5x4': 4,
};

export const BINDER_STYLES: {
  id: BinderStyle;
  label: string;
  cover: string;
  spine: string;
  accent: string;
  hi: string;
  mid: string;
  deep: string;
  rail: string;
  spineHi: string;
}[] = [
  {
    id: 'black',
    label: 'Black Leather',
    cover: '#1a1612',
    spine: '#0c0a08',
    accent: '#c4a882',
    hi: '#5a4b3d',
    mid: '#2a231c',
    deep: '#14110e',
    rail: '#6a5848',
    spineHi: '#4a3c30',
  },
  {
    id: 'chestnut',
    label: 'Chestnut Leather',
    cover: '#5c3420',
    spine: '#2a160e',
    accent: '#e7c4a0',
    hi: '#a06a42',
    mid: '#6b3d24',
    deep: '#3a2014',
    rail: '#b07a4e',
    spineHi: '#8a5434',
  },
  {
    id: 'rose',
    label: 'Rose Leather',
    cover: '#5c1e28',
    spine: '#2e1016',
    accent: '#e8b4a8',
    hi: '#8e3a44',
    mid: '#6a2832',
    deep: '#3c141c',
    rail: '#a04a52',
    spineHi: '#7a303c',
  },
  {
    id: 'forest',
    label: 'Forest Leather',
    cover: '#1e3c2c',
    spine: '#0e2218',
    accent: '#c4d8b8',
    hi: '#3e6a50',
    mid: '#264836',
    deep: '#14281e',
    rail: '#4e7a5e',
    spineHi: '#356048',
  },
  {
    id: 'navy',
    label: 'Navy Leather',
    cover: '#1a2c4a',
    spine: '#0c1628',
    accent: '#c8d4e8',
    hi: '#3a5278',
    mid: '#203656',
    deep: '#121e34',
    rail: '#4a6490',
    spineHi: '#2e4668',
  },
  {
    id: 'pokeball',
    label: 'Pokeball Leather',
    cover: '#1a1612',
    spine: '#0c0a08',
    accent: '#c4a882',
    hi: '#5a4b3d',
    mid: '#2a231c',
    deep: '#14110e',
    rail: '#6a5848',
    spineHi: '#4a3c30',
  },
];

const LEGACY_BINDER_STYLES: Record<string, BinderStyle> = {
  black: 'black',
  'black-leather': 'black',
  chestnut: 'chestnut',
  cognac: 'chestnut',
  sand: 'chestnut',
  clear: 'chestnut',
  rose: 'rose',
  oxblood: 'rose',
  crimson: 'rose',
  forest: 'forest',
  navy: 'navy',
  midnight: 'navy',
  pokeball: 'pokeball',
};

export function normalizeBinderStyle(style: string): BinderStyle {
  return LEGACY_BINDER_STYLES[style] ?? 'black';
}

export function getBinderStyle(style: string) {
  const id = normalizeBinderStyle(style);
  return BINDER_STYLES.find((item) => item.id === id) ?? BINDER_STYLES[0];
}

export function leatherCssVars(style: (typeof BINDER_STYLES)[number]) {
  return {
    '--binder-cover': style.cover,
    '--binder-spine': style.spine,
    '--binder-accent': style.accent,
    '--leather-hi': style.hi,
    '--leather-mid': style.mid,
    '--leather-deep': style.deep,
    '--leather-rail': style.rail,
    '--leather-spine-hi': style.spineHi,
  };
}

export const BINDER_SIZES: { id: BinderSize; label: string; desc: string }[] = [
  { id: '2x2', label: 'Pocket 2×2', desc: '4 cards per side' },
  { id: '3x3', label: 'Classic 3×3', desc: '9 cards per side' },
  { id: '4x3', label: 'Pro 4×3', desc: '12 cards per side' },
  { id: '5x4', label: 'Archive 5×4', desc: '20 cards per side' },
];
