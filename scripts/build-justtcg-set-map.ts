/**
 * Map every catalogue set to the JustTCG set id, so prices resolve by set + number
 * instead of fuzzy name search.
 *   npm run justtcg:set-map
 * Uses one JustTCG request (cached for a week in .cache/justtcg-sets.json).
 * Writes server/justtcgSetMap.json and prints anything left unmatched.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { listAllPokemonSets, type PokemonSetResult } from '../src/lib/pokemonTcg.ts'

type JustTcgSet = { id: string; name: string; count?: number; release_date?: string | null }

const SETS_CACHE = resolve('.cache/justtcg-sets.json')
const OUT = resolve('server/justtcgSetMap.json')
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** Names that share nothing a rule can latch onto. Catalogue set id → JustTCG set id. */
const OVERRIDES: Record<string, string> = {
  base1: 'base-set-pokemon',
  basep: 'wotc-promo-pokemon',
  np: 'nintendo-promos-pokemon',
  dpp: 'diamond-and-pearl-promos-pokemon',
  hsp: 'hgss-promos-pokemon',
  bwp: 'black-and-white-promos-pokemon',
  xyp: 'xy-promos-pokemon',
  smp: 'sm-promos-pokemon',
  swshp: 'swsh-sword-shield-promo-cards-pokemon',
  svp: 'sv-scarlet-violet-promo-cards-pokemon',
  mep: 'me-mega-evolution-promo-pokemon',
  sm1: 'sm-base-set-pokemon',
  xy1: 'xy-base-set-pokemon',
  swsh1: 'swsh01-sword-shield-base-set-pokemon',
  sv1: 'sv01-scarlet-violet-base-set-pokemon',
  sv3pt5: 'sv-scarlet-violet-151-pokemon',
  mee: 'mee-mega-evolution-energies-pokemon',
  mcd21: 'mcdonald-s-25th-anniversary-promos-pokemon',
  // JustTCG lists each two-deck trainer kit as one set; the card name tells the halves apart
  tk1a: 'ex-trainer-kit-1-latias-latios-pokemon',
  tk1b: 'ex-trainer-kit-1-latias-latios-pokemon',
  tk2a: 'ex-trainer-kit-2-plusle-minun-pokemon',
  tk2b: 'ex-trainer-kit-2-plusle-minun-pokemon',
  'tk-dp-l': 'dp-trainer-kit-manaphy-lucario-pokemon',
  'tk-dp-m': 'dp-trainer-kit-manaphy-lucario-pokemon',
  'tk-hs-g': 'hgss-trainer-kit-gyarados-raichu-pokemon',
  'tk-hs-r': 'hgss-trainer-kit-gyarados-raichu-pokemon',
  'tk-bw-e': 'bw-trainer-kit-excadrill-zoroark-pokemon',
  'tk-bw-z': 'bw-trainer-kit-excadrill-zoroark-pokemon',
  'tk-xy-b': 'xy-trainer-kit-bisharp-wigglytuff-pokemon',
  'tk-xy-w': 'xy-trainer-kit-bisharp-wigglytuff-pokemon',
}

/** Subsets the catalogue keeps inside the main set (numbered RC1…) but JustTCG splits out. */
const NUMBER_PREFIX_SETS: Record<string, Record<string, string>> = {
  g1: { RC: 'generations-radiant-collection-pokemon' },
  bw11: { RC: 'legendary-treasures-radiant-collection-pokemon' },
}

/** Wording JustTCG uses differently: "EX Emerald" = "Emerald", "McDonald's Promos 2019" = "... Collection 2019". */
function comparable(name: string): string {
  return key(name)
    .replace(/^ex (?!trainer)/, '')
    .replace(/\bcollection (\d{4})$/, 'promos $1')
}

function readEnvKey(): string {
  const env = readFileSync('.env.local', 'utf8')
  const key = env.match(/^JUSTTCG_API_KEY\s*=\s*"?([^"\r\n]+)"?/m)?.[1]
  if (!key) throw new Error('JUSTTCG_API_KEY missing from .env.local')
  return key
}

async function loadJustTcgSets(): Promise<JustTcgSet[]> {
  if (existsSync(SETS_CACHE) && Date.now() - statSync(SETS_CACHE).mtimeMs < CACHE_MAX_AGE_MS) {
    return JSON.parse(readFileSync(SETS_CACHE, 'utf8')) as JustTcgSet[]
  }
  const res = await fetch('https://api.justtcg.com/v1/sets?game=Pokemon', {
    headers: { 'x-api-key': readEnvKey(), Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`JustTCG /sets failed (${res.status})`)
  const body = (await res.json()) as { data?: JustTcgSet[]; meta?: { hasMore?: boolean } }
  if (body.meta?.hasMore) console.warn('JustTCG /sets reported more pages — only the first was read.')
  const sets = body.data ?? []
  mkdirSync(dirname(SETS_CACHE), { recursive: true })
  writeFileSync(SETS_CACHE, JSON.stringify(sets, null, 2))
  return sets
}

const STOP = new Set(['and', 'the', 'pokemon', 'set', 'tcg'])

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t && !STOP.has(t))
}

const key = (value: string) => tokens(value).join(' ')

/** "SWSH04: Vivid Voltage" / "SM - Celestial Storm" → code + bare name. */
function splitJustTcgName(name: string): { code?: string; bare: string } {
  const m = name.match(/^([A-Za-z]+\d*[A-Za-z]*)\s*(?::|\s-\s)\s*(.+)$/)
  if (!m) return { bare: name }
  return { code: m[1].toLowerCase(), bare: m[2] }
}

/** swsh04 → swsh4, me01 → me1; codes without a number don't identify one set. */
function normCode(code: string | undefined): string | undefined {
  const m = code?.match(/^([a-z]+)0*(\d+)$/)
  return m ? `${m[1]}${m[2]}` : undefined
}

function sameDay(ours: string, theirs: string | null | undefined): boolean {
  if (!theirs) return false
  return ours.replace(/\//g, '-').slice(0, 10) === theirs.slice(0, 10)
}

function overlap(a: string, b: string): number {
  const ta = new Set(tokens(a))
  const tb = new Set(tokens(b))
  if (ta.size === 0 || tb.size === 0) return 0
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared++
  return shared / Math.max(ta.size, tb.size)
}

type Match = {
  justtcgSetId: string
  justtcgName: string
  how: string
  /** Collector-number prefix → JustTCG set id for split-out subsets. */
  numberPrefixes?: Record<string, string>
}

function matchSet(set: PokemonSetResult, jt: JustTcgSet[], byId: Map<string, JustTcgSet>): Match | null {
  const hit = (s: JustTcgSet, how: string): Match => ({ justtcgSetId: s.id, justtcgName: s.name, how })

  const override = OVERRIDES[set.id] && byId.get(OVERRIDES[set.id])
  if (override) return hit(override, 'override')

  const ours = comparable(set.name)
  const named = jt.filter(
    (s) => comparable(s.name) === ours || comparable(splitJustTcgName(s.name).bare) === ours,
  )
  if (named.length === 1) return hit(named[0], 'name')
  if (named.length > 1) {
    const dated = named.filter((s) => sameDay(set.releaseDate, s.release_date))
    if (dated.length === 1) return hit(dated[0], 'name+date')
  }

  const coded = jt.filter((s) => normCode(splitJustTcgName(s.name).code) === set.id.toLowerCase())
  if (coded.length === 1) return hit(coded[0], 'code')

  const dated = jt
    .filter((s) => sameDay(set.releaseDate, s.release_date))
    .map((s) => ({ s, score: overlap(set.name, splitJustTcgName(s.name).bare) }))
    .filter((x) => x.score >= 0.5)
    .sort((a, b) => b.score - a.score)
  if (dated.length === 1 || (dated.length > 1 && dated[0].score > dated[1].score)) {
    return hit(dated[0].s, 'date+words')
  }
  return null
}

const [catalogue, justtcg] = await Promise.all([listAllPokemonSets(), loadJustTcgSets()])
const byId = new Map(justtcg.map((s) => [s.id, s]))

const map: Record<string, { catalogueName: string } & Match> = {}
const unmatched: string[] = []
for (const set of catalogue) {
  const m = matchSet(set, justtcg, byId)
  if (m) {
    const prefixes = NUMBER_PREFIX_SETS[set.id]
    const known = prefixes
      ? Object.fromEntries(Object.entries(prefixes).filter(([, id]) => byId.has(id)))
      : undefined
    map[set.id] = {
      catalogueName: set.name,
      ...m,
      ...(known && Object.keys(known).length ? { numberPrefixes: known } : {}),
    }
  } else unmatched.push(`${set.id.padEnd(12)} ${set.name} (${set.releaseDate})`)
}

// Two catalogue sets landing on one JustTCG set usually means a rule overreached
const claimed = new Map<string, string[]>()
for (const [id, m] of Object.entries(map)) {
  claimed.set(m.justtcgSetId, [...(claimed.get(m.justtcgSetId) ?? []), id])
}
const shared = [...claimed.entries()].filter(([, ids]) => ids.length > 1)

const sorted = Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)))
writeFileSync(OUT, `${JSON.stringify(sorted, null, 2)}\n`)

const usedJt = new Set(
  Object.values(map).flatMap((m) => [m.justtcgSetId, ...Object.values(m.numberPrefixes ?? {})]),
)
const how = Object.values(map).reduce<Record<string, number>>((acc, m) => {
  acc[m.how] = (acc[m.how] ?? 0) + 1
  return acc
}, {})

console.log(`Mapped ${Object.keys(map).length}/${catalogue.length} catalogue sets → ${OUT}`)
console.log(`  by ${Object.entries(how).map(([k, v]) => `${k}: ${v}`).join(', ')}`)
console.log(`\nLoosest matches (date + shared words) — check these by eye:`)
console.log(
  Object.entries(map)
    .filter(([, m]) => m.how === 'date+words')
    .map(([id, m]) => `${id.padEnd(12)} ${m.catalogueName}  →  ${m.justtcgName}`)
    .join('\n') || '  none',
)
console.log(`\nCatalogue sets with no JustTCG set (${unmatched.length}):`)
console.log(unmatched.join('\n') || '  none')
console.log(`\nJustTCG sets several catalogue sets map to (${shared.length}):`)
console.log(shared.map(([jt, ids]) => `${jt} ← ${ids.join(', ')}`).join('\n') || '  none')
console.log(`\nJustTCG sets nothing maps to (${justtcg.length - usedJt.size}):`)
console.log(
  justtcg
    .filter((s) => !usedJt.has(s.id))
    .map((s) => `${s.id} | ${s.name} | ${s.release_date?.slice(0, 10) ?? '-'}`)
    .join('\n') || '  none',
)
