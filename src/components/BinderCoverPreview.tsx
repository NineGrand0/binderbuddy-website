import type { CSSProperties } from 'react';
import type { Binder } from '../types';
import { getBinderStyle, leatherCssVars } from '../types';

export function BinderCoverPreview({
  binder,
  className = '',
}: {
  binder: Pick<Binder, 'style' | 'size' | 'coverPreset' | 'previewImageDataUrl'>;
  className?: string;
}) {
  const styleMeta = getBinderStyle(binder.style);
  const cols = Number(binder.size.split('x')[0]) || 3;
  const hasCustom = Boolean(binder.previewImageDataUrl);
  const isPokeball = styleMeta.id === 'pokeball' && !hasCustom;

  const faceStyle: CSSProperties = {
    ...(leatherCssVars(styleMeta) as CSSProperties),
    ...(hasCustom
      ? {
          backgroundImage: `url(${binder.previewImageDataUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }
      : {}),
  };

  return (
    <div
      className={`binder-cover-mini ${className}`.trim()}
      data-style={styleMeta.id}
      style={faceStyle}
    >
      <div
        className="spine"
        style={{
          background: hasCustom
            ? 'rgba(0,0,0,0.55)'
            : `linear-gradient(90deg, ${styleMeta.spine}, ${styleMeta.spineHi} 62%, ${styleMeta.spine})`,
        }}
      />
      {isPokeball && (
        <div className="binder-pokeball" aria-hidden>
          <span className="binder-pokeball__band" />
          <span className="binder-pokeball__button" />
        </div>
      )}
      {!hasCustom && !isPokeball && (
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
