import type { CardCondition, CardPriceSnapshot } from '../types';

export type JustTcgResolveResponse =
  | {
      status: 'priced';
      justtcgCardId: string;
      justtcgVariantId: string;
      printing: string;
      price: CardPriceSnapshot;
    }
  | {
      status: 'needs_printing';
      justtcgCardId: string;
      printings: string[];
    }
  | {
      status: 'unavailable';
      reason: string;
      /** Fallback sources disagreed, so no price was chosen — the owner should set one. */
      conflict?: {
        market: 'TCGplayer' | 'Cardmarket';
        currency: 'USD' | 'EUR';
        tcgdex: number;
        pokemontcgio: number;
        pokemontcgioUpdatedAt?: string;
      };
    };

export type JustTcgPriceResult = {
  justtcgVariantId: string;
  status: 'priced' | 'unavailable';
  price?: CardPriceSnapshot;
  reason?: string;
};

export class PriceRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'PriceRequestError';
    this.status = status;
  }
}

/** JustTCG's per-minute / per-day limit — the card wasn't looked at, so it isn't "unavailable". */
export function isRateLimited(err: unknown): boolean {
  return err instanceof PriceRequestError && err.status === 429;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new PriceRequestError(data.error || `Request failed (${response.status}).`, response.status);
  }
  return data;
}

export function resolveJustTcgPrice(input: {
  name: string;
  set: string;
  number: string;
  condition: CardCondition;
  printing?: string;
  /** Catalogue card id (e.g. swsh4-188); lets the server look up by JustTCG set + number. */
  externalId?: string;
}) {
  return postJson<JustTcgResolveResponse>('/api/justtcg/resolve', input);
}

export function refreshJustTcgPrices(input: {
  items: { justtcgVariantId: string; condition: CardCondition }[];
  force?: boolean;
}) {
  return postJson<{ results: JustTcgPriceResult[] }>('/api/justtcg/prices', input);
}

/**
 * Where a price came from, for the line under it: "JustTCG · NM", or for fallbacks
 * "TCGplayer market via TCGdex · condition not factored in".
 */
export function describePriceSource(price: CardPriceSnapshot | null | undefined, condition?: string): string {
  if (!price) return '';
  if (price.source === 'Manual') return 'Set by you · never changed by a refresh';
  if (price.source === 'JustTCG') return condition ? `JustTCG · ${condition}` : 'JustTCG';
  const converted = price.converted ? ` (€${price.converted.amount.toFixed(2)} converted)` : '';
  const checked = price.crossCheck ? 'matches pokemontcg.io' : 'not cross-checked';
  return `${price.source} price via TCGdex${converted} · ${checked} · condition not factored in`;
}

/** Owner-entered prices are kept as-is: no JustTCG / TCGdex lookup may replace them. */
export function isManualPrice(price: CardPriceSnapshot | null | undefined): boolean {
  return price?.source === 'Manual';
}

export function manualPrice(amount: number): CardPriceSnapshot {
  return { amount, currency: 'USD', source: 'Manual', lastRefreshedAt: new Date().toISOString() };
}

export function formatCardPrice(price: CardPriceSnapshot | null | undefined): string {
  if (!price) return 'Price unavailable';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: price.currency || 'USD',
    }).format(price.amount);
  } catch {
    return `${price.amount} ${price.currency}`;
  }
}
