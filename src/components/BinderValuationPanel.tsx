import { useMemo, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { formatCardPrice, refreshJustTcgPrices, resolveJustTcgPrice } from '../lib/justtcgClient';
import { useStore } from '../store/Store';
import type { Binder, Card, CardCondition } from '../types';

type Props = {
  binder: Binder;
  collection: Card[];
};

export function BinderValuationPanel({ binder, collection }: Props) {
  const { updateCard } = useStore();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const slotted = useMemo(() => {
    const byId = new Map(collection.map((card) => [card.id, card]));
    const cards: Card[] = [];
    for (const page of binder.pages) {
      for (const slot of page.slots) {
        if (!slot) continue;
        const card = byId.get(slot);
        if (card) cards.push(card);
      }
    }
    return cards;
  }, [binder.pages, collection]);

  const priced = slotted.filter((card) => card.priceStatus === 'priced' && card.price);
  const excluded = slotted.length - priced.length;
  const currency = priced[0]?.price?.currency ?? 'USD';
  const total = priced.reduce((sum, card) => sum + (card.price?.amount ?? 0), 0);
  const totalLabel = formatCardPrice({
    amount: total,
    currency,
    source: 'JustTCG',
    lastRefreshedAt: new Date().toISOString(),
  });

  async function onRefresh() {
    setBusy(true);
    setNote(null);
    try {
      const refreshItems: { justtcgVariantId: string; condition: CardCondition }[] = [];
      const seen = new Set<string>();

      for (const card of slotted) {
        if (!card.condition || !card.name?.trim() || !card.set?.trim() || !card.number?.trim()) continue;

        if (!card.justtcgVariantId) {
          try {
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
              if (!seen.has(result.justtcgVariantId)) {
                seen.add(result.justtcgVariantId);
                refreshItems.push({
                  justtcgVariantId: result.justtcgVariantId,
                  condition: card.condition,
                });
              }
            } else {
              updateCard(card.id, { price: null, priceStatus: 'unavailable' });
            }
          } catch {
            updateCard(card.id, { price: null, priceStatus: 'unavailable' });
          }
          continue;
        }

        if (!seen.has(card.justtcgVariantId)) {
          seen.add(card.justtcgVariantId);
          refreshItems.push({
            justtcgVariantId: card.justtcgVariantId,
            condition: card.condition,
          });
        }
      }

      if (refreshItems.length === 0) {
        setNote('No priced JustTCG matches yet for cards in this binder.');
        return;
      }

      const { results } = await refreshJustTcgPrices({ items: refreshItems, force: true });
      const byVariant = new Map(results.map((row) => [row.justtcgVariantId, row]));
      for (const card of slotted) {
        const variantId =
          card.justtcgVariantId ||
          refreshItems.find((item) => item.condition === card.condition)?.justtcgVariantId;
        // Prefer the card's own id; for newly linked cards updateCard already set price.
        if (!card.justtcgVariantId) continue;
        const row = byVariant.get(card.justtcgVariantId);
        if (!row) continue;
        if (row.status === 'priced' && row.price) {
          updateCard(card.id, { price: row.price, priceStatus: 'priced' });
        } else {
          updateCard(card.id, { price: null, priceStatus: 'unavailable' });
        }
        void variantId;
      }
      setNote('Prices refreshed from JustTCG (prototype).');
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Could not refresh prices.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel binder-valuation">
      <div className="binder-valuation__head">
        <div>
          <strong>Valuation (prototype)</strong>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            Exact JustTCG matches only. Not a paid or public pricing feature.
          </p>
        </div>
        <button type="button" className="btn btn-secondary" disabled={busy || slotted.length === 0} onClick={() => void onRefresh()}>
          {busy ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
          Refresh prices
        </button>
      </div>
      <div className="binder-valuation__stats">
        <div>
          <span className="muted">Binder total</span>
          <strong>{priced.length > 0 ? totalLabel : 'Price unavailable'}</strong>
        </div>
        <div>
          <span className="muted">Coverage</span>
          <strong>
            {priced.length} priced · {excluded} excluded
          </strong>
        </div>
      </div>
      {slotted.length > 0 && (
        <ul className="binder-valuation__list">
          {slotted.map((card) => (
            <li key={`${card.id}-${card.justtcgVariantId ?? 'none'}`}>
              <span>
                {card.name}
                {card.condition ? ` · ${card.condition}` : ''}
                {card.printing ? ` · ${card.printing}` : ''}
              </span>
              <span className="muted">
                {card.priceStatus === 'priced' && card.price
                  ? `${formatCardPrice(card.price)} · ${card.price.source}`
                  : 'Price unavailable'}
              </span>
            </li>
          ))}
        </ul>
      )}
      {note && (
        <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
          {note}
        </p>
      )}
    </section>
  );
}
