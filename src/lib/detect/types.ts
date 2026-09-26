import type { ImagePoint } from '../../types';

export interface DetectedBox {
  corners: [ImagePoint, ImagePoint, ImagePoint, ImagePoint];
}

export interface DetectResult {
  boxes: DetectedBox[];
  note: string;
}

export interface PageDetector {
  id: 'demo-grid' | 'roboflow';
  detect(image: { width: number; height: number; dataUrl: string }): Promise<DetectResult>;
}
