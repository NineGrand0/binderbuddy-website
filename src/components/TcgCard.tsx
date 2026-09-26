import type { CSSProperties } from 'react';
import type { Card } from '../types';
import { cardArtStyle } from '../lib/cardArt';

export function TcgCard({ card }: { card: Card }) {
  const art = cardArtStyle(card);
  const hasArt = Boolean(card.imageUrl || card.imageDataUrl);

  return (
    <div
      className={`tcg-card ${hasArt ? 'has-art' : ''}`}
      style={{ '--hue': card.imageHue } as CSSProperties}
    >
      <div className="art" style={art} />
      {!hasArt && (
        <>
          {card.rarity && <span className="rarity">{card.rarity}</span>}
          <div className="meta">
            <strong>{card.name || 'Unnamed'}</strong>
            <span>{[card.set, card.number && `#${card.number}`].filter(Boolean).join(' · ')}</span>
          </div>
        </>
      )}
      {hasArt && (
        <div className="meta-bar">
          <strong>{card.name || 'Unnamed'}</strong>
          <span>{[card.set, card.number && `#${card.number}`].filter(Boolean).join(' ')}</span>
        </div>
      )}
    </div>
  );
}
