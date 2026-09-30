import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { listCatalogueCards } from '../../src/lib/pokemonTcg.ts'
import { categorize, tagCatalogue, type BenchCategory, type BenchTag } from './categories.ts'
import type { DamageRecord } from './damage.ts'

export const BENCH_DIR = resolve('.cache/card-bench')
export const PHOTOS_DIR = resolve('test-data/card-photos')

export type BenchItem = {
  /** Relative to BENCH_DIR for synthetic images, PHOTOS_DIR for real photos. */
  file: string
  /** real = cropped to the labelled card box (or already a card crop); real-uncropped = the whole photo. */
  source: 'synthetic' | 'real' | 'real-uncropped'
  /** Any of these ids counts as a correct answer. */
  expectIds: string[]
  label: string
  category: BenchCategory | 'unknown'
  tags: BenchTag[]
  damage?: DamageRecord
  /** Real photos: rainbow | other-foil | non-holo. */
  finish?: string
  /** Card box in the photo as [x0, y0, x1, y1] fractions. */
  crop?: [number, number, number, number]
}

export type Manifest = {
  createdAt: string
  seed: number
  catalogueSize: number
  skipped: string[]
  items: BenchItem[]
}

export function itemPath(item: BenchItem) {
  return resolve(item.source === 'synthetic' ? BENCH_DIR : PHOTOS_DIR, item.file)
}

/** The image a method is given: EXIF-rotated, then cut to the labelled card box if there is one. */
export async function loadItemImage(item: BenchItem): Promise<Buffer> {
  const raw = await readFile(itemPath(item))
  if (item.source === 'synthetic') return raw
  if (!item.crop) return sharp(raw).rotate().jpeg({ quality: 95 }).toBuffer()
  const rotated = await sharp(raw).rotate().toBuffer({ resolveWithObject: true })
  const { width, height } = rotated.info
  const [x0, y0, x1, y1] = item.crop
  const left = Math.round(x0 * width)
  const top = Math.round(y0 * height)
  return sharp(rotated.data)
    .extract({
      left,
      top,
      width: Math.min(width - left, Math.round((x1 - x0) * width)),
      height: Math.min(height - top, Math.round((y1 - y0) * height)),
    })
    .jpeg({ quality: 95 })
    .toBuffer()
}

export async function loadSyntheticItems(): Promise<BenchItem[]> {
  try {
    const manifest = JSON.parse(await readFile(resolve(BENCH_DIR, 'manifest.json'), 'utf8')) as Manifest
    return manifest.items
  } catch {
    return []
  }
}

type PhotoLabel = {
  file: string
  label?: string
  expectIds: string[]
  finish?: string
  crop?: [number, number, number, number]
}

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
  const items: BenchItem[] = []
  const missing: string[] = []
  for (const p of photos) {
    // Third-party photo folders are git-ignored, so a fresh checkout may not have them
    if (!(await access(resolve(PHOTOS_DIR, p.file)).then(() => true, () => false))) {
      missing.push(p.file)
      continue
    }
    const card = p.expectIds.map((id) => byId.get(id)).find(Boolean)
    const item: BenchItem = {
      file: p.file,
      source: 'real',
      expectIds: p.expectIds,
      label: p.label ?? p.file,
      category: card ? categorize(card) : 'unknown',
      tags: card ? tags.get(card.id)! : [],
      finish: p.finish,
      crop: p.crop,
    }
    items.push(item)
    // Scoring the whole photo too shows how much finding the card first matters
    if (p.crop) items.push({ ...item, source: 'real-uncropped', crop: undefined })
  }
  if (missing.length) console.log(`  ! ${missing.length} labelled photos not on disk (e.g. ${missing[0]}) — skipped`)
  return items
}
