import type { Binder, BinderValuePoint, Card } from '../types';

export type PriceView = 'daily' | 'weekly' | 'monthly' | 'yearly';

export const PRICE_VIEWS: { id: PriceView; label: string }[] = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'yearly', label: 'Yearly' },
];

export interface BinderValue {
  total: number;
  currency: string;
  priced: number;
  cards: number;
}

export interface SeriesPoint {
  key: string;
  /** Short axis label. */
  label: string;
  /** Tooltip label. */
  detail: string;
  /** Last known binder total at the end of the period; null before tracking started. */
  value: number | null;
}

const MAX_TRACKED_DAYS = 20 * 366;

export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDay(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function slottedCards(binder: Pick<Binder, 'pages'>, collection: Card[]): Card[] {
  const byId = new Map(collection.map((card) => [card.id, card]));
  const cards: Card[] = [];
  for (const page of binder.pages) {
    for (const slot of page.slots) {
      const card = slot ? byId.get(slot) : undefined;
      if (card) cards.push(card);
    }
  }
  return cards;
}

export function computeBinderValue(binder: Pick<Binder, 'pages'>, collection: Card[]): BinderValue {
  const cards = slottedCards(binder, collection);
  const priced = cards.filter((card) => card.priceStatus === 'priced' && card.price);
  const total = priced.reduce((sum, card) => sum + (card.price?.amount ?? 0), 0);
  return {
    total: Math.round(total * 100) / 100,
    currency: priced[0]?.price?.currency ?? 'USD',
    priced: priced.length,
    cards: cards.length,
  };
}

function samePoint(a: BinderValuePoint, b: BinderValuePoint) {
  return a.total === b.total && a.currency === b.currency && a.priced === b.priced && a.cards === b.cards;
}

/**
 * Records today's value. Returns the new history, or null when nothing changed
 * (unchanged days are carried forward when the graph is drawn).
 */
export function recordValue(
  history: BinderValuePoint[] | undefined,
  value: BinderValue,
  today = dayKey(new Date()),
): BinderValuePoint[] | null {
  const list = history ?? [];
  const point: BinderValuePoint = { date: today, ...value };
  const last = list[list.length - 1];
  if (last && last.date === today) {
    return samePoint(last, point) ? null : [...list.slice(0, -1), point];
  }
  if (last && samePoint(last, point)) return null;
  return [...list, point];
}

/** Day 0 of the graph: the creation day, or the first recorded day if creation is unknown. */
export function binderStartDay(createdAt: string | undefined, history?: BinderValuePoint[]): string {
  const created = createdAt ? new Date(createdAt) : null;
  if (created && !Number.isNaN(created.getTime())) return dayKey(created);
  return history?.[0]?.date ?? dayKey(new Date());
}

/** Day 0 entry for a brand-new, empty binder. */
export function initialValueHistory(createdAt: Date): BinderValuePoint[] {
  return [{ date: dayKey(createdAt), total: 0, currency: 'USD', priced: 0, cards: 0 }];
}

const shortDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const longDay = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const shortMonth = new Intl.DateTimeFormat(undefined, { month: 'short', year: '2-digit' });
const longMonth = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });

/** Graph points from day 0 (binder creation) to today, one per day/week/month/year. */
export function buildValueSeries(
  history: BinderValuePoint[] | undefined,
  startDay: string,
  view: PriceView,
  today = dayKey(new Date()),
): SeriesPoint[] {
  const sorted = [...(history ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  let start = sorted[0] && sorted[0].date < startDay ? sorted[0].date : startDay;
  const earliest = dayKey(addDays(parseDay(today), -MAX_TRACKED_DAYS));
  if (start < earliest) start = earliest;
  if (start > today) start = today;

  const days: { date: Date; value: number | null }[] = [];
  let index = 0;
  let current: number | null = null;
  for (let date = parseDay(start); dayKey(date) <= today; date = addDays(date, 1)) {
    const key = dayKey(date);
    while (index < sorted.length && sorted[index].date <= key) {
      current = sorted[index].total;
      index += 1;
    }
    days.push({ date, value: current });
  }

  if (view === 'daily') {
    return days.map(({ date, value }, i) => ({
      key: dayKey(date),
      label: shortDay.format(date),
      detail: `${longDay.format(date)} · Day ${i}`,
      value,
    }));
  }

  const buckets = new Map<string, SeriesPoint>();
  days.forEach(({ date, value }, i) => {
    let key: string;
    let label: string;
    let detail: string;
    if (view === 'weekly') {
      const week = Math.floor(i / 7);
      const weekStart = addDays(parseDay(start), week * 7);
      key = `w${week}`;
      label = shortDay.format(weekStart);
      const weekEnd = addDays(weekStart, 6);
      detail = `Week ${week + 1} · ${shortDay.format(weekStart)} – ${shortDay.format(weekEnd)}`;
    } else if (view === 'monthly') {
      key = `${date.getFullYear()}-${date.getMonth()}`;
      label = shortMonth.format(date);
      detail = longMonth.format(date);
    } else {
      key = String(date.getFullYear());
      label = key;
      detail = key;
    }
    // Later days overwrite earlier ones, so each bucket holds its end-of-period value
    buckets.set(key, { key, label, detail, value });
  });
  return [...buckets.values()];
}

export function formatMoney(amount: number, currency = 'USD', compact = false): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      notation: compact ? 'compact' : 'standard',
      maximumFractionDigits: compact ? 1 : 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
