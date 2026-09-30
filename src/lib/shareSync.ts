import { useSyncExternalStore } from 'react';
import type { BinderShare } from '../types';
import { ShareApiError, disableShareLink, type ShareSnapshot } from './shareClient';

export type ShareSyncStatus =
  | { state: 'syncing' }
  | { state: 'synced'; at: string }
  | { state: 'error'; message: string }
  /** The server no longer knows this share (revoked elsewhere or the store was wiped). */
  | { state: 'missing' };

const statuses = new Map<string, ShareSyncStatus>();
/** shareId → JSON of the snapshot last sent (or being sent) to the server. */
const lastSent = new Map<string, string>();
const statusListeners = new Set<() => void>();
const resyncListeners = new Set<() => void>();
let resyncVersion = 0;

function emit() {
  for (const listener of statusListeners) listener();
}

function subscribeStatus(listener: () => void) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

function subscribeResync(listener: () => void) {
  resyncListeners.add(listener);
  return () => resyncListeners.delete(listener);
}

export function setShareStatus(shareId: string, status: ShareSyncStatus) {
  statuses.set(shareId, status);
  emit();
}

export function useShareStatus(shareId: string | undefined): ShareSyncStatus | undefined {
  return useSyncExternalStore(subscribeStatus, () => (shareId ? statuses.get(shareId) : undefined));
}

/** Bumps when the owner asks to retry a failed sync. */
export function useShareResyncVersion(): number {
  return useSyncExternalStore(subscribeResync, () => resyncVersion);
}

export function snapshotKey(snapshot: ShareSnapshot): string {
  return JSON.stringify(snapshot);
}

export function wasSent(shareId: string, key: string): boolean {
  return lastSent.get(shareId) === key;
}

export function markSent(shareId: string, key: string) {
  lastSent.set(shareId, key);
}

/** Lets the next change (or a manual retry) publish again after a failed send. */
export function clearSent(shareId: string) {
  lastSent.delete(shareId);
}

export function forgetShare(shareId: string) {
  lastSent.delete(shareId);
  statuses.delete(shareId);
  emit();
}

export function requestResync(shareId: string) {
  lastSent.delete(shareId);
  resyncVersion += 1;
  for (const listener of resyncListeners) listener();
}

const PENDING_DELETES_KEY = 'bb_share_pending_deletes';

type PendingDelete = Pick<BinderShare, 'shareId' | 'manageKey'>;

function readPendingDeletes(): PendingDelete[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_DELETES_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePendingDeletes(list: PendingDelete[]) {
  if (list.length) localStorage.setItem(PENDING_DELETES_KEY, JSON.stringify(list));
  else localStorage.removeItem(PENDING_DELETES_KEY);
}

let flushing = false;

/** Retries revoking links whose binders were deleted, so those links stop working. */
export async function flushShareDeletions() {
  if (flushing) return;
  flushing = true;
  try {
    for (const item of readPendingDeletes()) {
      try {
        await disableShareLink({ ...item, token: '', createdAt: '' });
      } catch (err) {
        const gone = err instanceof ShareApiError && (err.status === 404 || err.status === 403);
        if (!gone) continue;
      }
      writePendingDeletes(readPendingDeletes().filter((p) => p.shareId !== item.shareId));
      forgetShare(item.shareId);
    }
  } finally {
    flushing = false;
  }
}

export function queueShareDeletion(share: BinderShare) {
  const pending = readPendingDeletes().filter((p) => p.shareId !== share.shareId);
  pending.push({ shareId: share.shareId, manageKey: share.manageKey });
  writePendingDeletes(pending);
  void flushShareDeletions();
}
