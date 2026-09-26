export type CardImageSize = 'large' | 'small';

const PROXIED_HOSTS = new Set(['images.pokemontcg.io', 'assets.tcgdex.net', 'images.scrydex.com']);

// The /api/card-image endpoint only exists on the dev server until it's hosted elsewhere
const PROXY_ENABLED = import.meta.env.DEV || import.meta.env.VITE_CARD_IMAGE_PROXY === '1';

function isProxiable(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && PROXIED_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Catalogue art URL → our locally stored copy. User photos (data URLs) and
 * other hosts pass through unchanged.
 */
export function cardImageSrc(
  url: string | undefined,
  externalId?: string,
  size: CardImageSize = 'large',
): string | undefined {
  if (!url || !PROXY_ENABLED || !isProxiable(url)) return url;
  const params = new URLSearchParams({ src: url, size });
  if (externalId) params.set('id', externalId);
  return `/api/card-image?${params}`;
}
