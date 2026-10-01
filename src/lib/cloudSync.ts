/**
 * Moves an account's cards, binders and profile between the browser and Supabase. The browser keeps
 * a copy for instant loads; the database is the source of truth. Every request runs under the
 * signed-in user's session, so Row Level Security limits it to that user's own rows.
 */
import type { Binder, Card, PremiumPaymentMethod, User } from '../types';
import { supabase } from './supabase';

type Row<T> = { id: string; data: T };

export type CloudProfile = Pick<
  User,
  'displayName' | 'shareCode' | 'isPremium' | 'premiumPurchasedAt' | 'premiumPaymentMethod' | 'role'
> & { prefs: { demoSeeded?: boolean; rarityBackfilled?: boolean } };

export type CloudAccount = { profile: CloudProfile; collection: Card[]; binders: Binder[] };

/** What was last written to the server, per row, so only changes are sent. */
export type SyncSnapshot = { cards: Map<string, string>; binders: Map<string, string> };

export function emptySnapshot(): SyncSnapshot {
  return { cards: new Map(), binders: new Map() };
}

export function snapshotOf(user: Pick<User, 'collection' | 'binders'>): SyncSnapshot {
  return {
    cards: new Map(user.collection.map((c) => [c.id, JSON.stringify(c)])),
    binders: new Map(user.binders.map((b) => [b.id, JSON.stringify(b)])),
  };
}

export async function pullAccount(userId: string): Promise<CloudAccount> {
  const [profile, cards, binders] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).single(),
    supabase.from('cards').select('id, data').eq('user_id', userId),
    supabase.from('binders').select('id, data').eq('user_id', userId),
  ]);
  if (profile.error) throw profile.error;
  if (cards.error) throw cards.error;
  if (binders.error) throw binders.error;
  const p = profile.data;
  return {
    profile: {
      displayName: p.display_name,
      shareCode: p.share_code,
      isPremium: p.is_premium,
      premiumPurchasedAt: p.premium_purchased_at ?? undefined,
      premiumPaymentMethod: (p.premium_payment_method ?? undefined) as PremiumPaymentMethod | undefined,
      role: p.role === 'admin' ? 'admin' : 'user',
      prefs: p.prefs ?? {},
    },
    // Newest first, matching how the app adds them
    collection: (cards.data as Row<Card>[]).map((r) => r.data).sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? '')),
    binders: (binders.data as Row<Binder>[]).map((r) => r.data).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

const UPSERT_BATCH = 25;

async function pushTable<T extends { id: string }>(
  table: 'cards' | 'binders',
  userId: string,
  items: T[],
  previous: Map<string, string>,
): Promise<Map<string, string>> {
  const current = new Map(items.map((item) => [item.id, JSON.stringify(item)]));
  const changed = items.filter((item) => previous.get(item.id) !== current.get(item.id));
  const removed = [...previous.keys()].filter((id) => !current.has(id));
  // Batches keep each request small: cards carry their photo crops
  for (let i = 0; i < changed.length; i += UPSERT_BATCH) {
    const rows = changed.slice(i, i + UPSERT_BATCH).map((item) => ({
      user_id: userId,
      id: item.id,
      data: item,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from(table).upsert(rows);
    if (error) throw error;
  }
  if (removed.length > 0) {
    const { error } = await supabase.from(table).delete().eq('user_id', userId).in('id', removed);
    if (error) throw error;
  }
  return current;
}

/** Sends cards and binders that changed since `previous`; returns the new snapshot. */
export async function pushAccount(
  userId: string,
  user: Pick<User, 'collection' | 'binders'>,
  previous: SyncSnapshot,
): Promise<SyncSnapshot> {
  const cards = await pushTable('cards', userId, user.collection, previous.cards);
  const binders = await pushTable('binders', userId, user.binders, previous.binders);
  return { cards, binders };
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
