import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, RotateCcw, RotateCw, X } from 'lucide-react';

/** Standard trading-card aspect (width / height). */
export const CARD_ASPECT = 63 / 88;

type Rect = { x: number; y: number; w: number; h: number };
type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

interface Props {
  src: string;
  title?: string;
  /** Card shape when omitted. Pass null to resize freely. */
  aspect?: number | null;
  onCancel: () => void;
  onConfirm: (croppedDataUrl: string) => void;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function initialCrop(imgW: number, imgH: number, aspect: number | null): Rect {
  if (aspect == null) {
    const insetX = imgW * 0.08;
    const insetY = imgH * 0.08;
    return { x: insetX, y: insetY, w: imgW - insetX * 2, h: imgH - insetY * 2 };
  }
  const imageAspect = imgW / imgH;
  let w: number;
  let h: number;
  if (imageAspect > aspect) {
    h = imgH * 0.85;
    w = h * aspect;
  } else {
    w = imgW * 0.85;
    h = w / aspect;
  }
  return {
    x: (imgW - w) / 2,
    y: (imgH - h) / 2,
    w,
    h,
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (src.startsWith('http')) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image for crop.'));
    img.src = src;
  });
}

/** Draw the source rotated around its centre into a fitted canvas. */
function rotateToDataUrl(img: HTMLImageElement, degrees: number): { dataUrl: string; w: number; h: number } {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const w = Math.max(1, Math.ceil(Math.abs(img.naturalWidth * cos) + Math.abs(img.naturalHeight * sin)));
  const h = Math.max(1, Math.ceil(Math.abs(img.naturalWidth * sin) + Math.abs(img.naturalHeight * cos)));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not rotate image.');
  ctx.translate(w / 2, h / 2);
  ctx.rotate(rad);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.92), w, h };
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

export function ImageCropModal({
  src,
  title = 'Crop card photo',
  aspect = CARD_ASPECT,
  onCancel,
  onConfirm,
}: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [rotation, setRotation] = useState(0);
  const [workingSrc, setWorkingSrc] = useState(src);
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

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setCrop(null);
    setError(null);
    setRotation(0);
    setWorkingSrc(src);

    void (async () => {
      try {
        const img = await loadImage(src);
        if (cancelled) return;
        setNatural({ w: img.naturalWidth, h: img.naturalHeight });
        setWorkingSrc(src);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load image.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src]);

  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    const degrees = ((rotation % 360) + 360) % 360;
    if (degrees === 0) {
      setWorkingSrc(src);
      setCrop(null);
      return;
    }

    void (async () => {
      try {
        const img = await loadImage(src);
        if (cancelled) return;
        const rotated = rotateToDataUrl(img, rotation);
        if (cancelled) return;
        setWorkingSrc(rotated.dataUrl);
        setNatural({ w: rotated.w, h: rotated.h });
        setCrop(null);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not rotate image.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rotation, src]);

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
    setCrop((prev) => prev ?? initialCrop(nw, nh, aspect));
    setReady(true);
  }, [aspect]);

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

  function nudgeRotation(delta: number) {
    setRotation((value) => Math.round((value + delta) * 10) / 10);
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
    } else if (aspect == null) {
      const minSize = Math.min(natural.w, natural.h) * 0.08;
      let x1 = startCrop.x;
      let y1 = startCrop.y;
      let x2 = startCrop.x + startCrop.w;
      let y2 = startCrop.y + startCrop.h;
      if (drag.handle.includes('w')) x1 = startCrop.x + dx;
      if (drag.handle.includes('e')) x2 = startCrop.x + startCrop.w + dx;
      if (drag.handle.includes('n')) y1 = startCrop.y + dy;
      if (drag.handle.includes('s')) y2 = startCrop.y + startCrop.h + dy;
      x1 = clamp(x1, 0, natural.w - minSize);
      y1 = clamp(y1, 0, natural.h - minSize);
      x2 = clamp(x2, minSize, natural.w);
      y2 = clamp(y2, minSize, natural.h);
      if (x2 - x1 < minSize) {
        if (drag.handle.includes('w')) x1 = x2 - minSize;
        else x2 = x1 + minSize;
      }
      if (y2 - y1 < minSize) {
        if (drag.handle.includes('n')) y1 = y2 - minSize;
        else y2 = y1 + minSize;
      }
      next = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    } else {
      const minW = Math.min(natural.w, natural.h * aspect) * 0.15;
      let x1 = startCrop.x;
      let y1 = startCrop.y;
      let x2 = startCrop.x + startCrop.w;
      let y2 = startCrop.y + startCrop.h;

      if (drag.handle.includes('w')) x1 = startCrop.x + dx;
      if (drag.handle.includes('e')) x2 = startCrop.x + startCrop.w + dx;
      if (drag.handle.includes('n')) y1 = startCrop.y + dy;
      if (drag.handle.includes('s')) y2 = startCrop.y + startCrop.h + dy;

      const cx = drag.handle.includes('w') ? x2 : x1;
      const cy = drag.handle.includes('n') ? y2 : y1;

      let w = Math.abs(x2 - x1);
      let h = w / aspect;

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

      if (x1 < 0) {
        x1 = 0;
        w = x2 - x1;
        h = w / aspect;
        if (drag.handle.includes('n')) y1 = y2 - h;
        else y2 = y1 + h;
      }
      if (y1 < 0) {
        y1 = 0;
        h = y2 - y1;
        w = h * aspect;
        if (drag.handle.includes('w')) x1 = x2 - w;
        else x2 = x1 + w;
      }
      if (x2 > natural.w) {
        x2 = natural.w;
        w = x2 - x1;
        h = w / aspect;
        if (drag.handle.includes('n')) y1 = y2 - h;
        else y2 = y1 + h;
      }
      if (y2 > natural.h) {
        y2 = natural.h;
        h = y2 - y1;
        w = h * aspect;
        if (drag.handle.includes('w')) x1 = x2 - w;
        else x2 = x1 + w;
      }

      w = Math.max(minW, x2 - x1);
      h = w / aspect;
      if (drag.handle.includes('w')) x1 = x2 - w;
      else x2 = x1 + w;
      if (drag.handle.includes('n')) y1 = y2 - h;
      else y2 = y1 + h;

      next = {
        x: clamp(Math.min(x1, x2), 0, natural.w),
        y: clamp(Math.min(y1, y2), 0, natural.h),
        w: clamp(w, minW, natural.w),
        h: clamp(h, minW / aspect, natural.h),
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
  const rotationLabel = `${rotation > 0 ? '+' : ''}${rotation.toFixed(1)}°`;

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
          <p className="muted">
            {aspect == null
              ? 'Rotate to straighten · drag to move · drag any corner into place'
              : 'Rotate to straighten · drag to move · corners to resize · locked to card shape'}
          </p>
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

      <div className="crop-modal__rotate">
        <button
          type="button"
          className="btn btn-secondary"
          aria-label="Rotate left 15 degrees"
          onClick={() => nudgeRotation(-15)}
        >
          <RotateCcw size={16} /> 15°
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          aria-label="Rotate left 1 degree"
          onClick={() => nudgeRotation(-1)}
        >
          <RotateCcw size={16} /> 1°
        </button>
        <label className="crop-modal__rotate-slider">
          <span>{rotationLabel}</span>
          <input
            type="range"
            min={-90}
            max={90}
            step={0.5}
            value={clamp(rotation, -90, 90)}
            onChange={(event) => setRotation(Number(event.target.value))}
          />
        </label>
        <button
          type="button"
          className="btn btn-secondary"
          aria-label="Rotate right 1 degree"
          onClick={() => nudgeRotation(1)}
        >
          1° <RotateCw size={16} />
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          aria-label="Rotate right 15 degrees"
          onClick={() => nudgeRotation(15)}
        >
          15° <RotateCw size={16} />
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={rotation === 0}
          onClick={() => setRotation(0)}
        >
          Reset
        </button>
      </div>

      <div className="crop-modal__stage" ref={stageRef}>
        <img
          ref={imgRef}
          key={workingSrc}
          src={workingSrc}
          alt="Crop source"
          className="crop-modal__image"
          crossOrigin={workingSrc.startsWith('http') ? 'anonymous' : undefined}
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
