import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Eraser, Loader2, RefreshCw, X } from 'lucide-react';
import type { Card, CardCondition } from '../types';
import { cardArtStyle } from '../lib/cardArt';
import { formatCardPrice, refreshJustTcgPrices, resolveJustTcgPrice } from '../lib/justtcgClient';
import { useStore } from '../store/Store';

const LENS_W = 234;
const LENS_H = 168;
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
  const { updateCard } = useStore();
  const artSrc = card.imageUrl || card.imageDataUrl;
  const hasArt = Boolean(artSrc);
  const artRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [lens, setLens] = useState<Lens | null>(null);
  const [priceBusy, setPriceBusy] = useState(false);
  const [priceNote, setPriceNote] = useState<string | null>(null);
  const added = new Date(card.addedAt);
  const addedLabel = Number.isNaN(added.getTime())
    ? null
    : added.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

  useEffect(() => {
    setLens(null);
    setNatural(null);
    setPriceNote(null);
    if (!artSrc) return;
    const image = new Image();
    image.onload = () => setNatural({ w: image.naturalWidth, h: image.naturalHeight });
    image.src = artSrc;
  }, [artSrc, card.id]);

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
      bgX: LENS_W / 2 - (x - originX) * ZOOM,
      bgY: LENS_H / 2 - (y - originY) * ZOOM,
    });
  }

  async function refreshPrice() {
    if (priceBusy || readOnly) return;
    if (!card.condition || !card.name?.trim() || !card.set?.trim() || !card.number?.trim()) {
      setPriceNote('Need name, set, number, and condition to look up a price.');
      return;
    }
    setPriceBusy(true);
    setPriceNote(null);
    try {
      if (card.justtcgVariantId) {
        const { results } = await refreshJustTcgPrices({
          items: [{ justtcgVariantId: card.justtcgVariantId, condition: card.condition as CardCondition }],
          force: true,
        });
        const row = results[0];
        if (row?.status === 'priced' && row.price) {
          updateCard(card.id, { price: row.price, priceStatus: 'priced' });
          setPriceNote('Price refreshed.');
        } else {
          updateCard(card.id, { price: null, priceStatus: 'unavailable' });
          setPriceNote(row?.reason || 'Price unavailable');
        }
        return;
      }

      const result = await resolveJustTcgPrice({
        name: card.name,
        set: card.set,
        number: card.number,
        condition: card.condition,
        printing: card.printing,
      });
      if (result.status === 'priced') {
        updateCard(card.id, {
          printing: result.printing,
          justtcgCardId: result.justtcgCardId,
          justtcgVariantId: result.justtcgVariantId,
          price: result.price,
          priceStatus: 'priced',
        });
        setPriceNote('Price refreshed.');
        return;
      }
      if (result.status === 'needs_printing') {
        updateCard(card.id, {
          justtcgCardId: result.justtcgCardId,
          price: null,
          priceStatus: 'unavailable',
        });
        setPriceNote(`Pick an exact printing first: ${result.printings.join(', ')}`);
        return;
      }
      updateCard(card.id, { price: null, priceStatus: 'unavailable' });
      setPriceNote(result.reason || 'Price unavailable');
    } catch (err) {
      setPriceNote(err instanceof Error ? err.message : 'Could not refresh price.');
    } finally {
      setPriceBusy(false);
    }
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
            <div>
              <dt>Condition</dt>
              <dd>{card.condition ?? '—'}</dd>
            </div>
            <div>
              <dt>Price (prototype)</dt>
              <dd>
                {card.priceStatus === 'priced' && card.price
                  ? `${formatCardPrice(card.price)} · ${card.price.source}${
                      card.printing ? ` · ${card.printing}` : ''
                    }`
                  : 'Price unavailable'}
              </dd>
            </div>
            {card.price?.lastRefreshedAt && (
              <div>
                <dt>Price refreshed</dt>
                <dd>{new Date(card.price.lastRefreshedAt).toLocaleString()}</dd>
              </div>
            )}
          </dl>

          {!readOnly && (
            <div className="card-detail-actions">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={priceBusy}
                onClick={() => void refreshPrice()}
              >
                {priceBusy ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
                Refresh price
              </button>
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
          {priceNote && (
            <p className="muted" style={{ margin: '0.75rem 0 0', fontSize: '0.9rem' }}>
              {priceNote}
            </p>
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
