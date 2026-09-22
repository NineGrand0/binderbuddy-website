import { SLOT_COUNTS, type BinderPage, type BinderSize } from '../types';

export function pagesWithSlot(
  pages: BinderPage[],
  pageIndex: number,
  slotIndex: number,
  cardId: string | null,
): BinderPage[] {
  return pages.map((page, index) => {
    if (index !== pageIndex) return page;
    const slots = [...page.slots];
    slots[slotIndex] = cardId;
    return { slots };
  });
}

export function pagesWithSwap(
  pages: BinderPage[],
  from: { page: number; slot: number },
  to: { page: number; slot: number },
): BinderPage[] | null {
  if (from.page === to.page && from.slot === to.slot) return null;
  if (!pages[from.page] || !pages[to.page]) return null;
  const next = pages.map((page) => ({ slots: [...page.slots] }));
  const moving = next[from.page].slots[from.slot];
  next[from.page].slots[from.slot] = next[to.page].slots[to.slot];
  next[to.page].slots[to.slot] = moving;
  return next;
}

export function pagesWithPlacement(
  binder: { pages: BinderPage[]; size: BinderSize },
  cardId: string,
  preferred?: { page: number; slot: number },
): { pages: BinderPage[]; placed: { page: number; slot: number } } | null {
  if (binder.pages.some((page) => page.slots.includes(cardId))) return null;

  const slotCount = SLOT_COUNTS[binder.size];
  const pages = binder.pages.map((page) => ({ slots: [...page.slots] }));
  const preferredEmpty =
    preferred &&
    pages[preferred.page] &&
    preferred.slot >= 0 &&
    preferred.slot < pages[preferred.page].slots.length &&
    !pages[preferred.page].slots[preferred.slot]
      ? preferred
      : null;

  let target: { page: number; slot: number } | null = preferredEmpty;
  if (!target) {
    for (let page = 0; page < pages.length; page++) {
      const slot = pages[page].slots.findIndex((id) => !id);
      if (slot !== -1) {
        target = { page, slot };
        break;
      }
    }
  }

  if (!target) {
    pages.push(
      { slots: Array.from({ length: slotCount }, () => null) },
      { slots: Array.from({ length: slotCount }, () => null) },
    );
    target = { page: pages.length - 2, slot: 0 };
  }

  pages[target.page].slots[target.slot] = cardId;
  return { pages, placed: target };
}
