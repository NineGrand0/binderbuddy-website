import { createWorker, PSM, type Worker } from 'tesseract.js';
import type { Card } from '../types';
import {
  collectorNumberDenom,
  extractCollectorNumber,
  inferRarityFromName,
  parseCardDetailsFromOcr,
  type ParsedCardDetails,
} from './parseCardOcr';
import { matchSetSymbolFromImage } from './setSymbolMatch';
import { makeId } from './ids';

export interface DetectResult {
  cards: Card[];
  ocrText: string;
  notes: string[];
  details?: ParsedCardDetails;
  /** Pocket index for each card when a binder page was split into crops. */
  pocketSlots?: number[];
}

export type PageSlice = { x: number; y: number; w: number; h: number };

let workerPromise: Promise<Worker> | null = null;
/** Serialize recognizes — one worker cannot safely run concurrent setParameters/recognize. */
let ocrChain: Promise<unknown> = Promise.resolve();
/** Bumped on worker reset so in-flight queued jobs abort cleanly. */
let ocrGeneration = 0;

const OCR_PASS_TIMEOUT_MS = 7_000;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker('eng', 1, {
        logger: () => undefined,
      });
      await worker.setParameters({
        preserve_interword_spaces: '1',
        tessedit_pageseg_mode: PSM.AUTO,
      });
      return worker;
    })();
  }
  return workerPromise;
}

/** Kill a stuck Tesseract worker and clear the OCR queue so later cards can load. */
export async function resetOcrWorker() {
  ocrGeneration += 1;
  const pending = workerPromise;
  workerPromise = null;
  ocrChain = Promise.resolve();
  if (!pending) return;
  try {
    const worker = await pending;
    await worker.terminate();
  } catch {
    /* ignore terminate races */
  }
}

function enqueueOcr<T>(fn: () => Promise<T>): Promise<T> {
  const gen = ocrGeneration;
  const run = ocrChain.then(
    async () => {
      if (gen !== ocrGeneration) throw new Error('OCR_CANCELLED');
      return fn();
    },
    async () => {
      if (gen !== ocrGeneration) throw new Error('OCR_CANCELLED');
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
    img.onerror = () => reject(new Error('Could not load image for OCR.'));
    img.src = src;
  });
}

type PreprocessMode = 'contrast' | 'invert' | 'binary' | 'raw';

const TITLE_WHITELIST =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 '&-.";
const FOOTER_WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/ ';

function otsuThreshold(gray: Float32Array): number {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[Math.round(gray[i])] += 1;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestThresh = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      bestThresh = t;
    }
  }
  return bestThresh;
}

function makeCanvas(
  img: HTMLImageElement,
  crop: { x: number; y: number; w: number; h: number } | undefined,
  scaleUp: number,
  mode: PreprocessMode,
): HTMLCanvasElement {
  const x = crop?.x ?? 0;
  const y = crop?.y ?? 0;
  const w = crop?.w ?? img.naturalWidth;
  const h = crop?.h ?? img.naturalHeight;

  const targetW = Math.min(1280, Math.max(720, Math.round(w * scaleUp)));
  const scale = targetW / w;
  const targetH = Math.max(1, Math.round(h * scale));
  const pad = Math.max(16, Math.round(Math.min(targetW, targetH) * 0.05));

  const canvas = document.createElement('canvas');
  canvas.width = targetW + pad * 2;
  canvas.height = targetH + pad * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unsupported.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, x, y, w, h, pad, pad, targetW, targetH);

  if (mode === 'raw') return canvas;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  let min = 255;
  let max = 0;
  const gray = new Float32Array(data.length / 4);

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray[p] = g;
    min = Math.min(min, g);
    max = Math.max(max, g);
  }
  const range = Math.max(1, max - min);
  const binaryCut = mode === 'binary' ? otsuThreshold(gray) : 140;

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    let v: number;
    if (mode === 'binary') {
      v = gray[p] > binaryCut ? 255 : 0;
    } else {
      v = ((gray[p] - min) / range) * 255;
      v = Math.min(255, Math.max(0, (v - 128) * 1.55 + 128));
      if (mode === 'invert') v = 255 - v;
    }
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

type OcrHit = { text: string; confidence: number };

async function ocrCanvas(
  canvas: HTMLCanvasElement,
  options?: { psm?: PSM; whitelist?: string },
): Promise<OcrHit> {
  return enqueueOcr(async () => {
    const gen = ocrGeneration;
    try {
      const worker = await getWorker();
      if (gen !== ocrGeneration) return { text: '', confidence: 0 };
      const params: Record<string, string> = {
        tessedit_pageseg_mode: String(options?.psm ?? PSM.AUTO),
        // Always set an explicit whitelist — empty string can fail to clear a prior one.
        tessedit_char_whitelist:
          options?.whitelist ??
          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/ &'-.@",
        preserve_interword_spaces: '1',
      };
      await worker.setParameters(params);

      let finished = false;
      const recognize = worker.recognize(canvas).then(({ data: { text, confidence } }) => {
        finished = true;
        return {
          text: text.replace(/\r/g, '\n').trim(),
          confidence: typeof confidence === 'number' && Number.isFinite(confidence) ? confidence : 0,
        };
      });

      const hit = await Promise.race([
        recognize,
        new Promise<null>((resolve) => {
          window.setTimeout(() => resolve(null), OCR_PASS_TIMEOUT_MS);
        }),
      ]);

      if (gen !== ocrGeneration) return { text: '', confidence: 0 };
      if (hit) return hit;
      if (!finished) await resetOcrWorker();
      return { text: '', confidence: 0 };
    } catch {
      return { text: '', confidence: 0 };
    }
  });
}

/** Prefer high-confidence reads; keep a few unique alternates for parsing. */
function mergeOcrHits(hits: OcrHit[], limit = 4): string {
  const usable = hits
    .map((hit) => ({
      ...hit,
      text: hit.text.replace(/\s+/g, ' ').trim(),
    }))
    .filter((hit) => hit.text.replace(/\s+/g, '').length >= 2)
    .sort((a, b) => b.confidence - a.confidence || b.text.length - a.text.length);

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const hit of usable) {
    const key = hit.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(hit.text);
    if (unique.length >= limit) break;
  }
  return unique.join('\n');
}

export function cardFromDetails(
  details: ParsedCardDetails & { name: string },
  imageDataUrl?: string,
): Card {
  const rarity = inferRarityFromName(details.name, details.rarity);
  return {
    id: makeId('scan'),
    name: details.name,
    set: details.set?.trim() || 'Scanned',
    number: details.number?.trim() || '—',
    rarity,
    game: 'Pokémon TCG',
    imageHue: Math.floor(Math.random() * 360),
    imageDataUrl,
    addedAt: new Date().toISOString(),
  };
}

export function cardFromPokemonName(name: string, imageDataUrl?: string): Card {
  return cardFromDetails({ name }, imageDataUrl);
}

function detailsNote(details: ParsedCardDetails): string {
  const bits: string[] = [];
  if (details.name) bits.push(`name ${details.name}`);
  if (details.set) bits.push(`set ${details.set}`);
  if (details.number) bits.push(`#${details.number}`);
  if (details.rarity) bits.push(details.rarity);
  return bits.length ? `Filled from card text: ${bits.join(' · ')}.` : '';
}

type CardOcrParts = {
  titleText: string;
  footerText: string;
  fullText: string;
};

async function readCardText(img: HTMLImageElement): Promise<CardOcrParts> {
  const w = img.naturalWidth;
  const h = img.naturalHeight;

  const titleCrops = [
    { x: w * 0.04, y: h * 0.02, w: w * 0.8, h: h * 0.14 },
    { x: w * 0.04, y: h * 0.04, w: w * 0.72, h: h * 0.12 },
  ];
  const footerCrops = [
    { x: w * 0.02, y: h * 0.86, w: w * 0.52, h: h * 0.12 },
    { x: w * 0.02, y: h * 0.88, w: w * 0.42, h: h * 0.1 },
  ];

  // Adaptive passes — stop early once we have a confident title / collector number.
  // (Serialized worker: dozens of fixed jobs felt like a hang on foil cards.)
  const titleAttempts: Array<{ crop: (typeof titleCrops)[0]; mode: PreprocessMode; scale: number }> = [
    { crop: titleCrops[0], mode: 'contrast', scale: 3.4 },
    { crop: titleCrops[0], mode: 'invert', scale: 3.4 },
    { crop: titleCrops[0], mode: 'binary', scale: 3.6 },
    { crop: titleCrops[1], mode: 'contrast', scale: 3.2 },
    { crop: titleCrops[1], mode: 'invert', scale: 3.2 },
  ];
  const footerAttempts: Array<{
    crop: (typeof footerCrops)[0];
    mode: PreprocessMode;
    scale: number;
    psm: PSM;
  }> = [
    { crop: footerCrops[0], mode: 'contrast', scale: 4.4, psm: PSM.SINGLE_LINE },
    { crop: footerCrops[0], mode: 'binary', scale: 4.6, psm: PSM.SINGLE_LINE },
    { crop: footerCrops[0], mode: 'invert', scale: 4.4, psm: PSM.SINGLE_LINE },
    { crop: footerCrops[1], mode: 'contrast', scale: 4.2, psm: PSM.SINGLE_LINE },
    { crop: footerCrops[0], mode: 'contrast', scale: 4.0, psm: PSM.SPARSE_TEXT },
  ];

  const titleHits: OcrHit[] = [];
  for (const attempt of titleAttempts) {
    const hit = await ocrCanvas(makeCanvas(img, attempt.crop, attempt.scale, attempt.mode), {
      psm: PSM.SINGLE_LINE,
      whitelist: TITLE_WHITELIST,
    });
    titleHits.push(hit);
    const soFar = mergeOcrHits(titleHits, 3);
    // Confident line, or enough variety that a species name can parse
    if (hit.confidence >= 62 && /[a-zA-Z]{4,}/.test(hit.text)) break;
    if (titleHits.length >= 3 && /[a-zA-Z]{4,}/.test(soFar)) break;
  }

  const footerHits: OcrHit[] = [];
  for (const attempt of footerAttempts) {
    const hit = await ocrCanvas(makeCanvas(img, attempt.crop, attempt.scale, attempt.mode), {
      psm: attempt.psm,
      whitelist: FOOTER_WHITELIST,
    });
    footerHits.push(hit);
    const soFar = mergeOcrHits(footerHits, 4);
    if (extractCollectorNumber(soFar)) break;
    if (hit.confidence >= 70 && /\d{2,}/.test(hit.text)) break;
  }

  let titleText = mergeOcrHits(titleHits, 4);
  let footerText = mergeOcrHits(footerHits, 5);
  let fullParts: OcrHit[] = [];

  // Full-card OCR only as a fallback when title/footer both look empty
  if (
    titleText.replace(/\s+/g, '').length < 4 ||
    (!extractCollectorNumber(footerText) && footerText.replace(/\s+/g, '').length < 3)
  ) {
    fullParts = [
      await ocrCanvas(makeCanvas(img, undefined, 1.6, 'contrast'), { psm: PSM.AUTO }),
    ];
    if (!titleText) titleText = mergeOcrHits(fullParts, 2);
    if (!footerText) footerText = mergeOcrHits(fullParts, 2);
  }

  const fullText = mergeOcrHits([...titleHits, ...footerHits, ...fullParts], 8);
  return { titleText, footerText, fullText };
}

export async function detectSingleCard(imageUrl: string): Promise<DetectResult> {
  const notes: string[] = [];
  const img = await loadImage(imageUrl);

  notes.push('Reading name, set symbol, number, and rarity from the card…');

  // OCR first so we can narrow symbol matching with the collector-number size
  const { titleText, footerText, fullText: ocrText } = await readCardText(img);

  if ((!ocrText || ocrText.replace(/\s+/g, '').length < 3)) {
    // Still try symbol alone
    const symbolOnly = await matchSetSymbolFromImage(imageUrl).catch(() => null);
    if (!symbolOnly) {
      notes.push(
        'Couldn’t read text from this photo. Foil names are hard — pick the Pokémon name below to finish adding.',
      );
      return { cards: [], ocrText: ocrText ?? '', notes };
    }
    notes.push(
      `Set symbol matched: ${symbolOnly.name} (${Math.round(symbolOnly.confidence * 100)}% confidence).`,
    );
    const details: ParsedCardDetails = { set: symbolOnly.name };
    notes.push(
      'No Pokémon name found automatically. Choose the name below — set will stay filled.',
    );
    return { cards: [], ocrText: ocrText ?? '', notes, details };
  }

  notes.push(
    `OCR read: “${ocrText.replace(/\s+/g, ' ').trim().slice(0, 160)}${ocrText.length > 160 ? '…' : ''}”`,
  );

  const cardCountHint = collectorNumberDenom(
    extractCollectorNumber(footerText) ?? extractCollectorNumber(ocrText),
  );

  // Graphical set symbol — supporting evidence only (not text OCR).
  // Narrow by denom when available; skip low-confidence matches.
  const symbolMatch = await matchSetSymbolFromImage(imageUrl, {
    cardCount: cardCountHint,
  }).catch(() => null);
  const setFromSymbol =
    symbolMatch && symbolMatch.confidence >= 0.55 ? symbolMatch.name : undefined;

  const details = await parseCardDetailsFromOcr(ocrText, {
    titleText,
    footerText,
    setFromSymbol,
  });

  if (setFromSymbol && details.set === setFromSymbol) {
    notes.push(
      `Set symbol matched: ${setFromSymbol} (${Math.round((symbolMatch?.confidence ?? 0) * 100)}% confidence).`,
    );
  } else if (details.identifiers?.denom) {
    notes.push(
      `Collector size /${details.identifiers.denom} used as supporting set evidence (not a unique set id).`,
    );
  }

  if (!details.name) {
    notes.push(
      'No Pokémon name found automatically. Choose the name below — set/number/rarity will still fill from any text we read.',
    );
    return { cards: [], ocrText: ocrText ?? '', notes, details };
  }

  const filled = detailsNote(details);
  if (filled) notes.push(filled);

  return {
    cards: [cardFromDetails({ ...details, name: details.name })],
    ocrText: ocrText ?? '',
    notes,
    details,
  };
}

function cropCellToDataUrl(
  img: HTMLImageElement,
  crop: { x: number; y: number; w: number; h: number },
): { dataUrl: string; canvas: HTMLCanvasElement } {
  const maxW = 480;
  const scale = Math.min(1, maxW / Math.max(crop.w, 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(crop.w * scale));
  canvas.height = Math.max(1, Math.round(crop.h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unsupported.');
  const sx = Math.max(0, crop.x);
  const sy = Math.max(0, crop.y);
  const ex = Math.min(img.naturalWidth, crop.x + crop.w);
  const ey = Math.min(img.naturalHeight, crop.y + crop.h);
  const sw = ex - sx;
  const sh = ey - sy;
  if (sw > 0 && sh > 0) {
    ctx.drawImage(img, sx, sy, sw, sh, (sx - crop.x) * scale, (sy - crop.y) * scale, sw * scale, sh * scale);
  }
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.82), canvas };
}

export async function detectBinderPage(
  imageUrl: string,
  cols: number,
  rows: number,
  slice: PageSlice,
): Promise<DetectResult> {
  const notes: string[] = [];
  const img = await loadImage(imageUrl);
  const cards: Card[] = [];
  const pocketSlots: number[] = [];
  const ocrChunks: string[] = [];

  const cellW = slice.w / cols;
  const cellH = slice.h / rows;
  let emptyCount = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const slot = r * cols + c;
      const crop = {
        x: slice.x + c * cellW,
        y: slice.y + r * cellH,
        w: cellW,
        h: cellH,
      };
      const onImageW = Math.min(crop.x + crop.w, img.naturalWidth) - Math.max(crop.x, 0);
      const onImageH = Math.min(crop.y + crop.h, img.naturalHeight) - Math.max(crop.y, 0);
      if (onImageW < crop.w * 0.45 || onImageH < crop.h * 0.45) {
        emptyCount += 1;
        continue;
      }
      const { dataUrl } = cropCellToDataUrl(img, crop);
      const nameBand = {
        x: crop.x + crop.w * 0.04,
        y: crop.y + crop.h * 0.02,
        w: crop.w * 0.78,
        h: crop.h * 0.16,
      };
      const nameHits = await Promise.all([
        ocrCanvas(makeCanvas(img, nameBand, 3.0, 'contrast'), {
          psm: PSM.SINGLE_LINE,
          whitelist: TITLE_WHITELIST,
        }),
        ocrCanvas(makeCanvas(img, nameBand, 3.0, 'invert'), {
          psm: PSM.SINGLE_LINE,
          whitelist: TITLE_WHITELIST,
        }),
        ocrCanvas(makeCanvas(img, nameBand, 3.2, 'binary'), {
          psm: PSM.SINGLE_LINE,
          whitelist: TITLE_WHITELIST,
        }),
      ]);
      const text = mergeOcrHits(nameHits, 2);
      if (text) ocrChunks.push(`[${r + 1},${c + 1}] ${text}`);
      const details = await parseCardDetailsFromOcr(text);
      const name = details.name?.trim() || `Card ${slot + 1}`;
      cards.push(cardFromDetails({ ...details, name }, dataUrl));
      pocketSlots.push(slot);
    }
  }

  const named = cards.filter((card) => !/^Card \d+$/.test(card.name)).length;
  notes.push(
    cards.length
      ? `Sliced ${cards.length} card${cards.length === 1 ? '' : 's'} on the ${cols}×${rows} guides${emptyCount ? ` (${emptyCount} empty pocket${emptyCount === 1 ? '' : 's'} skipped)` : ''}.${named ? ` Read a name on ${named}.` : ' Names that did not read can be edited later.'}`
      : 'Every pocket in that frame looks empty. Drag the photo so the cards sit inside the boxes.',
  );

  return { cards, pocketSlots, ocrText: ocrChunks.join('\n\n'), notes };
}

export async function terminateOcrWorker() {
  if (!workerPromise) return;
  const worker = await workerPromise;
  await worker.terminate();
  workerPromise = null;
}
