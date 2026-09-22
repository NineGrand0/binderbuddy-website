import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HomeAppShell } from '../components/Layout';
import { InteractiveBinder, type InteractiveBinderHandle } from '../components/InteractiveBinder';
import { PlanCatalog, toPlanCard } from '../components/PlanCatalog';
import { RequireAuth } from './Dashboard';
import { useStore } from '../store/Store';
import { loadPlan, savePlan, type PlanRecord } from '../lib/planStorage';
import type { Binder, Card } from '../types';

export function PlanPage() {
  return (
    <RequireAuth>
      <PlanInner />
    </RequireAuth>
  );
}

function PlanInner() {
  const { user } = useStore();
  const userId = user?.id ?? null;
  const binderRef = useRef<InteractiveBinderHandle>(null);
  const [ownedBy, setOwnedBy] = useState(userId);
  const [plan, setPlan] = useState<PlanRecord | null>(() => (userId ? loadPlan(userId) : null));
  const [hint, setHint] = useState<string | null>(null);

  if (userId !== ownedBy) {
    setOwnedBy(userId);
    setPlan(userId ? loadPlan(userId) : null);
  }

  useEffect(() => {
    if (!userId || !plan || ownedBy !== userId) return;
    savePlan(userId, plan);
  }, [userId, plan, ownedBy]);

  const onBinderChange = useCallback((patch: Partial<Binder>) => {
    setPlan((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        binder: {
          ...prev.binder,
          ...patch,
          isPublic: false,
          updatedAt: new Date().toISOString(),
        },
      };
    });
  }, []);

  const placedIds = useMemo(() => {
    const ids = new Set<string>();
    plan?.binder.pages.forEach((page) => {
      page.slots.forEach((id) => {
        if (id) ids.add(id);
      });
    });
    return ids;
  }, [plan]);

  if (!user || !plan) return null;

  function placeFromCatalog(card: Card) {
    const stable = toPlanCard(card);
    const placed = binderRef.current?.placeCard(stable.id) ?? false;
    if (!placed) {
      const already = plan!.binder.pages.some((page) => page.slots.includes(stable.id));
      setHint(
        already
          ? 'That card is already in this plan.'
          : 'Open the front cover, then click a card to place it.',
      );
      return;
    }
    setHint(null);
    setPlan((prev) => {
      if (!prev || prev.cards.some((item) => item.id === stable.id)) return prev;
      return { ...prev, cards: [...prev.cards, stable] };
    });
  }

  return (
    <HomeAppShell wide>
      <div className="page-header">
        <div>
          <h1>Plan</h1>
          <p className="plan-lead">
            Sketch a binder before you commit to it in real life. Arrange Pokémon cards, try
            pocket sizes, and turn the pages. This plan stays in your browser and is not shared.
          </p>
        </div>
      </div>

      <div className="field plan-name">
        <label htmlFor="plan-name">Plan name</label>
        <input
          id="plan-name"
          value={plan.binder.name}
          onChange={(e) => onBinderChange({ name: e.target.value })}
          maxLength={60}
        />
      </div>

      <InteractiveBinder
        ref={binderRef}
        binder={plan.binder}
        collection={plan.cards}
        hideCollection
        onChange={onBinderChange}
      />

      {hint && (
        <p className="plan-hint" role="status">
          {hint}
        </p>
      )}

      <PlanCatalog placedIds={placedIds} onPick={placeFromCatalog} />
    </HomeAppShell>
  );
}
