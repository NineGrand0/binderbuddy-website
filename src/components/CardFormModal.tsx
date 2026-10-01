import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Crop, Loader2, PencilLine, RefreshCw, ScanSearch } from 'lucide-react';
import {
  CARD_CONDITIONS,
  userHasPremium,
  type Card,
  type CardCondition,
  type CardPriceSnapshot,
  type CardPriceStatus,
} from '../types';
import {
  describePriceSource,
  formatCardPrice,
  isManualPrice,
  manualPrice,
  resolveJustTcgPrice,
} from '../lib/justtcgClient';
import {
  isPromoSet,
  listAllPokemonSets,
  type PokemonMatchCandidate,
  type PokemonSetResult,
} from '../lib/pokemonTcg';
import { identifyCroppedCard } from '../lib/identifyCard';
import { cardImageSrc } from '../lib/cardImage';
import { useStore } from '../store/Store';
import { RarityOptions } from './RarityOptions';
import { ImageCropModal } from './ImageCropModal';

export type CardFormValues = {
  name: string;
  set: string;
  number: string;
  rarity: Card['rarity'];
  condition?: CardCondition;
  game: string;
  imageUrl: string;
  imageDataUrl?: string;
  /** Catalogue printing id, set when a looked-up match is chosen. */
  externalId?: string;
  /** Valuation link. On submit this is null when the details changed since it was priced. */
  pricing?: CardPricing | null;
};

export type CardPricing = {
  printing?: string;
  justtcgCardId?: string;
  justtcgVariantId?: string;
  price?: CardPriceSnapshot | null;
  priceStatus?: CardPriceStatus;
};

type PriceState = {
  /** Card details the pricing belongs to — a price for other details is stale. */
  key: string;
  pricing: CardPricing;
  busy: boolean;
  note: string | null;
  printings: string[];
};

function pricingKey(v: Pick<CardFormValues, 'name' | 'set' | 'number' | 'condition'>) {
  return [v.name.trim(), v.set.trim(), v.number.trim(), v.condition ?? ''].join('|').toLowerCase();
}

type Lookup =
  | { status: 'idle' }
  | { status: 'reading' }
  | { status: 'error'; message: string }
  | {
      status: 'done';
      note: string;
      candidates: PokemonMatchCandidate[];
      more: PokemonMatchCandidate[];
      showAll: boolean;
    };

const CONDITION_NAMES: Record<CardCondition, string> = {
  NM: 'Near Mint',
  LP: 'Lightly Played',
  MP: 'Moderately Played',
  HP: 'Heavily Played',
  Damaged: 'Damaged',
};

const emptyValues: CardFormValues = {
  name: '',
  set: '',
  number: '',
  rarity: undefined,
  condition: undefined,
  game: 'Pokémon TCG',
  imageUrl: '',
  imageDataUrl: undefined,
};

interface Props {
  title: string;
  submitLabel: string;
  initial?: Partial<CardFormValues> & { imageDataUrl?: string };
  onClose: () => void;
  onSubmit: (values: CardFormValues) => void;
}

export function CardFormModal({ title, submitLabel, initial, onClose, onSubmit }: Props) {
  const [values, setValues] = useState<CardFormValues>({
    ...emptyValues,
    ...initial,
    imageDataUrl: initial?.imageDataUrl,
  });
  const [cropOpen, setCropOpen] = useState(false);
  const [sets, setSets] = useState<PokemonSetResult[]>([]);
  const [setsError, setSetsError] = useState<string | null>(null);
  const [promo, setPromo] = useState(() => isPromoSet({ name: initial?.set ?? '' }));
  const [lookup, setLookup] = useState<Lookup>({ status: 'idle' });
  const [priceState, setPriceState] = useState<PriceState>(() => ({
    key: pricingKey({ ...emptyValues, ...initial }),
    pricing: initial?.pricing ?? {},
    busy: false,
    note: null,
    printings: [],
  }));
  const isManual = isManualPrice(priceState.pricing.price);
  // A price the owner typed in stays theirs even if the card details change
  const priceCurrent = isManual || priceState.key === pricingKey(values);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const manualAmount = Number(manualInput.replace(/[^0-9.]/g, ''));
  const manualValid = manualInput.trim() !== '' && Number.isFinite(manualAmount) && manualAmount >= 0;

  function saveManualPrice() {
    if (!manualValid) return;
    setPriceState((prev) => ({
      ...prev,
      key: pricingKey(values),
      busy: false,
      note: null,
      printings: [],
      pricing: {
        printing: prev.pricing.printing,
        // Explicitly cleared so a later refresh can't link it back to a market listing
        justtcgCardId: undefined,
        justtcgVariantId: undefined,
        price: manualPrice(Math.round(manualAmount * 100) / 100),
        priceStatus: 'priced',
      },
    }));
    setManualOpen(false);
  }
  const { user } = useStore();
  const canLookup = userHasPremium(user);

  useEffect(() => {
    let cancelled = false;
    void listAllPokemonSets()
      .then((loaded) => {
        if (!cancelled) {
          setSets([...loaded].sort((a, b) => a.releaseDate.localeCompare(b.releaseDate)));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setSetsError(err instanceof Error ? err.message : 'Could not load sets.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleSets = sets.filter((set) => isPromoSet(set) === promo);
  const knownName = visibleSets.some((set) => set.name === values.set);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!values.name.trim()) return;
    onSubmit({
      ...values,
      name: values.name.trim(),
      set: values.set.trim() || 'Custom',
      number: values.number.trim() || '001',
      game: values.game.trim() || 'Custom',
      imageUrl: values.imageUrl.trim(),
      imageDataUrl: values.imageDataUrl,
      pricing: priceCurrent ? priceState.pricing : null,
    });
  }

  async function fetchPrice(printing?: string) {
    const { name, set, number, condition } = values;
    if (!name.trim() || !set.trim() || !number.trim() || !condition) {
      setPriceState((prev) => ({
        ...prev,
        note: 'Add the card name, set, number and condition first.',
      }));
      return;
    }
    const key = pricingKey(values);
    // Keep the printing only if it was chosen for these same details
    const keepPrinting = printing ?? (priceCurrent ? priceState.pricing.printing : undefined);
    setPriceState((prev) => ({ ...prev, busy: true, note: null }));
    try {
      const result = await resolveJustTcgPrice({
        name: name.trim(),
        set: set.trim(),
        number: number.trim(),
        condition,
        printing: keepPrinting,
        externalId: values.externalId,
      });
      if (result.status === 'priced') {
        setPriceState({
          key,
          busy: false,
          note: null,
          printings: [],
          pricing: {
            printing: result.printing,
            justtcgCardId: result.justtcgCardId,
            justtcgVariantId: result.justtcgVariantId,
            price: result.price,
            priceStatus: 'priced',
          },
        });
      } else if (result.status === 'needs_printing') {
        setPriceState({
          key,
          busy: false,
          note: 'This card has more than one printing. Pick the one you have.',
          printings: result.printings,
          pricing: { justtcgCardId: result.justtcgCardId, price: null, priceStatus: 'unavailable' },
        });
      } else {
        setPriceState({
          key,
          busy: false,
          note: result.reason || 'No exact JustTCG match for this card.',
          printings: [],
          pricing: { price: null, priceStatus: 'unavailable' },
        });
        // The sources disagree on this card — the owner is the best judge of its value
        if (result.conflict) {
          setManualInput('');
          setManualOpen(true);
        }
      }
    } catch (err) {
      setPriceState((prev) => ({
        ...prev,
        busy: false,
        note: err instanceof Error ? err.message : 'Could not get a price.',
      }));
    }
  }

  function setField<K extends keyof CardFormValues>(key: K, value: CardFormValues[K]) {
    setValues((prev) => ({
      ...prev,
      [key]: value,
      // A hand-edited set or number no longer points at the looked-up catalogue printing
      ...((key === 'set' || key === 'number') && value !== prev[key] ? { externalId: undefined } : {}),
    }));
  }

  function applyCrop(croppedDataUrl: string) {
    setValues((prev) => ({
      ...prev,
      imageDataUrl: croppedDataUrl,
      imageUrl: '',
    }));
    setCropOpen(false);
    setLookup({ status: 'idle' });
  }

  const remoteArt = cardImageSrc(values.imageUrl.trim() || undefined);
  const preview = values.imageDataUrl || remoteArt || initial?.imageDataUrl;
  const cropSource = values.imageDataUrl || remoteArt || initial?.imageDataUrl;

  async function runLookup() {
    if (!cropSource || !canLookup) return;
    setLookup({ status: 'reading' });
    try {
      const result = await identifyCroppedCard(cropSource);
      setLookup({
        status: 'done',
        note: result.note,
        candidates: result.candidates,
        more: result.moreCandidates,
        showAll: false,
      });
    } catch (err) {
      setLookup({
        status: 'error',
        message: err instanceof Error ? err.message : 'Could not read this card.',
      });
    }
  }

  function chooseCandidate(candidate: PokemonMatchCandidate) {
    setValues((prev) => ({
      ...prev,
      name: candidate.name,
      set: candidate.set,
      number: candidate.number,
      rarity: candidate.rarity ?? prev.rarity,
      game: 'Pokémon TCG',
      externalId: candidate.externalId,
    }));
    setPromo(isPromoSet({ name: candidate.set }));
  }

  const lookupList =
    lookup.status === 'done'
      ? [...lookup.candidates, ...(lookup.showAll ? lookup.more : [])]
      : [];

  return (
    <>
      <div
        role="dialog"
        aria-modal
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,.55)',
          display: 'grid',
          placeItems: 'center',
          zIndex: 50,
          padding: 16,
        }}
        onClick={onClose}
      >
        <form
          className="panel"
          style={{
            width: 'min(460px, 100%)',
            display: 'grid',
            gap: '0.9rem',
            maxHeight: '90vh',
            overflow: 'auto',
          }}
          onClick={(e) => e.stopPropagation()}
          onSubmit={handleSubmit}
        >
          <h2 style={{ fontSize: '1.35rem' }}>{title}</h2>

          {preview && (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
              <div
                style={{
                  width: 120,
                  aspectRatio: '63/88',
                  borderRadius: 8,
                  overflow: 'hidden',
                  border: '1px solid var(--line)',
                  background: `center / cover no-repeat url(${preview})`,
                  flexShrink: 0,
                }}
              />
              <div style={{ display: 'grid', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setCropOpen(true)}
                  disabled={!cropSource}
                >
                  <Crop size={16} /> Crop image
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void runLookup()}
                  disabled={!cropSource || !canLookup || lookup.status === 'reading'}
                >
                  {lookup.status === 'reading' ? (
                    <Loader2 size={16} className="spin" />
                  ) : (
                    <ScanSearch size={16} />
                  )}
                  Look up card
                </button>
              </div>
            </div>
          )}

          {preview && !canLookup && (
            <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
              <Link to="/premium">Unlock Premium</Link> to look up card details from the image.
            </p>
          )}

          {lookup.status === 'reading' && (
            <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
              Reading card text… the first lookup also loads the card catalogue.
            </p>
          )}
          {lookup.status === 'error' && <p className="form-error">{lookup.message}</p>}
          {lookup.status === 'done' && (
            <div className="card-form-lookup">
              <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
                {lookupList.length > 0
                  ? 'Pick the matching printing to fill in the details below.'
                  : lookup.note || 'No matching cards found. Try cropping tighter to the card.'}
              </p>
              {lookupList.length > 0 && (
                <div className="page-scan-candidates">
                  {lookupList.map((candidate) => (
                    <button
                      key={candidate.externalId}
                      type="button"
                      className={`page-scan-candidate${
                        values.externalId === candidate.externalId ? ' is-active' : ''
                      }`}
                      aria-pressed={values.externalId === candidate.externalId}
                      onClick={() => chooseCandidate(candidate)}
                    >
                      <img
                        src={cardImageSrc(candidate.imageUrl, candidate.externalId, 'small')}
                        alt=""
                        loading="lazy"
                      />
                      <span>
                        {candidate.name}
                        <small>
                          {candidate.set} · #{candidate.number}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {lookup.more.length > 0 && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ justifySelf: 'start' }}
                  onClick={() => setLookup({ ...lookup, showAll: !lookup.showAll })}
                >
                  {lookup.showAll ? 'Show fewer' : `Show all (${lookup.more.length} more)`}
                </button>
              )}
            </div>
          )}

          <div className="field">
            <label htmlFor="cf-name">Card name</label>
            <input
              id="cf-name"
              value={values.name}
              onChange={(e) => setField('name', e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="cf-set">Set</label>
            <select
              id="cf-set"
              value={values.set}
              onChange={(e) => setField('set', e.target.value)}
            >
              <option value="">{sets.length ? 'Choose a set' : 'Loading sets…'}</option>
              {values.set && !knownName && <option value={values.set}>{values.set}</option>}
              {visibleSets.map((set) => (
                <option key={set.id} value={set.name}>
                  {set.name}
                </option>
              ))}
            </select>
            {setsError && <p className="form-error">{setsError}</p>}
          </div>

          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              color: 'var(--muted)',
              fontSize: '0.95rem',
            }}
          >
            <input
              type="checkbox"
              checked={promo}
              onChange={(e) => {
                const next = e.target.checked;
                setPromo(next);
                setValues((prev) => {
                  const stillListed = sets.some(
                    (set) => set.name === prev.set && isPromoSet(set) === next,
                  );
                  return stillListed ? prev : { ...prev, set: '' };
                });
              }}
            />
            Promo
          </label>

          <div className="field">
            <label htmlFor="cf-number">Number</label>
            <input
              id="cf-number"
              value={values.number}
              onChange={(e) => setField('number', e.target.value)}
              placeholder="025/131"
            />
          </div>
          <div className="field">
            <label htmlFor="cf-rarity">Rarity</label>
            <select
              id="cf-rarity"
              value={values.rarity ?? ''}
              onChange={(e) => setField('rarity', (e.target.value || undefined) as Card['rarity'])}
            >
              <RarityOptions />
            </select>
          </div>
          <div className="field">
            <span id="cf-condition-label" className="field-label">Condition</span>
            <div className="card-form-conditions" role="radiogroup" aria-labelledby="cf-condition-label">
              {CARD_CONDITIONS.map((condition) => {
                const active = values.condition === condition;
                return (
                  <button
                    key={condition}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    title={CONDITION_NAMES[condition]}
                    className={`btn ${active ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setField('condition', active ? undefined : condition)}
                  >
                    {condition}
                  </button>
                );
              })}
            </div>
            <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
              {values.condition
                ? `${CONDITION_NAMES[values.condition]} — used for the binder valuation.`
                : 'Not set. Pick one to include this card in the binder valuation.'}
            </p>
          </div>
          <div className="field">
            <span className="field-label">Price</span>
            <div className="card-form-price">
              <div>
                <strong>
                  {priceCurrent && priceState.pricing.priceStatus === 'priced' && priceState.pricing.price
                    ? formatCardPrice(priceState.pricing.price)
                    : 'No price yet'}
                </strong>
                <span className="muted">
                  {isManual
                    ? describePriceSource(priceState.pricing.price)
                    : !priceCurrent
                    ? 'Details changed — get a new price.'
                    : priceState.pricing.priceStatus === 'priced' && priceState.pricing.price
                      ? [
                          describePriceSource(priceState.pricing.price, values.condition),
                          priceState.pricing.printing,
                          priceState.pricing.price.lastRefreshedAt &&
                            new Date(priceState.pricing.price.lastRefreshedAt).toLocaleDateString(),
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : 'JustTCG price for this condition, or a TCGdex market price if JustTCG lacks the card.'}
                </span>
              </div>
              <div className="card-form-price__actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={priceState.busy}
                  onClick={() => void fetchPrice()}
                  title={isManual ? 'Replace your price with the current market price' : undefined}
                >
                  {priceState.busy ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
                  {isManual
                    ? 'Use market price'
                    : priceCurrent && priceState.pricing.priceStatus === 'priced'
                      ? 'Refresh'
                      : 'Get price'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={priceState.busy}
                  onClick={() => {
                    setManualInput(isManual && priceState.pricing.price ? String(priceState.pricing.price.amount) : '');
                    setManualOpen((open) => !open);
                  }}
                >
                  <PencilLine size={16} />
                  {isManual ? 'Edit price' : 'Set price'}
                </button>
              </div>
            </div>
            {manualOpen && (
              <div className="card-form-manual-price">
                <label htmlFor="cf-manual-price" className="muted">
                  Your price (USD) — kept until you change it or switch back to the market price
                </label>
                <div className="card-form-manual-price__row">
                  <span aria-hidden="true">$</span>
                  <input
                    id="cf-manual-price"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={manualInput}
                    autoFocus
                    onChange={(e) => setManualInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        // Enter saves the price, not the whole card form
                        e.preventDefault();
                        saveManualPrice();
                      }
                    }}
                  />
                  <button type="button" className="btn btn-primary" disabled={!manualValid} onClick={saveManualPrice}>
                    Save price
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setManualOpen(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {priceCurrent && priceState.printings.length > 0 && (
              <div className="card-form-conditions">
                {priceState.printings.map((printing) => (
                  <button
                    key={printing}
                    type="button"
                    className="btn btn-secondary"
                    disabled={priceState.busy}
                    onClick={() => void fetchPrice(printing)}
                  >
                    {printing}
                  </button>
                ))}
              </div>
            )}
            {priceState.note && (
              <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
                {priceState.note}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor="cf-game">Game</label>
            <input
              id="cf-game"
              value={values.game}
              onChange={(e) => setField('game', e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              {submitLabel}
            </button>
          </div>
        </form>
      </div>

      {cropOpen && cropSource && (
        <ImageCropModal
          src={cropSource}
          title="Crop card image"
          onCancel={() => setCropOpen(false)}
          onConfirm={applyCrop}
        />
      )}
    </>
  );
}
