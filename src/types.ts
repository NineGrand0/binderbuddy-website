export type BinderStyle = 'midnight' | 'forest' | 'crimson' | 'sand' | 'clear';
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
}[] = [
  { id: 'midnight', label: 'Midnight Vinyl', cover: '#152238', spine: '#0a1220', accent: '#3d7ea6' },
  { id: 'forest', label: 'Forest Leather', cover: '#1f5c45', spine: '#0f3326', accent: '#6bc48a' },
  { id: 'crimson', label: 'Crimson Soft', cover: '#8a2438', spine: '#4a1220', accent: '#e86a7a' },
  { id: 'sand', label: 'Sand Canvas', cover: '#a67c52', spine: '#6b4a2e', accent: '#e0b87a' },
  { id: 'clear', label: 'Clear Front', cover: '#6d7d90', spine: '#3d4756', accent: '#c5d0dc' },
];

export const BINDER_SIZES: { id: BinderSize; label: string; desc: string }[] = [
  { id: '2x2', label: 'Pocket 2×2', desc: '4 cards per side' },
  { id: '3x3', label: 'Classic 3×3', desc: '9 cards per side' },
  { id: '4x3', label: 'Pro 4×3', desc: '12 cards per side' },
  { id: '5x4', label: 'Archive 5×4', desc: '20 cards per side' },
];
