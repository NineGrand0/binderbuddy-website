import { useEffect } from 'react';
import { useStore } from '../store/Store';
import { computeBinderValue, recordValue } from '../lib/binderValue';

/** Logs each binder's total for today whenever prices or pocket contents change. */
export function ValueHistorySync() {
  const { user, updateBinder } = useStore();

  useEffect(() => {
    if (!user) return;
    for (const binder of user.binders) {
      const next = recordValue(binder.valueHistory, computeBinderValue(binder, user.collection));
      if (next) updateBinder(binder.id, { valueHistory: next });
    }
  }, [user, updateBinder]);

  return null;
}
