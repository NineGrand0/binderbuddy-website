import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BookX, Loader2 } from 'lucide-react';
import { HomeAppShell } from '../components/Layout';
import { InteractiveBinder } from '../components/InteractiveBinder';
import { PageSoundToggle } from '../components/PageSoundToggle';
import { BinderPriceGraph } from '../components/BinderPriceGraph';
import { fetchSharedBinder, type ShareSnapshot } from '../lib/shareClient';
import { computeBinderValue, formatMoney } from '../lib/binderValue';
import type { Binder, BinderCoverPreset, BinderStyle, Card } from '../types';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; snapshot: ShareSnapshot; updatedAt: string }
  | { status: 'unavailable' }
  | { status: 'error' };

/** Keeps guest pages out of search indexes and stops the token leaking via Referer. */
function usePrivatePageMeta() {
  useEffect(() => {
    const tags = [
      { name: 'robots', content: 'noindex, nofollow, noarchive' },
      { name: 'referrer', content: 'no-referrer' },
    ].map(({ name, content }) => {
      const meta = document.createElement('meta');
      meta.name = name;
      meta.content = content;
      document.head.appendChild(meta);
      return meta;
    });
    return () => tags.forEach((meta) => meta.remove());
  }, []);
}

function toBinder(snapshot: ShareSnapshot, updatedAt: string): Binder {
  const { binder } = snapshot;
  return {
    id: 'shared',
    name: binder.name,
    style: binder.style as BinderStyle,
    size: binder.size,
    pages: binder.pages,
    createdAt: updatedAt,
    updatedAt,
    isPublic: false,
    coverPreset: binder.coverPreset as BinderCoverPreset | undefined,
    previewImageDataUrl: binder.previewImageDataUrl,
  };
}

function toCards(snapshot: ShareSnapshot): Card[] {
  return snapshot.cards.map(({ price, ...card }) => ({
    ...card,
    addedAt: '',
    ...(price
      ? {
          price: { ...price, source: 'JustTCG' as const, lastRefreshedAt: '' },
          priceStatus: 'priced' as const,
        }
      : { price: null, priceStatus: 'unavailable' as const }),
  }));
}

function SharedPriceGuide({ snapshot, cards }: { snapshot: ShareSnapshot; cards: Card[] }) {
  const prices = snapshot.prices;
  if (!prices) return null;
  const value = computeBinderValue(snapshot.binder, cards);
  return (
    <section className="panel binder-valuation shared-price-guide" aria-labelledby="shared-price-title">
      <div className="binder-valuation__stats">
        <div>
          <span className="muted" id="shared-price-title">
            Binder total
          </span>
          <strong>{value.priced > 0 ? formatMoney(value.total, value.currency) : 'Price unavailable'}</strong>
        </div>
        <div>
          <span className="muted">Coverage</span>
          <strong>
            {value.priced} of {value.cards} {value.cards === 1 ? 'card' : 'cards'} valued
          </strong>
        </div>
      </div>
      <div className="binder-valuation__graph">
        <strong>Price guide</strong>
        <BinderPriceGraph history={prices.history} startDay={prices.startDay} currency={value.currency} />
      </div>
    </section>
  );
}

export function SharedBinderPage() {
  const { token = '' } = useParams();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  usePrivatePageMeta();

  useEffect(() => {
    let cancelled = false;
    let lastUpdatedAt = '';

    async function load(initial: boolean) {
      try {
        const shared = await fetchSharedBinder(token);
        if (cancelled) return;
        if (!shared) {
          setState({ status: 'unavailable' });
          return;
        }
        if (shared.updatedAt === lastUpdatedAt) return;
        lastUpdatedAt = shared.updatedAt;
        setState({ status: 'ready', ...shared });
      } catch {
        if (!cancelled && initial) setState({ status: 'error' });
      }
    }

    setState({ status: 'loading' });
    void load(true);

    // Pick up the owner's latest saved changes when a guest comes back to the tab
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [token, attempt]);

  const view = useMemo(
    () =>
      state.status === 'ready'
        ? { binder: toBinder(state.snapshot, state.updatedAt), cards: toCards(state.snapshot) }
        : null,
    [state],
  );

  useEffect(() => {
    const previous = document.title;
    if (view) document.title = `${view.binder.name} · BinderBuddy`;
    return () => {
      document.title = previous;
    };
  }, [view]);

  if (state.status === 'unavailable') return <BinderUnavailablePage />;

  if (state.status === 'error') {
    return (
      <HomeAppShell>
        <div className="shared-binder-state" role="alert">
          <h1>Couldn’t load this binder</h1>
          <p className="muted">Check your connection and try again.</p>
          <button type="button" className="home-app-cta" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      </HomeAppShell>
    );
  }

  if (!view || state.status !== 'ready') {
    return (
      <HomeAppShell>
        <div className="shared-binder-state" aria-live="polite">
          <Loader2 size={28} className="spin" aria-hidden />
          <p className="muted">Opening binder…</p>
        </div>
      </HomeAppShell>
    );
  }

  return (
    <HomeAppShell wide>
      <div className="page-header">
        <div>
          <h1>{view.binder.name}</h1>
          <p>Shared by {state.snapshot.ownerName}. Flip the pages and tap any card to take a closer look.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <PageSoundToggle />
        </div>
      </div>
      <SharedPriceGuide snapshot={state.snapshot} cards={view.cards} />
      <InteractiveBinder binder={view.binder} collection={view.cards} readOnly hideCollection />
    </HomeAppShell>
  );
}

export function BinderUnavailablePage() {
  usePrivatePageMeta();

  return (
    <HomeAppShell>
      <div className="shared-binder-state" role="alert">
        <BookX size={40} aria-hidden className="shared-binder-state__icon" />
        <h1>This binder is no longer available</h1>
        <p className="muted">
          The owner may have stopped sharing it, created a new link, or deleted the binder.
        </p>
        <Link to="/" className="home-app-cta">
          Go to BinderBuddy
        </Link>
      </div>
    </HomeAppShell>
  );
}
