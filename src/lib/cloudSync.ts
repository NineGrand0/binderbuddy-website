/**
 * Moves an account's cards, binders and profile between the browser and Supabase. The browser keeps
 * a copy for instant loads; the database is the source of truth. Every request runs under the
 * signed-in user's session, so Row Level Security limits it to that user's own rows.
 *
 * Changes are tracked as a list of pending row operations (“put card X”, “delete binder Y”) rather
 * than by comparing whole collections, so a sync only sends what changed, and a stale copy of the
 * collection on one device can never re-upload cards that were deleted on another.
 */
import type { Binder, Card, PremiumPaymentMethod, User } from '../types';
import { supabase } from './supabase';

type Row<T> = { id: string; data: T };

export type CloudProfile = Pick<
  User,
  'displayName' | 'shareCode' | 'isPremium' | 'premiumPurchasedAt' | 'premiumPaymentMethod' | 'role'
> & { prefs: { demoSeeded?: boolean; rarityBackfilled?: boolean } };

export type CloudAccount = { profile: CloudProfile; collection: Card[]; binders: Binder[] };

// ── Pending changes ──────────────────────────────────────────────────────────────────────────────

/** `put:<n>` / `del:<n>`; the number tells an upload apart from an edit made while it ran. */
type PendingOp = string;
export type PendingChanges = { cards: Record<string, PendingOp>; binders: Record<string, PendingOp> };

let opSequence = 0;
const op = (kind: 'put' | 'del'): PendingOp => `${kind}:${Date.now().toString(36)}${(opSequence++).toString(36)}`;
const isDelete = (value: PendingOp) => value.startsWith('del:');

export function emptyPending(): PendingChanges {
  return { cards: {}, binders: {} };
}

export function hasPending(pending: PendingChanges): boolean {
  return Object.keys(pending.cards).length > 0 || Object.keys(pending.binders).length > 0;
}

/**
 * Records what changed between two versions of a list. Updates in this app replace only the
 * objects that changed, so comparing object identity finds them without serialising anything.
 */
function diffList<T extends { id: string }>(target: Record<string, PendingOp>, prev: T[], next: T[]) {
  const before = new Map(prev.map((item) => [item.id, item]));
  for (const item of next) {
    if (before.get(item.id) !== item) target[item.id] = op('put');
  }
  if (prev.length === 0) return;
  const after = new Set(next.map((item) => item.id));
  for (const item of prev) {
    if (!after.has(item.id)) target[item.id] = op('del');
  }
}

export function recordChanges(
  pending: PendingChanges,
  prev: Pick<User, 'collection' | 'binders'> | undefined,
  next: Pick<User, 'collection' | 'binders'>,
) {
  if (prev?.collection !== next.collection) diffList(pending.cards, prev?.collection ?? [], next.collection);
  if (prev?.binders !== next.binders) diffList(pending.binders, prev?.binders ?? [], next.binders);
}

/** Marks every item as needing upload (imports, demo cards). */
export function recordAll(pending: PendingChanges, account: Pick<User, 'collection' | 'binders'>) {
  for (const card of account.collection) pending.cards[card.id] = op('put');
  for (const binder of account.binders) pending.binders[binder.id] = op('put');
}

/** Lays this device's not-yet-uploaded edits over a fresh copy from the server. */
export function applyPending(cloud: CloudAccount, local: Pick<User, 'collection' | 'binders'>, pending: PendingChanges) {
  const merge = <T extends { id: string }>(remote: T[], mine: T[], ops: Record<string, PendingOp>) => {
    // Server order and rows, with this device's edits swapped in place and its deletions removed;
    // rows created here (not on the server yet) go first, like newly added cards do
    const mineById = new Map(mine.map((item) => [item.id, item]));
    const remoteIds = new Set(remote.map((item) => item.id));
    const added = mine.filter((item) => ops[item.id] && !isDelete(ops[item.id]) && !remoteIds.has(item.id));
    const kept = remote.flatMap((item) => {
      const pendingOp = ops[item.id];
      if (!pendingOp) return [item];
      if (isDelete(pendingOp)) return [];
      return [mineById.get(item.id) ?? item];
    });
    return [...added, ...kept];
  };
  return {
    collection: merge(cloud.collection, local.collection, pending.cards),
    binders: merge(cloud.binders, local.binders, pending.binders),
  };
}

const PENDING_KEY = (userId: string) => `bb_pending_${userId}`;

export function loadPending(userId: string): PendingChanges {
  try {
    const raw = localStorage.getItem(PENDING_KEY(userId));
    const parsed = raw ? (JSON.parse(raw) as Partial<PendingChanges>) : {};
    return { cards: parsed.cards ?? {}, binders: parsed.binders ?? {} };
  } catch {
    return emptyPending();
  }
}

export function savePending(userId: string, pending: PendingChanges) {
  try {
    if (hasPending(pending)) localStorage.setItem(PENDING_KEY(userId), JSON.stringify(pending));
    else localStorage.removeItem(PENDING_KEY(userId));
  } catch {
    /* storage full or blocked: the in-memory list still uploads this session */
  }
}

// ── Server reads ─────────────────────────────────────────────────────────────────────────────────

/** Supabase returns at most 1000 rows per request; page through so big collections arrive whole. */
const PAGE = 1000;

async function pullRows<T>(table: 'cards' | 'binders', userId: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select('id, data')
      .eq('user_id', userId)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as Row<T>[];
    out.push(...rows.map((r) => r.data));
    if (rows.length < PAGE) return out;
  }
}

type ProfileRow = {
  display_name: string;
  share_code: string;
  is_premium: boolean;
  premium_purchased_at: string | null;
  premium_payment_method: string | null;
  role: string;
  prefs: CloudProfile['prefs'] | null;
};

function toProfile(p: ProfileRow): CloudProfile {
  return {
    displayName: p.display_name,
    shareCode: p.share_code,
    isPremium: p.is_premium,
    premiumPurchasedAt: p.premium_purchased_at ?? undefined,
    premiumPaymentMethod: (p.premium_payment_method ?? undefined) as PremiumPaymentMethod | undefined,
    role: p.role === 'admin' ? 'admin' : 'user',
    prefs: p.prefs ?? {},
  };
}

/** The account's profile, creating it if the sign-up trigger never did (e.g. user predates it). */
export async function pullProfile(userId: string): Promise<CloudProfile> {
  const read = () => supabase.from('profiles').select('*').eq('id', userId).maybeSingle<ProfileRow>();
  let { data, error } = await read();
  if (error) throw error;
  if (!data) {
    const created = await supabase.rpc('ensure_profile');
    if (created.error) throw created.error;
    ({ data, error } = await read());
    if (error) throw error;
    if (!data) throw new Error('Your account profile is missing. Contact support.');
  }
  return toProfile(data);
}

// Same-batch cards share an addedAt; fall back to id so the order is the same on every load
const byNewest = (a: { addedAt?: string; id: string }, b: { addedAt?: string; id: string }) =>
  (b.addedAt ?? '').localeCompare(a.addedAt ?? '') || a.id.localeCompare(b.id);

export async function pullAccount(userId: string): Promise<CloudAccount> {
  const [profile, cards, binders] = await Promise.all([
    pullProfile(userId),
    pullRows<Card>('cards', userId),
    pullRows<Binder>('binders', userId),
  ]);
  return {
    profile,
    collection: cards.sort(byNewest),
    binders: binders.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || a.id.localeCompare(b.id)),
  };
}

// ── Server writes ────────────────────────────────────────────────────────────────────────────────

/** Rows per request: cards carry their photo crops, and deletes list ids in the URL. */
const UPSERT_BATCH = 25;
const DELETE_BATCH = 100;

async function pushTable<T extends { id: string }>(
  table: 'cards' | 'binders',
  userId: string,
  items: T[],
  ops: Record<string, PendingOp>,
) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const puts: T[] = [];
  const deletes: string[] = [];
  for (const [id, value] of Object.entries(ops)) {
    const item = byId.get(id);
    if (isDelete(value)) deletes.push(id);
    // A put with nothing to send is stale (removing it would have recorded a delete): skip it
    else if (item) puts.push(item);
  }
  for (let i = 0; i < puts.length; i += UPSERT_BATCH) {
    const now = new Date().toISOString();
    const rows = puts.slice(i, i + UPSERT_BATCH).map((item) => ({ user_id: userId, id: item.id, data: item, updated_at: now }));
    const { error } = await supabase.from(table).upsert(rows);
    if (error) throw error;
  }
  for (let i = 0; i < deletes.length; i += DELETE_BATCH) {
    const { error } = await supabase
      .from(table)
      .delete()
      .eq('user_id', userId)
      .in('id', deletes.slice(i, i + DELETE_BATCH));
    if (error) throw error;
  }
}

/**
 * Uploads `sent` (a copy of the pending list taken before starting) and removes from `pending`
 * only the operations that weren't superseded by an edit made during the upload.
 */
export async function pushPending(
  userId: string,
  account: Pick<User, 'collection' | 'binders'>,
  pending: PendingChanges,
): Promise<void> {
  const sent: PendingChanges = { cards: { ...pending.cards }, binders: { ...pending.binders } };
  await pushTable('cards', userId, account.collection, sent.cards);
  await pushTable('binders', userId, account.binders, sent.binders);
  for (const [id, value] of Object.entries(sent.cards)) if (pending.cards[id] === value) delete pending.cards[id];
  for (const [id, value] of Object.entries(sent.binders)) if (pending.binders[id] === value) delete pending.binders[id];
}

export async function pushProfile(
  userId: string,
  patch: { displayName?: string; prefs?: CloudProfile['prefs'] },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.displayName !== undefined) row.display_name = patch.displayName;
  if (patch.prefs !== undefined) row.prefs = patch.prefs;
  const { error } = await supabase.from('profiles').update(row).eq('id', userId);
  if (error) throw error;
}

export async function activatePremiumOnServer(method: PremiumPaymentMethod): Promise<void> {
  const { error } = await supabase.rpc('activate_premium', { method });
  if (error) throw error;
}
