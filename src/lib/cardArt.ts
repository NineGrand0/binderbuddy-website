import type { CSSProperties } from 'react';
import type { Card } from '../types';
import { cardImageSrc } from './cardImage';

export function cardArtSrc(card: Card): string | undefined {
  return cardImageSrc(card.imageUrl, card.externalId) || card.imageDataUrl;
}

export function cardArtStyle(card: Card): CSSProperties | undefined {
  const src = cardArtSrc(card);
  if (!src) return undefined;
  return {
    backgroundImage: `url(${src})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  };
}
