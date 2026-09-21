import setSymbolDb from '../data/setSymbolDb.json';

export type SetSymbolEntry = {
  id: string;
  name: string;
  series: string;
  releaseDate: string;
  printedTotal?: number | null;
  total?: number | null;
  symbolUrl: string;
  hash: string;
};

export type SetSymbolMatch = {
  id: string;
  name: string;
  series: string;
  confidence: number;
  distance: number;
};

const HASH_SIZE = setSymbolDb.hashSize as number;
const CATALOG = setSymbolDb.sets as SetSymbolEntry[];

/** Hamming distance between two equal-length hex hashes. */
export function hashDistance(a: string, b: string): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    dist += (x & 1) + ((x >> 1) & 1) + ((x >> 2) & 1) + ((x >> 3) & 1);
  }
  return dist;
}

function fingerprintImageData(data: Uint8ClampedArray, width: number, height: number): string {
  const cells = HASH_SIZE * HASH_SIZE;
  const gray = new Float32Array(cells);
  const cellW = width / HASH_SIZE;
  const cellH = height / HASH_SIZE;

  for (let gy = 0; gy < HASH_SIZE; gy++) {
    for (let gx = 0; gx < HASH_SIZE; gx++) {
      let sum = 0;
      let count = 0;
      const x0 = Math.floor(gx * cellW);
      const y0 = Math.floor(gy * cellH);
      const x1 = Math.max(x0 + 1, Math.floor((gx + 1) * cellW));
      const y1 = Math.max(y0 + 1, Math.floor((gy + 1) * cellH));
      for (let y = y0; y < y1 && y < height; y++) {
        for (let x = x0; x < x1 && x < width; x++) {
          const i = (y * width + x) * 4;
          sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          count++;
        }
      }
      gray[gy * HASH_SIZE + gx] = count ? sum / count : 0;
    }
  }

  let mean = 0;
  for (let i = 0; i < cells; i++) mean += gray[i];
  mean /= cells;

  let hex = '';
  for (let i = 0; i < cells; i += 4) {
    let nibble = 0;
    for (let b = 0; b < 4 && i + b < cells; b++) {
      if (gray[i + b] >= mean) nibble |= 1 << (3 - b);
    }
    hex += nibble.toString(16);
  }
  return hex;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image for set-symbol match.'));
    img.src = src;
  });
}

type CropRect = { x: number; y: number; w: number; h: number };

/** Typical set-symbol placements (bottom-left, beside the collector number). */
function symbolCropCandidates(w: number, h: number): CropRect[] {
  return [
    { x: w * 0.02, y: h * 0.86, w: w * 0.16, h: h * 0.1 },
    { x: w * 0.04, y: h * 0.88, w: w * 0.14, h: h * 0.08 },
    { x: w * 0.02, y: h * 0.84, w: w * 0.2, h: h * 0.12 },
    { x: w * 0.06, y: h * 0.87, w: w * 0.14, h: h * 0.09 },
    { x: w * 0.02, y: h * 0.9, w: w * 0.18, h: h * 0.07 },
    { x: w * 0.02, y: h * 0.85, w: w * 0.24, h: h * 0.11 },
  ];
}

function cropFingerprint(img: HTMLImageElement, crop: CropRect): string | null {
  const x = Math.max(0, Math.floor(crop.x));
  const y = Math.max(0, Math.floor(crop.y));
  const w = Math.max(1, Math.floor(crop.w));
  const h = Math.max(1, Math.floor(crop.h));
  if (x + w > img.naturalWidth + 2 || y + h > img.naturalHeight + 2) return null;

  const size = Math.max(48, Math.round(Math.max(w, h) * 2));
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(img, x, y, w, h, 0, 0, size, size);

  const imageData = ctx.getImageData(0, 0, size, size);
  const d = imageData.data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    min = Math.min(min, g);
    max = Math.max(max, g);
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = ((g - min) / range) * 255;
    d[i] = d[i + 1] = d[i + 2] = v;
  }

  return fingerprintImageData(d, size, size);
}

function bestMatchForHash(
  hash: string,
  catalog: SetSymbolEntry[],
): { entry: SetSymbolEntry; distance: number } | null {
  let best: { entry: SetSymbolEntry; distance: number } | null = null;
  for (const entry of catalog) {
    const distance = hashDistance(hash, entry.hash);
    if (!best || distance < best.distance) best = { entry, distance };
  }
  return best;
}

function catalogForOptions(options?: { setIds?: string[]; cardCount?: number }): SetSymbolEntry[] {
  let catalog = CATALOG;
  if (options?.setIds?.length) {
    const allow = new Set(options.setIds);
    catalog = catalog.filter((s) => allow.has(s.id));
  } else if (options?.cardCount != null) {
    const n = options.cardCount;
    const narrowed = catalog.filter((s) => s.printedTotal === n || s.total === n);
    if (narrowed.length > 0) catalog = narrowed;
  }
  return catalog;
}

/**
 * Match the set symbol printed on a card photo against the fingerprint database.
 * Pass cardCount (collector-number denominator) to narrow candidates — e.g. 185 → Vivid Voltage.
 */
export async function matchSetSymbolFromImage(
  imageUrl: string,
  options?: { setIds?: string[]; cardCount?: number },
): Promise<SetSymbolMatch | null> {
  const img = await loadImageElement(imageUrl);
  const catalog = catalogForOptions(options);
  const maxBits = HASH_SIZE * HASH_SIZE;
  // Tighter when we already narrowed by card count
  const maxDistance = Math.floor(maxBits * (options?.cardCount || options?.setIds ? 0.3 : 0.22));

  let best: { entry: SetSymbolEntry; distance: number } | null = null;

  for (const crop of symbolCropCandidates(img.naturalWidth, img.naturalHeight)) {
    const hash = cropFingerprint(img, crop);
    if (!hash) continue;
    const hit = bestMatchForHash(hash, catalog);
    if (!hit) continue;
    if (!best || hit.distance < best.distance) best = hit;
  }

  if (!best || best.distance > maxDistance) return null;

  const confidence = Math.max(0, 1 - best.distance / maxBits);
  return {
    id: best.entry.id,
    name: best.entry.name,
    series: best.entry.series,
    confidence,
    distance: best.distance,
  };
}

/** Full catalog (id + name + symbol URL) for UI / debugging. */
export function listSetSymbolCatalog(): SetSymbolEntry[] {
  return CATALOG;
}

export function getSetSymbolCount() {
  return CATALOG.length;
}
