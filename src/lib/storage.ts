import type { Session, User } from '../types';
import { SLOT_COUNTS, normalizeBinderStyle } from '../types';
import {
  create30thCelebrationDemoCards,
  createShowcasePokemonCards,
  has30thCelebrationDemo,
} from './pokemonTcg';

export { makeId, makeShareCode } from './ids';

const USERS_KEY = 'bb_users';
const SESSION_KEY = 'bb_session';

export const ADMIN_EMAIL = 'admin@binderbuddy.com';
export const ADMIN_PASSWORD = 'admin123';

function buildAdminShowcase(): Pick<User, 'collection' | 'binders'> {
  const collection = [...create30thCelebrationDemoCards(), ...createShowcasePokemonCards()];
  const slots = SLOT_COUNTS['3x3'];
  const pageSlots = Array.from({ length: slots }, (_, i) => collection[i]?.id ?? null);
  return {
    collection,
    binders: [
      {
        id: 'binder_admin_starter',
        name: 'Admin showcase',
        style: 'black',
        size: '3x3',
        pages: [
          { slots: pageSlots },
          { slots: Array.from({ length: slots }, () => null) },
          { slots: Array.from({ length: slots }, () => null) },
          { slots: Array.from({ length: slots }, () => null) },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isPublic: true,
        coverPreset: 'classic',
      },
    ],
  };
}

function applyAdminPremium(user: User): User {
  return {
    ...user,
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    displayName: user.displayName || 'Admin',
    role: 'admin',
    isPremium: true,
    premiumPurchasedAt: user.premiumPurchasedAt ?? new Date().toISOString(),
    premiumPaymentMethod: user.premiumPaymentMethod ?? 'card',
    shareCode: user.shareCode || 'BBADMIN1',
  };
}

function createAdminUser(): User {
  return applyAdminPremium({
    id: 'user_admin_seed',
    email: ADMIN_EMAIL,
    displayName: 'Admin',
    password: ADMIN_PASSWORD,
    shareCode: 'BBADMIN1',
    role: 'admin',
    isPremium: true,
    premiumPurchasedAt: new Date().toISOString(),
    premiumPaymentMethod: 'card',
    ...buildAdminShowcase(),
  });
}

function needsPokemonUpgrade(user: User) {
  return !user.collection.some((c) => c.game === 'Pokémon TCG' && Boolean(c.imageUrl));
}

export function ensureAdminUser(users: User[]): User[] {
  const existing = users.find((u) => u.email === ADMIN_EMAIL || u.id === 'user_admin_seed');
  if (!existing) return [createAdminUser(), ...users];

  const sessionUserId = loadSession()?.userId ?? null;

  return users.map((u) => {
    const isAdmin = u.email === ADMIN_EMAIL || u.id === 'user_admin_seed' || u.role === 'admin';
    if (!isAdmin) {
      if (u.id === sessionUserId && !has30thCelebrationDemo(u.collection)) {
        return { ...u, collection: [...create30thCelebrationDemoCards(), ...u.collection] };
      }
      return u;
    }
    const upgraded = needsPokemonUpgrade(u) ? buildAdminShowcase() : null;
    const next: User = {
      ...applyAdminPremium(u),
      ...(upgraded ?? {}),
      // Premium must win over showcase spread
      role: 'admin',
      isPremium: true,
      premiumPurchasedAt: u.premiumPurchasedAt ?? new Date().toISOString(),
      premiumPaymentMethod: u.premiumPaymentMethod ?? 'card',
    };
    if (!has30thCelebrationDemo(next.collection)) {
      next.collection = [...create30thCelebrationDemoCards(), ...next.collection];
    }
    return next;
  });
}

function migrateBinderStyles(users: User[]): User[] {
  return users.map((user) => ({
    ...user,
    binders: user.binders.map((binder) => {
      const style = normalizeBinderStyle(String(binder.style));
      return style === binder.style ? binder : { ...binder, style };
    }),
  }));
}

export function loadUsers(): User[] {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    const parsed = raw ? (JSON.parse(raw) as User[]) : [];
    const users = migrateBinderStyles(parsed);
    const withAdmin = ensureAdminUser(users);
    if (JSON.stringify(users) !== JSON.stringify(withAdmin)) saveUsers(withAdmin);
    return withAdmin;
  } catch {
    const adminOnly = ensureAdminUser([]);
    saveUsers(adminOnly);
    return adminOnly;
  }
}

export function saveUsers(users: User[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session | null) {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}
