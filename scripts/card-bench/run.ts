/**
 * Score a card identifier against the test set (synthetic damage + real photos).
 *
 *   npm run bench:cards -- --method ocr --limit 200 --workers 3
 *   npm run bench:cards -- --source real
 *   npm run bench:cards -- --category full-art
 *
 * Reports top-1 / top-3 / found-at-all overall and broken down by source, card category,
 * damage severity, individual damage effect and hard-case tag. Every run is saved to
 * .cache/card-bench/results/ and compared with the previous run of the same method.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { BENCH_DIR, itemPath, loadRealItems, loadSyntheticItems, type BenchItem } from './manifest.ts'
import { METHODS } from './methods.ts'
import { makeRng } from './damage.ts'

const { values: args } = parseArgs({
  options: {
    method: { type: 'string', default: 'ocr' },
    source: { type: 'string', default: 'all' },
    category: { type: 'string' },
    limit: { type: 'string' },
    workers: { type: 'string', default: '2' },
    timeout: { type: 'string', default: '60000' },
    verbose: { type: 'boolean', default: false },
  },
})

const method = METHODS[args.method!]
if (!method) {
  console.error(`Unknown method "${args.method}". Available: ${Object.keys(METHODS).join(', ')}`)
  process.exit(1)
}

let items: BenchItem[] = [
  ...(args.source === 'real' ? [] : await loadSyntheticItems()),
  ...(args.source === 'synthetic' ? [] : await loadRealItems()),
]
if (args.category) items = items.filter((i) => i.category === args.category)
if (args.limit) {
  // Real photos always stay in; synthetic ones are subsampled evenly (seeded) so a quick run
  // still covers every category
  const limit = Number(args.limit)
  const real = items.filter((i) => i.source === 'real')
  const rng = makeRng(7)
  const synthetic = items
    .filter((i) => i.source === 'synthetic')
    .map((i) => ({ i, k: rng() }))
    .sort((a, b) => a.k - b.k)
    .slice(0, Math.max(0, limit - real.length))
    .map(({ i }) => i)
  items = [...synthetic, ...real]
}
if (!items.length) {
  console.error('No test images. Build the synthetic set first: npm run bench:cards:build')
  process.exit(1)
}

type Outcome = { file: string; rank: number | null; top: string[]; ms: number; note?: string; error?: string }
const outcomes = new Map<BenchItem, Outcome>()

console.log(`Method: ${args.method} — ${method.describe}`)
console.log(`Images: ${items.length} (${items.filter((i) => i.source === 'real').length} real)\n`)

let next = 0
const started = Date.now()
async function worker() {
  const instance = await method.create()
  try {
    while (next < items.length) {
      const item = items[next++]
      const t0 = Date.now()
      let outcome: Outcome
      try {
        const image = await readFile(itemPath(item))
        const result = await Promise.race([
          instance.identify(image),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), Number(args.timeout))),
        ])
        const index = result.ranked.findIndex((id) => item.expectIds.includes(id))
        outcome = {
          file: item.file,
          rank: index >= 0 ? index + 1 : null,
          top: result.ranked.slice(0, 3),
          ms: Date.now() - t0,
          note: result.note,
        }
      } catch (err) {
        outcome = { file: item.file, rank: null, top: [], ms: Date.now() - t0, error: String(err) }
      }
      outcomes.set(item, outcome)
      if (args.verbose || item.source === 'real') {
        const mark = outcome.rank === 1 ? 'OK ' : outcome.rank ? `#${outcome.rank}` : 'MISS'
        console.log(`  ${mark.padEnd(4)} ${item.label} → ${outcome.top.join(', ') || outcome.error || '(nothing)'}`)
      }
      if (outcomes.size % 25 === 0) {
        const rate = (Date.now() - started) / outcomes.size
        const left = Math.round(((items.length - outcomes.size) * rate) / 1000)
        console.log(`  … ${outcomes.size}/${items.length} (${left}s left)`)
      }
    }
  } finally {
    await instance.close()
  }
}
await Promise.all(Array.from({ length: Math.min(Number(args.workers), items.length) }, worker))

// ---------- report ----------

type Stats = { n: number; top1: number; top3: number; found: number; ms: number }
const empty = (): Stats => ({ n: 0, top1: 0, top3: 0, found: 0, ms: 0 })
function add(s: Stats, o: Outcome) {
  s.n++
  s.ms += o.ms
  if (o.rank === 1) s.top1++
  if (o.rank && o.rank <= 3) s.top3++
  if (o.rank) s.found++
}
const pct = (k: number, n: number) => (n ? `${((100 * k) / n).toFixed(1)}%` : '-').padStart(7)

function table(title: string, groups: Map<string, Stats>) {
  console.log(`\n${title}`)
  console.log(`  ${''.padEnd(18)}${'n'.padStart(6)}${'top-1'.padStart(8)}${'top-3'.padStart(8)}${'found'.padStart(8)}${'avg'.padStart(8)}`)
  for (const [name, s] of [...groups].sort((a, b) => b[1].n - a[1].n)) {
    console.log(
      `  ${name.padEnd(18)}${String(s.n).padStart(6)} ${pct(s.top1, s.n)} ${pct(s.top3, s.n)} ${pct(s.found, s.n)}${`${Math.round(s.ms / s.n)}ms`.padStart(8)}`,
    )
  }
}

function groupBy(keys: (item: BenchItem) => string[]) {
  const groups = new Map<string, Stats>()
  for (const [item, o] of outcomes) {
    for (const k of keys(item)) {
      if (!groups.has(k)) groups.set(k, empty())
      add(groups.get(k)!, o)
    }
  }
  return groups
}

const overall = groupBy(() => ['all'])
table('Overall', overall)
table('By source', groupBy((i) => [i.source]))
table('By card type', groupBy((i) => [i.category]))
table('By damage severity (synthetic)', groupBy((i) => (i.damage ? [i.damage.severity] : [])))
// Low-res + JPEG hit every image, so they aren't worth a row
table(
  'By damage effect (synthetic, an image can have several)',
  groupBy((i) => i.damage?.applied.filter((a) => a !== 'low-res' && a !== 'jpeg') ?? []),
)
table('Hard cases', groupBy((i) => i.tags))

const errors = [...outcomes.values()].filter((o) => o.error)
if (errors.length) console.log(`\n${errors.length} images errored (first: ${errors[0].error})`)

const resultsDir = resolve(BENCH_DIR, 'results')
await mkdir(resultsDir, { recursive: true })
// Method names like embed:dinov2-small — a colon in a Windows filename silently makes an NTFS stream
const fileStem = args.method!.replace(/[^a-zA-Z0-9._-]/g, '_')
const previous = (await readdir(resultsDir)).filter((f) => f.startsWith(`${fileStem}-`)).sort().pop()
const all = overall.get('all')!
const summary = {
  method: args.method,
  args,
  finishedAt: new Date().toISOString(),
  overall: all,
  outcomes: [...outcomes].map(([item, o]) => ({ ...o, source: item.source, expectIds: item.expectIds })),
}
const file = `${fileStem}-${summary.finishedAt.replace(/[:.]/g, '-')}.json`
await writeFile(resolve(resultsDir, file), JSON.stringify(summary, null, 2))

if (previous) {
  const prev = JSON.parse(await readFile(resolve(resultsDir, previous), 'utf8'))
  const delta = (now: number, n: number, was: number, wn: number) => {
    const d = (100 * now) / n - (100 * was) / wn
    return `${d >= 0 ? '+' : ''}${d.toFixed(1)}pt`
  }
  const p = prev.overall as Stats
  console.log(
    `\nVs previous ${args.method} run (${previous}, ${p.n} images): top-1 ${delta(all.top1, all.n, p.top1, p.n)}, top-3 ${delta(all.top3, all.n, p.top3, p.n)}` +
      (JSON.stringify(prev.args) !== JSON.stringify(args) ? '  [different options — not a like-for-like comparison]' : ''),
  )
}
console.log(`\nSaved ${resolve(resultsDir, file)}`)
process.exit(0)
