/**
 * Search re-rank weights against the evidence saved by a `rerank:*` run — no images are
 * re-processed. Tunes on one source and reports another, so the weights aren't fitted to the
 * handful of real photos they're judged on.
 *
 *   npm run bench:cards:tune -- --tune synthetic --check real
 *   npm run bench:cards:tune -- --file .cache/card-bench/results/rerank_dinov2-small-….json
 */
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { DEFAULT_WEIGHTS, rerankScore, type CandidateEvidence, type RerankWeights } from '../card-index/rerank.ts'
import { BENCH_DIR } from './manifest.ts'

const { values: args } = parseArgs({
  options: {
    file: { type: 'string' },
    tune: { type: 'string', default: 'synthetic' },
    check: { type: 'string', default: 'real' },
  },
})

const resultsDir = resolve(BENCH_DIR, 'results')
const file =
  args.file ?? resolve(resultsDir, (await readdir(resultsDir)).filter((f) => f.startsWith('rerank_')).sort().pop()!)
type Row = { source: string; expectIds: string[]; evidence?: { candidates: CandidateEvidence[] } }
const rows = (JSON.parse(await readFile(file, 'utf8')).outcomes as Row[]).filter((r) => r.evidence)
console.log(`Evidence: ${file} (${rows.length} images)`)

function score(subset: Row[], w: RerankWeights) {
  let top1 = 0
  let top3 = 0
  for (const r of subset) {
    const ranked = [...r.evidence!.candidates].sort((a, b) => rerankScore(b, w) - rerankScore(a, w))
    const rank = ranked.findIndex((c) => r.expectIds.includes(c.id))
    if (rank === 0) top1++
    if (rank >= 0 && rank < 3) top3++
  }
  return { top1: top1 / subset.length, top3: top3 / subset.length, n: subset.length }
}

const tuneRows = rows.filter((r) => r.source === args.tune)
const checkRows = rows.filter((r) => r.source === args.check)
if (!tuneRows.length) {
  console.error(`No "${args.tune}" rows in this run — rerun the benchmark including that source.`)
  process.exit(1)
}

const grid: RerankWeights[] = []
for (const features of [0, 0.1, 0.2, 0.3, 0.5, 0.8, 1.2])
  for (const inlierScale of [20, 40, 60, 100, 200])
    for (const number of [0, 0.1, 0.2, 0.3, 0.5, 0.8]) grid.push({ features, inlierScale, number })

const results = grid
  .map((w) => ({ w, tune: score(tuneRows, w) }))
  .sort((a, b) => b.tune.top1 - a.tune.top1 || b.tune.top3 - a.tune.top3)

const pct = (x: number) => `${(100 * x).toFixed(1)}%`.padStart(7)
const show = (label: string, w: RerankWeights) => {
  const t = score(tuneRows, w)
  const c = checkRows.length ? score(checkRows, w) : null
  console.log(
    `  ${label.padEnd(44)} ${args.tune} ${pct(t.top1)} ${pct(t.top3)}` +
      (c ? `   ${args.check} ${pct(c.top1)} ${pct(c.top3)}` : ''),
  )
}
console.log(`\n  ${''.padEnd(44)} top-1 / top-3 on ${args.tune} (n=${tuneRows.length})` + (checkRows.length ? ` and ${args.check} (n=${checkRows.length})` : ''))
show('embedding only', { features: 0, inlierScale: 1, number: 0 })
show(`current ${JSON.stringify(DEFAULT_WEIGHTS)}`, DEFAULT_WEIGHTS)
for (const { w } of results.slice(0, 8)) show(JSON.stringify(w), w)
