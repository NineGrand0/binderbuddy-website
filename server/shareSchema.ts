/**
 * Guest-visible shape of a shared binder. The server runs every incoming snapshot through
 * `sanitizeShareSnapshot`, so anything not listed here (JustTCG ids, import ids, timestamps,
 * owner email) can never reach a guest even if a client sends it. Prices are only kept when
 * the snapshot carries a `prices` section, which the owner can switch off.
 *
 * Pure TypeScript: imported by both the dev server and the browser bundle.
 */

export const SHARE_BINDER_SIZES = ['2x2', '3x3', '4x3', '4x4', '5x4'] as const;
export const SHARE_CARD_RARITIES = ['common', 'uncommon', 'rare', 'ultra', 'secret'] as const;
export const SHARE_CARD_CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'Damaged'] as const;

const SLOTS_PER_SIZE: Record<SharedBinderSize, number> = {
  '2x2': 4,
  '3x3': 9,
  '4x3': 12,
  '4x4': 16,
  '5x4': 20,
};

export type SharedBinderSize = (typeof SHARE_BINDER_SIZES)[number];
export type SharedCardRarity = (typeof SHARE_CARD_RARITIES)[number];
export type SharedCardCondition = (typeof SHARE_CARD_CONDITIONS)[number];

export interface SharedCard {
  id: string;
  name: string;
  set: string;
  number: string;
  game: string;
  imageHue: number;
  rarity?: SharedCardRarity;
  condition?: SharedCardCondition;
  imageUrl?: string;
  imageDataUrl?: string;
  externalId?: string;
  /** Only present when the owner shares prices. */
  price?: { amount: number; currency: string };
}

export interface SharedValuePoint {
  date: string;
  total: number;
  currency: string;
  priced: number;
  cards: number;
}

export interface SharedPriceGuide {
  /** Day 0 of the graph — the binder's creation day. */
  startDay: string;
  history: SharedValuePoint[];
}

export interface SharedBinder {
  name: string;
  style: string;
  size: SharedBinderSize;
  coverPreset?: string;
  previewImageDataUrl?: string;
  pages: { slots: (string | null)[] }[];
}

export interface ShareSnapshot {
  ownerName: string;
  binder: SharedBinder;
  cards: SharedCard[];
  prices?: SharedPriceGuide;
}

const MAX_PAGES = 400;
const MAX_TEXT = 160;
const MAX_ID = 120;
const MAX_URL = 2048;
const MAX_DATA_URL = 4 * 1024 * 1024;
const DATA_IMAGE_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/;
const TOKEN_RE = /^[a-z0-9-]{1,40}$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const MAX_AMOUNT = 100_000_000;
const MAX_HISTORY = 20 * 366;

export class ShareSnapshotError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max = MAX_TEXT): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_URL) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function dataImage(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_DATA_URL) return undefined;
  return DATA_IMAGE_RE.test(value) ? value : undefined;
}

function amount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_AMOUNT
    ? Math.round(value * 100) / 100
    : undefined;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? Math.min(value, 100_000) : 0;
}

function sanitizePrice(raw: unknown): SharedCard['price'] {
  if (!isRecord(raw)) return undefined;
  const value = amount(raw.amount);
  const currency = typeof raw.currency === 'string' && CURRENCY_RE.test(raw.currency) ? raw.currency : undefined;
  return value !== undefined && currency ? { amount: value, currency } : undefined;
}

function sanitizePriceGuide(raw: unknown): SharedPriceGuide | undefined {
  if (!isRecord(raw) || typeof raw.startDay !== 'string' || !DAY_RE.test(raw.startDay)) return undefined;
  const history: SharedValuePoint[] = [];
  for (const point of Array.isArray(raw.history) ? raw.history.slice(-MAX_HISTORY) : []) {
    if (!isRecord(point) || typeof point.date !== 'string' || !DAY_RE.test(point.date)) continue;
    const total = amount(point.total);
    const currency =
      typeof point.currency === 'string' && CURRENCY_RE.test(point.currency) ? point.currency : undefined;
    if (total === undefined || !currency) continue;
    history.push({ date: point.date, total, currency, priced: count(point.priced), cards: count(point.cards) });
  }
  history.sort((a, b) => a.date.localeCompare(b.date));
  return { startDay: raw.startDay, history };
}

function sanitizeCard(raw: unknown, includePrice: boolean): SharedCard | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id, MAX_ID);
  const name = text(raw.name);
  if (!id || !name) return null;
  const hue = typeof raw.imageHue === 'number' && Number.isFinite(raw.imageHue) ? raw.imageHue : 0;
  const card: SharedCard = {
    id,
    name,
    set: text(raw.set) ?? '',
    number: text(raw.number, 24) ?? '',
    game: text(raw.game, 60) ?? '',
    imageHue: Math.round(((hue % 360) + 360) % 360),
  };
  const rarity = oneOf(raw.rarity, SHARE_CARD_RARITIES);
  if (rarity) card.rarity = rarity;
  const condition = oneOf(raw.condition, SHARE_CARD_CONDITIONS);
  if (condition) card.condition = condition;
  const imageUrl = httpsUrl(raw.imageUrl);
  if (imageUrl) card.imageUrl = imageUrl;
  const imageDataUrl = dataImage(raw.imageDataUrl);
  if (imageDataUrl) card.imageDataUrl = imageDataUrl;
  const externalId = text(raw.externalId, MAX_ID);
  if (externalId) card.externalId = externalId;
  if (includePrice) {
    const price = sanitizePrice(raw.price);
    if (price) card.price = price;
  }
  return card;
}

/** Whitelists and bounds a snapshot. Throws `ShareSnapshotError` when it can't be shown at all. */
export function sanitizeShareSnapshot(raw: unknown): ShareSnapshot {
  if (!isRecord(raw) || !isRecord(raw.binder)) {
    throw new ShareSnapshotError('Snapshot must include a binder.');
  }
  const rawBinder = raw.binder;
  const size = oneOf(rawBinder.size, SHARE_BINDER_SIZES);
  if (!size) throw new ShareSnapshotError('Unsupported binder size.');
  if (!Array.isArray(rawBinder.pages) || rawBinder.pages.length === 0) {
    throw new ShareSnapshotError('Binder has no pages.');
  }
  if (rawBinder.pages.length > MAX_PAGES) {
    throw new ShareSnapshotError('Binder has too many pages to share.');
  }

  const slotCount = SLOTS_PER_SIZE[size];
  const referenced = new Set<string>();
  const pages = rawBinder.pages.map((page) => {
    const rawSlots = isRecord(page) && Array.isArray(page.slots) ? page.slots : [];
    const slots = Array.from({ length: slotCount }, (_, i) => {
      const id = text(rawSlots[i], MAX_ID) ?? null;
      if (id) referenced.add(id);
      return id;
    });
    return { slots };
  });

  const prices = sanitizePriceGuide(raw.prices);
  const cards: SharedCard[] = [];
  const seen = new Set<string>();
  for (const rawCard of Array.isArray(raw.cards) ? raw.cards : []) {
    const card = sanitizeCard(rawCard, prices !== undefined);
    if (!card || !referenced.has(card.id) || seen.has(card.id)) continue;
    seen.add(card.id);
    cards.push(card);
  }

  const binder: SharedBinder = {
    name: text(rawBinder.name, 80) ?? 'Shared binder',
    style: TOKEN_RE.test(String(rawBinder.style ?? '')) ? String(rawBinder.style) : 'black',
    size,
    pages,
  };
  if (typeof rawBinder.coverPreset === 'string' && TOKEN_RE.test(rawBinder.coverPreset)) {
    binder.coverPreset = rawBinder.coverPreset;
  }
  const preview = dataImage(rawBinder.previewImageDataUrl);
  if (preview) binder.previewImageDataUrl = preview;

  const snapshot: ShareSnapshot = {
    ownerName: text(raw.ownerName, 60) ?? 'A collector',
    binder,
    cards,
  };
  if (prices) snapshot.prices = prices;
  return snapshot;
}
