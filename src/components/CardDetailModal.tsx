import type { CSSProperties } from 'react';
import { Eraser, X } from 'lucide-react';
import type { Card } from '../types';
import { cardArtStyle } from '../lib/cardArt';

interface Props {
  card: Card;
  pageLabel?: string;
  readOnly?: boolean;
  onClose: () => void;
  onSelectPocket?: () => void;
  onClearPocket?: () => void;
}

export function CardDetailModal({
  card,
  pageLabel,
  readOnly = false,
  onClose,
  onSelectPocket,
  onClearPocket,
}: Props) {
  const hasArt = Boolean(card.imageUrl || card.imageDataUrl);
  const added = new Date(card.addedAt);
  const addedLabel = Number.isNaN(added.getTime())
    ? null
    : added.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

  return (
    <div
      className="card-detail-modal"
      role="dialog"
      aria-modal
      aria-label={`${card.name} details`}
      onClick={onClose}
    >
      <div className="card-detail-panel" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="card-detail-close btn btn-ghost" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>

        <div
          className={`card-detail-art ${hasArt ? 'has-art' : ''}`}
          style={{ '--hue': card.imageHue } as CSSProperties}
        >
          <div className="art" style={cardArtStyle(card)} />
          {!hasArt && <span className="card-detail-fallback">{card.name}</span>}
        </div>

        <div className="card-detail-body">
          <p className="card-detail-game muted">{card.game}</p>
          <h2>{card.name}</h2>
          <dl className="card-detail-meta">
            <div>
              <dt>Set</dt>
              <dd>{card.set}</dd>
            </div>
            <div>
              <dt>Number</dt>
              <dd>#{card.number}</dd>
            </div>
            <div>
              <dt>Rarity</dt>
              <dd className="card-detail-rarity">{card.rarity}</dd>
            </div>
            {pageLabel && (
              <div>
                <dt>Location</dt>
                <dd>{pageLabel}</dd>
              </div>
            )}
            {addedLabel && (
              <div>
                <dt>Added</dt>
                <dd>{addedLabel}</dd>
              </div>
            )}
          </dl>

          {!readOnly && (onSelectPocket || onClearPocket) && (
            <div className="card-detail-actions">
              {onSelectPocket && (
                <button type="button" className="btn btn-secondary" onClick={onSelectPocket}>
                  Select pocket
                </button>
              )}
              {onClearPocket && (
                <button type="button" className="btn btn-ghost" onClick={onClearPocket}>
                  <Eraser size={16} /> Clear pocket
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
