import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Crop, ImagePlus, Loader2, Search, Trash2 } from 'lucide-react';
import { HomeAppShell } from '../components/Layout';
import { TcgCard } from '../components/TcgCard';
import { ImageCropModal } from '../components/ImageCropModal';
import { RequireAuth } from './Dashboard';
import { useStore } from '../store/Store';
import { cardFromDetails, detectBinderPage, detectSingleCard } from '../lib/cardDetect';
import { loadPokemonSpeciesNames } from '../lib/pokemonNames';
import type { ParsedCardDetails } from '../lib/parseCardOcr';
import type { Card } from '../types';
import { GRID_COLS, SLOT_COUNTS } from '../types';

type Mode = 'page' | 'card';

function isPokemonNameCard(card: Card) {
  return card.game === 'Pokémon TCG' && Boolean(card.name.trim());
}

export function ScanPage() {
  return (
    <RequireAuth>
      <ScanInner />
    </RequireAuth>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read image.'));
    reader.readAsDataURL(file);
  });
}

function ScanInner() {
  const { user, addCards, updateBinder, createBinder } = useStore();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>('card');
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [ocrText, setOcrText] = useState('');
  const [detected, setDetected] = useState<Card[]>([]);
  const [targetBinderId, setTargetBinderId] = useState('');
  const [cropOpen, setCropOpen] = useState(false);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [detectionAttempted, setDetectionAttempted] = useState(false);
  const [ocrDetails, setOcrDetails] = useState<ParsedCardDetails>({});
  const [speciesNames, setSpeciesNames] = useState<string[]>([]);
  const [nameQuery, setNameQuery] = useState('');
  const [pickedName, setPickedName] = useState('');
  const [asEx, setAsEx] = useState(false);
  const [asGx, setAsGx] = useState(false);
  const [asPromo, setAsPromo] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadPokemonSpeciesNames().then((names) => {
      if (!cancelled) setSpeciesNames(names);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const nameSuggestions = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    if (!q) {
      // Helpful defaults when foil OCR fails
      return ['Rayquaza', 'Charizard', 'Pikachu', 'Mewtwo', 'Giratina', 'Umbreon'].filter((n) =>
        speciesNames.some((s) => s.toLowerCase() === n.toLowerCase()),
      );
    }
    return speciesNames
      .filter((n) => n.toLowerCase().includes(q))
      .sort((a, b) => {
        const al = a.toLowerCase();
        const bl = b.toLowerCase();
        const aStarts = al.startsWith(q) ? 0 : 1;
        const bStarts = bl.startsWith(q) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return al.localeCompare(bl);
      })
      .slice(0, 12);
  }, [nameQuery, speciesNames]);

  if (!user) return null;
  const currentUser = user;

  const grid = useMemo(() => {
    const binder = targetBinderId
      ? currentUser.binders.find((b) => b.id === targetBinderId)
      : null;
    const size = binder?.size ?? '3x3';
    const cols = GRID_COLS[size];
    const slots = SLOT_COUNTS[size];
    const rows = Math.ceil(slots / cols);
    return { cols, rows, size };
  }, [currentUser.binders, targetBinderId]);

  function resetPreviewExtras() {
    setDetected([]);
    setOcrText('');
    setOcrDetails({});
    setNotes([]);
    setStatus(null);
    setDetectionAttempted(false);
    setNameQuery('');
    setPickedName('');
    setAsEx(false);
    setAsGx(false);
    setAsPromo(false);
  }

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) return;
    if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview);
    const url = URL.createObjectURL(file);
    setPreview(url);
    setPreviewFile(file);
    resetPreviewExtras();
    setNotes([
      'Photo ready — crop if needed, then run detection. We’ll try to fill name, set, number, and rarity from the card text.',
    ]);
  }

  async function resolveSourceDataUrl(): Promise<string | null> {
    if (preview?.startsWith('data:')) return preview;
    if (previewFile) return fileToDataUrl(previewFile);
    return preview;
  }

  async function openCrop() {
    const src = await resolveSourceDataUrl();
    if (!src) return;
    setCropSource(src);
    setCropOpen(true);
  }

  function applyCrop(croppedDataUrl: string) {
    if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview);
    setPreview(croppedDataUrl);
    setPreviewFile(null);
    setCropOpen(false);
    setCropSource(null);
    setNotes(['Crop applied — run detection to read name, set, number, and rarity.']);
  }

  async function runDetection() {
    if (!preview) return;
    setScanning(true);
    setStatus('Reading name, set, number, and rarity…');
    setDetected([]);
    setOcrText('');
    setOcrDetails({});
    setDetectionAttempted(false);
    try {
      const result =
        mode === 'card'
          ? await detectSingleCard(preview)
          : await detectBinderPage(preview, grid.cols, grid.rows);

      const photo = await resolveSourceDataUrl();
      const named = result.cards
        .filter(isPokemonNameCard)
        .map((card) => ({
          ...card,
          imageDataUrl: mode === 'card' ? photo ?? card.imageDataUrl : card.imageDataUrl,
          imageUrl: undefined,
        }));

      setDetected(named);
      setOcrText(result.ocrText);
      setOcrDetails(result.details ?? {});
      setNotes(result.notes);
      setDetectionAttempted(true);
      if (named.length === 0 && mode === 'card') {
        setNameQuery(result.details?.name ?? 'Rayquaza');
      }
      setStatus(null);
    } catch (err) {
      setStatus(null);
      setDetectionAttempted(true);
      setNotes([
        err instanceof Error
          ? err.message
          : 'Detection failed. Pick the Pokémon name below to add your photo.',
      ]);
    } finally {
      setScanning(false);
    }
  }

  async function confirmPickedName(e?: FormEvent) {
    e?.preventDefault();
    const base = (pickedName || nameQuery).trim();
    if (!base || !preview) return;
    const species = speciesNames.find((n) => n.toLowerCase() === base.toLowerCase());
    if (!species) {
      setNotes((n) => [
        ...n,
        'Choose a real Pokémon name from the list (e.g. Rayquaza). Free-typed names aren’t allowed.',
      ]);
      return;
    }
    let label = species.replace(/\s+(ex|gx)$/i, '').trim();
    if (asGx) label = `${label} GX`;
    else if (asEx) label = `${label} ex`;

    const photo = await resolveSourceDataUrl();
    const setName = asPromo
      ? ocrDetails.set && !/promo/i.test(ocrDetails.set)
        ? `${ocrDetails.set} Promo`
        : ocrDetails.set || 'Promo'
      : ocrDetails.set;
    const card = cardFromDetails(
      {
        name: label,
        set: setName,
        number: ocrDetails.number,
        rarity: ocrDetails.rarity,
      },
      photo ?? undefined,
    );
    setDetected([card]);
    const extras = [
      setName && `set ${setName}`,
      ocrDetails.number && `#${ocrDetails.number}`,
      ocrDetails.rarity && ocrDetails.rarity,
    ].filter(Boolean);
    setNotes([
      extras.length
        ? `Using ${label} with ${extras.join(' · ')} from the card text.`
        : `Using Pokémon name: ${label}.`,
    ]);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }

  function removeDetected(id: string) {
    setDetected((prev) => prev.filter((c) => c.id !== id));
  }

  function addToCollectionOnly() {
    const cards = detected.filter(isPokemonNameCard);
    if (cards.length === 0) return;
    addCards(cards);
    setDetected([]);
    setPreview(null);
    setPreviewFile(null);
    navigate('/collection');
  }

  function fillBinder() {
    const cards = detected.filter(isPokemonNameCard);
    if (cards.length === 0) return;
    addCards(cards);

    let binder = targetBinderId
      ? currentUser.binders.find((b) => b.id === targetBinderId)
      : undefined;

    if (!binder) {
      binder = createBinder({
        name: 'Scanned page binder',
        style: 'midnight',
        size: grid.size,
        pageCount: 2,
      });
    }

    const pages = binder.pages.map((p) => ({ slots: [...p.slots] }));
    const page =
      pages[0] ?? {
        slots: Array.from({ length: SLOT_COUNTS[binder.size] }, () => null),
      };
    cards.forEach((card, i) => {
      if (i < page.slots.length) page.slots[i] = card.id;
    });
    pages[0] = page;
    updateBinder(binder.id, { pages });
    setDetected([]);
    setPreview(null);
    setPreviewFile(null);
    navigate(`/binder/${binder.id}`);
  }

  return (
    <HomeAppShell>
      <div className="page-header">
          <div>
            <h1>Scan &amp; upload</h1>
            <p>
              Upload a card photo and run detection. We’ll fill name, set, number, and rarity from the
              text on the card when we can.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: '1.25rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`btn ${mode === 'card' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => {
              setMode('card');
              setPreview(null);
              setPreviewFile(null);
              resetPreviewExtras();
            }}
          >
            Single card
          </button>
          <button
            type="button"
            className={`btn ${mode === 'page' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => {
              setMode('page');
              setPreview(null);
              setPreviewFile(null);
              resetPreviewExtras();
            }}
          >
            Full binder page
          </button>
        </div>

        {mode === 'page' && (
          <div className="field" style={{ maxWidth: 360, marginBottom: '1rem' }}>
            <label htmlFor="target-binder">Fill binder (optional)</label>
            <select
              id="target-binder"
              value={targetBinderId}
              onChange={(e) => setTargetBinderId(e.target.value)}
            >
              <option value="">Create new binder from scan ({grid.size})</option>
              {user.binders.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.size})
                </option>
              ))}
            </select>
          </div>
        )}

        <div
          className={`scan-drop ${dragging ? 'dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <ImagePlus size={36} color="#2c71f6" />
          <strong>
            {mode === 'page' ? 'Drop a photo of a binder page' : 'Drop a photo of one card'}
          </strong>
          <p className="muted" style={{ margin: 0 }}>
            Reads the printed name, set symbol, collector number, and rarity from the photo.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => inputRef.current?.click()}>
            <Camera size={16} /> Choose photo
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
        </div>

        {preview && (
          <div style={{ marginTop: '1.5rem', display: 'grid', gap: '1rem' }}>
            <div className={`scan-preview${mode === 'card' ? ' scan-preview--card' : ''}`}>
              <img src={preview} alt="Upload preview" />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {mode === 'card' && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={scanning}
                  onClick={() => void openCrop()}
                >
                  <Crop size={16} /> Crop photo
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary"
                disabled={scanning}
                onClick={() => void runDetection()}
              >
                {scanning ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
                Run detection
              </button>
            </div>
            {(scanning || status) && (
              <p className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Loader2 size={16} className="spin" /> {status ?? 'Detecting cards…'}
              </p>
            )}
            {notes.map((note) => (
              <p key={note} className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
                {note}
              </p>
            ))}
          </div>
        )}

        {mode === 'card' && preview && detectionAttempted && detected.length === 0 && (
          <section className="panel" style={{ marginTop: '1.5rem', display: 'grid', gap: '0.85rem' }}>
            <h2 style={{ fontSize: '1.15rem', margin: 0 }}>Choose Pokémon name</h2>
            <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
              Foil names are often hard to read. Pick the Pokémon below — any set, number, or rarity
              we already found on the card will still fill in.
              {(ocrDetails.set || ocrDetails.number || ocrDetails.rarity) && (
                <>
                  {' '}
                  Found:{' '}
                  {[
                    ocrDetails.set,
                    ocrDetails.number && `#${ocrDetails.number}`,
                    ocrDetails.rarity,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  .
                </>
              )}
            </p>
            <form onSubmit={(e) => void confirmPickedName(e)} style={{ display: 'grid', gap: '0.75rem' }}>
              <div className="field">
                <label htmlFor="poke-name">Pokémon</label>
                <input
                  id="poke-name"
                  value={nameQuery}
                  onChange={(e) => {
                    setNameQuery(e.target.value);
                    setPickedName('');
                  }}
                  placeholder="Start typing — Rayquaza, Charizard…"
                  autoComplete="off"
                />
              </div>
              {nameSuggestions.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {nameSuggestions.map((name) => (
                    <button
                      key={name}
                      type="button"
                      className={`btn ${pickedName === name || (!pickedName && nameQuery.toLowerCase() === name.toLowerCase()) ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ padding: '0.35rem 0.7rem', fontSize: '0.85rem' }}
                      onClick={() => {
                        setPickedName(name);
                        setNameQuery(name);
                      }}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem 1.25rem' }}>
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    color: 'var(--muted)',
                    fontSize: '0.9rem',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={asEx}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setAsEx(on);
                      if (on) setAsGx(false);
                    }}
                  />
                  ex
                </label>
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    color: 'var(--muted)',
                    fontSize: '0.9rem',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={asGx}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setAsGx(on);
                      if (on) setAsEx(false);
                    }}
                  />
                  GX
                </label>
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    color: 'var(--muted)',
                    fontSize: '0.9rem',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={asPromo}
                    onChange={(e) => setAsPromo(e.target.checked)}
                  />
                  Promo
                </label>
              </div>
              <button type="submit" className="btn btn-primary" style={{ justifySelf: 'start' }}>
                Use this name
              </button>
            </form>
          </section>
        )}

        {detected.length > 0 && (
          <section style={{ marginTop: '2rem' }}>
            <h2 style={{ fontSize: '1.4rem', marginBottom: '0.75rem' }}>
              Ready to add ({detected.length})
            </h2>
            <div className="grid-cards">
              {detected.map((card) => (
                <div key={card.id} className="collection-item">
                  <TcgCard card={card} />
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: '0.4rem 0.7rem', fontSize: '0.85rem' }}
                    onClick={() => removeDetected(card.id)}
                  >
                    <Trash2 size={14} /> Remove
                  </button>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary" onClick={addToCollectionOnly}>
                Add to collection only
              </button>
              {mode === 'page' && (
                <button type="button" className="btn btn-primary" onClick={fillBinder}>
                  Add &amp; fill binder
                </button>
              )}
              {mode === 'card' && (
                <button type="button" className="btn btn-primary" onClick={addToCollectionOnly}>
                  Save to collection
                </button>
              )}
            </div>
          </section>
        )}

        {ocrText && (
          <details style={{ marginTop: '1.5rem' }}>
            <summary className="muted" style={{ cursor: 'pointer' }}>
              Show OCR text
            </summary>
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--line)',
                borderRadius: 12,
                padding: '0.85rem',
                fontSize: '0.8rem',
                color: 'var(--muted)',
              }}
            >
              {ocrText}
            </pre>
          </details>
        )}

        {cropOpen && cropSource && (
          <ImageCropModal
            src={cropSource}
            onCancel={() => {
              setCropOpen(false);
              setCropSource(null);
            }}
            onConfirm={applyCrop}
          />
        )}
      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </HomeAppShell>
  );
}
