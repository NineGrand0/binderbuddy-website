import {
  SLOT_COUNTS,
  normalizeBinderStyle,
  type Binder,
  type BinderPage,
  type BinderSize,
  type Card,
} from '../types';

const SIZES = new Set<BinderSize>(['2x2', '3x3', '4x3', '5x4']);

export interface PlanRecord {
  binder: Binder;
  cards: Card[];
}

function storageKey(userId: string) {
  return `bb_plan_${userId}`;
}

function emptyPages(size: BinderSize, count: number): BinderPage[] {
  const slots = SLOT_COUNTS[size];
  return Array.from({ length: count }, () => ({
    slots: Array.from({ length: slots }, () => null),
  }));
}

export function createPlanRecord(): PlanRecord {
  const now = new Date().toISOString();
  return {
    binder: {
      id: 'plan',
      name: 'Binder plan',
      style: 'black',
      size: '3x3',
      pages: emptyPages('3x3', 4),
      createdAt: now,
      updatedAt: now,
      isPublic: false,
    },
    cards: [],
  };
}

function isCard(value: unknown): value is Card {
  if (!value || typeof value !== 'object') return false;
  const card = value as Card;
  return typeof card.id === 'string' && typeof card.name === 'string';
}

function isPlanRecord(value: unknown): value is PlanRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as PlanRecord;
  return (
    !!record.binder &&
    typeof record.binder.id === 'string' &&
    SIZES.has(record.binder.size) &&
    Array.isArray(record.binder.pages) &&
    Array.isArray(record.cards) &&
    record.cards.every(isCard)
  );
}

export function loadPlan(userId: string): PlanRecord {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return createPlanRecord();
    const parsed: unknown = JSON.parse(raw);
    if (!isPlanRecord(parsed)) return createPlanRecord();
    return {
      cards: parsed.cards,
      binder: {
        ...parsed.binder,
        style: normalizeBinderStyle(String(parsed.binder.style)),
        isPublic: false,
      },
    };
  } catch {
    return createPlanRecord();
  }
}

export function savePlan(userId: string, plan: PlanRecord) {
  const next: PlanRecord = {
    cards: plan.cards,
    binder: { ...plan.binder, isPublic: false },
  };
  localStorage.setItem(storageKey(userId), JSON.stringify(next));
}
