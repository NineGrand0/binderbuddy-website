/**
 * Card identifiers the benchmark can score. Each returns catalogue ids best-first.
 * Add a new approach by adding an entry to METHODS.
 */
import sharp from 'sharp'
import { createWorker, PSM, type Worker } from 'tesseract.js'
import { buildIdentifiers } from '../../src/lib/cardIdentifiers.ts'
import {
  MID_REGIONS,
  TITLE_REGIONS,
  mergeBest,
  scoreTitle,
  type OcrBand,
  type Prep,
  type Region,
} from '../../src/lib/cardRead.ts'
import { parseCardDetailsFromOcr } from '../../src/lib/parseCardOcr.ts'
import { listCatalogueCards, matchPokemonPrintings, type CatalogueCard } from '../../src/lib/pokemonTcg.ts'
import { loadImageEmbedder, VISION_MODELS, type VisionModelKey } from '../../src/lib/cardVision.ts'
import { collectorNumberAgreement } from '../../src/lib/collectorNumber.ts'
import { getCardImage } from '../../server/cardImages.ts'
import { cardToInput, loadIndex, nearest, type LoadedIndex } from '../card-index/indexFile.ts'
import {
  computeFeatures,
  loadCv,
  matchFeatures,
  readCollectorNumber,
  rectify,
  rerankScore,
  toGray,
  type CandidateEvidence,
  readCachedFeatures,
  writeCachedFeatures,
  type Features,
} from '../card-index/rerank.ts'

export type Identification = {
  ranked: string[]
  note?: string
  /** Per-candidate evidence, saved with the results for offline weight tuning. */
  evidence?: { numberText?: string; rectified: boolean; candidates: CandidateEvidence[] }
}

export type Method = {
  identify: (image: Buffer) => Promise<Identification>
  close: () => Promise<void>
}

/** One instance per parallel worker. */
export const METHODS: Record<string, { describe: string; create: () => Promise<Method> }> = {
  ocr: {
    describe: 'Current scanner: title + attack OCR → name → printings (no set-symbol step)',
    create: createOcrMethod,
  },
  // One entry per vision model: embed:dinov2-small, embed:mobileclip-s0, …
  ...Object.fromEntries(
    Object.keys(VISION_MODELS).map((key) => [
      `embed:${key}`,
      {
        describe: `Image embedding (${key}) nearest neighbours over the catalogue index`,
        create: () => createEmbedMethod(key as VisionModelKey),
      },
    ]),
  ),
  // rerank:dinov2-small — embedding shortlist, then feature matching + collector number
  ...Object.fromEntries(
    Object.keys(VISION_MODELS).map((key) => [
      `rerank:${key}`,
      {
        describe: `${key} shortlist re-ranked by ORB feature matching + collector-number OCR`,
        create: () => createRerankMethod(key as VisionModelKey),
      },
    ]),
  ),
}

const WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/ &'-.@"

/** Node port of cardRead.ts `renderRegion`: crop, upscale to 900–1400px, pad white, optional prep. */
async function renderRegion(image: Buffer, width: number, height: number, region: Region, prep: Prep, scale: number) {
  const left = Math.max(0, Math.floor(region.x * width))
  const top = Math.max(0, Math.floor(region.y * height))
  const w = Math.max(1, Math.min(width - left, Math.floor(region.w * width)))
  const h = Math.max(1, Math.min(height - top, Math.floor(region.h * height)))
  const tw = Math.min(1400, Math.max(900, Math.round(w * scale)))
  let img = sharp(image)
    .extract({ left, top, width: w, height: h })
    .resize({ width: tw })
    .extend({ top: 16, bottom: 16, left: 16, right: 16, background: '#fff' })
  if (prep !== 'raw') {
    // Same as the browser: greyscale, stretch to full range, contrast ×1.35 around mid-grey
    img = sharp(await img.greyscale().normalise().png().toBuffer()).linear(1.35, 128 - 128 * 1.35)
    if (prep === 'invert') img = img.negate({ alpha: false })
  }
  return img.png().toBuffer()
}

async function createOcrMethod(): Promise<Method> {
  const worker: Worker = await createWorker('eng', 1, { logger: () => undefined })
  // Tesseract prints "Detected N diacritics" etc. per call; send its debug output nowhere
  await worker.setParameters({ debug_file: '/dev/null' })

  async function recognize(png: Buffer, psm: PSM): Promise<OcrBand> {
    await worker.setParameters({
      tessedit_pageseg_mode: psm,
      tessedit_char_whitelist: WHITELIST,
      preserve_interword_spaces: '1',
    })
    const { data } = await worker.recognize(png)
    return { text: data.text.replace(/\r/g, '\n').trim(), confidence: data.confidence ?? 0 }
  }

  return {
    async identify(image) {
      const meta = await sharp(image).metadata()
      const width = meta.width!
      const height = meta.height!

      // Mirrors readCardImage: up to 12 title attempts with the same early stop
      const titleHits: OcrBand[] = []
      title: for (const region of TITLE_REGIONS.slice(0, 2)) {
        for (const prep of ['raw', 'contrast', 'invert'] as Prep[]) {
          for (const [scale, psm] of [
            [3.2, PSM.SINGLE_LINE],
            [3.0, PSM.SPARSE_TEXT],
          ] as const) {
            const band = await recognize(await renderRegion(image, width, height, region, prep, scale), psm)
            if (band.text) titleHits.push(band)
            if (titleHits.some((h) => scoreTitle(h.text, h.confidence) >= 70 && /[a-z]{5,}/i.test(h.text))) break title
            if (titleHits.length >= 6) break title
          }
        }
      }
      const bodyHits: string[] = []
      for (const region of MID_REGIONS) {
        for (const prep of ['raw', 'invert'] as Prep[]) {
          const band = await recognize(await renderRegion(image, width, height, region, prep, 2.6), PSM.SPARSE_TEXT)
          if (band.text) bodyHits.push(band.text.replace(/\s+/g, ' ').trim())
        }
      }

      const titleText = mergeBest(titleHits, scoreTitle, 4)
      const fullText = [titleText, ...bodyHits].filter(Boolean).join('\n')
      const parsed = await parseCardDetailsFromOcr(fullText, { titleText, footerText: '' })
      const identifiers = buildIdentifiers({
        name: parsed.name,
        rarity: parsed.rarity,
        nameFromFuzzy: parsed.identifiers?.confidence.name === 'low',
      })
      const matched = await matchPokemonPrintings(identifiers, { limit: 3, moreLimit: 200, ocrText: fullText })
      return {
        ranked: [...matched.candidates, ...matched.moreCandidates].map((c) => c.externalId),
        note: `name=${identifiers.name ?? '∅'} mode=${matched.mode}`,
      }
    },
    close: async () => {
      await worker.terminate()
    },
  }
}

// Shared by every worker — the index is ~30 MB
const indexes = new Map<VisionModelKey, Promise<LoadedIndex>>()

function sharedIndex(model: VisionModelKey) {
  if (!indexes.has(model)) {
    indexes.set(
      model,
      loadIndex(model).then((index) => {
        if (index.meta.count < index.meta.catalogueSize) {
          console.log(
            `  ! ${model} index covers ${index.meta.count} of ${index.meta.catalogueSize} cards — cards missing from it can't be found`,
          )
        }
        return index
      }),
    )
  }
  return indexes.get(model)!
}

async function createEmbedMethod(model: VisionModelKey): Promise<Method> {
  const index = await sharedIndex(model)
  const embedder = await loadImageEmbedder(VISION_MODELS[model])
  return {
    async identify(image) {
      const query = await embedder.embed(await cardToInput(image, embedder.spec))
      const hits = nearest(index, query, 50)
      return {
        ranked: hits.map((h) => h.id),
        note: `top=${hits[0]?.score.toFixed(3)} gap=${(hits[0].score - hits[1].score).toFixed(3)}`,
      }
    },
    close: async () => undefined,
  }
}

// Real photos of rainbow / sleeved cards can sit in the 20s–30s by embedding alone
const SHORTLIST = 50
// Fewer RANSAC inliers than this and the "best match" is noise — don't trust its outline
const MIN_INLIERS_TO_RECTIFY = 15

// Matching cost scales with query × candidate feature counts; these hold accuracy on real photos
const QUERY_FEATURES = Number(process.env.RERANK_QUERY_FEATURES ?? 1000)
const CANDIDATE_FEATURES = Number(process.env.RERANK_CANDIDATE_FEATURES ?? 700)

let catalogueById: Promise<Map<string, CatalogueCard>> | null = null
// Catalogue-scan features, shared across workers and images (null = no image)
const candidateFeatures = new Map<string, Promise<Features | null>>()

function featuresFor(card: CatalogueCard): Promise<Features | null> {
  let job = candidateFeatures.get(card.id)
  if (!job) {
    job = (async () => {
      const cached = await readCachedFeatures(card.id, CANDIDATE_FEATURES)
      if (cached) return cached
      try {
        const { body } = await getCardImage({ id: card.id, src: card.imageLarge, size: 'large' })
        const feats = computeFeatures(await loadCv(), await toGray(body, 800), CANDIDATE_FEATURES)
        await writeCachedFeatures(card.id, CANDIDATE_FEATURES, feats)
        return feats
      } catch {
        return null
      }
    })()
    candidateFeatures.set(card.id, job)
  }
  return job
}

async function createRerankMethod(model: VisionModelKey): Promise<Method> {
  catalogueById ??= listCatalogueCards().then((cards) => new Map(cards.map((c) => [c.id, c])))
  const [index, byId, cv, embedder, worker] = await Promise.all([
    sharedIndex(model),
    catalogueById,
    loadCv(),
    loadImageEmbedder(VISION_MODELS[model]),
    createWorker('eng', 1, { logger: () => undefined }).then(async (w) => {
      await w.setParameters({ debug_file: '/dev/null' })
      return w
    }),
  ])

  return {
    async identify(image) {
      const hits = nearest(index, await embedder.embed(await cardToInput(image, embedder.spec)), SHORTLIST)
      const photo = await toGray(image, 1600)
      const queryGray = await toGray(image, 800)
      const query = computeFeatures(cv, queryGray, QUERY_FEATURES)
      const queryScale = queryGray.width / photo.width

      const matches = await Promise.all(
        hits.map(async (hit) => {
          const card = byId.get(hit.id)
          const feats = card ? await featuresFor(card) : null
          const match = feats ? matchFeatures(cv, feats, query) : { inliers: 0, homography: null }
          return { hit, card, feats, match }
        }),
      )

      // Straighten the card using the most convincing geometric match, then read its number
      const best = matches.reduce((a, b) => (b.match.inliers > a.match.inliers ? b : a))
      const canRectify = best.match.inliers >= MIN_INLIERS_TO_RECTIFY && best.match.homography && best.feats
      const upright = canRectify
        ? rectify(cv, photo, { homography: best.match.homography!, cand: best.feats!, queryScale }, 1000)
        : photo
      const { text: numberText, reads } = await readCollectorNumber(worker, upright)

      const candidates: CandidateEvidence[] = matches.map((m) => ({
        id: m.hit.id,
        cos: +m.hit.score.toFixed(4),
        inliers: m.match.inliers,
        number: m.card ? collectorNumberAgreement(reads, m.card) : 0,
      }))
      const ranked = [...candidates].sort((a, b) => rerankScore(b) - rerankScore(a))
      const read = reads.map((r) => (r.total ? `${r.number}/${r.total}` : r.number)).join(',') || '∅'
      return {
        ranked: ranked.map((c) => c.id),
        note: `inliers=${ranked[0].inliers} number=${ranked[0].number} read=${read}${canRectify ? '' : ' (not straightened)'}`,
        evidence: { numberText, rectified: Boolean(canRectify), candidates },
      }
    },
    close: async () => {
      await worker.terminate()
    },
  }
}
