import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  Binder,
  BinderPage,
  BinderSize,
  BinderStyle,
  Card,
  DetectorId,
  PageDetection,
  PremiumPaymentMethod,
  User,
} from '../types';
import { SLOT_COUNTS } from '../types';
import type { AuthError, PasskeyListItem, User as SupabaseUser } from '@supabase/supabase-js';
import { loadUsers, makeId, saveUsers } from '../lib/storage';
import { initialValueHistory } from '../lib/binderValue';
import { create30thCelebrationDemoCards, raritiesForIds } from '../lib/pokemonTcg';
import { supabase, supabaseConfigured } from '../lib/supabase';
import {
  activatePremiumOnServer,
  emptySnapshot,
  pullAccount,
  pushAccount,
  pushProfile,
  snapshotOf,
  type CloudAccount,
  type SyncSnapshot,
} from '../lib/cloudSync';

/**
 * Where sign-in stands. Password alone (Supabase AAL1) never reaches `signed-in`: every account has
 * to set up an authenticator app, and enter its code on each sign-in, before any data loads.
 */
export type AuthStage = 'loading' | 'signed-out' | 'mfa-enroll' | 'mfa-verify' | 'signed-in';

export type MfaEnrollment = { factorId: string; qrCode: string; secret: string };

interface AppStore {
  user: User | null;
  ready: boolean;
  authStage: AuthStage;
  /** Email of the session waiting on its authenticator step (shown on the 2FA screens). */
  pendingEmail: string | null;
  /** Last cloud save problem, or null when everything is saved. */
  syncError: string | null;
  /** Resolves to an error message, or null when a confirmation email was sent. */
  signup: (email: string, password: string, displayName: string) => Promise<string | null>;
  /** Resolves to an error message, or null — then `authStage` says what comes next. */
  login: (email: string, password: string) => Promise<string | null>;
  startMfaEnrollment: () => Promise<MfaEnrollment | { error: string }>;
  verifyMfa: (code: string, factorId?: string) => Promise<string | null>;
  /** Two-factor is optional: skipping the offer is remembered on the account. */
  skipMfaSetup: () => Promise<string | null>;
  signInWithPasskey: () => Promise<string | null>;
  registerPasskey: () => Promise<string | null>;
  listPasskeys: () => Promise<PasskeyListItem[] | { error: string }>;
  deletePasskey: (passkeyId: string) => Promise<string | null>;
  hasAuthenticatorApp: () => Promise<boolean>;
  disableAuthenticatorApp: () => Promise<string | null>;
  logout: () => Promise<void>;
  /** Resolves to a message for the user (e.g. “check your inbox”), or null. */
  updateProfile: (patch: Partial<Pick<User, 'displayName' | 'email'>>) => Promise<string | null>;
  activatePremium: (method: PremiumPaymentMethod) => Promise<string | null>;
  addCards: (cards: Card[]) => void;
  savePageImport: (input: {
    importId: string;
    imageDataUrl: string;
    width: number;
    height: number;
    detectorId: DetectorId;
    detections: PageDetection[];
  }) => 'saved' | 'duplicate' | 'storage-full';
  updateCard: (cardId: string, patch: Partial<Card>) => void;
  removeCard: (cardId: string) => void;
  /** Empties the collection and every binder slot; binders themselves are kept. */
  removeAllCards: () => void;
  createBinder: (input: {
    name: string;
    style: BinderStyle;
    size: BinderSize;
    pageCount?: number;
    coverPreset?: Binder['coverPreset'];
    previewImageDataUrl?: string;
  }) => Binder;
  updateBinder: (binderId: string, patch: Partial<Binder>) => void;
  deleteBinder: (binderId: string) => void;
  setSlot: (
    binderId: string,
    pageIndex: number,
    slotIndex: number,
    cardId: string | null,
  ) => void;
  swapSlots: (
    binderId: string,
    from: { page: number; slot: number },
    to: { page: number; slot: number },
  ) => void;
  placeInNextEmptySlot: (
    binderId: string,
    cardId: string,
    preferred?: { page: number; slot: number },
  ) => { page: number; slot: number } | null;
}

const StoreContext = createContext<AppStore | null>(null);

function emptyPages(size: BinderSize, count: number): BinderPage[] {
  const slots = SLOT_COUNTS[size];
  return Array.from({ length: count }, () => ({
    slots: Array.from({ length: slots }, () => null),
  }));
}

function updateUser(users: User[], userId: string, updater: (u: User) => User): User[] {
  return users.map((u) => (u.id === userId ? updater(u) : u));
}

const UNSYNCED_KEY = (id: string) => `bb_unsynced_${id}`;

/** Set while this browser holds edits the server hasn't stored yet. */
function markUnsynced(id: string, value: boolean) {
  try {
    if (value) localStorage.setItem(UNSYNCED_KEY(id), '1');
    else localStorage.removeItem(UNSYNCED_KEY(id));
  } catch {
    /* storage unavailable: the cloud copy simply wins next time */
  }
}

function hasUnsynced(id: string) {
  try {
    return localStorage.getItem(UNSYNCED_KEY(id)) === '1';
  } catch {
    return false;
  }
}

/** A passkey sign-in: device possession plus biometric/PIN, so it stands in for two-factor. */
function isPasskeyMethod(method: string) {
  return /passkey|webauthn/i.test(method);
}

/** An account from before cloud sign-in (local ids look like user_…; Supabase ids are UUIDs). */
function isLegacyAccount(u: User) {
  return u.id.startsWith('user_');
}

/** Passkey errors: the browser's own (cancelled, unsupported) or the server's. */
function passkeyErrorMessage(error: Error): string {
  const code = 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
  if (error.name === 'NotAllowedError' || /CANCELLED|NOT_ALLOWED|ABORTED/i.test(code)) {
    return 'Passkey request was cancelled.';
  }
  if (/passkey.*(disabled|not.*enabled)|feature_disabled/i.test(`${code} ${error.message}`)) {
    return 'Passkeys aren’t switched on for this site yet.';
  }
  if (/challenge_expired/i.test(code)) return 'That took too long — try the passkey again.';
  return authErrorMessage(error as AuthError);
}

/** Supabase errors → wording for the sign-in screens. */
function authErrorMessage(error: AuthError | Error): string {
  const code = 'code' in error ? (error.code as string | undefined) : undefined;
  switch (code) {
    case 'invalid_credentials':
      return 'Invalid email or password.';
    case 'email_not_confirmed':
      return 'Confirm your email first — check your inbox for the link we sent.';
    case 'weak_password':
      return error.message || 'Choose a stronger password.';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'Too many attempts — wait a minute and try again.';
    case 'mfa_verification_failed':
    case 'mfa_challenge_expired':
      return 'That code didn’t work. Codes change every 30 seconds — try the current one.';
    default:
      return error.message || 'Something went wrong. Try again.';
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<User[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [authStage, setAuthStage] = useState<AuthStage>('loading');
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const ready = authStage !== 'loading';
  const usersRef = useRef(users);
  usersRef.current = users;
  /** What the server holds for the signed-in account, so only changes are uploaded. */
  const snapshotRef = useRef<SyncSnapshot | null>(null);
  const pushChain = useRef<Promise<void>>(Promise.resolve());
  const authCheck = useRef<Promise<void>>(Promise.resolve());
  /** Account whose data has been loaded for this session (set before React re-renders). */
  const enteredUserId = useRef<string | null>(null);

  /** Returns false when the write didn't fit in localStorage; state is left unchanged. */
  const persist = useCallback((updater: (prev: User[]) => User[]) => {
    const next = updater(usersRef.current);
    try {
      saveUsers(next);
    } catch (err) {
      console.error('Could not save to browser storage', err);
      return false;
    }
    usersRef.current = next;
    setUsers(next);
    // Remember there's something the server hasn't got yet, in case the tab closes first
    if (enteredUserId.current && snapshotRef.current) markUnsynced(enteredUserId.current, true);
    return true;
  }, []);

  const user = useMemo(() => users.find((u) => u.id === userId) ?? null, [users, userId]);

  /** Loads the account from the server (or this browser's newer copy) once 2FA has passed. */
  const enterAccount = useCallback(
    async (authUser: SupabaseUser) => {
      const id = authUser.id;
      const email = (authUser.email ?? '').toLowerCase();
      const local = usersRef.current.find((u) => u.id === id);
      let cloud: CloudAccount | null = null;
      try {
        cloud = await pullAccount(id);
        setSyncError(null);
      } catch (err) {
        console.error('Could not load account from the server', err);
        setSyncError('Couldn’t reach the server — showing the copy saved on this device.');
      }

      let collection = cloud?.collection ?? local?.collection ?? [];
      let binders = cloud?.binders ?? local?.binders ?? [];
      const prefs = { ...(cloud?.profile.prefs ?? {}) };
      let importedFrom: string | null = null;

      if (cloud && local && hasUnsynced(id)) {
        // Edits made here never reached the server (tab closed, offline): this copy wins
        collection = local.collection;
        binders = local.binders;
      } else if (cloud && collection.length === 0 && binders.length === 0) {
        // Brand-new cloud account: bring over a pre-cloud account with the same (confirmed) email,
        // otherwise start with the demo cards
        const legacy = usersRef.current.find((u) => u.id !== id && isLegacyAccount(u) && u.email === email);
        if (legacy && (legacy.collection.length > 0 || legacy.binders.length > 0)) {
          collection = legacy.collection;
          binders = legacy.binders;
          importedFrom = legacy.id;
          prefs.demoSeeded = true;
        } else if (!prefs.demoSeeded) {
          collection = create30thCelebrationDemoCards();
          prefs.demoSeeded = true;
        }
        // Imported cards may carry rarities from the old mapping; fresh demo cards don't
        if (!importedFrom) prefs.rarityBackfilled ??= true;
      }

      const account: User = {
        id,
        email,
        displayName: cloud?.profile.displayName ?? local?.displayName ?? email.split('@')[0],
        shareCode: cloud?.profile.shareCode ?? local?.shareCode ?? '',
        role: cloud?.profile.role ?? local?.role,
        isPremium: cloud?.profile.isPremium ?? local?.isPremium,
        premiumPurchasedAt: cloud?.profile.premiumPurchasedAt ?? local?.premiumPurchasedAt,
        premiumPaymentMethod: cloud?.profile.premiumPaymentMethod ?? local?.premiumPaymentMethod,
        demoSeeded: prefs.demoSeeded,
        rarityBackfilled: prefs.rarityBackfilled,
        collection,
        binders,
        // Scan bookkeeping only matters on the device that scanned
        pageImports: local?.pageImports ?? [],
        pageDetections: local?.pageDetections ?? [],
      };
      // Server's view, so the sync below uploads exactly what differs (imports, demo cards, offline edits)
      snapshotRef.current = cloud ? snapshotOf(cloud) : emptySnapshot();
      enteredUserId.current = id;
      persist((prev) => [...prev.filter((u) => u.id !== id && u.id !== importedFrom), account]);
      // Anything the server doesn't have yet stays flagged until uploaded, so an imported
      // collection can't be lost if the tab closes first (the old local copy is gone now)
      if (!cloud || collection !== cloud.collection || binders !== cloud.binders) markUnsynced(id, true);
      if (cloud && JSON.stringify(prefs) !== JSON.stringify(cloud.profile.prefs)) {
        void pushProfile(id, { prefs }).catch((err) => console.warn('Could not save account flags', err));
      }
      setPendingEmail(null);
      setUserId(id);
      setAuthStage('signed-in');
    },
    [persist],
  );

  /**
   * Works out the sign-in stage from the Supabase session and its assurance level. Runs one at a
   * time: logging in and Supabase's auth event both ask, and the account must only load once.
   */
  const refreshAuth = useCallback(() => {
    authCheck.current = authCheck.current.then(async () => {
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (!session) {
        snapshotRef.current = null;
        enteredUserId.current = null;
        setPendingEmail(null);
        setUserId(null);
        setAuthStage('signed-out');
        return;
      }
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      const methods = (aal?.currentAuthenticationMethods ?? []).map((m) => (typeof m === 'string' ? m : m.method));
      if (import.meta.env.DEV) console.info('[auth] session level', aal?.currentLevel, '→', aal?.nextLevel, methods);
      const hasAuthenticator = aal?.nextLevel === 'aal2';
      // Same rule as public.session_meets_mfa() in the database — keep the two in step
      const strongEnough =
        aal?.currentLevel === 'aal2' ||
        methods.some(isPasskeyMethod) ||
        (!hasAuthenticator && Boolean(session.user.user_metadata?.mfa_prompt_dismissed));
      if (strongEnough) {
        if (enteredUserId.current !== session.user.id) await enterAccount(session.user);
        return;
      }
      // Password checked; the authenticator code (or the one-time offer to set one up) comes first
      snapshotRef.current = null;
      enteredUserId.current = null;
      setUserId(null);
      setPendingEmail(session.user.email ?? null);
      setAuthStage(hasAuthenticator ? 'mfa-verify' : 'mfa-enroll');
    }).catch((err) => {
      console.error('Could not check sign-in', err);
      setAuthStage((stage) => (stage === 'loading' ? 'signed-out' : stage));
    });
    return authCheck.current;
  }, [enterAccount]);

  useEffect(() => {
    const loaded = loadUsers();
    usersRef.current = loaded;
    setUsers(loaded);
    if (!supabaseConfigured) {
      console.error('Supabase is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local');
      setAuthStage('signed-out');
      return;
    }
    void refreshAuth();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      // Supabase warns against awaiting its own calls inside this callback — defer them
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'MFA_CHALLENGE_VERIFIED') {
        window.setTimeout(() => void refreshAuth(), 0);
      }
    });
    return () => data.subscription.unsubscribe();
  }, [refreshAuth]);

  // Upload changes shortly after they happen, one batch at a time
  const flushToCloud = useCallback(() => {
    pushChain.current = pushChain.current.then(async () => {
      const id = enteredUserId.current;
      const previous = snapshotRef.current;
      const account = usersRef.current.find((u) => u.id === id);
      if (!id || !previous || !account) return;
      try {
        snapshotRef.current = await pushAccount(id, account, previous);
        // Only clear the marker if nothing changed while uploading
        if (usersRef.current.find((u) => u.id === id) === account) markUnsynced(id, false);
        setSyncError(null);
      } catch (err) {
        console.error('Cloud save failed', err);
        setSyncError('Some changes haven’t been saved to your account yet — they’ll retry automatically.');
      }
    });
    return pushChain.current;
  }, []);

  useEffect(() => {
    if (authStage !== 'signed-in' || !user) return;
    const timer = window.setTimeout(() => void flushToCloud(), 600);
    return () => window.clearTimeout(timer);
  }, [authStage, user, flushToCloud]);

  // Leaving the tab: try to save straight away rather than after the delay
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flushToCloud();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [flushToCloud]);

  // Account flags that must follow the user to other devices
  const prefsKey = user ? `${user.demoSeeded ?? ''}|${user.rarityBackfilled ?? ''}` : '';
  const syncedPrefs = useRef('');
  useEffect(() => {
    if (authStage !== 'signed-in' || !user) return;
    if (!syncedPrefs.current) {
      syncedPrefs.current = prefsKey;
      return;
    }
    if (syncedPrefs.current === prefsKey) return;
    syncedPrefs.current = prefsKey;
    void pushProfile(user.id, { prefs: { demoSeeded: user.demoSeeded, rarityBackfilled: user.rarityBackfilled } }).catch(
      (err) => console.warn('Could not save account flags', err),
    );
  }, [authStage, user, prefsKey]);

  // One-time: scans used to save no rarity, and older catalogue lookups mapped rainbow rares to
  // Rare and promos to Common. Re-read every matched card's rarity from the catalogue.
  const backfillUserId = user && !user.rarityBackfilled ? user.id : null;
  useEffect(() => {
    if (!backfillUserId) return;
    let cancelled = false;
    const markDone = (rarities?: Map<string, NonNullable<Card['rarity']>>) =>
      persist((prev) =>
        updateUser(prev, backfillUserId, (u) => ({
          ...u,
          rarityBackfilled: true,
          collection: rarities
            ? u.collection.map((c) => {
                const rarity = c.externalId ? rarities.get(c.externalId) : undefined;
                return rarity && rarity !== c.rarity ? { ...c, rarity } : c;
              })
            : u.collection,
        })),
      );
    const ids = (usersRef.current.find((u) => u.id === backfillUserId)?.collection ?? []).flatMap(
      (c) => c.externalId ?? [],
    );
    // Nothing matched to the catalogue: no need to download it
    if (ids.length === 0) {
      markDone();
      return;
    }
    void raritiesForIds(ids)
      .then((rarities) => {
        if (!cancelled) markDone(rarities);
      })
      // Offline or catalogue unreachable: leave the flag unset and try again next visit
      .catch((err) => console.warn('Rarity backfill skipped', err));
    return () => {
      cancelled = true;
    };
  }, [backfillUserId, persist]);

  const signup = useCallback(async (email: string, password: string, displayName: string) => {
    const normalized = email.trim().toLowerCase();
    if (!normalized || !password || !displayName.trim()) return 'Fill in all fields.';
    const { error } = await supabase.auth.signUp({
      email: normalized,
      password,
      options: {
        data: { display_name: displayName.trim() },
        // The confirmation link brings them back here to log in and set up 2FA
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });
    if (error) return authErrorMessage(error);
    // Supabase answers the same whether or not the email is new, so accounts can't be probed
    return null;
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (error) return authErrorMessage(error);
      await refreshAuth();
      return null;
    },
    [refreshAuth],
  );

  const startMfaEnrollment = useCallback(async (): Promise<MfaEnrollment | { error: string }> => {
    // An abandoned earlier attempt leaves an unverified factor behind; clear it before starting over
    const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) return { error: authErrorMessage(listError) };
    for (const factor of factors.all) {
      if (factor.factor_type === 'totp' && factor.status !== 'verified') {
        await supabase.auth.mfa.unenroll({ factorId: factor.id });
      }
    }
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `Authenticator app ${new Date().toISOString().slice(0, 10)}`,
    });
    if (error) return { error: authErrorMessage(error) };
    return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
  }, []);

  const verifyMfa = useCallback(
    async (code: string, factorId?: string) => {
      const clean = code.replace(/\s+/g, '');
      if (!/^\d{6}$/.test(clean)) return 'Enter the 6-digit code from your authenticator app.';
      let id = factorId;
      if (!id) {
        const { data, error } = await supabase.auth.mfa.listFactors();
        if (error) return authErrorMessage(error);
        id = data.totp[0]?.id;
        if (!id) return 'No authenticator is set up on this account yet.';
      }
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: id, code: clean });
      if (error) return authErrorMessage(error);
      await refreshAuth();
      return null;
    },
    [refreshAuth],
  );

  /** “Skip for now” on the 2FA offer: remembered on the account so it isn't asked every time. */
  const skipMfaSetup = useCallback(async () => {
    const { error } = await supabase.auth.updateUser({ data: { mfa_prompt_dismissed: true } });
    if (error) return authErrorMessage(error);
    await supabase.auth.refreshSession();
    await refreshAuth();
    return null;
  }, [refreshAuth]);

  const signInWithPasskey = useCallback(async () => {
    if (!window.PublicKeyCredential) return 'This browser doesn’t support passkeys.';
    const { error } = await supabase.auth.signInWithPasskey();
    if (error) return passkeyErrorMessage(error);
    await refreshAuth();
    return null;
  }, [refreshAuth]);

  const registerPasskey = useCallback(async () => {
    if (!window.PublicKeyCredential) return 'This browser doesn’t support passkeys.';
    const { error } = await supabase.auth.registerPasskey();
    if (error) return passkeyErrorMessage(error);
    // Offered during sign-in: a passkey is protection enough, so the prompt is done
    if (!enteredUserId.current) await skipMfaSetup();
    return null;
  }, [skipMfaSetup]);

  const listPasskeys = useCallback(async (): Promise<PasskeyListItem[] | { error: string }> => {
    const { data, error } = await supabase.auth.passkey.list();
    if (error) return { error: passkeyErrorMessage(error) };
    return data ?? [];
  }, []);

  const deletePasskey = useCallback(async (passkeyId: string) => {
    const { error } = await supabase.auth.passkey.delete({ passkeyId });
    return error ? passkeyErrorMessage(error) : null;
  }, []);

  /** Whether the account has a verified authenticator app. */
  const hasAuthenticatorApp = useCallback(async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    return Boolean(data?.totp.some((f) => f.status === 'verified'));
  }, []);

  const disableAuthenticatorApp = useCallback(async () => {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) return authErrorMessage(error);
    for (const factor of data.totp) {
      // Supabase only allows this from a session that passed two-factor
      const { error: removeError } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
      if (removeError) {
        return removeError.code === 'insufficient_aal'
          ? 'Log out and back in with your authenticator code, then turn it off.'
          : authErrorMessage(removeError);
      }
    }
    await supabase.auth.updateUser({ data: { mfa_prompt_dismissed: true } });
    return null;
  }, []);

  const logout = useCallback(async () => {
    const id = enteredUserId.current;
    if (id) await flushToCloud();
    await supabase.auth.signOut();
    snapshotRef.current = null;
    enteredUserId.current = null;
    // The account lives on the server now: don't leave a readable copy on a shared device
    if (id && !hasUnsynced(id)) persist((prev) => prev.filter((u) => u.id !== id));
    setUserId(null);
    setPendingEmail(null);
    setAuthStage('signed-out');
  }, [flushToCloud, persist]);

  const updateProfile = useCallback(
    async (patch: Partial<Pick<User, 'displayName' | 'email'>>) => {
      if (!userId) return null;
      const current = usersRef.current.find((u) => u.id === userId);
      const notes: string[] = [];
      const displayName = patch.displayName?.trim();
      if (displayName && displayName !== current?.displayName) {
        try {
          await pushProfile(userId, { displayName });
          persist((prev) => updateUser(prev, userId, (u) => ({ ...u, displayName })));
        } catch (err) {
          return err instanceof Error ? err.message : 'Couldn’t save your display name.';
        }
      }
      const email = patch.email?.trim().toLowerCase();
      if (email && email !== current?.email) {
        // Supabase emails the new address; the change applies once it's confirmed
        const { error } = await supabase.auth.updateUser(
          { email },
          { emailRedirectTo: `${window.location.origin}/account` },
        );
        if (error) return authErrorMessage(error);
        notes.push(`Check ${email} to confirm the change — your email stays the same until you do.`);
      }
      return notes.join(' ') || null;
    },
    [persist, userId],
  );

  const activatePremium = useCallback(
    async (method: PremiumPaymentMethod) => {
      if (!userId) return 'Not signed in.';
      try {
        await activatePremiumOnServer(method);
        const { profile } = await pullAccount(userId);
        persist((prev) =>
          updateUser(prev, userId, (u) => ({
            ...u,
            isPremium: profile.isPremium,
            premiumPurchasedAt: profile.premiumPurchasedAt,
            premiumPaymentMethod: profile.premiumPaymentMethod,
          })),
        );
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : 'Couldn’t activate Premium.';
      }
    },
    [persist, userId],
  );

  const addCards = useCallback(
    (cards: Card[]) => {
      if (!userId) return;
      persist((prev) =>
        updateUser(prev, userId, (u) => ({ ...u, collection: [...cards, ...u.collection] })),
      );
    },
    [persist, userId],
  );

  const savePageImport = useCallback(
    (input: {
      importId: string;
      imageDataUrl: string;
      width: number;
      height: number;
      detectorId: DetectorId;
      detections: PageDetection[];
    }): 'saved' | 'duplicate' | 'storage-full' => {
      if (!userId) return 'duplicate';
      let status: 'saved' | 'duplicate' = 'saved';
      const stored = persist((prev) =>
        updateUser(prev, userId, (u) => {
          const imports = u.pageImports ?? [];
          const existing = imports.find((item) => item.id === input.importId);
          if (existing?.savedAt) {
            status = 'duplicate';
            return u;
          }
          const now = new Date().toISOString();
          const cards: Card[] = [];
          for (const det of input.detections) {
            if (!det.included) continue;
            const qty = Math.max(0, Math.floor(det.quantity));
            for (let n = 0; n < qty; n++) {
              cards.push({
                id: makeId('card'),
                name: det.name.trim(),
                set: det.set.trim(),
                number: det.cardNumber.trim(),
                rarity: det.rarity,
                game: det.game.trim(),
                imageHue: 210,
                imageDataUrl: det.imageDataUrl,
                externalId: det.externalId,
                importId: input.importId,
                addedAt: now,
                condition: det.condition,
                printing: det.printing,
                justtcgCardId: det.justtcgCardId,
                justtcgVariantId: det.justtcgVariantId,
                price: det.price ?? null,
                priceStatus: det.priceStatus,
              });
            }
          }
          // Crops already live on the cards; storing them (and the page photo) again overflows localStorage
          const detections = input.detections.map((det) => ({
            ...det,
            importId: input.importId,
            imageDataUrl: undefined,
          }));
          return {
            ...u,
            collection: [...cards, ...u.collection],
            pageImports: [
              {
                id: input.importId,
                width: input.width,
                height: input.height,
                createdAt: existing?.createdAt ?? now,
                detectorId: input.detectorId,
                savedAt: now,
              },
              ...imports.filter((item) => item.id !== input.importId),
            ],
            pageDetections: [
              ...(u.pageDetections ?? []).filter((det) => det.importId !== input.importId),
              ...detections,
            ],
          };
        }),
      );
      return stored ? status : 'storage-full';
    },
    [persist, userId],
  );

  const updateCard = useCallback(
    (cardId: string, patch: Partial<Card>) => {
      if (!userId) return;
      persist((prev) =>
        updateUser(prev, userId, (u) => ({
          ...u,
          collection: u.collection.map((c) => (c.id === cardId ? { ...c, ...patch } : c)),
        })),
      );
    },
    [persist, userId],
  );

  const removeCard = useCallback(
    (cardId: string) => {
      if (!userId) return;
      persist((prev) =>
        updateUser(prev, userId, (u) => ({
          ...u,
          collection: u.collection.filter((c) => c.id !== cardId),
          binders: u.binders.map((b) => ({
            ...b,
            pages: b.pages.map((p) => ({
              slots: p.slots.map((s) => (s === cardId ? null : s)),
            })),
          })),
        })),
      );
    },
    [persist, userId],
  );

  const removeAllCards = useCallback(() => {
    if (!userId) return;
    persist((prev) =>
      updateUser(prev, userId, (u) => ({
        ...u,
        collection: [],
        binders: u.binders.map((b) => ({
          ...b,
          pages: b.pages.map((p) => ({ slots: p.slots.map(() => null) })),
        })),
      })),
    );
  }, [persist, userId]);

  const createBinder = useCallback(
    (input: {
      name: string;
      style: BinderStyle;
      size: BinderSize;
      pageCount?: number;
      coverPreset?: Binder['coverPreset'];
      previewImageDataUrl?: string;
    }) => {
      if (!userId) throw new Error('Not signed in');
      const now = new Date();
      const binder: Binder = {
        id: makeId('binder'),
        name: input.name.trim() || 'Untitled Binder',
        style: input.style,
        size: input.size,
        pages: emptyPages(input.size, input.pageCount ?? 4),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        valueHistory: initialValueHistory(now),
        isPublic: false,
        coverPreset: input.coverPreset ?? 'classic',
        previewImageDataUrl: input.previewImageDataUrl,
      };
      persist((prev) =>
        updateUser(prev, userId, (u) => ({ ...u, binders: [binder, ...u.binders] })),
      );
      return binder;
    },
    [persist, userId],
  );

  const updateBinder = useCallback(
    (binderId: string, patch: Partial<Binder>) => {
      if (!userId) return;
      persist((prev) =>
        updateUser(prev, userId, (u) => ({
          ...u,
          binders: u.binders.map((b) =>
            b.id === binderId ? { ...b, ...patch, updatedAt: new Date().toISOString() } : b,
          ),
        })),
      );
    },
    [persist, userId],
  );

  const deleteBinder = useCallback(
    (binderId: string) => {
      if (!userId) return;
      persist((prev) =>
        updateUser(prev, userId, (u) => ({
          ...u,
          binders: u.binders.filter((b) => b.id !== binderId),
        })),
      );
    },
    [persist, userId],
  );

  const setSlot = useCallback(
    (binderId: string, pageIndex: number, slotIndex: number, cardId: string | null) => {
      if (!userId) return;
      persist((prev) =>
        updateUser(prev, userId, (u) => ({
          ...u,
          binders: u.binders.map((b) => {
            if (b.id !== binderId) return b;
            const pages = b.pages.map((p, pi) => {
              if (pi !== pageIndex) return p;
              const slots = [...p.slots];
              slots[slotIndex] = cardId;
              return { slots };
            });
            return { ...b, pages, updatedAt: new Date().toISOString() };
          }),
        })),
      );
    },
    [persist, userId],
  );

  const swapSlots = useCallback(
    (
      binderId: string,
      from: { page: number; slot: number },
      to: { page: number; slot: number },
    ) => {
      if (!userId) return;
      if (from.page === to.page && from.slot === to.slot) return;
      persist((prev) =>
        updateUser(prev, userId, (u) => ({
          ...u,
          binders: u.binders.map((b) => {
            if (b.id !== binderId) return b;
            if (!b.pages[from.page] || !b.pages[to.page]) return b;
            const pages = b.pages.map((p) => ({ slots: [...p.slots] }));
            const moving = pages[from.page].slots[from.slot];
            pages[from.page].slots[from.slot] = pages[to.page].slots[to.slot];
            pages[to.page].slots[to.slot] = moving;
            return { ...b, pages, updatedAt: new Date().toISOString() };
          }),
        })),
      );
    },
    [persist, userId],
  );

  const placeInNextEmptySlot = useCallback(
    (
      binderId: string,
      cardId: string,
      preferred?: { page: number; slot: number },
    ): { page: number; slot: number } | null => {
      if (!userId) return null;
      let placed: { page: number; slot: number } | null = null;
      persist((prev) =>
        updateUser(prev, userId, (u) => {
          const binder = u.binders.find((b) => b.id === binderId);
          if (!binder) return u;
          if (binder.pages.some((page) => page.slots.includes(cardId))) return u;

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

          let target = preferredEmpty;
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
          placed = target;
          return {
            ...u,
            binders: u.binders.map((b) =>
              b.id === binderId ? { ...b, pages, updatedAt: new Date().toISOString() } : b,
            ),
          };
        }),
      );
      return placed;
    },
    [persist, userId],
  );

  const value = useMemo(
    () => ({
      user,
      ready,
      authStage,
      pendingEmail,
      syncError,
      signup,
      login,
      startMfaEnrollment,
      verifyMfa,
      skipMfaSetup,
      signInWithPasskey,
      registerPasskey,
      listPasskeys,
      deletePasskey,
      hasAuthenticatorApp,
      disableAuthenticatorApp,
      logout,
      updateProfile,
      activatePremium,
      addCards,
      savePageImport,
      updateCard,
      removeCard,
      removeAllCards,
      createBinder,
      updateBinder,
      deleteBinder,
      setSlot,
      swapSlots,
      placeInNextEmptySlot,
    }),
    [
      user, ready, authStage, pendingEmail, syncError, signup, login, startMfaEnrollment, verifyMfa, skipMfaSetup,
      signInWithPasskey, registerPasskey, listPasskeys, deletePasskey, hasAuthenticatorApp, disableAuthenticatorApp, logout,
      updateProfile, activatePremium, addCards, savePageImport, updateCard, removeCard,
      removeAllCards, createBinder, updateBinder, deleteBinder, setSlot, swapSlots, placeInNextEmptySlot,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
