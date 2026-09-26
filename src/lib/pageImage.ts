import type { ImagePoint } from '../types';

export async function normalizeOrientedImage(file: File): Promise<{
  dataUrl: string;
  width: number;
  height: number;
}> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Could not read that image.');
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.92),
    width: canvas.width,
    height: canvas.height,
  };
}

function solveLinear(matrix: number[][], values: number[]): number[] {
  const n = values.length;
  const rows = matrix.map((row, index) => [...row, values[index]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    }
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const divisor = rows[col][col] || 1e-12;
    for (let cell = col; cell <= n; cell++) rows[col][cell] /= divisor;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = rows[row][col];
      for (let cell = col; cell <= n; cell++) rows[row][cell] -= factor * rows[col][cell];
    }
  }
  return rows.map((row) => row[n]);
}

function homography(from: ImagePoint[], to: ImagePoint[]): number[] {
  const matrix: number[][] = [];
  const values: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    values.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    values.push(v);
  }
  return [...solveLinear(matrix, values), 1];
}

function applyHomography(h: number[], x: number, y: number): ImagePoint {
  const w = h[6] * x + h[7] * y + h[8];
  return {
    x: (h[0] * x + h[1] * y + h[2]) / w,
    y: (h[3] * x + h[4] * y + h[5]) / w,
  };
}

function sampleBilinear(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): [number, number, number, number] {
  if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) return [0, 0, 0, 0];
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const dx = x - x0;
  const dy = y - y0;
  const i00 = (y0 * width + x0) * 4;
  const i10 = i00 + 4;
  const i01 = i00 + width * 4;
  const i11 = i01 + 4;
  const pixel: [number, number, number, number] = [0, 0, 0, 0];
  for (let channel = 0; channel < 4; channel++) {
    const top = data[i00 + channel] * (1 - dx) + data[i10 + channel] * dx;
    const bottom = data[i01 + channel] * (1 - dx) + data[i11 + channel] * dx;
    pixel[channel] = top * (1 - dy) + bottom * dy;
  }
  return pixel;
}

function edgeLength(a: ImagePoint, b: ImagePoint) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function expandAxisAlignedCorners(
  corners: [ImagePoint, ImagePoint, ImagePoint, ImagePoint],
  pad: number,
  imageWidth: number,
  imageHeight: number,
): [ImagePoint, ImagePoint, ImagePoint, ImagePoint] {
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const minX = Math.max(0, Math.min(...xs) - pad);
  const maxX = Math.min(imageWidth, Math.max(...xs) + pad);
  const minY = Math.max(0, Math.min(...ys) - pad);
  const maxY = Math.min(imageHeight, Math.max(...ys) + pad);
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

export async function straightenCard(
  source: HTMLImageElement,
  corners: [ImagePoint, ImagePoint, ImagePoint, ImagePoint],
): Promise<string> {
  const [tl, tr, br, bl] = corners;
  const width = Math.max(1, Math.round((edgeLength(tl, tr) + edgeLength(bl, br)) / 2));
  const height = Math.max(1, Math.round((edgeLength(tl, bl) + edgeLength(tr, br)) / 2));
  const scale = Math.min(1, 640 / width, 880 / height);
  const outW = Math.max(1, Math.round(width * scale));
  const outH = Math.max(1, Math.round(height * scale));

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = source.naturalWidth;
  srcCanvas.height = source.naturalHeight;
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
  if (!srcCtx) throw new Error('Could not crop that card.');
  srcCtx.drawImage(source, 0, 0);
  const src = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);

  const dest = [
    { x: 0, y: 0 },
    { x: outW - 1, y: 0 },
    { x: outW - 1, y: outH - 1 },
    { x: 0, y: outH - 1 },
  ];
  const map = homography(dest, [tl, tr, br, bl]);
  const output = new ImageData(outW, outH);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const srcPoint = applyHomography(map, x, y);
      const pixel = sampleBilinear(src.data, srcCanvas.width, srcCanvas.height, srcPoint.x, srcPoint.y);
      const offset = (y * outW + x) * 4;
      output.data[offset] = pixel[0];
      output.data[offset + 1] = pixel[1];
      output.data[offset + 2] = pixel[2];
      output.data[offset + 3] = pixel[3] || 255;
    }
  }
  const outCanvas = document.createElement('canvas');
  outCanvas.width = outW;
  outCanvas.height = outH;
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) throw new Error('Could not crop that card.');
  outCtx.putImageData(output, 0, 0);
  return outCanvas.toDataURL('image/jpeg', 0.86);
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not read that image.'));
    image.src = src;
  });
}
