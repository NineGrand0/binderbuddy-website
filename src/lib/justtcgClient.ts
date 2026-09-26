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
    };

export type JustTcgPriceResult = {
  justtcgVariantId: string;
  status: 'priced' | 'unavailable';
  price?: CardPriceSnapshot;
  reason?: string;
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status}).`);
  }
  return data;
}

export function resolveJustTcgPrice(input: {
  name: string;
  set: string;
  number: string;
  condition: CardCondition;
  printing?: string;
}) {
  return postJson<JustTcgResolveResponse>('/api/justtcg/resolve', input);
}

export function refreshJustTcgPrices(input: {
  items: { justtcgVariantId: string; condition: CardCondition }[];
  force?: boolean;
}) {
  return postJson<{ results: JustTcgPriceResult[] }>('/api/justtcg/prices', input);
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
