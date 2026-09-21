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
          <span className="rarity">{card.rarity}</span>
          <div className="meta">
            <strong>{card.name}</strong>
            <span>
              {card.set} · #{card.number}
            </span>
          </div>
        </>
      )}
      {hasArt && (
        <div className="meta-bar">
          <strong>{card.name}</strong>
          <span>
            {card.set} #{card.number}
          </span>
        </div>
      )}
    </div>
  );
}
