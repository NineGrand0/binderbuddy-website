/**
 * On-disk image-embedding index for the catalogue, one folder per model:
 *   ids.txt      one catalogue id per line, in vector order
 *   vectors.f32  float32 rows of `dim`, L2-normalised
 *   meta.json    model + preprocessing, so a mismatched query embedding is caught
 * Appended batch by batch so a build can be interrupted and resumed.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { pixelsToInput, VISION_MODELS, type VisionModelKey, type VisionModelSpec } from '../../src/lib/cardVision.ts'

export const INDEX_ROOT = resolve('.cache/card-index')
export const indexDir = (model: VisionModelKey) => resolve(INDEX_ROOT, model)

// Transparent card corners become neutral grey rather than whatever the decoder leaves behind
export const PREP_NOTE = 'flatten on #808080, stretch whole card to square'

/** Card image (any format sharp reads) → model input. Build and query must both use this. */
export async function cardToInput(image: Buffer, spec: VisionModelSpec): Promise<Float32Array> {
  const { data } = await sharp(image)
    .flatten({ background: '#808080' })
    .resize(spec.size, spec.size, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return pixelsToInput(data, 3, spec)
}

export type IndexMeta = {
  model: VisionModelKey
  repo: string
  dim: number
  count: number
  catalogueSize: number
  prep: string
  updatedAt: string
}

export type LoadedIndex = { meta: IndexMeta; ids: string[]; vectors: Float32Array }

export async function loadIndex(model: VisionModelKey): Promise<LoadedIndex> {
  const dir = indexDir(model)
  const meta = JSON.parse(await readFile(resolve(dir, 'meta.json'), 'utf8')) as IndexMeta
  const ids = (await readFile(resolve(dir, 'ids.txt'), 'utf8')).split('\n').filter(Boolean)
  const raw = await readFile(resolve(dir, 'vectors.f32'))
  const vectors = new Float32Array(raw.buffer, raw.byteOffset, ids.length * meta.dim)
  if (meta.prep !== PREP_NOTE) throw new Error(`Index ${model} was built with different preprocessing — rebuild it.`)
  return { meta, ids, vectors }
}

/** Cosine similarity (vectors are normalised) → best `k` ids. Brute force: 20k × 384 is ~2 ms. */
export function nearest(index: LoadedIndex, query: Float32Array, k: number) {
  const { dim } = index.meta
  const scores = new Float32Array(index.ids.length)
  for (let r = 0; r < index.ids.length; r++) {
    let dot = 0
    const o = r * dim
    for (let d = 0; d < dim; d++) dot += index.vectors[o + d] * query[d]
    scores[r] = dot
  }
  const order = Array.from(scores.keys()).sort((a, b) => scores[b] - scores[a]).slice(0, k)
  return order.map((r) => ({ id: index.ids[r], score: scores[r] }))
}

export function specFor(model: string): VisionModelSpec {
  const spec = VISION_MODELS[model as VisionModelKey]
  if (!spec) throw new Error(`Unknown model "${model}". Available: ${Object.keys(VISION_MODELS).join(', ')}`)
  return spec
}
