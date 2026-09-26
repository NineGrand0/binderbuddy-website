import type { DetectResult, PageDetector } from './types';

export function detectDemoGrid(
  width: number,
  height: number,
  cols = 3,
  rows = 3,
): DetectResult {
  const boxes: DetectResult['boxes'] = [];
  const cellW = width / cols;
  const cellH = height / rows;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * cellW;
      const y = row * cellH;
      boxes.push({
        corners: [
          { x, y },
          { x: x + cellW, y },
          { x: x + cellW, y: y + cellH },
          { x, y: y + cellH },
        ],
      });
    }
  }
  return {
    boxes,
    note: `Demo ${cols}×${rows} grid. This is a fixed layout, not card detection. Remove empty pockets before you save.`,
  };
}

export function createDemoGridDetector(cols = 3, rows = 3): PageDetector {
  return {
    id: 'demo-grid',
    async detect(image) {
      return detectDemoGrid(image.width, image.height, cols, rows);
    },
  };
}
