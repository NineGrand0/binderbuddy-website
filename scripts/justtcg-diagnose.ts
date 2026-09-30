/**
 * Why doesn't JustTCG price a card? Looks up every labelled test card
 * (test-data/card-photos/labels.json) the way the app does — JustTCG set + number — and,
 * when that misses, asks JustTCG for the card by name inside the set to show how JustTCG
 * labels it. Every response is cached in .cache/justtcg-debug/, so reruns cost no requests.
 *
 *   npx tsx scripts/justtcg-diagnose.ts [--max-requests 40]
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { justTcgSetIdFor, pickByNumberAndName } from '../server/justtcg.ts'
import { listCatalogueCards } from '../src/lib/pokemonTcg.ts'

const { values: args } = parseArgs({
  options: {
    'max-requests': { type: 'string', default: '40' },
    // Comma-separated catalogue ids to check instead of the labelled test cards
    ids: { type: 'string' },
  },
})
const MAX_REQUESTS = Number(args['max-requests'])
const CACHE = resolve('.cache/justtcg-debug')
const apiKey = (await readFile('.env.local', 'utf8')).match(/^JUSTTCG_API_KEY\s*=\s*"?([^"\r\n]+)"?/m)?.[1]
if (!apiKey) throw new Error('JUSTTCG_API_KEY missing from .env.local')

type JtCard = { id?: string; name?: string; number?: string; set_name?: string; rarity?: string; variants?: Array<{ printing?: string }> }
let spent = 0

async function jt(params: Record<string, string>): Promise<JtCard[] | null> {
  const url = `https://api.justtcg.com/v1/cards?${new URLSearchParams({ game: 'Pokemon', ...params })}`
  const file = resolve(CACHE, `${createHash('sha1').update(url).digest('hex').slice(0, 16)}.json`)
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    // not cached
  }
  if (spent >= MAX_REQUESTS) return null
  // Free tier allows 10 requests a minute
  if (spent > 0) await new Promise((r) => setTimeout(r, 6500))
  spent++
  let res = await fetch(url, { headers: { 'x-api-key': apiKey!, Accept: 'application/json' } })
  if (res.status === 429) {
    // Still inside an earlier run's minute window — wait it out once
    await new Promise((r) => setTimeout(r, 65_000))
    res = await fetch(url, { headers: { 'x-api-key': apiKey!, Accept: 'application/json' } })
  }
  const body = (await res.json()) as { data?: JtCard[]; error?: string }
  if (!res.ok) throw new Error(`JustTCG ${res.status}: ${body.error ?? 'request failed'}`)
  await mkdir(CACHE, { recursive: true })
  await writeFile(file, JSON.stringify(body.data ?? []))
  return body.data ?? []
}

const show = (c: JtCard) => `“${c.name}” #${c.number}`

const labels = JSON.parse(await readFile('test-data/card-photos/labels.json', 'utf8')).photos as Array<{ expectIds: string[] }>
const byId = new Map((await listCatalogueCards()).map((c) => [c.id, c]))
const ids = args.ids ? args.ids.split(',').map((s) => s.trim()) : [...new Set(labels.map((l) => l.expectIds[0]))]

let ok = 0
const failures: string[] = []
for (const id of ids) {
  const card = byId.get(id)
  if (!card) continue
  const set = justTcgSetIdFor({ set: card.set, number: card.number, externalId: card.id })
  const label = `${card.name} ${card.number} (${card.set}, ${id})`
  if (!set) {
    failures.push(`${label}\n    no JustTCG set mapped`)
    continue
  }
  // Exactly what the app sends
  const hits = await jt({ set, number: card.number, condition: 'NM', limit: '20' })
  if (!hits) {
    console.log(`  … request budget used up before ${label}`)
    break
  }
  const picked = pickByNumberAndName(hits as never, card.number, card.name) as JtCard | null
  if (picked) {
    ok++
    console.log(`  OK   ${label} → ${show(picked)}`)
    continue
  }
  let why = hits.length ? `number search returned ${hits.map(show).join(', ')} — rejected by name/number check` : 'number search returned nothing'
  // Same set, by name: how does JustTCG label this card?
  const byName = await jt({ set, q: card.name.split(/[\s-]/)[0], limit: '20' })
  if (byName) {
    const similar = byName.filter((c) => c.number !== 'N/A').slice(0, 6)
    why += `\n    JustTCG has in ${set}: ${similar.map(show).join(', ') || '(nothing by that name)'}`
  }
  failures.push(`${label}\n    ${why}`)
  console.log(`  MISS ${label}`)
}

console.log(`\n${ok}/${ids.length} matched · ${spent} JustTCG requests used this run\n`)
for (const f of failures) console.log(`• ${f}`)
