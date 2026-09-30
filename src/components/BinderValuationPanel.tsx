import { useMemo, useState } from 'react';
import { ChevronDown, Loader2, RefreshCw } from 'lucide-react';
import {
  describePriceSource,
  formatCardPrice,
  isManualPrice,
  isRateLimited,
  refreshJustTcgPrices,
  resolveJustTcgPrice,
} from '../lib/justtcgClient';
import { useStore } from '../store/Store';
import { binderStartDay } from '../lib/binderValue';
import { BinderPriceGraph } from './BinderPriceGraph';
import type { Binder, Card, CardCondition } from '../types';

type Props = {
  binder: Binder;
  collection: Card[];
};

const COLLAPSED_KEY = 'bb_valuation_collapsed';

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function BinderValuationPanel({ binder, collection }: Props) {
  const { updateCard } = useStore();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(readCollapsed);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      /* ignore private browsing */
    }
  }

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
      let newlyPriced = 0;
      let needPrinting = 0;
      let rateLimited = false;
      let disputed = 0;

      for (const card of slotted) {
        // A price the owner typed in is theirs — never looked up or replaced
        if (isManualPrice(card.price)) continue;
        if (!card.name?.trim() || !card.set?.trim() || !card.number?.trim()) continue;
        // No condition chosen yet: price it as Near Mint and flag the guess
        const condition: CardCondition = card.condition ?? 'NM';
        if (!card.condition) updateCard(card.id, { condition, conditionAssumed: true });

        if (!card.justtcgVariantId) {
          // Out of lookups for now — leave the rest untouched rather than marking them unavailable
          if (rateLimited) continue;
          try {
            const result = await resolveJustTcgPrice({
              name: card.name,
              set: card.set,
              number: card.number,
              condition,
              printing: card.printing,
              externalId: card.externalId,
            });
            if (result.status === 'priced') {
              newlyPriced++;
              updateCard(card.id, {
                printing: result.printing,
                justtcgCardId: result.justtcgCardId,
                justtcgVariantId: result.justtcgVariantId,
                price: result.price,
                priceStatus: 'priced',
              });
            } else if (result.status === 'needs_printing') {
              // Found, but the owner has to say which printing they have
              needPrinting++;
              updateCard(card.id, { justtcgCardId: result.justtcgCardId, price: null, priceStatus: 'pending' });
            } else {
              if (result.conflict) disputed++;
              updateCard(card.id, { price: null, priceStatus: 'unavailable' });
            }
          } catch (err) {
            if (isRateLimited(err)) rateLimited = true;
            else updateCard(card.id, { price: null, priceStatus: 'unavailable' });
          }
          continue;
        }

        if (!seen.has(card.justtcgVariantId)) {
          seen.add(card.justtcgVariantId);
          refreshItems.push({ justtcgVariantId: card.justtcgVariantId, condition });
        }
      }

      const notes: string[] = [];
      if (newlyPriced) notes.push(`${newlyPriced} newly priced.`);
      if (needPrinting) notes.push(`${needPrinting} need a printing chosen — open the card to pick one.`);
      if (disputed) {
        notes.push(
          `${disputed} ${disputed === 1 ? 'card has' : 'cards have'} price sources that disagree — edit ${disputed === 1 ? 'it' : 'them'} to set a price by hand.`,
        );
      }
      if (rateLimited) notes.push('JustTCG’s free tier allows 10 lookups a minute — refresh again shortly for the rest.');

      if (refreshItems.length === 0) {
        setNote(notes.join(' ') || 'No priced matches yet for cards in this binder.');
        return;
      }

      const { results } = await refreshJustTcgPrices({ items: refreshItems, force: true });
      const byVariant = new Map(results.map((row) => [row.justtcgVariantId, row]));
      for (const card of slotted) {
        // Newly linked cards were priced above; this updates cards that already had a variant
        if (!card.justtcgVariantId || isManualPrice(card.price)) continue;
        const row = byVariant.get(card.justtcgVariantId);
        if (!row) continue;
        if (row.status === 'priced' && row.price) {
          updateCard(card.id, { price: row.price, priceStatus: 'priced' });
        } else {
          updateCard(card.id, { price: null, priceStatus: 'unavailable' });
        }
      }
      setNote(['Prices refreshed.', ...notes].join(' '));
    } catch (err) {
      setNote(
        isRateLimited(err)
          ? 'JustTCG’s free-tier limit was reached — try again in a minute.'
          : err instanceof Error
            ? err.message
            : 'Could not refresh prices.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`panel binder-valuation${collapsed ? ' is-collapsed' : ''}`}>
      <div className="binder-valuation__head">
        <div>
          <strong>Valuation (prototype)</strong>
          {collapsed ? (
            <span className="binder-valuation__summary">
              <span className="muted">Binder total</span>
              <strong>{priced.length > 0 ? totalLabel : 'Price unavailable'}</strong>
              <span className="muted">
                {priced.length} of {slotted.length} {slotted.length === 1 ? 'card' : 'cards'} valued
              </span>
            </span>
          ) : (
            <p className="muted" style={{ margin: '0.35rem 0 0' }}>
              JustTCG prices by condition; cards JustTCG doesn’t carry use TCGdex market prices. Not a
              paid or public pricing feature.
            </p>
          )}
        </div>
        <div className="binder-valuation__actions">
          {!collapsed && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy || slotted.length === 0}
              onClick={() => void onRefresh()}
              aria-label="Refresh prices"
            >
              {busy ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
              <span className="binder-valuation__refresh-label">Refresh prices</span>
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost binder-valuation__toggle"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-controls="binder-valuation-body"
            aria-label={collapsed ? 'Expand valuation' : 'Collapse valuation'}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            <ChevronDown size={18} />
          </button>
        </div>
      </div>
      {!collapsed && (
        <div id="binder-valuation-body" className="binder-valuation__body">
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
          <div className="binder-valuation__graph">
            <strong>Price guide</strong>
            <BinderPriceGraph
              history={binder.valueHistory}
              startDay={binderStartDay(binder.createdAt, binder.valueHistory)}
              currency={currency}
            />
          </div>
          {slotted.length > 0 && (
            <ul className="binder-valuation__list">
              {slotted.map((card) => (
                <li key={`${card.id}-${card.justtcgVariantId ?? 'none'}`}>
                  <span>
                    {card.name}
                    {card.condition ? ` · ${card.condition}${card.conditionAssumed ? ' (assumed)' : ''}` : ''}
                    {card.printing ? ` · ${card.printing}` : ''}
                  </span>
                  <span className="muted" title={describePriceSource(card.price, card.condition)}>
                    {card.priceStatus === 'priced' && card.price
                      ? `${formatCardPrice(card.price)} · ${
                          card.price.source === 'Manual'
                            ? 'set by you'
                            : card.price.via
                              ? `${card.price.source} via TCGdex`
                              : card.price.source
                        }`
                      : card.priceStatus === 'pending'
                        ? 'Pick a printing'
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
        </div>
      )}
    </section>
  );
}
