import type { DetectResult, PageDetector } from './types';

interface RoboflowPrediction {
  x: number;
  y: number;
  width: number;
  height: number;
}

function boxFromPrediction(prediction: RoboflowPrediction): DetectResult['boxes'][number] {
  const left = prediction.x - prediction.width / 2;
  const top = prediction.y - prediction.height / 2;
  const right = prediction.x + prediction.width / 2;
  const bottom = prediction.y + prediction.height / 2;
  return {
    corners: [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    ],
  };
}

export const roboflowDetector: PageDetector = {
  id: 'roboflow',
  async detect(image) {
    const response = await fetch('/api/detect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: image.dataUrl }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      predictions?: RoboflowPrediction[];
      note?: string;
    };
    if (!response.ok) {
      throw new Error(body.error || 'Card detection failed.');
    }
    const predictions = body.predictions ?? [];
    return {
      boxes: predictions.map(boxFromPrediction),
      note:
        body.note ||
        `Binder Card Edges found ${predictions.length} card${predictions.length === 1 ? '' : 's'}.`,
    };
  },
};
