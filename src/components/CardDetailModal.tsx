import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Eraser, X } from 'lucide-react';
import type { Card } from '../types';
import { cardArtStyle } from '../lib/cardArt';

const LENS_SIZE = 156;
const ZOOM = 2.6;

type Lens = {
  x: number;
  y: number;
  bgW: number;
  bgH: number;
  bgX: number;
  bgY: number;
};

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
  const artSrc = card.imageUrl || card.imageDataUrl;
  const hasArt = Boolean(artSrc);
  const artRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [lens, setLens] = useState<Lens | null>(null);
  const added = new Date(card.addedAt);
  const addedLabel = Number.isNaN(added.getTime())
    ? null
    : added.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

  useEffect(() => {
    setLens(null);
    setNatural(null);
    if (!artSrc) return;
    const image = new Image();
    image.onload = () => setNatural({ w: image.naturalWidth, h: image.naturalHeight });
    image.src = artSrc;
  }, [artSrc]);

  function updateLens(event: PointerEvent<HTMLDivElement>) {
    const art = artRef.current;
    if (!art || !artSrc) return;
    const rect = art.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
      setLens(null);
      return;
    }

    let displayW = rect.width;
    let displayH = rect.height;
    let originX = 0;
    let originY = 0;
    if (natural && natural.w > 0 && natural.h > 0) {
      const base = Math.max(rect.width / natural.w, rect.height / natural.h);
      displayW = natural.w * base;
      displayH = natural.h * base;
      originX = (rect.width - displayW) / 2;
      originY = (rect.height - displayH) / 2;
    }

    setLens({
      x: event.clientX,
      y: event.clientY,
      bgW: displayW * ZOOM,
      bgH: displayH * ZOOM,
      bgX: LENS_SIZE / 2 - (x - originX) * ZOOM,
      bgY: LENS_SIZE / 2 - (y - originY) * ZOOM,
    });
  }

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
          ref={artRef}
          className={`card-detail-art ${hasArt ? 'has-art' : ''} ${lens ? 'is-magnifying' : ''}`}
          style={{ '--hue': card.imageHue } as CSSProperties}
          onPointerMove={hasArt ? updateLens : undefined}
          onPointerLeave={hasArt ? () => setLens(null) : undefined}
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
      {lens &&
        artSrc &&
        createPortal(
          <div
            className="card-detail-lens"
            aria-hidden
            style={{
              left: lens.x,
              top: lens.y,
              backgroundImage: `url(${artSrc})`,
              backgroundSize: `${lens.bgW}px ${lens.bgH}px`,
              backgroundPosition: `${lens.bgX}px ${lens.bgY}px`,
            }}
          />,
          document.body,
        )}
    </div>
  );
}
