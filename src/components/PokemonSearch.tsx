import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Layers, Loader2, Search } from 'lucide-react';
import type { Card } from '../types';
import {
  getCardsFromSet,
  listAllPokemonSets,
  searchPokemonCards,
  type PokemonSetResult,
} from '../lib/pokemonTcg';
import { TcgCard } from './TcgCard';

type SearchMode = 'set' | 'card';

function yearFromReleaseDate(releaseDate: string) {
  return releaseDate.slice(0, 4) || 'Unknown';
}

export function PokemonSearch({
  onAdd,
  existingExternalIds,
}: {
  onAdd: (cards: Card[]) => void;
  existingExternalIds?: Set<string>;
}) {
  const [mode, setMode] = useState<SearchMode>('set');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Card[]>([]);
  const [allSets, setAllSets] = useState<PokemonSetResult[]>([]);
  const [activeSet, setActiveSet] = useState<PokemonSetResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingSets, setLoadingSets] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingSets(true);
      try {
        const sets = await listAllPokemonSets();
        if (!cancelled) setAllSets(sets);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load sets.');
        }
      } finally {
        if (!cancelled) setLoadingSets(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredSets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allSets;
    return allSets.filter((set) => {
      const name = set.name.toLowerCase();
      const id = set.id.toLowerCase();
      if (name.includes(q) || id.includes(q)) return true;
      return q
        .split(/\s+/)
        .filter(Boolean)
        .every((term) => name.includes(term) || id.includes(term));
    });
  }, [allSets, query]);

  const setsByYear = useMemo(() => {
    const groups = new Map<string, PokemonSetResult[]>();
    for (const set of filteredSets) {
      const year = yearFromReleaseDate(set.releaseDate);
      const bucket = groups.get(year) ?? [];
      bucket.push(set);
      groups.set(year, bucket);
    }
    return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filteredSets]);

  async function onCardSearch(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    setResults([]);
    setActiveSet(null);
    try {
      const cards = await searchPokemonCards(query);
      setResults(cards);
      if (cards.length === 0) {
        setError('No cards found. Try another name or browse Sets.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setBusy(false);
    }
  }

  async function openSet(set: PokemonSetResult) {
    setBusy(true);
    setError(null);
    setActiveSet(set);
    try {
      const cards = await getCardsFromSet(set.id);
      setResults(cards);
      if (cards.length === 0) {
        setError('This set has no cards in the dataset yet.');
      }
    } catch (err) {
      setResults([]);
      setError(err instanceof Error ? err.message : 'Could not load set.');
    } finally {
      setBusy(false);
    }
  }

  function addAllMissing(cards: Card[]) {
    const missing = cards.filter(
      (c) => !c.externalId || !existingExternalIds?.has(c.externalId),
    );
    if (missing.length === 0) {
      setError('All of these cards are already in your collection.');
      return;
    }
    onAdd(missing);
    setError(null);
  }

  const missingCount = results.filter(
    (c) => !c.externalId || !existingExternalIds?.has(c.externalId),
  ).length;

  return (
    <div className="panel" style={{ display: 'grid', gap: '1rem', marginBottom: '1.5rem' }}>
      <div>
        <h2 style={{ fontSize: '1.15rem', marginBottom: 4 }}>Search Pokémon cards</h2>
        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
          Browse every English Pokémon TCG set in the public dataset, or search by card name.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className={`btn ${mode === 'set' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => {
            setMode('set');
            setQuery('');
            setResults([]);
            setActiveSet(null);
            setError(null);
          }}
        >
          <Layers size={16} />
          Sets ({allSets.length || '…'})
        </button>
        <button
          type="button"
          className={`btn ${mode === 'card' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => {
            setMode('card');
            setQuery('Charizard');
            setResults([]);
            setActiveSet(null);
            setError(null);
          }}
        >
          <Search size={16} />
          Cards
        </button>
      </div>

      {mode === 'set' ? (
        <div className="field">
          <label htmlFor="pkmn-q">Filter sets</label>
          <input
            id="pkmn-q"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveSet(null);
              setResults([]);
            }}
            placeholder="Prismatic Evolutions, 30th Celebration, Base…"
          />
        </div>
      ) : (
        <form onSubmit={onCardSearch} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 220px' }}>
            <label htmlFor="pkmn-q">Card name</label>
            <input
              id="pkmn-q"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Pikachu, Mewtwo…"
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ alignSelf: 'end' }}
            disabled={busy || !query.trim()}
          >
            {busy ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
            Search
          </button>
        </form>
      )}

      {error && <p className="form-error">{error}</p>}

      {mode === 'set' && !activeSet && (
        <div>
          <div className="muted" style={{ marginBottom: '0.75rem', fontSize: '0.85rem' }}>
            {loadingSets
              ? 'Loading all sets…'
              : `Showing ${filteredSets.length} of ${allSets.length} sets`}
          </div>
          {loadingSets ? (
            <p className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Loader2 size={16} className="spin" />
              Fetching set list…
            </p>
          ) : filteredSets.length === 0 ? (
            <div className="empty-state">No sets match that filter.</div>
          ) : (
            <div className="set-year-list">
              {setsByYear.map(([year, sets]) => (
                <section key={year} className="set-year-group">
                  <h3>{year}</h3>
                  <div className="set-results">
                    {sets.map((set) => (
                      <button
                        key={set.id}
                        type="button"
                        className="set-result-chip"
                        onClick={() => void openSet(set)}
                      >
                        <strong>{set.name}</strong>
                        <span className="muted">
                          {set.releaseDate} · {set.id}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      )}

      {activeSet && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <div>
            <strong style={{ fontFamily: 'var(--font-display)' }}>{activeSet.name}</strong>
            <div className="muted" style={{ fontSize: '0.85rem' }}>
              {busy
                ? 'Loading cards…'
                : `${results.length} cards · ${missingCount} not in your collection yet`}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setActiveSet(null);
                setResults([]);
                setError(null);
              }}
            >
              Back to all sets
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || missingCount === 0}
              onClick={() => addAllMissing(results)}
            >
              Add all missing ({missingCount})
            </button>
          </div>
        </div>
      )}

      {busy && activeSet && (
        <p className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Loader2 size={16} className="spin" />
          Loading set cards…
        </p>
      )}

      {results.length > 0 && (
        <div className="grid-cards">
          {results.map((card) => {
            const owned = card.externalId ? existingExternalIds?.has(card.externalId) : false;
            return (
              <div key={card.id} className="collection-item">
                <TcgCard card={card} />
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '0.4rem 0.7rem', fontSize: '0.85rem' }}
                  disabled={owned}
                  onClick={() => onAdd([card])}
                >
                  {owned ? 'In collection' : 'Add to collection'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
