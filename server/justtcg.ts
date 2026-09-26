import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const API_BASE = 'https://api.justtcg.com/v1/cards'
const CACHE_PATH = resolve('.cache/justtcg-prices.json')
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const FREE_BATCH_LIMIT = 20
const FREE_PER_MINUTE = 10
const FREE_PER_DAY = 100

export type JustTcgCondition = 'NM' | 'LP' | 'MP' | 'HP' | 'Damaged'

export type JustTcgPriceSnapshot = {
  amount: number
  currency: string
  source: 'JustTCG'
  lastRefreshedAt: string
  marketUpdatedAt?: string
}

export type JustTcgResolveResult =
  | {
      status: 'priced'
      justtcgCardId: string
      justtcgVariantId: string
      printing: string
      price: JustTcgPriceSnapshot
    }
  | {
      status: 'needs_printing'
      justtcgCardId: string
      printings: string[]
    }
  | {
      status: 'unavailable'
      reason: string
    }

type JustTcgVariant = {
  id?: string
  uuid?: string
  condition?: string
  printing?: string
  price?: number | null
  lastUpdated?: number
}

type JustTcgCard = {
  id?: string
  uuid?: string
  name?: string
  set?: string
  set_name?: string
  number?: string
  variants?: JustTcgVariant[]
}

type CacheEntry = {
  amount: number
  currency: string
  marketUpdatedAt?: string
  fetchedAt: string
}

type CacheFile = {
  entries: Record<string, CacheEntry>
  rate: {
    dayKey: string
    dayCount: number
    minuteKey: string
    minuteCount: number
  }
}

export class JustTcgError extends Error {
  status: number
  constructor(message: string, status = 500) {
    super(message)
    this.name = 'JustTcgError'
    this.status = status
  }
}

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function normalizeNumber(value: string): string {
  const left = value.trim().split('/')[0]?.trim() ?? ''
  return left.replace(/^0+(?=\d)/, '').toLowerCase()
}

function conditionMatches(apiCondition: string | undefined, wanted: JustTcgCondition): boolean {
  if (!apiCondition) return false
  const n = normalizeKey(apiCondition)
  const map: Record<JustTcgCondition, string[]> = {
    NM: ['nm', 'near mint', 'near-mint'],
    LP: ['lp', 'lightly played', 'lightly-played'],
    MP: ['mp', 'moderately played', 'moderately-played'],
    HP: ['hp', 'heavily played', 'heavily-played'],
    Damaged: ['dmg', 'damaged'],
  }
  return map[wanted].some((alias) => n === alias || n.includes(alias))
}

function printingMatches(apiPrinting: string | undefined, wanted: string): boolean {
  if (!apiPrinting) return false
  return normalizeKey(apiPrinting) === normalizeKey(wanted)
}

function loadCache(): CacheFile {
  try {
    const raw = readFileSync(CACHE_PATH, 'utf8')
    const parsed = JSON.parse(raw) as CacheFile
    return {
      entries: parsed.entries ?? {},
      rate: parsed.rate ?? { dayKey: '', dayCount: 0, minuteKey: '', minuteCount: 0 },
    }
  } catch {
    return { entries: {}, rate: { dayKey: '', dayCount: 0, minuteKey: '', minuteCount: 0 } }
  }
}

function saveCache(cache: CacheFile) {
  mkdirSync(dirname(CACHE_PATH), { recursive: true })
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8')
}

function dayKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10)
}

function minuteKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 16)
}

function assertRateLimit(cache: CacheFile) {
  const now = Date.now()
  const day = dayKey(now)
  const minute = minuteKey(now)
  if (cache.rate.dayKey !== day) {
    cache.rate.dayKey = day
    cache.rate.dayCount = 0
  }
  if (cache.rate.minuteKey !== minute) {
    cache.rate.minuteKey = minute
    cache.rate.minuteCount = 0
  }
  if (cache.rate.dayCount >= FREE_PER_DAY) {
    throw new JustTcgError(
      `JustTCG free-tier daily limit reached (${FREE_PER_DAY}/day). Try again tomorrow.`,
      429,
    )
  }
  if (cache.rate.minuteCount >= FREE_PER_MINUTE) {
    throw new JustTcgError(
      `JustTCG free-tier rate limit reached (${FREE_PER_MINUTE}/min). Wait a moment and retry.`,
      429,
    )
  }
}

function recordRequest(cache: CacheFile) {
  const now = Date.now()
  const day = dayKey(now)
  const minute = minuteKey(now)
  if (cache.rate.dayKey !== day) {
    cache.rate.dayKey = day
    cache.rate.dayCount = 0
  }
  if (cache.rate.minuteKey !== minute) {
    cache.rate.minuteKey = minute
    cache.rate.minuteCount = 0
  }
  cache.rate.dayCount += 1
  cache.rate.minuteCount += 1
}

async function justTcgFetch(apiKey: string, url: string, init?: RequestInit): Promise<unknown> {
  const cache = loadCache()
  assertRateLimit(cache)
  recordRequest(cache)
  saveCache(cache)

  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      ...(init?.headers ?? {}),
    },
  })
  const text = await response.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { error: text }
  }
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `JustTCG request failed (${response.status}).`
    throw new JustTcgError(message, response.status === 429 ? 429 : response.status >= 400 ? response.status : 500)
  }
  return body
}

function cardsFromResponse(body: unknown): JustTcgCard[] {
  if (!body || typeof body !== 'object') return []
  const data = (body as { data?: unknown }).data
  return Array.isArray(data) ? (data as JustTcgCard[]) : []
}

function cardIdOf(card: JustTcgCard): string | undefined {
  return card.id || card.uuid
}

function variantIdOf(variant: JustTcgVariant): string | undefined {
  return variant.id || variant.uuid
}

function normalizeName(value: string): string {
  return normalizeKey(value).replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Catalogue set labels ↔ JustTCG set names (exact aliases only, no fuzzy nearest-set). */
function setAliases(wantedSet: string): string[] {
  const key = normalizeKey(wantedSet)
  if (!key) return []
  const aliases = new Set<string>([key])
  // Pokémon TCG data: "SM Black Star Promos" · JustTCG: "SM Promos"
  // "Mega Evolution Black Star Promos" · JustTCG: "ME: Mega Evolution Promo"
  const blackStar = key.match(/^(.+?)\s+black\s+star\s+promos$/)
  if (blackStar) {
    aliases.add(`${blackStar[1]} promos`)
    aliases.add(`${blackStar[1]} promo`)
    aliases.add(`${blackStar[1]} promo cards`)
  }
  const shortPromos = key.match(/^([a-z0-9]+)\s+promos$/)
  if (shortPromos && !key.includes('black star')) {
    aliases.add(`${shortPromos[1]} black star promos`)
  }
  return [...aliases]
}

function setMatches(wantedSet: string, card: JustTcgCard): boolean {
  const aliases = setAliases(wantedSet)
  if (aliases.length === 0) return false
  const setName = normalizeKey(String(card.set_name ?? ''))
  const setSlug = normalizeKey(String(card.set ?? '').replace(/-pokemon$/i, ' ').replace(/-/g, ' '))
  const withoutCode = setName.replace(/^[a-z]*\d+\s+/, '').trim()
  const slugTail = setSlug.replace(/^[a-z]*\d+\s+/, '').replace(/\s+pokemon$/, '').trim()

  for (const setKey of aliases) {
    if (setName === setKey || setSlug === setKey || withoutCode === setKey || slugTail === setKey) return true
    if (setName.endsWith(` ${setKey}`)) return true
    if (setSlug.endsWith(` ${setKey}`) || setSlug === `${setKey} pokemon` || setSlug.endsWith(` ${setKey} pokemon`)) {
      return true
    }
  }
  return false
}

function exactCardMatch(cards: JustTcgCard[], set: string, number: string, name?: string): JustTcgCard | null {
  const numberKey = normalizeNumber(number)
  const nameKey = name ? normalizeName(name) : ''
  const byNumber = cards.filter((card) => normalizeNumber(String(card.number ?? '')) === numberKey)
  const bySet = byNumber.filter((card) => setMatches(set, card))
  if (bySet.length === 1) return bySet[0]
  if (bySet.length > 1 && nameKey) {
    const byName = bySet.filter((card) => {
      const cardName = normalizeName(String(card.name ?? ''))
      return (
        cardName === nameKey ||
        cardName.startsWith(`${nameKey} `) ||
        cardName.startsWith(`${nameKey} -`) ||
        cardName.includes(` ${nameKey} `)
      )
    })
    if (byName.length === 1) return byName[0]
  }
  return null
}

function variantsForCondition(card: JustTcgCard, condition: JustTcgCondition): JustTcgVariant[] {
  return (card.variants ?? []).filter((variant) => conditionMatches(variant.condition, condition))
}

function snapshotFromVariant(variant: JustTcgVariant, now = new Date()): JustTcgPriceSnapshot | null {
  if (typeof variant.price !== 'number' || Number.isNaN(variant.price)) return null
  return {
    amount: variant.price,
    currency: 'USD',
    source: 'JustTCG',
    lastRefreshedAt: now.toISOString(),
    marketUpdatedAt:
      typeof variant.lastUpdated === 'number'
        ? new Date(variant.lastUpdated * 1000).toISOString()
        : undefined,
  }
}

function cacheGet(variantId: string): JustTcgPriceSnapshot | null {
  const cache = loadCache()
  const entry = cache.entries[variantId]
  if (!entry) return null
  if (Date.now() - Date.parse(entry.fetchedAt) > CACHE_TTL_MS) return null
  return {
    amount: entry.amount,
    currency: entry.currency,
    source: 'JustTCG',
    lastRefreshedAt: entry.fetchedAt,
    marketUpdatedAt: entry.marketUpdatedAt,
  }
}

function cachePut(variantId: string, price: JustTcgPriceSnapshot) {
  const cache = loadCache()
  cache.entries[variantId] = {
    amount: price.amount,
    currency: price.currency,
    marketUpdatedAt: price.marketUpdatedAt,
    fetchedAt: price.lastRefreshedAt,
  }
  saveCache(cache)
}

export async function resolveJustTcgCard(input: {
  apiKey: string
  name: string
  set: string
  number: string
  condition: JustTcgCondition
  printing?: string
}): Promise<JustTcgResolveResult> {
  const name = input.name.trim()
  const set = input.set.trim()
  const number = input.number.trim()
  if (!name || !set || !number) {
    return { status: 'unavailable', reason: 'Name, set, and number are required for an exact match.' }
  }

  const params = new URLSearchParams({
    game: 'Pokemon',
    number,
    q: name,
    condition: input.condition === 'Damaged' ? 'Damaged' : input.condition,
    limit: '20',
  })
  if (input.printing) params.set('printing', input.printing)

  const body = await justTcgFetch(input.apiKey, `${API_BASE}?${params.toString()}`)
  const cards = cardsFromResponse(body)
  const card = exactCardMatch(cards, set, number, name)

  if (!card) {
    return {
      status: 'unavailable',
      reason: 'No exact JustTCG card matched that set and number.',
    }
  }

  const cardId = cardIdOf(card)
  if (!cardId) {
    return { status: 'unavailable', reason: 'JustTCG card was missing an id.' }
  }

  const conditioned = variantsForCondition(card, input.condition)
  if (conditioned.length === 0) {
    return {
      status: 'unavailable',
      reason: `No JustTCG variant for condition ${input.condition}.`,
    }
  }

  const printings = [
    ...new Set(
      conditioned
        .map((variant) => variant.printing?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort((a, b) => a.localeCompare(b))

  if (!input.printing) {
    if (printings.length === 1) {
      return resolveJustTcgCard({ ...input, printing: printings[0] })
    }
    if (printings.length > 1) {
      return { status: 'needs_printing', justtcgCardId: cardId, printings }
    }
    return { status: 'unavailable', reason: 'JustTCG variants were missing printing labels.' }
  }

  const matched = conditioned.filter((variant) => printingMatches(variant.printing, input.printing!))
  if (matched.length !== 1) {
    return {
      status: 'unavailable',
      reason:
        matched.length === 0
          ? `No JustTCG variant for printing “${input.printing}” in ${input.condition}.`
          : 'Multiple JustTCG variants matched that printing — refusing ambiguous fallback.',
    }
  }

  const variant = matched[0]
  const variantId = variantIdOf(variant)
  if (!variantId) {
    return { status: 'unavailable', reason: 'JustTCG variant was missing an id.' }
  }

  const cached = cacheGet(variantId)
  if (cached) {
    return {
      status: 'priced',
      justtcgCardId: cardId,
      justtcgVariantId: variantId,
      printing: variant.printing!.trim(),
      price: cached,
    }
  }

  const price = snapshotFromVariant(variant)
  if (!price) {
    return {
      status: 'unavailable',
      reason: 'Exact JustTCG variant found, but no price was listed.',
    }
  }
  cachePut(variantId, price)
  return {
    status: 'priced',
    justtcgCardId: cardId,
    justtcgVariantId: variantId,
    printing: variant.printing!.trim(),
    price,
  }
}

export async function fetchJustTcgPrices(input: {
  apiKey: string
  items: { justtcgVariantId: string; condition: JustTcgCondition }[]
  force?: boolean
}): Promise<
  {
    justtcgVariantId: string
    status: 'priced' | 'unavailable'
    price?: JustTcgPriceSnapshot
    reason?: string
  }[]
> {
  const unique = input.items.slice(0, FREE_BATCH_LIMIT)
  const results: {
    justtcgVariantId: string
    status: 'priced' | 'unavailable'
    price?: JustTcgPriceSnapshot
    reason?: string
  }[] = []

  const toFetch: typeof unique = []
  for (const item of unique) {
    if (!input.force) {
      const cached = cacheGet(item.justtcgVariantId)
      if (cached) {
        results.push({ justtcgVariantId: item.justtcgVariantId, status: 'priced', price: cached })
        continue
      }
    }
    toFetch.push(item)
  }

  if (toFetch.length === 0) return results

  for (const item of toFetch) {
    const params = new URLSearchParams({
      variantId: item.justtcgVariantId,
      condition: item.condition === 'Damaged' ? 'Damaged' : item.condition,
      limit: '1',
    })
    try {
      const body = await justTcgFetch(input.apiKey, `${API_BASE}?${params.toString()}`)
      const cards = cardsFromResponse(body)
      const variant =
        cards[0]?.variants?.find((entry) => variantIdOf(entry) === item.justtcgVariantId) ??
        cards[0]?.variants?.find((entry) => conditionMatches(entry.condition, item.condition))
      if (!variant || variantIdOf(variant) !== item.justtcgVariantId) {
        results.push({
          justtcgVariantId: item.justtcgVariantId,
          status: 'unavailable',
          reason: 'Exact variant not returned by JustTCG.',
        })
        continue
      }
      const price = snapshotFromVariant(variant)
      if (!price) {
        results.push({
          justtcgVariantId: item.justtcgVariantId,
          status: 'unavailable',
          reason: 'Exact variant found, but no price was listed.',
        })
        continue
      }
      cachePut(item.justtcgVariantId, price)
      results.push({ justtcgVariantId: item.justtcgVariantId, status: 'priced', price })
    } catch (err) {
      if (err instanceof JustTcgError && err.status === 429) throw err
      results.push({
        justtcgVariantId: item.justtcgVariantId,
        status: 'unavailable',
        reason: err instanceof Error ? err.message : 'Price refresh failed.',
      })
    }
  }

  return results
}

export async function searchJustTcgCards(input: {
  apiKey: string
  name: string
  number: string
  condition?: JustTcgCondition
}): Promise<{ id?: string; name?: string; set?: string; set_name?: string; number?: string; printings: string[] }[]> {
  const params = new URLSearchParams({
    game: 'Pokemon',
    number: input.number,
    q: input.name,
    limit: '10',
  })
  if (input.condition) params.set('condition', input.condition === 'Damaged' ? 'Damaged' : input.condition)
  const body = await justTcgFetch(input.apiKey, `${API_BASE}?${params.toString()}`)
  return cardsFromResponse(body).map((card) => ({
    id: cardIdOf(card),
    name: card.name,
    set: card.set,
    set_name: card.set_name,
    number: card.number,
    printings: [
      ...new Set(
        (card.variants ?? [])
          .map((variant) => variant.printing?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    ],
  }))
}

export const JUSTTCG_FREE_BATCH_LIMIT = FREE_BATCH_LIMIT
