import { createWorker, PSM, type Worker } from 'tesseract.js';
import type { Card } from '../types';
import { findPokemonNamesInText } from './pokemonNames';
import {
  collectorNumberDenom,
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
}

let workerPromise: Promise<Worker> | null = null;

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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image for OCR.'));
    img.src = src;
  });
}

type PreprocessMode = 'contrast' | 'invert' | 'binary' | 'raw';

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

  const targetW = Math.max(800, Math.round(w * scaleUp));
  const scale = targetW / w;
  const targetH = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unsupported.');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, x, y, w, h, 0, 0, targetW, targetH);

  if (mode === 'raw') return canvas;

  const imageData = ctx.getImageData(0, 0, targetW, targetH);
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

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    let v = ((gray[p] - min) / range) * 255;
    if (mode === 'invert') v = 255 - v;
    if (mode === 'binary') v = v > 140 ? 255 : 0;
    else v = Math.min(255, Math.max(0, (v - 128) * 1.45 + 128));
    data[i] = data[i + 1] = data[i + 2] = v;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

async function ocrCanvas(canvas: HTMLCanvasElement, psm?: PSM): Promise<string> {
  const worker = await getWorker();
  if (psm != null) {
    await worker.setParameters({ tessedit_pageseg_mode: psm });
  }
  const {
    data: { text },
  } = await worker.recognize(canvas);
  return text.replace(/\r/g, '\n').trim();
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

  const nameCrops = [
    { x: w * 0.04, y: h * 0.02, w: w * 0.78, h: h * 0.15 },
    { x: w * 0.04, y: h * 0.02, w: w * 0.92, h: h * 0.22 },
    { x: w * 0.04, y: h * 0.06, w: w * 0.72, h: h * 0.12 },
  ];

  // Symbol + collector number live bottom-left (e.g. ◆ 177/168)
  const bottomCrops = [
    { x: w * 0.02, y: h * 0.86, w: w * 0.48, h: h * 0.12 },
    { x: w * 0.02, y: h * 0.88, w: w * 0.4, h: h * 0.1 },
    { x: w * 0.08, y: h * 0.9, w: w * 0.36, h: h * 0.08 },
    { x: w * 0.02, y: h * 0.84, w: w * 0.55, h: h * 0.14 },
  ];

  const titleJobs: Promise<string>[] = [];
  for (const crop of nameCrops) {
    titleJobs.push(ocrCanvas(makeCanvas(img, crop, 2.8, 'raw'), PSM.SINGLE_LINE));
    titleJobs.push(ocrCanvas(makeCanvas(img, crop, 2.8, 'contrast'), PSM.SINGLE_LINE));
    titleJobs.push(ocrCanvas(makeCanvas(img, crop, 2.8, 'invert'), PSM.SINGLE_LINE));
    titleJobs.push(ocrCanvas(makeCanvas(img, crop, 3.0, 'binary'), PSM.SINGLE_LINE));
  }

  const footerJobs: Promise<string>[] = [];
  for (const crop of bottomCrops) {
    // Higher scale — collector numbers are tiny next to the set symbol
    footerJobs.push(ocrCanvas(makeCanvas(img, crop, 3.4, 'raw'), PSM.SINGLE_LINE));
    footerJobs.push(ocrCanvas(makeCanvas(img, crop, 3.4, 'contrast'), PSM.SINGLE_LINE));
    footerJobs.push(ocrCanvas(makeCanvas(img, crop, 3.4, 'invert'), PSM.SINGLE_LINE));
    footerJobs.push(ocrCanvas(makeCanvas(img, crop, 3.6, 'binary'), PSM.SINGLE_LINE));
    footerJobs.push(ocrCanvas(makeCanvas(img, crop, 3.2, 'contrast'), PSM.SPARSE_TEXT));
  }

  const fullJobs = [
    ocrCanvas(makeCanvas(img, undefined, 1.8, 'contrast'), PSM.AUTO),
    ocrCanvas(makeCanvas(img, undefined, 1.8, 'invert'), PSM.AUTO),
  ];

  const [titleParts, footerParts, fullParts] = await Promise.all([
    Promise.all(titleJobs),
    Promise.all(footerJobs),
    Promise.all(fullJobs),
  ]);

  const uniq = (parts: string[]) => {
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const part of parts) {
      const key = part.replace(/\s+/g, ' ').trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push(part);
    }
    return unique.join('\n');
  };

  const titleText = uniq(titleParts);
  const footerText = uniq(footerParts);
  const fullText = uniq([...titleParts, ...footerParts, ...fullParts]);
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

  const details = await parseCardDetailsFromOcr(ocrText, { titleText, footerText });
  const cardCount = collectorNumberDenom(details.number);

  const symbolMatch = await matchSetSymbolFromImage(imageUrl, {
    cardCount,
  }).catch(() => null);

  // Priority: symbol (esp. when narrowed by number) > number-size inference > OCR set text
  if (symbolMatch) {
    details.set = symbolMatch.name;
    notes.push(
      `Set symbol matched: ${symbolMatch.name} (${Math.round(symbolMatch.confidence * 100)}% confidence).`,
    );
  } else if (details.set && cardCount) {
    notes.push(`Set inferred from card number size (/${cardCount}): ${details.set}.`);
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

export async function detectBinderPage(
  imageUrl: string,
  cols: number,
  rows: number,
): Promise<DetectResult> {
  const notes: string[] = [];
  const img = await loadImage(imageUrl);
  const cards: Card[] = [];
  const seen = new Set<string>();
  const ocrChunks: string[] = [];

  const fullText = await ocrCanvas(makeCanvas(img, undefined, 1.8, 'contrast'), PSM.AUTO);
  ocrChunks.push(fullText);

  const padX = img.naturalWidth * 0.03;
  const padY = img.naturalHeight * 0.03;
  const usableW = img.naturalWidth - padX * 2;
  const usableH = img.naturalHeight - padY * 2;
  const cellW = usableW / cols;
  const cellH = usableH / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const crop = {
        x: padX + c * cellW + cellW * 0.06,
        y: padY + r * cellH + cellH * 0.05,
        w: cellW * 0.88,
        h: cellH * 0.55,
      };
      const text = (
        await Promise.all([
          ocrCanvas(makeCanvas(img, crop, 2.4, 'raw'), PSM.SPARSE_TEXT),
          ocrCanvas(makeCanvas(img, crop, 2.4, 'invert'), PSM.SINGLE_LINE),
          ocrCanvas(makeCanvas(img, crop, 2.4, 'contrast'), PSM.SPARSE_TEXT),
        ])
      ).join('\n');
      if (text) ocrChunks.push(`[${r + 1},${c + 1}] ${text}`);

      const details = await parseCardDetailsFromOcr(text);
      if (!details.name) continue;
      const key = details.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      cards.push(cardFromDetails({ ...details, name: details.name }));
    }
  }

  if (cards.length === 0) {
    notes.push('Grid OCR found nothing — checking the full page.');
    const details = await parseCardDetailsFromOcr(fullText);
    const names = await findPokemonNamesInText(fullText);
    for (const name of names) {
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      cards.push(cardFromDetails({ ...details, name }));
    }
  }

  notes.push(
    cards.length
      ? `Found ${cards.length} Pokémon card${cards.length === 1 ? '' : 's'} and filled available details.`
      : 'No Pokémon names found on this page. You can pick a name manually after scanning a single card.',
  );

  return {
    cards,
    ocrText: ocrChunks.join('\n\n'),
    notes,
  };
}

export async function terminateOcrWorker() {
  if (!workerPromise) return;
  const worker = await workerPromise;
  await worker.terminate();
  workerPromise = null;
}
