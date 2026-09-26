import { createWorker, PSM, type Worker } from 'tesseract.js';

export type OcrBand = {
  text: string;
  confidence: number;
};

export type CardReadResult = {
  titleText: string;
  /** Attack / ability area text. */
  bodyText: string;
  fullText: string;
  notes: string[];
};

type Region = { x: number; y: number; w: number; h: number };

const TITLE_REGIONS: Region[] = [
  { x: 0.05, y: 0.02, w: 0.78, h: 0.14 },
  { x: 0.06, y: 0.04, w: 0.7, h: 0.12 },
  { x: 0.04, y: 0.03, w: 0.88, h: 0.16 },
];

// Attack / ability names — used to rank printings and to rescue foil-wrecked titles
const MID_REGIONS: Region[] = [
  { x: 0.04, y: 0.46, w: 0.92, h: 0.22 },
  { x: 0.04, y: 0.62, w: 0.92, h: 0.22 },
];

let workerPromise: Promise<Worker> | null = null;
let ocrChain: Promise<unknown> = Promise.resolve();
let generation = 0;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker('eng', 1, { logger: () => undefined });
      await worker.setParameters({ preserve_interword_spaces: '1' });
      return worker;
    })();
  }
  return workerPromise;
}

export async function resetCardReader() {
  generation += 1;
  const pending = workerPromise;
  workerPromise = null;
  ocrChain = Promise.resolve();
  if (!pending) return;
  try {
    await (await pending).terminate();
  } catch {
    /* ignore */
  }
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const gen = generation;
  const run = ocrChain.then(
    async () => {
      if (gen !== generation) throw new Error('OCR_CANCELLED');
      return fn();
    },
    async () => {
      if (gen !== generation) throw new Error('OCR_CANCELLED');
      return fn();
    },
  );
  ocrChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load card image.'));
    img.src = src;
  });
}

type Prep = 'raw' | 'contrast' | 'invert';

function renderRegion(
  img: HTMLImageElement,
  region: Region,
  prep: Prep,
  scale: number,
): HTMLCanvasElement {
  const sx = Math.max(0, Math.floor(region.x * img.naturalWidth));
  const sy = Math.max(0, Math.floor(region.y * img.naturalHeight));
  const sw = Math.max(1, Math.floor(region.w * img.naturalWidth));
  const sh = Math.max(1, Math.floor(region.h * img.naturalHeight));
  const tw = Math.min(1400, Math.max(900, Math.round(sw * scale)));
  const th = Math.max(1, Math.round((sh / sw) * tw));
  const pad = 16;
  const canvas = document.createElement('canvas');
  canvas.width = tw + pad * 2;
  canvas.height = th + pad * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unsupported.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, pad, pad, tw, th);
  if (prep === 'raw') return canvas;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
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
    let v = ((0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] - min) / range) * 255;
    v = Math.min(255, Math.max(0, (v - 128) * 1.35 + 128));
    if (prep === 'invert') v = 255 - v;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

async function recognize(canvas: HTMLCanvasElement, psm: PSM): Promise<OcrBand> {
  return enqueue(async () => {
    const worker = await getWorker();
    await worker.setParameters({
      tessedit_pageseg_mode: psm,
      // Empty whitelist quietly breaks some builds — set a broad allow-list instead.
      tessedit_char_whitelist:
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/ &'-.@",
      preserve_interword_spaces: '1',
    });
    const timed = new Promise<OcrBand>((resolve) => {
      window.setTimeout(() => resolve({ text: '', confidence: 0 }), 6000);
    });
    let done = false;
    const run = worker.recognize(canvas).then(({ data: { text, confidence } }) => {
      done = true;
      return {
        text: text.replace(/\r/g, '\n').trim(),
        confidence: typeof confidence === 'number' ? confidence : 0,
      };
    });
    const hit = await Promise.race([run, timed]);
    if (!done && !hit.text) await resetCardReader();
    return hit;
  });
}

function scoreTitle(text: string, confidence: number): number {
  const t = text.toLowerCase();
  let score = confidence;
  if (/[a-z]{4,}/.test(t)) score += 25;
  if (/\b(gx|ex|vmax|vstar|\bv)\b/.test(t)) score += 20;
  if (/\b(hp|basic|stage|evolves)\b/.test(t)) score += 5;
  // Penalise pure garbage
  if ((t.match(/[^a-z0-9\s]/gi) ?? []).length > t.length * 0.4) score -= 20;
  return score;
}

function mergeBest(bands: OcrBand[], scorer: (t: string, c: number) => number, limit = 4): string {
  const ranked = bands
    .map((b) => ({ ...b, text: b.text.replace(/\s+/g, ' ').trim(), s: scorer(b.text, b.confidence) }))
    .filter((b) => b.text.length >= 2)
    .sort((a, b) => b.s - a.s);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const b of ranked) {
    const key = b.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b.text);
    if (out.length >= limit) break;
  }
  return out.join('\n');
}

/**
 * Read the title and attack/ability bands from a cropped card photo (data URL or http URL).
 */
export async function readCardImage(imageUrl: string): Promise<CardReadResult> {
  const notes: string[] = [];
  const img = await loadImage(imageUrl);
  const titleHits: OcrBand[] = [];
  const bodyHits: OcrBand[] = [];

  const titleJobs: Array<{ region: Region; prep: Prep; scale: number; psm: PSM }> = [];
  for (const region of TITLE_REGIONS.slice(0, 2)) {
    for (const prep of ['raw', 'contrast', 'invert'] as Prep[]) {
      titleJobs.push({ region, prep, scale: 3.2, psm: PSM.SINGLE_LINE });
      titleJobs.push({ region, prep, scale: 3.0, psm: PSM.SPARSE_TEXT });
    }
  }
  // Cap title attempts — stop early once we have a strong name-like hit
  for (const job of titleJobs) {
    const band = await recognize(renderRegion(img, job.region, job.prep, job.scale), job.psm);
    if (band.text) titleHits.push(band);
    if (titleHits.some((h) => scoreTitle(h.text, h.confidence) >= 70 && /[a-z]{5,}/i.test(h.text))) {
      break;
    }
    if (titleHits.length >= 6) break;
  }

  for (const region of MID_REGIONS) {
    for (const prep of ['raw', 'invert'] as Prep[]) {
      const band = await recognize(renderRegion(img, region, prep, 2.6), PSM.SPARSE_TEXT);
      if (band.text) bodyHits.push(band);
    }
  }

  const titleText = mergeBest(titleHits, scoreTitle, 4);
  const bodyText = bodyHits.map((b) => b.text.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  const fullText = [titleText, bodyText].filter(Boolean).join('\n');

  if (!titleText) notes.push('Title band was hard to read (foil glare is common).');

  return {
    titleText,
    bodyText,
    fullText,
    notes,
  };
}
