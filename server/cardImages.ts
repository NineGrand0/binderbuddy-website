import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'

const CACHE_DIR = resolve('.cache/card-images')
const FETCH_TIMEOUT_MS = 15_000
// Scrydex answers unknown ids with a 200 “no image” PNG of exactly these sizes (large, small)
const SCRYDEX_PLACEHOLDER_BYTES = new Set([186_316, 45_551])

// Only card-art hosts — the endpoint must not fetch arbitrary URLs for callers
const ALLOWED_HOSTS = new Set(['images.pokemontcg.io', 'assets.tcgdex.net', 'images.scrydex.com'])

export type CardImageSize = 'large' | 'small'

const SIZES: Record<CardImageSize, { width: number; quality: number }> = {
  // Native pokemontcg.io hi-res width, so the detail-view zoom lens stays sharp
  large: { width: 734, quality: 85 },
  small: { width: 245, quality: 80 },
}

export class CardImageError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'CardImageError'
    this.status = status
  }
}

function isAllowedUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

/** PokemonTCG-style id (swsh4-188, mep-37) → other hosts that may carry the same card. */
function fallbackUrls(id: string, size: CardImageSize): string[] {
  const m = id.match(/^([a-z0-9.]+)-([A-Za-z0-9]+)$/i)
  if (!m) return []
  const [, set, number] = m
  return [
    `https://images.pokemontcg.io/${set}/${number}${size === 'large' ? '_hires' : ''}.png`,
    `https://images.scrydex.com/pokemon/${set}-${number}/${size}`,
  ]
}

function cacheFileFor(id: string | undefined, src: string | undefined, size: CardImageSize) {
  // Include the source so an edited image URL on the same card isn't served stale
  const parts = [
    id?.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80),
    src && createHash('sha1').update(src).digest('hex').slice(0, 10),
  ].filter(Boolean)
  return resolve(CACHE_DIR, `${parts.join('-')}-${size}.webp`)
}

async function download(url: string): Promise<Buffer | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return null
    if (!(res.headers.get('content-type') ?? '').startsWith('image/')) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (url.includes('images.scrydex.com') && SCRYDEX_PLACEHOLDER_BYTES.has(buf.length)) return null
    return buf
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

const inFlight = new Map<string, Promise<{ body: Buffer; source: string }>>()

/**
 * Serve a card image from local storage, downloading + shrinking it on first request.
 * Tries the given source URL first, then other hosts derived from the card id.
 */
export async function getCardImage(input: {
  id?: string
  src?: string
  size: CardImageSize
}): Promise<{ body: Buffer; cached: boolean; source: string }> {
  const src = input.src && isAllowedUrl(input.src) ? input.src : undefined
  if (input.src && !src) throw new CardImageError('Image host not allowed.', 400)
  if (!src && !input.id) throw new CardImageError('Pass a card id or image src.', 400)

  const file = cacheFileFor(input.id, src, input.size)
  try {
    return { body: await readFile(file), cached: true, source: 'cache' }
  } catch {
    // not cached yet
  }

  let job = inFlight.get(file)
  if (!job) {
    job = (async () => {
      const candidates = [...new Set([src, ...(input.id ? fallbackUrls(input.id, input.size) : [])])].filter(
        (u): u is string => Boolean(u),
      )
      for (const url of candidates) {
        const raw = await download(url)
        if (!raw) continue
        const { width, quality } = SIZES[input.size]
        const body = await sharp(raw)
          .resize({ width, withoutEnlargement: true })
          .webp({ quality })
          .toBuffer()
        await mkdir(CACHE_DIR, { recursive: true })
        const tmp = `${file}.${process.pid}.tmp`
        await writeFile(tmp, body)
        await rename(tmp, file)
        return { body, source: new URL(url).hostname }
      }
      throw new CardImageError('No image host had this card.', 404)
    })().finally(() => inFlight.delete(file))
    inFlight.set(file, job)
  }
  const result = await job
  return { ...result, cached: false }
}

export function isCardImageSize(value: unknown): value is CardImageSize {
  return value === 'large' || value === 'small'
}

export function isAllowedCardImageUrl(value: string): boolean {
  return isAllowedUrl(value)
}

