import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { BinderValuePoint } from '../types';
import { PRICE_VIEWS, buildValueSeries, formatMoney, type PriceView } from '../lib/binderValue';

const VIEW_KEY = 'bb_price_view';
const HEIGHT = 210;
const PAD = { top: 14, right: 14, bottom: 30, left: 60 };

function readView(): PriceView {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    if (PRICE_VIEWS.some((v) => v.id === saved)) return saved as PriceView;
  } catch {
    /* ignore private browsing */
  }
  return 'daily';
}

function niceMax(max: number, ticks: number): number {
  if (max <= 0) return 1;
  const raw = max / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / magnitude;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * magnitude;
  return step * ticks;
}

type Props = {
  history: BinderValuePoint[] | undefined;
  /** Day 0 — the binder's creation day (YYYY-MM-DD). */
  startDay: string;
  currency: string;
};

export function BinderPriceGraph({ history, startDay, currency }: Props) {
  const [view, setView] = useState<PriceView>(readView);
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(640);
  const wrapRef = useRef<HTMLDivElement>(null);
  const gradientId = useId();

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(240, Math.round(entry.contentRect.width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const series = useMemo(() => buildValueSeries(history, startDay, view), [history, startDay, view]);

  function chooseView(next: PriceView) {
    setView(next);
    setHover(null);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* ignore private browsing */
    }
  }

  const firstIndex = series.findIndex((p) => p.value !== null);
  const values = series.flatMap((p) => (p.value === null ? [] : [p.value]));
  const hasData = values.length > 0;
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const top = niceMax(hasData ? Math.max(...values) : 0, 4);
  const x = (i: number) =>
    PAD.left + (series.length <= 1 ? plotW / 2 : (i * plotW) / (series.length - 1));
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;

  const line = series
    .map((p, i) => (p.value === null ? null : `${i === firstIndex ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`))
    .filter(Boolean)
    .join(' ');
  const area =
    firstIndex >= 0
      ? `${line} L${x(series.length - 1).toFixed(1)},${y(0)} L${x(firstIndex).toFixed(1)},${y(0)} Z`
      : '';

  const maxLabels = Math.max(2, Math.floor(plotW / 84));
  const labelStep = Math.max(1, Math.ceil(series.length / maxLabels));
  const yTicks = [0, 1, 2, 3, 4].map((n) => (top / 4) * n);

  const lastIndex = series.length - 1;
  const focusIndex = hover ?? lastIndex;
  const focus = series[focusIndex];
  const first = firstIndex >= 0 ? series[firstIndex].value ?? 0 : 0;
  const focusValue = focus?.value ?? null;
  const change = focusValue === null ? null : focusValue - first;
  const changePct = change !== null && first > 0 ? (change / first) * 100 : null;

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    if (series.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * width;
    const ratio = series.length <= 1 ? 0 : (px - PAD.left) / plotW;
    setHover(Math.min(lastIndex, Math.max(0, Math.round(ratio * lastIndex))));
  }

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const delta = event.key === 'ArrowLeft' ? -1 : 1;
    setHover(Math.min(lastIndex, Math.max(0, focusIndex + delta)));
  }

  return (
    <div className="price-graph">
      <div className="price-graph__head">
        <div className="price-graph__readout" aria-live="polite">
          <span className="muted">{focus?.detail ?? 'Day 0'}</span>
          <strong>{focusValue === null ? 'No price yet' : formatMoney(focusValue, currency)}</strong>
          {change !== null && firstIndex < focusIndex && (
            <span className={change > 0 ? 'is-up' : change < 0 ? 'is-down' : 'muted'}>
              {change >= 0 ? '+' : '−'}
              {formatMoney(Math.abs(change), currency)}
              {changePct !== null && ` (${change >= 0 ? '+' : '−'}${Math.abs(changePct).toFixed(1)}%)`}
              <span className="muted"> since {series[firstIndex].label}</span>
            </span>
          )}
        </div>
        <div className="price-graph__views" role="group" aria-label="Graph period">
          {PRICE_VIEWS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={view === option.id ? 'is-active' : ''}
              aria-pressed={view === option.id}
              onClick={() => chooseView(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={wrapRef} className="price-graph__plot">
        {!hasData ? (
          <p className="muted price-graph__empty">
            No prices recorded yet. Prices you add or refresh will start the graph.
          </p>
        ) : (
          <svg
            width={width}
            height={HEIGHT}
            viewBox={`0 0 ${width} ${HEIGHT}`}
            role="img"
            tabIndex={0}
            aria-label={`Binder value ${view}, ${formatMoney(first, currency)} at day 0 to ${formatMoney(
              values[values.length - 1],
              currency,
            )} now. Use arrow keys to step through.`}
            onPointerMove={onPointerMove}
            onPointerLeave={() => setHover(null)}
            onKeyDown={onKeyDown}
            onBlur={() => setHover(null)}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
                <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
              </linearGradient>
            </defs>
            {yTicks.map((tick) => (
              <g key={tick}>
                <line
                  className="price-graph__grid"
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={y(tick)}
                  y2={y(tick)}
                />
                <text className="price-graph__axis" x={PAD.left - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle">
                  {formatMoney(tick, currency, true)}
                </text>
              </g>
            ))}
            {series.map((point, i) =>
              i % labelStep === 0 ? (
                <text
                  key={point.key}
                  className="price-graph__axis"
                  x={x(i)}
                  y={HEIGHT - 8}
                  textAnchor={series.length === 1 ? 'middle' : i === 0 ? 'start' : 'middle'}
                >
                  {point.label}
                </text>
              ) : null,
            )}
            <path d={area} fill={`url(#${gradientId})`} className="price-graph__area" />
            <path d={line} className="price-graph__line" />
            {(values.length === 1 || hover !== null) && focusValue !== null && (
              <>
                {hover !== null && (
                  <line
                    className="price-graph__cursor"
                    x1={x(focusIndex)}
                    x2={x(focusIndex)}
                    y1={PAD.top}
                    y2={PAD.top + plotH}
                  />
                )}
                <circle className="price-graph__dot" cx={x(focusIndex)} cy={y(focusValue)} r={4.5} />
              </>
            )}
          </svg>
        )}
      </div>
    </div>
  );
}
