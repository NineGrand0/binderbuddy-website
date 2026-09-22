import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import type { Card } from '../types';
import {
  getCardsFromSet,
  isPromoSet,
  listAllPokemonSets,
  searchPokemonCards,
  type PokemonSetResult,
} from '../lib/pokemonTcg';
import { TcgCard } from './TcgCard';

type KindFilter = 'all' | 'sets' | 'promos';
type RarityFilter = 'any' | Card['rarity'];

const RARITIES: { id: RarityFilter; label: string }[] = [
  { id: 'any', label: 'Any rarity' },
  { id: 'common', label: 'Common' },
  { id: 'uncommon', label: 'Uncommon' },
  { id: 'rare', label: 'Rare' },
  { id: 'ultra', label: 'Ultra rare' },
  { id: 'secret', label: 'Secret rare' },
];

export function toPlanCard(card: Card): Card {
  return { ...card, id: card.externalId || card.id };
}

function yearOf(set: PokemonSetResult) {
  return set.releaseDate.slice(0, 4) || 'Unknown';
}

function setMetaMatches(set: PokemonSetResult, query: string) {
  if (!query) return true;
  const hay = `${set.name} ${set.id} ${set.series} ${yearOf(set)}`.toLowerCase();
  return hay.includes(query);
}

function groupByYear(sets: PokemonSetResult[]) {
  const groups: { year: string; sets: PokemonSetResult[] }[] = [];
  for (const set of sets) {
    const year = yearOf(set);
    const last = groups[groups.length - 1];
    if (!last || last.year !== year) groups.push({ year, sets: [set] });
    else last.sets.push(set);
  }
  return groups;
}

export function PlanCatalog({
  placedIds,
  onPick,
}: {
  placedIds: Set<string>;
  onPick: (card: Card) => void;
}) {
  const [sets, setSets] = useState<PokemonSetResult[]>([]);
  const [loadingSets, setLoadingSets] = useState(true);
  const [setsError, setSetsError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [series, setSeries] = useState('all');
  const [rarity, setRarity] = useState<RarityFilter>('any');
  const [cardsBySet, setCardsBySet] = useState<Record<string, Card[]>>({});
  const [loadingSetId, setLoadingSetId] = useState<string | null>(null);
  const [setErrors, setSetErrors] = useState<Record<string, string>>({});
  const [searchHits, setSearchHits] = useState<Card[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [settledQuery, setSettledQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    listAllPokemonSets()
      .then((loaded) => {
        if (cancelled) return;
        setSets([...loaded].sort((a, b) => a.releaseDate.localeCompare(b.releaseDate)));
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setSetsError(err instanceof Error ? err.message : 'Could not load sets.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSets(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSearchHits([]);
      setSearchError(null);
      setSearching(false);
      setSettledQuery('');
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      searchPokemonCards(q, 36)
        .then((cards) => {
          if (cancelled) return;
          const seen = new Set<string>();
          const unique: Card[] = [];
          for (const card of cards.map(toPlanCard)) {
            if (seen.has(card.id)) continue;
            seen.add(card.id);
            unique.push(card);
          }
          setSearchHits(unique);
          setSearchError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setSearchHits([]);
          setSearchError(err instanceof Error ? err.message : 'Search failed.');
        })
        .finally(() => {
          if (cancelled) return;
          setSearching(false);
          setSettledQuery(q.toLowerCase());
        });
    }, 320);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const seriesOptions = useMemo(() => {
    const names: string[] = [];
    const seen = new Set<string>();
    for (const set of sets) {
      if (seen.has(set.series)) continue;
      seen.add(set.series);
      names.push(set.series);
    }
    return names;
  }, [sets]);

  const setsByName = useMemo(() => {
    const map = new Map<string, PokemonSetResult>();
    for (const set of sets) map.set(set.name, set);
    return map;
  }, [sets]);

  const q = query.trim().toLowerCase();

  function passesSetFilters(set: PokemonSetResult) {
    const promo = isPromoSet(set);
    if (kind === 'sets' && promo) return false;
    if (kind === 'promos' && !promo) return false;
    if (series !== 'all' && set.series !== series) return false;
    return setMetaMatches(set, q);
  }

  const visibleSets = sets.filter(passesSetFilters);
  const mainSets = visibleSets.filter((set) => !isPromoSet(set));
  const promoSets = visibleSets.filter((set) => isPromoSet(set));

  const visibleHits = searchHits.filter((card) => {
    if (rarity !== 'any' && card.rarity !== rarity) return false;
    const meta = setsByName.get(card.set);
    const promo = meta ? isPromoSet(meta) : isPromoSet({ name: card.set });
    if (kind === 'sets' && promo) return false;
    if (kind === 'promos' && !promo) return false;
    if (series !== 'all' && meta && meta.series !== series) return false;
    if (series !== 'all' && !meta) return false;
    return true;
  });

  async function ensureCards(setId: string) {
    if (cardsBySet[setId] || loadingSetId === setId) return;
    setLoadingSetId(setId);
    try {
      const cards = (await getCardsFromSet(setId, 1000))
        .map(toPlanCard)
        .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
      setCardsBySet((prev) => ({ ...prev, [setId]: cards }));
      setSetErrors((prev) => {
        if (!prev[setId]) return prev;
        const next = { ...prev };
        delete next[setId];
        return next;
      });
    } catch (err) {
      setCardsBySet((prev) => ({ ...prev, [setId]: [] }));
      setSetErrors((prev) => ({
        ...prev,
        [setId]: err instanceof Error ? err.message : 'Could not load this set.',
      }));
    } finally {
      setLoadingSetId((current) => (current === setId ? null : current));
    }
  }

  return (
    <section className="plan-catalog" aria-label="Pokémon card catalogue">
      <div>
        <h2>Pokémon cards</h2>
        <p className="muted plan-catalog-lead">
          Every English set and promo set, oldest first. Open a set and click a card to place it
          in the plan.
        </p>
      </div>

      <div className="plan-filters">
        <div className="field plan-search">
          <label htmlFor="plan-search">Search</label>
          <div className="plan-search-box">
            <Search size={16} aria-hidden />
            <input
              id="plan-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Charizard, Prismatic Evolutions, 1999…"
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="plan-kind">Show</label>
          <select
            id="plan-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as KindFilter)}
          >
            <option value="all">Sets and promos</option>
            <option value="sets">Main sets</option>
            <option value="promos">Promo cards</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="plan-series">Series</label>
          <select id="plan-series" value={series} onChange={(e) => setSeries(e.target.value)}>
            <option value="all">All series</option>
            {seriesOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="plan-rarity">Rarity</label>
          <select
            id="plan-rarity"
            value={rarity}
            onChange={(e) => setRarity(e.target.value as RarityFilter)}
          >
            {RARITIES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {q.length >= 2 && (
        <div className="plan-results">
          <h3>
            Matching cards
            {searching && <Loader2 size={16} className="spin" aria-hidden />}
          </h3>
          {searchError && <p className="form-error">{searchError}</p>}
          {!searching && !searchError && settledQuery === q && visibleHits.length === 0 && (
            <p className="muted">No cards match that search with the current filters.</p>
          )}
          {visibleHits.length > 0 && (
            <CardGrid cards={visibleHits} placedIds={placedIds} onPick={onPick} />
          )}
        </div>
      )}

      {loadingSets && (
        <p className="muted plan-status">
          <Loader2 size={16} className="spin" aria-hidden /> Loading sets…
        </p>
      )}
      {setsError && <p className="form-error">{setsError}</p>}

      {!loadingSets &&
        !setsError &&
        visibleSets.length === 0 &&
        visibleHits.length === 0 &&
        !searching && (
        <p className="muted">No sets match those filters.</p>
      )}

      {kind !== 'promos' && mainSets.length > 0 && (
        <SetGroup
          title="Sets"
          sets={mainSets}
          cardsBySet={cardsBySet}
          loadingSetId={loadingSetId}
          setErrors={setErrors}
          rarity={rarity}
          placedIds={placedIds}
          onOpen={ensureCards}
          onPick={onPick}
        />
      )}

      {kind !== 'sets' && promoSets.length > 0 && (
        <SetGroup
          title="Promo cards"
          sets={promoSets}
          cardsBySet={cardsBySet}
          loadingSetId={loadingSetId}
          setErrors={setErrors}
          rarity={rarity}
          placedIds={placedIds}
          onOpen={ensureCards}
          onPick={onPick}
        />
      )}
    </section>
  );
}

function SetGroup({
  title,
  sets,
  cardsBySet,
  loadingSetId,
  setErrors,
  rarity,
  placedIds,
  onOpen,
  onPick,
}: {
  title: string;
  sets: PokemonSetResult[];
  cardsBySet: Record<string, Card[]>;
  loadingSetId: string | null;
  setErrors: Record<string, string>;
  rarity: RarityFilter;
  placedIds: Set<string>;
  onOpen: (setId: string) => void;
  onPick: (card: Card) => void;
}) {
  const years = groupByYear(sets);
  return (
    <div className="plan-group">
      <h3>
        {title} <span className="muted">{sets.length}</span>
      </h3>
      {years.map((group) => (
        <div key={`${title}-${group.year}`} className="plan-year">
          <h4>{group.year}</h4>
          <div className="plan-set-list">
            {group.sets.map((set) => {
              const loaded = cardsBySet[set.id];
              const visible = (loaded ?? []).filter(
                (card) => rarity === 'any' || card.rarity === rarity,
              );
              const count = set.total ?? set.printedTotal;
              return (
                <details
                  key={set.id}
                  className="plan-set"
                  onToggle={(event) => {
                    if (event.currentTarget.open) onOpen(set.id);
                  }}
                >
                  <summary>
                    <span>{set.name}</span>
                    <span className="muted">
                      {set.series}
                      {count ? ` · ${count} cards` : ''}
                    </span>
                  </summary>
                  <div className="plan-set-body">
                    {loadingSetId === set.id && !loaded && (
                      <p className="muted plan-status">
                        <Loader2 size={16} className="spin" aria-hidden /> Loading cards…
                      </p>
                    )}
                    {setErrors[set.id] && <p className="form-error">{setErrors[set.id]}</p>}
                    {loaded && visible.length === 0 && !setErrors[set.id] && (
                      <p className="muted">No cards match this rarity.</p>
                    )}
                    {visible.length > 0 && (
                      <CardGrid cards={visible} placedIds={placedIds} onPick={onPick} />
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function CardGrid({
  cards,
  placedIds,
  onPick,
}: {
  cards: Card[];
  placedIds: Set<string>;
  onPick: (card: Card) => void;
}) {
  return (
    <div className="plan-card-grid">
      {cards.map((card) => {
        const placed = placedIds.has(card.id);
        return (
          <button
            key={card.id}
            type="button"
            className={`plan-card-hit${placed ? ' is-placed' : ''}`}
            disabled={placed}
            onClick={() => onPick(card)}
            aria-label={
              placed
                ? `${card.name} is already in this plan`
                : `Place ${card.name}, ${card.set} number ${card.number}`
            }
          >
            <TcgCard card={card} />
            {placed && <span className="plan-card-badge">In plan</span>}
          </button>
        );
      })}
    </div>
  );
}
