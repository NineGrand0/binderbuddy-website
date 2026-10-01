/**
 * Ranks the printings a text match shortlisted by how much their catalogue art looks like the
 * photo. Text can tell Leafeon VMAX apart from other cards, but every Leafeon VMAX printing has
 * the same attacks and HP — the art (rainbow vs regular, alternate art, shiny) is what differs.
 *
 * Uses the DINOv2 index built by `npm run card-index:build`, served by /api/card-embeddings.
 * Preprocessing must match scripts/card-index/indexFile.ts: flatten on #808080, stretch to square.
 */
import { loadImageEmbedder, pixelsToInput, VISION_MODELS, type ImageEmbedder } from './cardVision';
import { loadImage } from './pageImage';
import { candidatesForIds, type PokemonMatchCandidate } from './pokemonTcg';

const SPEC = VISION_MODELS['dinov2-small'];
const INDEX_PREP = 'flatten on #808080, stretch whole card to square';

let embedderPromise: Promise<ImageEmbedder> | null = null;
/** When the index was last found missing; scans skip art ranking for a minute, then check again (it may have been built since). */
let indexMissingAt = 0;
const INDEX_RECHECK_MS = 60_000;
const indexMissing = () => Date.now() - indexMissingAt < INDEX_RECHECK_MS;
const vectorCache = new Map<string, Float32Array>();

function getEmbedder() {
  embedderPromise ??= loadImageEmbedder(SPEC).catch((err) => {
    embedderPromise = null;
    throw err;
  });
  return embedderPromise;
}

const photoCache = new Map<string, Promise<Float32Array>>();

function embedPhoto(dataUrl: string): Promise<Float32Array> {
  let pending = photoCache.get(dataUrl);
  if (!pending) {
    pending = embedPhotoUncached(dataUrl);
    photoCache.set(dataUrl, pending);
    pending.catch(() => photoCache.delete(dataUrl));
    // Only the last few scans are ever re-ranked; don't hold every photo
    if (photoCache.size > 8) photoCache.delete(photoCache.keys().next().value!);
  }
  return pending;
}

function encodeVector(v: Float32Array): string {
  const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/** Printings across the whole catalogue whose art looks most like the photo. */
export async function nearestByLook(photoDataUrl: string, k = 30): Promise<Map<string, number> | null> {
  if (indexMissing()) return null;
  const photo = await embedPhoto(photoDataUrl);
  const res = await fetch('/api/card-embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ near: encodeVector(photo), k }),
  });
  if (res.status === 404) {
    indexMissingAt = Date.now();
    return null;
  }
  if (!res.ok) throw new Error(`Card image search failed (${res.status}).`);
  const body = (await res.json()) as { model: string; prep: string; hits: Array<{ id: string; score: number }> };
  if (body.model !== SPEC.key || body.prep !== INDEX_PREP) {
    throw new Error('Card image index was built with a different model — rebuild it.');
  }
  return new Map(body.hits.map((h) => [h.id, h.score]));
}

async function embedPhotoUncached(dataUrl: string): Promise<Float32Array> {
  const image = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = SPEC.size;
  canvas.height = SPEC.size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas unsupported.');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, SPEC.size, SPEC.size);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, SPEC.size, SPEC.size);
  const { data } = ctx.getImageData(0, 0, SPEC.size, SPEC.size);
  const embedder = await getEmbedder();
  return embedder.embed(pixelsToInput(data, 4, SPEC));
}

function decodeVector(base64: string): Float32Array {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Float32Array(bytes.buffer);
}

async function fetchVectors(ids: string[]): Promise<Map<string, Float32Array>> {
  const missing = ids.filter((id) => !vectorCache.has(id));
  if (missing.length > 0) {
    const res = await fetch('/api/card-embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: missing }),
    });
    if (res.status === 404) {
      indexMissingAt = Date.now();
      return new Map();
    }
    if (!res.ok) throw new Error(`Card image index request failed (${res.status}).`);
    const body = (await res.json()) as { model: string; prep: string; vectors: Record<string, string> };
    if (body.model !== SPEC.key || body.prep !== INDEX_PREP) {
      throw new Error('Card image index was built with a different model — rebuild it.');
    }
    for (const [id, base64] of Object.entries(body.vectors)) vectorCache.set(id, decodeVector(base64));
  }
  const out = new Map<string, Float32Array>();
  for (const id of ids) {
    const v = vectorCache.get(id);
    if (v) out.set(id, v);
  }
  return out;
}

/**
 * Tuned on the 45 labelled real photos in test-data/card-photos (labels.json): right printing in
 * the top 3 for 42, up from 14 on text alone. Wide plateau — W 300–800 with P scaled alongside.
 */
export const LOOK_WEIGHTS = {
  /** Text points one unit of cosine similarity is worth. */
  perCosine: 500,
  /** Most text-matched printings to compare by look. */
  maxCompared: 60,
  /** Closest-looking printings from the whole catalogue added to the running. */
  nearest: 10,
  /** Text points below the best text match that a look-only printing starts from. */
  lookOnlyPenalty: 40,
};

/**
 * Re-orders text-ranked printings by how much each one's art looks like the photo, and adds the
 * closest-looking printings from the whole catalogue — text often reads the “Evolves from” line
 * (Combusken for Blaziken) or drops a suffix, leaving the right card out of the text list.
 * Returns null when the image index isn't available, so callers keep the text order.
 */
export async function rankByLook(
  photoDataUrl: string,
  ranked: PokemonMatchCandidate[],
  weights = LOOK_WEIGHTS,
): Promise<PokemonMatchCandidate[] | null> {
  const contenders = ranked.slice(0, weights.maxCompared);
  const [similarity, near] = await Promise.all([
    contenders.length ? visualSimilarity(photoDataUrl, contenders.map((c) => c.externalId)) : null,
    nearestByLook(photoDataUrl, weights.nearest),
  ]);
  if (!near) return null;

  const best = ranked[0]?.score ?? 0;
  const known = new Set(ranked.map((c) => c.externalId));
  const lookOnly = await candidatesForIds(
    [...near.keys()].filter((id) => !known.has(id)),
    'looks like your photo',
  );
  // Printings missing from the index (newer sets) can't be compared by look. Give them the average
  // look so their text evidence decides — rather than sinking below every look-only guess.
  const looks = [...(similarity?.values() ?? [])];
  const pool = looks.length > 0 ? looks : [...near.values()];
  const neutralLook = pool.reduce((sum, v) => sum + v, 0) / Math.max(pool.length, 1);
  const scored = [
    ...contenders.map((c) => {
      const look = similarity?.get(c.externalId);
      return { c, look: look ?? neutralLook, measured: look !== undefined, text: c.score };
    }),
    ...lookOnly.map((c) => ({ c, look: near.get(c.externalId)!, measured: true, text: best - weights.lookOnlyPenalty })),
  ];
  scored.sort((a, b) => b.text + weights.perCosine * b.look - (a.text + weights.perCosine * a.look));

  const compared = new Set(scored.map((s) => s.c.externalId));
  return [
    ...scored.map(({ c, look, measured }) => ({
      ...c,
      reason: [c.reason, measured ? `look ${look.toFixed(2)}` : 'not in image index'].filter(Boolean).join(' · '),
    })),
    // Past the comparison cap: keep their text order
    ...ranked.filter((c) => !compared.has(c.externalId)),
  ];
}

/**
 * Cosine similarity between the photo and each printing's catalogue art. Printings missing from
 * the index are left out. Returns null when visual ranking isn't available at all.
 */
export async function visualSimilarity(photoDataUrl: string, ids: string[]): Promise<Map<string, number> | null> {
  if (indexMissing() || ids.length === 0) return null;
  const [vectors, photo] = await Promise.all([fetchVectors(ids), embedPhoto(photoDataUrl)]);
  if (vectors.size === 0) return null;
  const scores = new Map<string, number>();
  for (const [id, v] of vectors) {
    let dot = 0;
    for (let d = 0; d < v.length; d++) dot += v[d] * photo[d];
    scores.set(id, dot);
  }
  return scores;
}
