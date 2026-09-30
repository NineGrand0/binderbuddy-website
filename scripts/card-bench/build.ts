/**
 * Build the synthetic card-detection test set: a stratified sample of catalogue cards, each
 * rendered as a few damaged "phone crops". Deterministic for a given --seed.
 *
 *   npm run bench:cards:build -- --cards 600 --variants 2 --seed 1
 *
 * Writes .cache/card-bench/images/*.jpg and .cache/card-bench/manifest.json.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { getCardImage } from '../../server/cardImages.ts'
import { listCatalogueCards, type CatalogueCard } from '../../src/lib/pokemonTcg.ts'
import { CATEGORIES, categorize, tagCatalogue, type BenchCategory } from './categories.ts'
import { damageCard, makeRng, SEVERITIES, type Rng } from './damage.ts'
import { BENCH_DIR, type BenchItem, type Manifest } from './manifest.ts'

const { values: args } = parseArgs({
  options: {
    cards: { type: 'string', default: '600' },
    variants: { type: 'string', default: '2' },
    seed: { type: 'string', default: '1' },
    concurrency: { type: 'string', default: '6' },
  },
})
const CARD_COUNT = Number(args.cards)
const VARIANTS = Number(args.variants)
const SEED = Number(args.seed)

function shuffle<T>(items: T[], rng: Rng): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const rng = makeRng(SEED)
const catalogue = await listCatalogueCards()
const tags = tagCatalogue(catalogue)
console.log(`Catalogue: ${catalogue.length} cards`)

// Equal share per category; within each, a quarter goes to cards with lettered / same-set twins
const byCategory = new Map<BenchCategory, CatalogueCard[]>(CATEGORIES.map((c) => [c, []]))
for (const card of catalogue) byCategory.get(categorize(card))!.push(card)

const sample: CatalogueCard[] = []
const quota = Math.ceil(CARD_COUNT / CATEGORIES.length)
for (const category of CATEGORIES) {
  const pool = shuffle(byCategory.get(category)!, rng)
  const twins = pool.filter((c) => tags.get(c.id)!.some((t) => t !== 'many-printings'))
  const picked = new Set(twins.slice(0, Math.floor(quota / 4)))
  for (const c of pool) {
    if (picked.size >= quota) break
    picked.add(c)
  }
  sample.push(...picked)
  console.log(`  ${category.padEnd(9)} ${String(picked.size).padStart(4)} of ${pool.length}`)
}
sample.length = Math.min(sample.length, CARD_COUNT)

const imagesDir = resolve(BENCH_DIR, 'images')
await rm(imagesDir, { recursive: true, force: true })
await mkdir(imagesDir, { recursive: true })

// Each card gets its own RNG so one failed download doesn't reshuffle every later image
const seeds = sample.map(() => Math.floor(rng() * 2 ** 32))
const items: BenchItem[] = []
const skipped: string[] = []
let next = 0
let done = 0

async function worker() {
  while (next < sample.length) {
    const index = next++
    const card = sample[index]
    const cardRng = makeRng(seeds[index])
    let source: Buffer
    try {
      source = (await getCardImage({ id: card.id, src: card.imageLarge, size: 'large' })).body
    } catch {
      skipped.push(card.id)
      continue
    }
    const firstSeverity = Math.floor(cardRng() * SEVERITIES.length)
    for (let v = 0; v < VARIANTS; v++) {
      const severity = SEVERITIES[(firstSeverity + v) % SEVERITIES.length]
      const { jpeg, record } = await damageCard(source, cardRng, severity)
      const file = `images/${card.id.replace(/[^a-zA-Z0-9._-]/g, '_')}__${v}.jpg`
      await writeFile(resolve(BENCH_DIR, file), jpeg)
      items.push({
        file,
        source: 'synthetic',
        expectIds: [card.id],
        label: `${card.name} (${card.set} ${card.number})`,
        category: categorize(card),
        tags: tags.get(card.id)!,
        damage: record,
      })
    }
    if (++done % 50 === 0) console.log(`  ${done}/${sample.length} cards rendered`)
  }
}
await Promise.all(Array.from({ length: Number(args.concurrency) }, worker))

items.sort((a, b) => a.file.localeCompare(b.file))
const manifest: Manifest = {
  createdAt: new Date().toISOString(),
  seed: SEED,
  catalogueSize: catalogue.length,
  skipped,
  items,
}
await writeFile(resolve(BENCH_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`\n${items.length} images from ${sample.length - skipped.length} cards → ${BENCH_DIR}`)
if (skipped.length) {
  const more = skipped.length > 10 ? ` and ${skipped.length - 10} more` : ''
  console.log(`Skipped ${skipped.length} cards with no image: ${skipped.slice(0, 10).join(', ')}${more}`)
}
