import type { CSSProperties } from 'react';
import type { Binder } from '../types';
import { BINDER_STYLES } from '../types';
import { getBinderCover } from '../lib/binderCovers';

export function BinderCoverPreview({
  binder,
  className = '',
}: {
  binder: Pick<Binder, 'style' | 'size' | 'coverPreset' | 'previewImageDataUrl'>;
  className?: string;
}) {
  const styleMeta = BINDER_STYLES.find((s) => s.id === binder.style) ?? BINDER_STYLES[0];
  const cover = getBinderCover(binder.coverPreset);
  const cols = Number(binder.size.split('x')[0]) || 3;
  const hasCustom = Boolean(binder.previewImageDataUrl);

  const faceStyle: CSSProperties = hasCustom
    ? {
        backgroundImage: `url(${binder.previewImageDataUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : {
        background: binder.coverPreset ? cover.face : styleMeta.cover,
      };

  const spineColor = hasCustom
    ? 'rgba(0,0,0,0.55)'
    : binder.coverPreset
      ? cover.spine
      : styleMeta.spine;

  return (
    <div className={`binder-cover-mini ${className}`.trim()} style={faceStyle}>
      <div className="spine" style={{ background: spineColor }} />
      {!hasCustom && (
        <div
          className="sheet"
          style={{ gridTemplateColumns: `repeat(${Math.min(cols, 4)}, 1fr)` }}
        >
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} />
          ))}
        </div>
      )}
      {hasCustom && <div className="binder-cover-mini__shade" aria-hidden />}
    </div>
  );
}
