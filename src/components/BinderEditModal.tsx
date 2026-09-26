import { useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { ImagePlus } from 'lucide-react';
import type { Binder, BinderStyle } from '../types';
import { BINDER_STYLES, leatherCssVars, normalizeBinderStyle } from '../types';
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
  style: BinderStyle;
  previewImageDataUrl?: string;
};

interface Props {
  title: string;
  submitLabel: string;
  initial: BinderEditValues;
  /** Size used only for live preview chrome */
  previewBinder: Pick<Binder, 'size'>;
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
  const [style, setStyle] = useState<BinderStyle>(normalizeBinderStyle(initial.style));
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
      style,
      previewImageDataUrl,
    });
  }

  const livePreview: Pick<Binder, 'style' | 'size' | 'previewImageDataUrl'> = {
    ...previewBinder,
    style,
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
          <label>Binder style</label>
          <div className="style-options">
            {BINDER_STYLES.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`style-chip ${style === option.id && !previewImageDataUrl ? 'active' : ''}`}
                onClick={() => {
                  setStyle(option.id);
                  setPreviewImageDataUrl(undefined);
                }}
              >
                <span
                  className={`style-swatch${option.id === 'pokeball' ? ' is-pokeball' : ''}`}
                  style={leatherCssVars(option) as CSSProperties}
                />
                {option.label}
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
                Use binder style instead
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
