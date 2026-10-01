import type { User } from '../types';
import { normalizeBinderStyle } from '../types';

export { makeId, makeShareCode } from './ids';

/**
 * This browser's copy of signed-in accounts (for instant loads and offline use), plus any
 * pre-cloud accounts not yet imported. Sign-in itself is handled by Supabase, not stored here.
 */
const USERS_KEY = 'bb_users';
/** Pre-cloud sign-in marker: just a user id anyone could edit. No longer read. */
const LEGACY_SESSION_KEY = 'bb_session';
/** Pre-cloud local demo admin; it had a published password and no place in cloud accounts. */
const LEGACY_DEMO_ADMIN_ID = 'user_admin_seed';

function migrateBinderStyles(users: User[]): User[] {
  return users.map((user) => ({
    ...user,
    binders: user.binders.map((binder) => {
      const style = normalizeBinderStyle(String(binder.style));
      return style === binder.style ? binder : { ...binder, style };
    }),
  }));
}

/** Older saves kept each page photo and a second copy of every card crop, filling localStorage. */
function dropScanImages(users: User[]): User[] {
  return users.map((user) => ({
    ...user,
    pageImports: user.pageImports?.map((item) => ({ ...item, imageDataUrl: undefined })),
    pageDetections: user.pageDetections?.map((det) => ({ ...det, imageDataUrl: undefined })),
  }));
}

export function loadUsers(): User[] {
  try {
    localStorage.removeItem(LEGACY_SESSION_KEY);
    const raw = localStorage.getItem(USERS_KEY);
    const parsed = raw ? (JSON.parse(raw) as User[]) : [];
    const users = dropScanImages(migrateBinderStyles(parsed))
      .filter((u) => u.id !== LEGACY_DEMO_ADMIN_ID)
      // Sign-in is Supabase's job now: no password (plain or hashed) stays in this browser
      .map(({ password: _password, passwordHash: _passwordHash, ...u }) => u as User);
    const serialized = JSON.stringify(users);
    if (raw && raw !== serialized) {
      try {
        localStorage.setItem(USERS_KEY, serialized);
      } catch (err) {
        console.error('Could not save to browser storage', err);
      }
    }
    return users;
  } catch (err) {
    // Unreadable cache: start empty but leave it in place — the server holds the real data
    console.error('Could not read browser storage', err);
    return [];
  }
}

export function saveUsers(users: User[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}
