import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { listCatalogueCards } from '../../src/lib/pokemonTcg.ts'
import { categorize, tagCatalogue, type BenchCategory, type BenchTag } from './categories.ts'
import type { DamageRecord } from './damage.ts'

export const BENCH_DIR = resolve('.cache/card-bench')
export const PHOTOS_DIR = resolve('test-data/card-photos')

export type BenchItem = {
  /** Relative to BENCH_DIR for synthetic images, PHOTOS_DIR for real photos. */
  file: string
  source: 'synthetic' | 'real'
  /** Any of these ids counts as a correct answer. */
  expectIds: string[]
  label: string
  category: BenchCategory | 'unknown'
  tags: BenchTag[]
  damage?: DamageRecord
}

export type Manifest = {
  createdAt: string
  seed: number
  catalogueSize: number
  skipped: string[]
  items: BenchItem[]
}

export function itemPath(item: BenchItem) {
  return resolve(item.source === 'real' ? PHOTOS_DIR : BENCH_DIR, item.file)
}

export async function loadSyntheticItems(): Promise<BenchItem[]> {
  try {
    const manifest = JSON.parse(await readFile(resolve(BENCH_DIR, 'manifest.json'), 'utf8')) as Manifest
    return manifest.items
  } catch {
    return []
  }
}

type PhotoLabel = { file: string; label?: string; expectIds: string[] }

export async function loadRealItems(): Promise<BenchItem[]> {
  let photos: PhotoLabel[]
  try {
    photos = JSON.parse(await readFile(resolve(PHOTOS_DIR, 'labels.json'), 'utf8')).photos
  } catch {
    return []
  }
  const catalogue = await listCatalogueCards()
  const byId = new Map(catalogue.map((c) => [c.id, c]))
  const tags = tagCatalogue(catalogue)
  return photos.map((p) => {
    const card = p.expectIds.map((id) => byId.get(id)).find(Boolean)
    return {
      file: p.file,
      source: 'real' as const,
      expectIds: p.expectIds,
      label: p.label ?? p.file,
      category: card ? categorize(card) : 'unknown',
      tags: card ? tags.get(card.id)! : [],
    }
  })
}
