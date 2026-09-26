import { useEffect, useState, type FormEvent } from 'react';
import { Crop } from 'lucide-react';
import type { Card } from '../types';
import { isPromoSet, listAllPokemonSets, type PokemonSetResult } from '../lib/pokemonTcg';
import { ImageCropModal } from './ImageCropModal';

export type CardFormValues = {
  name: string;
  set: string;
  number: string;
  rarity: Card['rarity'];
  game: string;
  imageUrl: string;
  imageDataUrl?: string;
};

const emptyValues: CardFormValues = {
  name: '',
  set: '',
  number: '',
  rarity: 'common',
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
    });
  }

  function setField<K extends keyof CardFormValues>(key: K, value: CardFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function applyCrop(croppedDataUrl: string) {
    setValues((prev) => ({
      ...prev,
      imageDataUrl: croppedDataUrl,
      imageUrl: '',
    }));
    setCropOpen(false);
  }

  const preview = values.imageDataUrl || values.imageUrl || initial?.imageDataUrl;
  const cropSource = values.imageDataUrl || values.imageUrl || initial?.imageDataUrl;

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
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setCropOpen(true)}
                disabled={!cropSource}
              >
                <Crop size={16} /> Crop image
              </button>
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
              value={values.rarity}
              onChange={(e) => setField('rarity', e.target.value as Card['rarity'])}
            >
              <option value="common">Common</option>
              <option value="uncommon">Uncommon</option>
              <option value="rare">Rare</option>
              <option value="ultra">Ultra</option>
              <option value="secret">Secret</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="cf-game">Game</label>
            <input
              id="cf-game"
              value={values.game}
              onChange={(e) => setField('game', e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="cf-image">Image URL (optional)</label>
            <input
              id="cf-image"
              value={values.imageUrl}
              onChange={(e) =>
                setValues((prev) => ({
                  ...prev,
                  imageUrl: e.target.value,
                  imageDataUrl: e.target.value.trim() ? undefined : prev.imageDataUrl,
                }))
              }
              placeholder="https://…"
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
