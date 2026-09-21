import type { CSSProperties } from 'react';
import type { Card } from '../types';

export function cardArtStyle(card: Card): CSSProperties | undefined {
  const src = card.imageUrl || card.imageDataUrl;
  if (!src) return undefined;
  return {
    backgroundImage: `url(${src})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  };
}
