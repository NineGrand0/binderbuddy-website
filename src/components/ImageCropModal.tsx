import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, X } from 'lucide-react';

/** Standard trading-card aspect (width / height). */
export const CARD_ASPECT = 63 / 88;

type Rect = { x: number; y: number; w: number; h: number };
type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

interface Props {
  src: string;
  title?: string;
  onCancel: () => void;
  onConfirm: (croppedDataUrl: string) => void;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function initialCrop(imgW: number, imgH: number): Rect {
  const imageAspect = imgW / imgH;
  let w: number;
  let h: number;
  if (imageAspect > CARD_ASPECT) {
    h = imgH * 0.85;
    w = h * CARD_ASPECT;
  } else {
    w = imgW * 0.85;
    h = w / CARD_ASPECT;
  }
  return {
    x: (imgW - w) / 2,
    y: (imgH - h) / 2,
    w,
    h,
  };
}

function cropToDataUrl(img: HTMLImageElement, crop: Rect): string {
  const outW = Math.max(1, Math.round(crop.w));
  const outH = Math.max(1, Math.round(crop.h));
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not crop image.');
  try {
    ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, outW, outH);
    return canvas.toDataURL('image/jpeg', 0.92);
  } catch {
    throw new Error(
      'Could not crop this image (blocked by the image host). Try uploading your own photo instead.',
    );
  }
}

export function ImageCropModal({ src, title = 'Crop card photo', onCancel, onConfirm }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [display, setDisplay] = useState({ w: 0, h: 0, left: 0, top: 0 });
  const [crop, setCrop] = useState<Rect | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragRef = useRef<{
    handle: Handle;
    startX: number;
    startY: number;
    startCrop: Rect;
  } | null>(null);

  const measure = useCallback(() => {
    const stage = stageRef.current;
    const img = imgRef.current;
    if (!stage || !img || !img.naturalWidth) return;

    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const pad = 16;
    const maxW = stage.clientWidth - pad * 2;
    const maxH = stage.clientHeight - pad * 2;
    const scale = Math.min(maxW / nw, maxH / nh, 1);
    const dw = nw * scale;
    const dh = nh * scale;
    const left = (stage.clientWidth - dw) / 2;
    const top = (stage.clientHeight - dh) / 2;

    setNatural({ w: nw, h: nh });
    setDisplay({ w: dw, h: dh, left, top });
    setCrop((prev) => prev ?? initialCrop(nw, nh));
    setReady(true);
  }, []);

  useEffect(() => {
    setReady(false);
    setCrop(null);
    setError(null);
  }, [src]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(stage);
    return () => ro.disconnect();
  }, [measure]);

  function scale() {
    return display.w / natural.w || 1;
  }

  function toScreen(rect: Rect) {
    const s = scale();
    return {
      left: display.left + rect.x * s,
      top: display.top + rect.y * s,
      width: rect.w * s,
      height: rect.h * s,
    };
  }

  function onPointerDown(handle: Handle, e: ReactPointerEvent) {
    if (!crop) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startCrop: { ...crop },
    };
  }

  function onPointerMove(e: ReactPointerEvent) {
    const drag = dragRef.current;
    if (!drag || !natural.w) return;

    const s = scale();
    const dx = (e.clientX - drag.startX) / s;
    const dy = (e.clientY - drag.startY) / s;
    const { startCrop } = drag;
    let next: Rect = { ...startCrop };

    if (drag.handle === 'move') {
      next.x = clamp(startCrop.x + dx, 0, natural.w - startCrop.w);
      next.y = clamp(startCrop.y + dy, 0, natural.h - startCrop.h);
    } else {
      const minW = Math.min(natural.w, natural.h * CARD_ASPECT) * 0.15;
      let x1 = startCrop.x;
      let y1 = startCrop.y;
      let x2 = startCrop.x + startCrop.w;
      let y2 = startCrop.y + startCrop.h;

      if (drag.handle.includes('w')) x1 = startCrop.x + dx;
      if (drag.handle.includes('e')) x2 = startCrop.x + startCrop.w + dx;
      if (drag.handle.includes('n')) y1 = startCrop.y + dy;
      if (drag.handle.includes('s')) y2 = startCrop.y + startCrop.h + dy;

      // Lock aspect from the opposite corner
      const cx = drag.handle.includes('w') ? x2 : x1;
      const cy = drag.handle.includes('n') ? y2 : y1;

      let w = Math.abs(x2 - x1);
      let h = w / CARD_ASPECT;

      if (drag.handle.includes('n')) {
        y1 = cy - h;
        y2 = cy;
      } else {
        y1 = cy;
        y2 = cy + h;
      }
      if (drag.handle.includes('w')) {
        x1 = cx - w;
        x2 = cx;
      } else {
        x1 = cx;
        x2 = cx + w;
      }

      // Clamp inside image while keeping aspect
      if (x1 < 0) {
        x1 = 0;
        w = x2 - x1;
        h = w / CARD_ASPECT;
        if (drag.handle.includes('n')) y1 = y2 - h;
        else y2 = y1 + h;
      }
      if (y1 < 0) {
        y1 = 0;
        h = y2 - y1;
        w = h * CARD_ASPECT;
        if (drag.handle.includes('w')) x1 = x2 - w;
        else x2 = x1 + w;
      }
      if (x2 > natural.w) {
        x2 = natural.w;
        w = x2 - x1;
        h = w / CARD_ASPECT;
        if (drag.handle.includes('n')) y1 = y2 - h;
        else y2 = y1 + h;
      }
      if (y2 > natural.h) {
        y2 = natural.h;
        h = y2 - y1;
        w = h * CARD_ASPECT;
        if (drag.handle.includes('w')) x1 = x2 - w;
        else x2 = x1 + w;
      }

      w = Math.max(minW, x2 - x1);
      h = w / CARD_ASPECT;
      if (drag.handle.includes('w')) x1 = x2 - w;
      else x2 = x1 + w;
      if (drag.handle.includes('n')) y1 = y2 - h;
      else y2 = y1 + h;

      next = {
        x: clamp(Math.min(x1, x2), 0, natural.w),
        y: clamp(Math.min(y1, y2), 0, natural.h),
        w: clamp(w, minW, natural.w),
        h: clamp(h, minW / CARD_ASPECT, natural.h),
      };
      if (next.x + next.w > natural.w) next.x = natural.w - next.w;
      if (next.y + next.h > natural.h) next.y = natural.h - next.h;
    }

    setCrop(next);
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  function apply() {
    const img = imgRef.current;
    if (!img || !crop) return;
    try {
      setError(null);
      onConfirm(cropToDataUrl(img, crop));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not crop image.');
    }
  }

  const screen = crop ? toScreen(crop) : null;

  return (
    <div
      className="crop-modal"
      role="dialog"
      aria-modal
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="crop-modal__header">
        <div>
          <h2>{title}</h2>
          <p className="muted">Drag to move · corners to resize · locked to card shape</p>
          {error && (
            <p style={{ margin: '0.4rem 0 0', color: '#e86a7a', fontSize: '0.85rem' }}>{error}</p>
          )}
        </div>
        <div className="crop-modal__actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            <X size={16} /> Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!ready || !crop} onClick={apply}>
            <Check size={16} /> Use crop
          </button>
        </div>
      </div>

      <div className="crop-modal__stage" ref={stageRef}>
        <img
          ref={imgRef}
          src={src}
          alt="Crop source"
          className="crop-modal__image"
          crossOrigin={src.startsWith('http') ? 'anonymous' : undefined}
          style={{
            width: display.w || undefined,
            height: display.h || undefined,
            left: display.left,
            top: display.top,
            opacity: ready ? 1 : 0,
          }}
          onLoad={measure}
          draggable={false}
        />

        {ready && screen && (
          <div
            className="crop-modal__frame"
            style={{
              left: screen.left,
              top: screen.top,
              width: screen.width,
              height: screen.height,
            }}
            onPointerDown={(e) => onPointerDown('move', e)}
          >
            {(['nw', 'ne', 'sw', 'se'] as const).map((handle) => (
              <span
                key={handle}
                className={`crop-modal__handle crop-modal__handle--${handle}`}
                onPointerDown={(e) => onPointerDown(handle, e)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
