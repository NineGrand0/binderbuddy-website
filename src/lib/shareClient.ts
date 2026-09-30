import { sanitizeShareSnapshot, type ShareSnapshot } from '../../server/shareSchema';
import type { Binder, BinderShare, Card } from '../types';
import { binderStartDay } from './binderValue';

export type { ShareSnapshot, SharedCard } from '../../server/shareSchema';

export class ShareApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(url: string, init: RequestInit & { manageKey?: string } = {}): Promise<T> {
  const { manageKey, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (rest.body) headers.set('Content-Type', 'application/json');
  if (manageKey) headers.set('Authorization', `Bearer ${manageKey}`);
  let response: Response;
  try {
    response = await fetch(url, { ...rest, headers, cache: 'no-store', referrerPolicy: 'no-referrer' });
  } catch {
    throw new ShareApiError('Could not reach the sharing server.', 0);
  }
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new ShareApiError(data.error || `Request failed (${response.status}).`, response.status);
  }
  return data;
}

/**
 * Guest-safe copy of a binder: only whitelisted fields and only the cards it holds.
 * Prices and the price graph are included unless the owner turned `sharePrices` off.
 */
export function buildShareSnapshot(binder: Binder, collection: Card[], ownerName: string): ShareSnapshot {
  const slotted = new Set<string>();
  for (const page of binder.pages) {
    for (const id of page.slots) if (id) slotted.add(id);
  }
  const includePrices = binder.sharePrices !== false;
  const cards = collection
    .filter((card) => slotted.has(card.id))
    .map((card) => ({
      ...card,
      price: includePrices && card.priceStatus === 'priced' ? card.price : undefined,
    }));
  return sanitizeShareSnapshot({
    prices: includePrices
      ? {
          startDay: binderStartDay(binder.createdAt, binder.valueHistory),
          history: binder.valueHistory ?? [],
        }
      : undefined,
    ownerName,
    binder: {
      name: binder.name,
      style: binder.style,
      size: binder.size,
      coverPreset: binder.coverPreset,
      previewImageDataUrl: binder.previewImageDataUrl,
      pages: binder.pages,
    },
    cards,
  });
}

export function shareUrl(token: string): string {
  return `${window.location.origin}/s/${token}`;
}

export async function createShareLink(snapshot: ShareSnapshot): Promise<BinderShare> {
  const created = await request<{ shareId: string; token: string; manageKey: string }>('/api/shares', {
    method: 'POST',
    body: JSON.stringify({ snapshot }),
  });
  return { ...created, createdAt: new Date().toISOString() };
}

export function publishShare(share: BinderShare, snapshot: ShareSnapshot): Promise<{ updatedAt: string }> {
  return request(`/api/shares/${encodeURIComponent(share.shareId)}`, {
    method: 'PUT',
    manageKey: share.manageKey,
    body: JSON.stringify({ snapshot }),
  });
}

export async function regenerateShareLink(share: BinderShare): Promise<string> {
  const { token } = await request<{ token: string }>(
    `/api/shares/${encodeURIComponent(share.shareId)}/regenerate`,
    { method: 'POST', manageKey: share.manageKey },
  );
  return token;
}

export function disableShareLink(share: BinderShare): Promise<void> {
  return request(`/api/shares/${encodeURIComponent(share.shareId)}`, {
    method: 'DELETE',
    manageKey: share.manageKey,
  });
}

/** Resolves to `null` when the link was revoked, regenerated or its binder deleted. */
export async function fetchSharedBinder(
  token: string,
): Promise<{ snapshot: ShareSnapshot; updatedAt: string } | null> {
  try {
    return await request(`/api/shared/${encodeURIComponent(token)}`);
  } catch (err) {
    if (err instanceof ShareApiError && err.status === 404) return null;
    throw err;
  }
}
