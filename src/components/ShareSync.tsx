import { useEffect, useRef } from 'react';
import { useStore } from '../store/Store';
import type { BinderShare } from '../types';
import { ShareApiError, buildShareSnapshot, publishShare, type ShareSnapshot } from '../lib/shareClient';
import {
  clearSent,
  flushShareDeletions,
  markSent,
  queueShareDeletion,
  setShareStatus,
  snapshotKey,
  useShareResyncVersion,
  wasSent,
} from '../lib/shareSync';

const PUBLISH_DELAY_MS = 800;

/** shareId → tail of that share's publish chain, so PUTs land in order. */
const chains = new Map<string, Promise<void>>();

function publish(share: BinderShare, snapshot: ShareSnapshot, key: string) {
  markSent(share.shareId, key);
  setShareStatus(share.shareId, { state: 'syncing' });
  const previous = chains.get(share.shareId) ?? Promise.resolve();
  const next = previous.then(async () => {
    if (!wasSent(share.shareId, key)) return;
    try {
      await publishShare(share, snapshot);
      if (wasSent(share.shareId, key)) {
        setShareStatus(share.shareId, { state: 'synced', at: new Date().toISOString() });
      }
    } catch (err) {
      if (err instanceof ShareApiError && (err.status === 404 || err.status === 403)) {
        setShareStatus(share.shareId, { state: 'missing' });
        return;
      }
      if (wasSent(share.shareId, key)) {
        clearSent(share.shareId);
        setShareStatus(share.shareId, {
          state: 'error',
          message: err instanceof Error ? err.message : 'Could not update the shared binder.',
        });
      }
    }
  });
  chains.set(share.shareId, next);
}

/**
 * Keeps every shared binder's server snapshot in step with the owner's saved changes,
 * and revokes a binder's link when the binder is deleted.
 */
export function ShareSync() {
  const { user } = useStore();
  const syncVersion = useShareResyncVersion();
  const previous = useRef<{ userId: string; shares: Map<string, BinderShare> } | null>(null);

  useEffect(() => {
    void flushShareDeletions();
  }, []);

  useEffect(() => {
    if (!user) {
      previous.current = null;
      return;
    }
    const shares = new Map<string, BinderShare>();
    for (const binder of user.binders) if (binder.share) shares.set(binder.id, binder.share);
    const before = previous.current;
    if (before?.userId === user.id) {
      for (const [binderId, share] of before.shares) {
        if (!user.binders.some((b) => b.id === binderId)) queueShareDeletion(share);
      }
    }
    previous.current = { userId: user.id, shares };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const timer = window.setTimeout(() => {
      for (const binder of user.binders) {
        if (!binder.share) continue;
        const snapshot = buildShareSnapshot(binder, user.collection, user.displayName);
        const key = snapshotKey(snapshot);
        if (!wasSent(binder.share.shareId, key)) publish(binder.share, snapshot, key);
      }
    }, PUBLISH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [user, syncVersion]);

  return null;
}
