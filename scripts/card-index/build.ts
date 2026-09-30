/**
 * Embed every catalogue card image into .cache/card-index/<model>/. Resumable: rerun to
 * continue after an interruption, or later to pick up newly released sets.
 *
 *   npm run card-index:build -- --model dinov2-small
 */
import { appendFile, mkdir, open, readFile, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { getCardImage } from '../../server/cardImages.ts'
import { loadImageEmbedder } from '../../src/lib/cardVision.ts'
import { listCatalogueCards } from '../../src/lib/pokemonTcg.ts'
import { cardToInput, indexDir, PREP_NOTE, specFor, type IndexMeta } from './indexFile.ts'

const { values: args } = parseArgs({
  options: {
    model: { type: 'string', default: 'dinov2-small' },
    concurrency: { type: 'string', default: '8' },
    batch: { type: 'string', default: '64' },
    limit: { type: 'string' },
  },
})
const spec = specFor(args.model!)
const dir = indexDir(spec.key)
const idsFile = resolve(dir, 'ids.txt')
const vectorsFile = resolve(dir, 'vectors.f32')
const failedFile = resolve(dir, 'failed.txt')
await mkdir(dir, { recursive: true })

const readLines = (file: string) =>
  readFile(file, 'utf8').then(
    (t) => t.split('\n').filter(Boolean),
    () => [] as string[],
  )

const done = await readLines(idsFile)
const failed = new Set(await readLines(failedFile))

const embedder = await loadImageEmbedder(spec)
const dim = (await embedder.embed(new Float32Array(3 * spec.size * spec.size))).length

// A crash between the two appends can leave extra vector bytes — trim to match ids.txt
const expectedBytes = done.length * dim * 4
const actualBytes = await stat(vectorsFile).then((s) => s.size, () => 0)
if (actualBytes !== expectedBytes) {
  if (actualBytes < expectedBytes) throw new Error(`vectors.f32 is shorter than ids.txt — delete ${dir} and rebuild.`)
  const fh = await open(vectorsFile, 'r+')
  await fh.truncate(expectedBytes)
  await fh.close()
}

const catalogue = await listCatalogueCards()
const doneSet = new Set(done)
let todo = catalogue.filter((c) => !doneSet.has(c.id) && !failed.has(c.id))
if (args.limit) todo = todo.slice(0, Number(args.limit))
console.log(`${spec.key}: ${done.length} indexed, ${failed.size} with no image, ${todo.length} to go (catalogue ${catalogue.length})`)

async function writeMeta(count: number) {
  const meta: IndexMeta = {
    model: spec.key,
    repo: spec.repo,
    dim,
    count,
    catalogueSize: catalogue.length,
    prep: PREP_NOTE,
    updatedAt: new Date().toISOString(),
  }
  await writeFile(resolve(dir, 'meta.json'), JSON.stringify(meta, null, 2))
}

const BATCH = Number(args.batch)
const started = Date.now()
let count = done.length
for (let b = 0; b < todo.length; b += BATCH) {
  const batch = todo.slice(b, b + BATCH)

  // Download in parallel, embed one at a time (the model already uses every core)
  const images: Array<Buffer | null> = new Array(batch.length).fill(null)
  let next = 0
  await Promise.all(
    Array.from({ length: Number(args.concurrency) }, async () => {
      while (next < batch.length) {
        const i = next++
        const card = batch[i]
        images[i] = await getCardImage({ id: card.id, src: card.imageSmall, size: 'small' })
          .then((r) => r.body)
          .catch(() => null)
      }
    }),
  )

  const ids: string[] = []
  const rows: Float32Array[] = []
  const missing: string[] = []
  for (let i = 0; i < batch.length; i++) {
    const image = images[i]
    if (!image) {
      missing.push(batch[i].id)
      continue
    }
    try {
      rows.push(await embedder.embed(await cardToInput(image, spec)))
      ids.push(batch[i].id)
    } catch {
      missing.push(batch[i].id)
    }
  }

  // Vectors first, then ids: a crash in between is repaired by the trim above
  const buf = Buffer.alloc(rows.length * dim * 4)
  rows.forEach((r, i) => buf.set(new Uint8Array(r.buffer, r.byteOffset, dim * 4), i * dim * 4))
  await appendFile(vectorsFile, buf)
  if (ids.length) await appendFile(idsFile, ids.join('\n') + '\n')
  if (missing.length) await appendFile(failedFile, missing.join('\n') + '\n')
  count += ids.length
  await writeMeta(count)

  const processed = Math.min(b + BATCH, todo.length)
  const eta = Math.round((((Date.now() - started) / processed) * (todo.length - processed)) / 60_000)
  console.log(`  ${processed}/${todo.length} (${count} indexed, ~${eta} min left)`)
}

await writeMeta(count)
console.log(`\nIndex ${spec.key}: ${count} of ${catalogue.length} cards → ${dir}`)
