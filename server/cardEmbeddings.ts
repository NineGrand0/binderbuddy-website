/**
 * Serves rows of the catalogue image-embedding index (built by `npm run card-index:build`) so the
 * browser scanner can compare a photo against the printings its text match shortlisted, without
 * downloading all 21k vectors. Reads the same files as scripts/card-index/indexFile.ts.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const INDEX_DIR = resolve('.cache/card-index/dinov2-small')
export const MAX_EMBEDDING_IDS = 300

type Index = { model: string; prep: string; dim: number; rows: Map<string, number>; vectors: Float32Array }

let indexPromise: Promise<Index | null> | null = null

function loadIndex(): Promise<Index | null> {
  indexPromise ??= (async () => {
    try {
      const meta = JSON.parse(await readFile(resolve(INDEX_DIR, 'meta.json'), 'utf8')) as {
        model: string
        prep: string
        dim: number
      }
      const ids = (await readFile(resolve(INDEX_DIR, 'ids.txt'), 'utf8')).split('\n').filter(Boolean)
      const raw = await readFile(resolve(INDEX_DIR, 'vectors.f32'))
      // Copy so the rows are 4-byte aligned regardless of how the Buffer was pooled
      const vectors = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + ids.length * meta.dim * 4))
      return { model: meta.model, prep: meta.prep, dim: meta.dim, rows: new Map(ids.map((id, row) => [id, row])), vectors }
    } catch {
      // No index built on this machine — the scanner falls back to its text ranking
      return null
    }
  })()
  return indexPromise
}

export type EmbeddingLookup = {
  model: string
  prep: string
  dim: number
  /** Catalogue id → base64 of the float32 row. Ids missing from the index are left out. */
  vectors: Record<string, string>
}

/** Catalogue printings whose art is closest to `query` (an L2-normalised photo embedding). */
export async function nearestCardEmbeddings(
  query: Float32Array,
  k: number,
): Promise<{ model: string; prep: string; hits: Array<{ id: string; score: number }> } | null> {
  const index = await loadIndex()
  if (!index) return null
  if (query.length !== index.dim) throw new Error(`Expected a ${index.dim}-dim embedding.`)
  const ids = [...index.rows.keys()]
  const scores = new Float32Array(ids.length)
  for (let r = 0; r < ids.length; r++) {
    let dot = 0
    const o = r * index.dim
    for (let d = 0; d < index.dim; d++) dot += index.vectors[o + d] * query[d]
    scores[r] = dot
  }
  const top = Array.from(scores.keys())
    .sort((a, b) => scores[b] - scores[a])
    .slice(0, Math.min(Math.max(1, k), 100))
  return { model: index.model, prep: index.prep, hits: top.map((r) => ({ id: ids[r], score: scores[r] })) }
}

export async function lookupCardEmbeddings(ids: string[]): Promise<EmbeddingLookup | null> {
  const index = await loadIndex()
  if (!index) return null
  const vectors: Record<string, string> = {}
  for (const id of ids.slice(0, MAX_EMBEDDING_IDS)) {
    const row = index.rows.get(id)
    if (row == null) continue
    const slice = index.vectors.subarray(row * index.dim, (row + 1) * index.dim)
    vectors[id] = Buffer.from(slice.buffer, slice.byteOffset, slice.byteLength).toString('base64')
  }
  return { model: index.model, prep: index.prep, dim: index.dim, vectors }
}
