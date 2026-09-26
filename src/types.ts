export type BinderStyle = 'black' | 'chestnut' | 'rose' | 'forest' | 'navy' | 'pokeball';
export type BinderSize = '2x2' | '3x3' | '4x3' | '4x4' | '5x4';

import type { BinderCoverPreset } from './lib/binderCovers';

export type { BinderCoverPreset };

export interface Card {
  id: string;
  name: string;
  set: string;
  number: string;
  rarity?: 'common' | 'uncommon' | 'rare' | 'ultra' | 'secret';
  game: string;
  imageHue: number;
  imageUrl?: string;
  imageDataUrl?: string;
  externalId?: string;
  /** Page import this card was saved from, when it came from a binder-page scan. */
  importId?: string;
  addedAt: string;
  /** Raw market condition for prototype JustTCG valuation. */
  condition?: CardCondition;
  /** JustTCG printing label after exact selection (e.g. Normal, Holofoil). */
  printing?: string;
  /** JustTCG card id — separate from our Card.id and catalogue externalId. */
  justtcgCardId?: string;
  /** Exact JustTCG condition+printing variant id. */
  justtcgVariantId?: string;
  price?: CardPriceSnapshot | null;
  priceStatus?: CardPriceStatus;
}

export type CardCondition = 'NM' | 'LP' | 'MP' | 'HP' | 'Damaged';

export type CardPriceStatus = 'priced' | 'unavailable' | 'pending';

export interface CardPriceSnapshot {
  amount: number;
  currency: string;
  source: 'JustTCG';
  lastRefreshedAt: string;
  marketUpdatedAt?: string;
}

export const CARD_CONDITIONS: CardCondition[] = ['NM', 'LP', 'MP', 'HP', 'Damaged'];

export interface ImagePoint {
  x: number;
  y: number;
}

export type DetectorId = 'demo-grid' | 'roboflow';

export interface PageImport {
  id: string;
  imageDataUrl: string;
  width: number;
  height: number;
  createdAt: string;
  detectorId: DetectorId;
  savedAt?: string;
}

export interface PageDetection {
  id: string;
  importId: string;
  /** Outline number shown on the photo, starting at 1. */
  index: number;
  corners: [ImagePoint, ImagePoint, ImagePoint, ImagePoint];
  included: boolean;
  imageDataUrl?: string;
  name: string;
  game: string;
  set: string;
  cardNumber: string;
  quantity: number;
  /** Catalogue printing id when the user accepted or chose a match. */
  externalId?: string;
  /** Reference art for the suggested / chosen printing (review only). */
  catalogueImageUrl?: string;
  matchStatus?:
    | 'reading'
    | 'suggested'
    | 'accepted'
    | 'manual'
    | 'unidentified'
    | 'failed'
    | 'needs-number';
  matchNote?: string;
  matchCandidates?: {
    externalId: string;
    name: string;
    set: string;
    number: string;
    imageUrl: string;
    score: number;
    reason?: string;
  }[];
  /** Additional plausible printings behind “Show more”. */
  matchMoreCandidates?: {
    externalId: string;
    name: string;
    set: string;
    number: string;
    imageUrl: string;
    score: number;
    reason?: string;
  }[];
  needsCollectorNumber?: boolean;
  /** Dev-only match diagnostics (identifiers + accept/reject reasons). */
  matchDiagnostics?: {
    identifiers: Record<string, unknown>;
    mode: string;
    accepted: Array<{ externalId: string; reason?: string; score: number }>;
    rejected: Array<{ name: string; set?: string; number?: string; reason: string }>;
  };
  condition?: CardCondition;
  printing?: string;
  justtcgCardId?: string;
  justtcgVariantId?: string;
  price?: CardPriceSnapshot | null;
  priceStatus?: CardPriceStatus;
  /** When resolve needs the user to pick an exact JustTCG printing. */
  justtcgPrintings?: string[];
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
  /** One-time Premium unlock ($15). Admin accounts are treated as premium. */
  isPremium?: boolean;
  premiumPurchasedAt?: string;
  premiumPaymentMethod?: PremiumPaymentMethod;
  collection: Card[];
  binders: Binder[];
  pageImports?: PageImport[];
  pageDetections?: PageDetection[];
}

export type PremiumPaymentMethod = 'card' | 'paypal' | 'apple_pay';

export const PREMIUM_PRICE_USD = 15;

export function userHasPremium(user: Pick<User, 'isPremium' | 'role'> | null | undefined): boolean {
  if (!user) return false;
  return Boolean(user.isPremium) || user.role === 'admin';
}

export interface Session {
  userId: string;
}

export const SLOT_COUNTS: Record<BinderSize, number> = {
  '2x2': 4,
  '3x3': 9,
  '4x3': 12,
  '4x4': 16,
  '5x4': 20,
};

export const GRID_COLS: Record<BinderSize, number> = {
  '2x2': 2,
  '3x3': 3,
  '4x3': 3,
  '4x4': 4,
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
  { id: '4x4', label: 'Square 4×4', desc: '16 cards per side' },
  { id: '5x4', label: 'Archive 5×4', desc: '20 cards per side' },
];
