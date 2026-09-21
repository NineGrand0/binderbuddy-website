import { useState, type FormEvent, type ReactNode, type MouseEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Pencil, Plus } from 'lucide-react';
import { HomeAppShell } from '../components/Layout';
import { BinderCoverPreview } from '../components/BinderCoverPreview';
import { BinderEditModal, type BinderEditValues } from '../components/BinderEditModal';
import { useStore } from '../store/Store';
import {
  BINDER_SIZES,
  BINDER_STYLES,
  type Binder,
  type BinderSize,
  type BinderStyle,
} from '../types';
import { BINDER_COVER_PRESETS, type BinderCoverPreset } from '../lib/binderCovers';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useStore();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function DashboardPage() {
  return (
    <RequireAuth>
      <DashboardInner />
    </RequireAuth>
  );
}

function DashboardInner() {
  const { user, createBinder, updateBinder } = useStore();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Binder | null>(null);
  const [name, setName] = useState('');
  const [style, setStyle] = useState<BinderStyle>('midnight');
  const [size, setSize] = useState<BinderSize>('3x3');
  const [coverPreset, setCoverPreset] = useState<BinderCoverPreset>('classic');

  if (!user) return null;

  function onCreate(e: FormEvent) {
    e.preventDefault();
    const binder = createBinder({ name, style, size, pageCount: 4, coverPreset });
    navigate(`/binder/${binder.id}`);
  }

  function onSaveEdit(values: BinderEditValues) {
    if (!editing) return;
    updateBinder(editing.id, {
      name: values.name,
      coverPreset: values.coverPreset,
      previewImageDataUrl: values.previewImageDataUrl,
    });
    setEditing(null);
  }

  function openEdit(e: MouseEvent, binder: Binder) {
    e.preventDefault();
    e.stopPropagation();
    setEditing(binder);
  }

  return (
    <HomeAppShell>
      <div className="page-header">
        <div>
          <h1>Your binders</h1>
          <p>Plan layouts, flip pages, and keep every pocket in sync with your collection.</p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setName('');
            setCoverPreset('classic');
            setOpen(true);
          }}
        >
          <Plus size={18} /> New binder
        </button>
      </div>

        {user.binders.length === 0 ? (
          <div className="empty-state">
            No binders yet. Create one to start placing cards from your collection.
          </div>
        ) : (
          <div className="grid-binders">
            {user.binders.map((b) => {
              const styleMeta = BINDER_STYLES.find((s) => s.id === b.style)!;
              const filled = b.pages.reduce(
                (n, p) => n + p.slots.filter(Boolean).length,
                0,
              );
              return (
                <div key={b.id} className="binder-tile">
                  <Link to={`/binder/${b.id}`} className="binder-tile__link">
                    <BinderCoverPreview binder={b} />
                    <div>
                      <strong style={{ fontFamily: 'Outfit, var(--font-display)', fontSize: '1.15rem' }}>
                        {b.name}
                      </strong>
                      <div className="muted" style={{ fontSize: '0.85rem', marginTop: 4 }}>
                        {styleMeta.label} · {b.size} · {filled} cards · {b.pages.length} pages
                      </div>
                    </div>
                  </Link>
                  <button
                    type="button"
                    className="btn btn-ghost binder-tile__edit"
                    onClick={(e) => openEdit(e, b)}
                  >
                    <Pencil size={14} /> Edit
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {open && (
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
            onClick={() => setOpen(false)}
          >
            <form
              className="panel"
              style={{
                width: 'min(480px, 100%)',
                display: 'grid',
                gap: '0.9rem',
                maxHeight: '90vh',
                overflow: 'auto',
              }}
              onClick={(e) => e.stopPropagation()}
              onSubmit={onCreate}
            >
              <h2 style={{ fontSize: '1.4rem' }}>New binder</h2>
              <BinderCoverPreview
                binder={{ style, size, coverPreset }}
              />
              <div className="field">
                <label htmlFor="binder-name">Name</label>
                <input
                  id="binder-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Main set binder"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="binder-style">Style</label>
                <select
                  id="binder-style"
                  value={style}
                  onChange={(e) => setStyle(e.target.value as BinderStyle)}
                >
                  {BINDER_STYLES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="binder-size">Pocket size</label>
                <select
                  id="binder-size"
                  value={size}
                  onChange={(e) => setSize(e.target.value as BinderSize)}
                >
                  {BINDER_SIZES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label} — {s.desc}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <span id="binder-cover-label">Cover art</span>
                <div className="cover-preset-grid" role="group" aria-labelledby="binder-cover-label">
                  {BINDER_COVER_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={`cover-preset-chip ${coverPreset === preset.id ? 'active' : ''}`}
                      onClick={() => setCoverPreset(preset.id)}
                    >
                      <span className="cover-preset-swatch" style={{ background: preset.face }} />
                      <span>{preset.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Create
                </button>
              </div>
            </form>
          </div>
        )}

        {editing && (
          <BinderEditModal
            key={editing.id}
            title="Edit binder"
            submitLabel="Save changes"
            initial={{
              name: editing.name,
              coverPreset: editing.coverPreset ?? 'classic',
              previewImageDataUrl: editing.previewImageDataUrl,
            }}
            previewBinder={{ style: editing.style, size: editing.size }}
            onClose={() => setEditing(null)}
            onSubmit={onSaveEdit}
          />
        )}
    </HomeAppShell>
  );
}
