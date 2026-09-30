/**
 * Second pass over the image-embedding shortlist:
 *  1. ORB keypoints + RANSAC homography between the photo and each candidate's catalogue scan,
 *     in greyscale so a rainbow foil's colour doesn't matter — only shapes that line up count.
 *  2. The best geometric match gives the card's exact outline in the photo, so the card is
 *     straightened and only its bottom strip is OCR'd for the collector number.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import cvModule from '@techstark/opencv-js'
import sharp from 'sharp'
import { PSM, type Worker } from 'tesseract.js'
import { parseCollectorNumbers, type ReadNumber } from '../../src/lib/collectorNumber.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any

let cvPromise: Promise<CV> | null = null
export function loadCv(): Promise<CV> {
  if (!cvPromise) {
    cvPromise =
      cvModule instanceof Promise
        ? cvModule
        : new Promise((resolve) => {
            ;(cvModule as CV).onRuntimeInitialized = () => resolve(cvModule)
          })
  }
  return cvPromise
}

export type Gray = { data: Uint8Array; width: number; height: number }

/** Greyscale, EXIF-rotated, longest side scaled to `maxSide`. */
export async function toGray(image: Buffer, maxSide: number): Promise<Gray> {
  const { data, info } = await sharp(image)
    .rotate()
    .flatten({ background: '#808080' })
    .resize(maxSide, maxSide, { fit: 'inside' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height }
}

/** Keypoints and descriptors copied out of OpenCV so they can be cached without leaking Mats. */
export type Features = { width: number; height: number; points: Float32Array; descriptors: Uint8Array; count: number }

function grayMat(cv: CV, g: Gray) {
  const mat = new cv.Mat(g.height, g.width, cv.CV_8UC1)
  mat.data.set(g.data)
  return mat
}

export function computeFeatures(cv: CV, g: Gray, maxFeatures = 1500): Features {
  const mat = grayMat(cv, g)
  // Local contrast evens out glare and foil so edges in bright and dark areas both get keypoints
  const clahe = new cv.CLAHE(2.0, new cv.Size(8, 8))
  const eq = new cv.Mat()
  clahe.apply(mat, eq)
  const orb = new cv.ORB(maxFeatures)
  const kps = new cv.KeyPointVector()
  const des = new cv.Mat()
  const noMask = new cv.Mat()
  orb.detectAndCompute(eq, noMask, kps, des)
  const count = kps.size()
  const points = new Float32Array(count * 2)
  for (let i = 0; i < count; i++) {
    const p = kps.get(i).pt
    points[i * 2] = p.x
    points[i * 2 + 1] = p.y
  }
  const descriptors = new Uint8Array(des.rows ? des.data : [])
  for (const m of [mat, eq, des, noMask, kps, orb, clahe]) m.delete()
  return { width: g.width, height: g.height, points, descriptors: descriptors.slice(), count }
}

const FEATURE_CACHE = resolve('.cache/card-features')
const featureFile = (id: string, maxFeatures: number) =>
  resolve(FEATURE_CACHE, String(maxFeatures), `${id.replace(/[^a-zA-Z0-9._-]/g, '_')}.bin`)

/** Layout: u32 width, u32 height, u32 count, f32 points[count*2], u8 descriptors[count*32]. */
export async function readCachedFeatures(id: string, maxFeatures: number): Promise<Features | null> {
  try {
    const buf = await readFile(featureFile(id, maxFeatures))
    const [width, height, count] = [buf.readUInt32LE(0), buf.readUInt32LE(4), buf.readUInt32LE(8)]
    const points = new Float32Array(buf.buffer.slice(buf.byteOffset + 12, buf.byteOffset + 12 + count * 8))
    const descriptors = new Uint8Array(buf.subarray(12 + count * 8, 12 + count * 8 + count * 32))
    return { width, height, count, points, descriptors }
  } catch {
    return null
  }
}

export async function writeCachedFeatures(id: string, maxFeatures: number, f: Features) {
  const file = featureFile(id, maxFeatures)
  await mkdir(dirname(file), { recursive: true })
  const header = Buffer.alloc(12)
  header.writeUInt32LE(f.width, 0)
  header.writeUInt32LE(f.height, 4)
  header.writeUInt32LE(f.count, 8)
  await writeFile(file, Buffer.concat([header, Buffer.from(f.points.buffer, f.points.byteOffset, f.count * 8), Buffer.from(f.descriptors)]))
}

export type GeometricMatch = {
  /** RANSAC inliers — keypoints that agree on one card-to-photo mapping. */
  inliers: number
  /** Candidate-feature coords → query-feature coords, row-major 3×3; null if no usable mapping. */
  homography: number[] | null
}

function descriptorMat(cv: CV, f: Features) {
  const mat = new cv.Mat(f.count, 32, cv.CV_8U)
  mat.data.set(f.descriptors)
  return mat
}

/** Where the candidate's corners land in the photo must be a sane, non-folded card shape. */
function plausible(H: number[], cand: Features, query: Features) {
  const corners = [
    [0, 0],
    [cand.width, 0],
    [cand.width, cand.height],
    [0, cand.height],
  ].map(([x, y]) => {
    const w = H[6] * x + H[7] * y + H[8]
    return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w]
  })
  let area = 0
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = corners[i]
    const [bx, by] = corners[(i + 1) % 4]
    const [cx, cy] = corners[(i + 2) % 4]
    area += ax * by - bx * ay
    const cross = Math.sign((bx - ax) * (cy - by) - (by - ay) * (cx - bx))
    if (sign && cross && cross !== sign) return false
    sign = sign || cross
  }
  const ratio = Math.abs(area / 2) / (query.width * query.height)
  // The card fills a loose crop, so it can't be tiny, and can't be far bigger than the photo
  return ratio > 0.2 && ratio < 1.6
}

export function matchFeatures(cv: CV, cand: Features, query: Features): GeometricMatch {
  if (cand.count < 8 || query.count < 8) return { inliers: 0, homography: null }
  const dq = descriptorMat(cv, query)
  const dc = descriptorMat(cv, cand)
  const matcher = new cv.BFMatcher(cv.NORM_HAMMING, false)
  const knn = new cv.DMatchVectorVector()
  matcher.knnMatch(dq, dc, knn, 2)
  const src: number[] = []
  const dst: number[] = []
  for (let i = 0; i < knn.size(); i++) {
    const pair = knn.get(i)
    if (pair.size() < 2) continue
    const a = pair.get(0)
    const b = pair.get(1)
    // Lowe's ratio test: keep only matches clearly better than the runner-up
    if (a.distance < 0.8 * b.distance) {
      src.push(cand.points[a.trainIdx * 2], cand.points[a.trainIdx * 2 + 1])
      dst.push(query.points[a.queryIdx * 2], query.points[a.queryIdx * 2 + 1])
    }
  }
  for (const m of [dq, dc, matcher, knn]) m.delete()
  if (src.length / 2 < 8) return { inliers: 0, homography: null }

  const srcMat = cv.matFromArray(src.length / 2, 1, cv.CV_32FC2, src)
  const dstMat = cv.matFromArray(dst.length / 2, 1, cv.CV_32FC2, dst)
  const mask = new cv.Mat()
  const H = cv.findHomography(srcMat, dstMat, cv.RANSAC, 6, mask)
  let inliers = 0
  for (let i = 0; i < mask.rows; i++) if (mask.data[i]) inliers++
  const homography = H.rows === 3 ? Array.from(H.data64F as Float64Array) : null
  for (const m of [srcMat, dstMat, mask, H]) m.delete()
  if (!homography || !plausible(homography, cand, query)) return { inliers: 0, homography: null }
  return { inliers, homography }
}

const mul3 = (a: number[], b: number[]) =>
  [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]))
const scale3 = (sx: number, sy: number) => [sx, 0, 0, 0, sy, 0, 0, 0, 1]

/**
 * Straighten the card in `photo` to an upright `outWidth`-wide image using a homography from
 * candidate-feature space to query-feature space. `queryScale` = query-feature px per photo px.
 */
export function rectify(
  cv: CV,
  photo: Gray,
  match: { homography: number[]; cand: Features; queryScale: number },
  outWidth: number,
): Gray {
  const outHeight = Math.round((outWidth * match.cand.height) / match.cand.width)
  // canonical → candidate features → query features → photo pixels
  const M = mul3(
    scale3(1 / match.queryScale, 1 / match.queryScale),
    mul3(match.homography, scale3(match.cand.width / outWidth, match.cand.height / outHeight)),
  )
  const src = grayMat(cv, photo)
  const out = new cv.Mat()
  const Mmat = cv.matFromArray(3, 3, cv.CV_64F, M)
  cv.warpPerspective(
    src,
    out,
    Mmat,
    new cv.Size(outWidth, outHeight),
    cv.INTER_LINEAR | cv.WARP_INVERSE_MAP,
    cv.BORDER_REPLICATE,
  )
  const result: Gray = { data: new Uint8Array(out.data).slice(), width: outWidth, height: outHeight }
  for (const m of [src, out, Mmat]) m.delete()
  return result
}


// The number sits in the last ~6% of the card (left on modern cards, right on vintage), below
// the rules box. The whole strip reads better than corner crops: the copyright line beside the
// number gives Tesseract a proper text line to lock onto.
const NUMBER_TOP = 0.935
const NUMBER_BOTTOM = 0.995

// Width the strip is upscaled to, layout mode, inverted (light-on-dark full-art borders).
// A whitelist made reads worse, so none is set.
const NUMBER_PASSES: Array<{ width: number; psm: PSM; invert: boolean }> = [
  { width: 1600, psm: PSM.SINGLE_BLOCK, invert: false },
  { width: 2400, psm: PSM.SPARSE_TEXT, invert: false },
  { width: 1600, psm: PSM.SINGLE_BLOCK, invert: true },
]

/** OCR the collector-number strip of an upright card. */
export async function readCollectorNumber(worker: Worker, card: Gray): Promise<{ text: string; reads: ReadNumber[] }> {
  const top = Math.round(card.height * NUMBER_TOP)
  const height = Math.round(card.height * (NUMBER_BOTTOM - NUMBER_TOP))
  const pixels = Buffer.from(card.data)
  const texts: string[] = []
  for (const pass of NUMBER_PASSES) {
    // One pipeline per pass: sharp widens 1-channel raw output to 3 channels, so an
    // intermediate raw strip can't be fed back in as 1-channel
    let region = sharp(pixels, { raw: { width: card.width, height: card.height, channels: 1 } })
      .extract({ left: 0, top, width: card.width, height })
      .resize({ width: pass.width })
      .normalise()
    if (pass.invert) region = region.negate()
    await worker.setParameters({ tessedit_pageseg_mode: pass.psm, tessedit_char_whitelist: '' })
    texts.push((await worker.recognize(await region.png().toBuffer())).data.text.replace(/\s+/g, ' ').trim())
  }
  const text = texts.join(' | ')
  return { text, reads: parseCollectorNumbers(texts.join('\n')) }
}

export type CandidateEvidence = {
  id: string
  /** Embedding cosine similarity. */
  cos: number
  inliers: number
  /** collectorNumberAgreement: 1 full match … -0.3 contradicts. */
  number: number
}

export type RerankWeights = { features: number; inlierScale: number; number: number }

// Starting point; `npm run bench:cards:tune` searches these against saved evidence
export const DEFAULT_WEIGHTS: RerankWeights = { features: 0.3, inlierScale: 60, number: 0.3 }

/** Final score per candidate; the shortlist is re-sorted by it. */
export function rerankScore(c: CandidateEvidence, w: RerankWeights = DEFAULT_WEIGHTS) {
  return c.cos + w.features * Math.min(1, c.inliers / w.inlierScale) + w.number * c.number
}
