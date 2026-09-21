import { useRef, useState, type FormEvent } from 'react';
import { ImagePlus } from 'lucide-react';
import type { Binder } from '../types';
import { BINDER_COVER_PRESETS, type BinderCoverPreset } from '../lib/binderCovers';
import { BinderCoverPreview } from './BinderCoverPreview';

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read image.'));
    reader.readAsDataURL(file);
  });
}

export type BinderEditValues = {
  name: string;
  coverPreset: BinderCoverPreset;
  previewImageDataUrl?: string;
};

interface Props {
  title: string;
  submitLabel: string;
  initial: BinderEditValues;
  /** Style/size used only for live preview chrome */
  previewBinder: Pick<Binder, 'style' | 'size'>;
  onClose: () => void;
  onSubmit: (values: BinderEditValues) => void;
}

export function BinderEditModal({
  title,
  submitLabel,
  initial,
  previewBinder,
  onClose,
  onSubmit,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initial.name);
  const [coverPreset, setCoverPreset] = useState<BinderCoverPreset>(initial.coverPreset);
  const [previewImageDataUrl, setPreviewImageDataUrl] = useState<string | undefined>(
    initial.previewImageDataUrl,
  );

  async function onPickFile(file: File | undefined) {
    if (!file || !file.type.startsWith('image/')) return;
    const dataUrl = await fileToDataUrl(file);
    setPreviewImageDataUrl(dataUrl);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({
      name: name.trim(),
      coverPreset,
      previewImageDataUrl,
    });
  }

  const livePreview: Pick<Binder, 'style' | 'size' | 'coverPreset' | 'previewImageDataUrl'> = {
    ...previewBinder,
    coverPreset,
    previewImageDataUrl,
  };

  return (
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
          width: 'min(480px, 100%)',
          display: 'grid',
          gap: '0.9rem',
          maxHeight: '90vh',
          overflow: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2 style={{ fontSize: '1.4rem' }}>{title}</h2>

        <BinderCoverPreview binder={livePreview} />

        <div className="field">
          <label htmlFor="binder-edit-name">Name</label>
          <input
            id="binder-edit-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Main set binder"
            required
          />
        </div>

        <div className="field">
          <label>Cover art</label>
          <div className="cover-preset-grid">
            {BINDER_COVER_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`cover-preset-chip ${coverPreset === preset.id && !previewImageDataUrl ? 'active' : ''}`}
                onClick={() => {
                  setCoverPreset(preset.id);
                  setPreviewImageDataUrl(undefined);
                }}
                title={preset.label}
              >
                <span className="cover-preset-swatch" style={{ background: preset.face }} />
                <span>{preset.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Custom preview image</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => inputRef.current?.click()}
            >
              <ImagePlus size={16} /> Upload image
            </button>
            {previewImageDataUrl && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setPreviewImageDataUrl(undefined)}
              >
                Use cover art instead
              </button>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => void onPickFile(e.target.files?.[0])}
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
  );
}
