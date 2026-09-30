/**
 * Fallback prices from TCGdex (free, keyless) for cards JustTCG doesn't carry. TCGdex relays
 * TCGplayer market prices (USD, per printing) and Cardmarket prices (EUR, converted to USD).
 * Neither is condition-specific — they're roughly near-mint market values, and are labelled so.
 *
 * Variant ids are namespaced `tcgdex:<card id>:<price key>` so the existing price-refresh
 * route can tell them apart from JustTCG variant ids.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const TCGDEX = 'https://api.tcgdex.net/v2/en'
const RATE_URL = 'https://api.frankfurter.app/latest?from=EUR&to=USD'
const CACHE_PATH = resolve('.cache/tcgdex-prices.json')
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
export const TCGDEX_VARIANT_PREFIX = 'tcgdex:'

export type FallbackPriceSnapshot = {
  amount: number
  currency: 'USD'
  source: 'TCGplayer' | 'Cardmarket'
  via: 'TCGdex'
  /** TCGdex prices ignore card condition. */
  conditionAware: false
  /** Set when the market price was in another currency. */
  converted?: { from: 'EUR'; amount: number; rate: number }
  /**
   * The same market price from pokemontcg.io, which maps cards to listings independently.
   * Absent when pokemontcg.io had no price or couldn't be reached — the price is then unverified.
   */
  crossCheck?: { source: 'pokemontcg.io'; amount: number; currency: 'USD' | 'EUR'; updatedAt?: string }
  lastRefreshedAt: string
  marketUpdatedAt?: string
}

/** Both sources' figure for the same market, when they disagree too much to pick one. */
export type PriceConflict = {
  market: 'TCGplayer' | 'Cardmarket'
  currency: 'USD' | 'EUR'
  tcgdex: number
  pokemontcgio: number
  pokemontcgioUpdatedAt?: string
}

export type FallbackResult =
  | { status: 'priced'; cardId: string; variantId: string; printing: string; price: FallbackPriceSnapshot }
  | { status: 'needs_printing'; cardId: string; printings: string[] }
  | { status: 'unavailable'; reason: string; conflict?: PriceConflict }

// Market prices from two feeds are never identical; beyond this ratio one of them has the wrong card.
// Cheap cards swing by multiples on noise (€1.06 vs €2.37), so a gap must also be this big in money.
const MAX_SOURCE_RATIO = 2
const MIN_SOURCE_GAP = 10

type TcgplayerPrice = { marketPrice?: number | null; midPrice?: number | null }
type CardmarketPrice = { trend?: number | null; avg30?: number | null; avg?: number | null; 'trend-holo'?: number | null; 'avg30-holo'?: number | null; updated?: string }
type TcgdexCard = {
  id: string
  pricing?: {
    tcgplayer?: ({ updated?: string } & Record<string, TcgplayerPrice | string | undefined>) | null
    cardmarket?: CardmarketPrice | null
  } | null
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

// ---------- catalogue id → TCGdex id ----------

/** sv02 / sv2 → sv2, sv03.5 / sv3pt5 → sv35, swsh4.5sv / swsh45sv → swsh45sv. */
function setKey(id: string) {
  return id.toLowerCase().replace(/pt5/g, '5').replace(/\./g, '').replace(/([a-z])0+(\d)/g, '$1$2')
}
const numberKey = (n: string) => n.trim().toLowerCase().replace(/^([a-z]*)0+(?=\d)/, '$1')

let setIndex: Promise<Map<string, string>> | null = null
function tcgdexSetIds(): Promise<Map<string, string>> {
  if (!setIndex) {
    setIndex = getJson<Array<{ id: string }>>(`${TCGDEX}/sets`).then((sets) => {
      if (!sets) {
        setIndex = null
        return new Map()
      }
      const map = new Map<string, string>()
      const clashes = new Set<string>()
      for (const s of sets) {
        const k = setKey(s.id)
        if (map.has(k)) clashes.add(k)
        map.set(k, s.id)
      }
      for (const k of clashes) map.delete(k)
      return map
    })
  }
  return setIndex
}

const setCards = new Map<string, Promise<Array<{ id: string; localId: string }> | null>>()
async function tcgdexCardId(externalId: string, number: string): Promise<string | null> {
  const dash = externalId.lastIndexOf('-')
  if (dash <= 0) return null
  const setId = (await tcgdexSetIds()).get(setKey(externalId.slice(0, dash)))
  if (!setId) return null
  let cards = setCards.get(setId)
  if (!cards) {
    cards = getJson<{ cards: Array<{ id: string; localId: string }> }>(`${TCGDEX}/sets/${encodeURIComponent(setId)}`).then(
      (s) => s?.cards ?? null,
    )
    setCards.set(setId, cards)
  }
  const want = numberKey(number || externalId.slice(dash + 1))
  return (await cards)?.find((c) => numberKey(c.localId) === want)?.id ?? null
}

// ---------- disk cache (cards + exchange rate) ----------

type CacheFile = { cards: Record<string, { at: number; card: TcgdexCard }>; rate?: { at: number; usdPerEur: number } }

function loadCache(): CacheFile {
  try {
    return JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as CacheFile
  } catch {
    return { cards: {} }
  }
}
function saveCache(cache: CacheFile) {
  mkdirSync(dirname(CACHE_PATH), { recursive: true })
  writeFileSync(CACHE_PATH, JSON.stringify(cache))
}

async function fetchCard(tcgdexId: string, force = false): Promise<TcgdexCard | null> {
  const cache = loadCache()
  const hit = cache.cards[tcgdexId]
  if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.card
  const card = await getJson<TcgdexCard>(`${TCGDEX}/cards/${encodeURIComponent(tcgdexId)}`)
  if (!card) return hit?.card ?? null
  const slim: TcgdexCard = { id: card.id, pricing: card.pricing ?? null }
  cache.cards[tcgdexId] = { at: Date.now(), card: slim }
  saveCache(cache)
  return slim
}

/** EUR → USD (ECB rate via frankfurter.app), cached a day; the last known rate if it's down. */
async function usdPerEur(): Promise<number | null> {
  const cache = loadCache()
  if (cache.rate && Date.now() - cache.rate.at < CACHE_TTL_MS) return cache.rate.usdPerEur
  const body = await getJson<{ rates?: { USD?: number } }>(RATE_URL)
  const rate = body?.rates?.USD
  if (!rate) return cache.rate?.usdPerEur ?? null
  cache.rate = { at: Date.now(), usdPerEur: rate }
  saveCache(cache)
  return rate
}

// ---------- printings ----------

/** TCGdex TCGplayer keys → the labels JustTCG uses, so a saved printing works with both. */
function printingLabel(key: string): string {
  return key
    .split('-')
    .map((w) => (w === '1st' ? '1st' : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}
const printingKey = (label: string) => label.trim().toLowerCase().replace(/\s+/g, '-')

function tcgplayerPrices(card: TcgdexCard): Array<{ key: string; amount: number }> {
  const tp = card.pricing?.tcgplayer
  if (!tp) return []
  return Object.entries(tp).flatMap(([key, value]) => {
    if (!value || typeof value !== 'object') return []
    const amount = value.marketPrice ?? value.midPrice
    return typeof amount === 'number' && amount > 0 ? [{ key, amount }] : []
  })
}

async function quote(card: TcgdexCard, priceKey: string): Promise<FallbackPriceSnapshot | null> {
  const now = new Date().toISOString()
  if (priceKey.startsWith('cardmarket')) {
    const cm = card.pricing?.cardmarket
    if (!cm) return null
    // Cardmarket's "-holo" columns are the reverse-holo printing on modern cards
    const eur = priceKey === 'cardmarket-holo' ? (cm['trend-holo'] ?? cm['avg30-holo']) : (cm.trend ?? cm.avg30 ?? cm.avg)
    const rate = await usdPerEur()
    if (typeof eur !== 'number' || eur <= 0 || !rate) return null
    return {
      amount: Math.round(eur * rate * 100) / 100,
      currency: 'USD',
      source: 'Cardmarket',
      via: 'TCGdex',
      conditionAware: false,
      converted: { from: 'EUR', amount: eur, rate },
      lastRefreshedAt: now,
      marketUpdatedAt: cm.updated,
    }
  }
  const hit = tcgplayerPrices(card).find((p) => p.key === priceKey)
  if (!hit) return null
  return {
    amount: hit.amount,
    currency: 'USD',
    source: 'TCGplayer',
    via: 'TCGdex',
    conditionAware: false,
    lastRefreshedAt: now,
    marketUpdatedAt: typeof card.pricing?.tcgplayer?.updated === 'string' ? card.pricing.tcgplayer.updated : undefined,
  }
}

// ---------- cross-check against pokemontcg.io ----------

type PtcgCard = {
  tcgplayer?: { updatedAt?: string; prices?: Record<string, { market?: number | null; mid?: number | null }> }
  cardmarket?: {
    updatedAt?: string
    prices?: { trendPrice?: number | null; avg30?: number | null; reverseHoloTrend?: number | null; reverseHoloAvg30?: number | null }
  }
}
type PtcgCache = Record<string, { at: number; card: PtcgCard | null }>

const PTCG_ATTEMPTS = 2
const PTCG_TIMEOUT_MS = 15_000

/** pokemontcg.io card by catalogue id: null = it doesn't list the card, undefined = unreachable. */
async function fetchPtcgCard(externalId: string): Promise<PtcgCard | null | undefined> {
  const cache = loadCache() as CacheFile & { ptcg?: PtcgCache }
  const hit = cache.ptcg?.[externalId]
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.card
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (process.env.POKEMONTCG_API_KEY) headers['X-Api-Key'] = process.env.POKEMONTCG_API_KEY
  // The public API is flaky (502s, slow replies) — retry once before giving up
  for (let attempt = 0; attempt < PTCG_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`https://api.pokemontcg.io/v2/cards/${encodeURIComponent(externalId)}`, {
        headers,
        signal: AbortSignal.timeout(PTCG_TIMEOUT_MS),
      })
      if (res.status === 404) return remember(null)
      if (res.ok) {
        const body = (await res.json()) as { data?: PtcgCard }
        return remember({ tcgplayer: body.data?.tcgplayer, cardmarket: body.data?.cardmarket })
      }
    } catch {
      // timeout or network error — retry
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  return hit?.card

  function remember(card: PtcgCard | null) {
    const fresh = loadCache() as CacheFile & { ptcg?: PtcgCache }
    fresh.ptcg = { ...fresh.ptcg, [externalId]: { at: Date.now(), card } }
    saveCache(fresh)
    return card
  }
}

/** holofoil → holofoil, reverse-holofoil → reverseHolofoil, 1st-edition-holofoil → 1stEditionHolofoil. */
const ptcgPrintingKey = (key: string) => key.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())

/** pokemontcg.io's figure for the same market and printing, in that market's own currency. */
function ptcgFigure(card: PtcgCard, priceKey: string) {
  if (priceKey.startsWith('cardmarket')) {
    const p = card.cardmarket?.prices
    const eur = priceKey === 'cardmarket-holo' ? (p?.reverseHoloTrend ?? p?.reverseHoloAvg30) : (p?.trendPrice ?? p?.avg30)
    return typeof eur === 'number' && eur > 0
      ? { amount: eur, currency: 'EUR' as const, updatedAt: card.cardmarket?.updatedAt }
      : null
  }
  const p = card.tcgplayer?.prices?.[ptcgPrintingKey(priceKey)]
  const usd = p?.market ?? p?.mid
  return typeof usd === 'number' && usd > 0 ? { amount: usd, currency: 'USD' as const, updatedAt: card.tcgplayer?.updatedAt } : null
}

const money = (amount: number, currency: 'USD' | 'EUR') => `${currency === 'EUR' ? '€' : '$'}${amount.toFixed(2)}`

/**
 * Confirm a TCGdex price with pokemontcg.io. Returns the price with `crossCheck` filled in,
 * the price unchanged when pokemontcg.io has nothing to compare, or a conflict when they
 * disagree by more than MAX_SOURCE_RATIO and MIN_SOURCE_GAP — then neither figure can be trusted.
 */
async function crossChecked(
  externalId: string,
  priceKey: string,
  price: FallbackPriceSnapshot,
): Promise<{ price: FallbackPriceSnapshot } | { conflict: PriceConflict; reason: string }> {
  const card = await fetchPtcgCard(externalId)
  const other = card ? ptcgFigure(card, priceKey) : null
  if (!other) return { price }
  const ours = price.converted?.amount ?? price.amount
  const ratio = Math.max(ours, other.amount) / Math.min(ours, other.amount)
  if (ratio > MAX_SOURCE_RATIO && Math.abs(ours - other.amount) > MIN_SOURCE_GAP) {
    const conflict: PriceConflict = {
      market: price.source,
      currency: other.currency,
      tcgdex: ours,
      pokemontcgio: other.amount,
      pokemontcgioUpdatedAt: other.updatedAt,
    }
    return {
      conflict,
      reason: `Price sources disagree for this card's ${price.source} price: TCGdex ${money(ours, other.currency)} vs pokemontcg.io ${money(other.amount, other.currency)}. One of them has the wrong listing — set this card's price by hand.`,
    }
  }
  return { price: { ...price, crossCheck: { source: 'pokemontcg.io', ...other } } }
}

/** tcgdex:<TCGdex card id>:<price key>@<catalogue id> — the catalogue id is needed for the cross-check. */
const variantId = (tcgdexId: string, key: string, externalId: string) =>
  `${TCGDEX_VARIANT_PREFIX}${tcgdexId}:${key}@${externalId}`

/**
 * Price a catalogue card from TCGdex: TCGplayer for the chosen printing, otherwise Cardmarket.
 * Asks for a printing when TCGplayer lists several and none was chosen.
 */
export async function resolveTcgdexPrice(input: {
  externalId?: string
  number: string
  printing?: string
}): Promise<FallbackResult> {
  if (!input.externalId) return { status: 'unavailable', reason: 'No catalogue id to look up a fallback price.' }
  const tcgdexId = await tcgdexCardId(input.externalId, input.number)
  if (!tcgdexId) return { status: 'unavailable', reason: 'TCGdex doesn’t list this card either.' }
  const card = await fetchCard(tcgdexId)
  if (!card) return { status: 'unavailable', reason: 'TCGdex could not be reached.' }

  const cardId = `${TCGDEX_VARIANT_PREFIX}${tcgdexId}`
  const tp = tcgplayerPrices(card)
  let key: string | undefined
  if (tp.length) {
    if (input.printing) key = tp.find((p) => p.key === printingKey(input.printing!))?.key
    else if (tp.length === 1) key = tp[0].key
    else return { status: 'needs_printing', cardId, printings: tp.map((p) => printingLabel(p.key)) }
  }
  if (!key) key = input.printing && /reverse/i.test(input.printing) ? 'cardmarket-holo' : 'cardmarket'

  const quoted = await quote(card, key)
  if (!quoted) return { status: 'unavailable', reason: 'Neither JustTCG nor TCGdex has a price for this card.' }
  const checked = await crossChecked(input.externalId, key, quoted)
  if ('conflict' in checked) return { status: 'unavailable', reason: checked.reason, conflict: checked.conflict }
  const price = checked.price
  // Cardmarket's main price covers every printing, so don't invent one
  const printing = key.startsWith('cardmarket')
    ? (input.printing ?? (key === 'cardmarket-holo' ? 'Reverse Holofoil' : 'Any printing'))
    : printingLabel(key)
  return { status: 'priced', cardId, variantId: variantId(tcgdexId, key, input.externalId), printing, price }
}

/** Re-price a variant id produced by resolveTcgdexPrice. */
export async function refreshTcgdexVariant(
  id: string,
  force = false,
): Promise<{ price: FallbackPriceSnapshot } | { reason: string }> {
  const at = id.lastIndexOf('@')
  const externalId = at > 0 ? id.slice(at + 1) : ''
  const rest = id.slice(TCGDEX_VARIANT_PREFIX.length, at > 0 ? at : undefined)
  const colon = rest.lastIndexOf(':')
  if (colon <= 0 || !externalId) return { reason: 'Unrecognised fallback price id — look the price up again.' }
  const key = rest.slice(colon + 1)
  const card = await fetchCard(rest.slice(0, colon), force)
  const quoted = card ? await quote(card, key) : null
  if (!quoted) return { reason: 'TCGdex no longer lists a price for this card.' }
  const checked = await crossChecked(externalId, key, quoted)
  return 'conflict' in checked ? { reason: checked.reason } : { price: checked.price }
}

export const isTcgdexVariant = (id: string) => id.startsWith(TCGDEX_VARIANT_PREFIX)
