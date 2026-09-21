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
import type { Binder, BinderPage, BinderSize, BinderStyle, Card, User } from '../types';
import { SLOT_COUNTS } from '../types';
import {
  loadSession,
  loadUsers,
  makeId,
  makeShareCode,
  saveSession,
  saveUsers,
} from '../lib/storage';
import { createDemoCards } from '../lib/cards';

interface AppStore {
  user: User | null;
  ready: boolean;
  signup: (email: string, password: string, displayName: string) => string | null;
  login: (email: string, password: string) => string | null;
  logout: () => void;
  updateProfile: (patch: Partial<Pick<User, 'displayName' | 'email'>>) => void;
  addCards: (cards: Card[]) => void;
  updateCard: (cardId: string, patch: Partial<Card>) => void;
  removeCard: (cardId: string) => void;
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
  findUserByShareCode: (code: string) => User | null;
  findPublicBinder: (
    shareCode: string,
    binderId: string,
  ) => { owner: User; binder: Binder } | null;
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

export function StoreProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<User[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const usersRef = useRef(users);
  usersRef.current = users;

  useEffect(() => {
    const loaded = loadUsers();
    usersRef.current = loaded;
    setUsers(loaded);
    setUserId(loadSession()?.userId ?? null);
    setReady(true);
  }, []);

  const persist = useCallback((updater: (prev: User[]) => User[]) => {
    const next = updater(usersRef.current);
    usersRef.current = next;
    saveUsers(next);
    setUsers(next);
  }, []);

  const user = useMemo(() => users.find((u) => u.id === userId) ?? null, [users, userId]);

  const signup = useCallback(
    (email: string, password: string, displayName: string) => {
      const normalized = email.trim().toLowerCase();
      if (!normalized || !password || !displayName.trim()) return 'Fill in all fields.';
      let error: string | null = null;
      let newId = '';
      persist((prev) => {
        if (prev.some((u) => u.email === normalized)) {
          error = 'An account with that email already exists.';
          return prev;
        }
        const newUser: User = {
          id: makeId('user'),
          email: normalized,
          displayName: displayName.trim(),
          password,
          shareCode: makeShareCode(),
          collection: createDemoCards().slice(0, 6),
          binders: [],
        };
        newId = newUser.id;
        return [...prev, newUser];
      });
      if (error) return error;
      setUserId(newId);
      saveSession({ userId: newId });
      return null;
    },
    [persist],
  );

  const login = useCallback(
    (email: string, password: string) => {
      const normalized = email.trim().toLowerCase();
      const found = users.find((u) => u.email === normalized && u.password === password);
      if (!found) return 'Invalid email or password.';
      setUserId(found.id);
      saveSession({ userId: found.id });
      return null;
    },
    [users],
  );

  const logout = useCallback(() => {
    setUserId(null);
    saveSession(null);
  }, []);

  const updateProfile = useCallback(
    (patch: Partial<Pick<User, 'displayName' | 'email'>>) => {
      if (!userId) return;
      persist((prev) =>
        updateUser(prev, userId, (u) => ({
          ...u,
          ...patch,
          email: patch.email ? patch.email.trim().toLowerCase() : u.email,
        })),
      );
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
      const binder: Binder = {
        id: makeId('binder'),
        name: input.name.trim() || 'Untitled Binder',
        style: input.style,
        size: input.size,
        pages: emptyPages(input.size, input.pageCount ?? 4),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isPublic: true,
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

  const findUserByShareCode = useCallback(
    (code: string) =>
      users.find((u) => u.shareCode.toUpperCase() === code.toUpperCase()) ?? null,
    [users],
  );

  const findPublicBinder = useCallback(
    (shareCode: string, binderId: string) => {
      const owner = findUserByShareCode(shareCode);
      if (!owner) return null;
      const binder = owner.binders.find((b) => b.id === binderId && b.isPublic);
      if (!binder) return null;
      return { owner, binder };
    },
    [findUserByShareCode],
  );

  const value = useMemo(
    () => ({
      user,
      ready,
      signup,
      login,
      logout,
      updateProfile,
      addCards,
      updateCard,
      removeCard,
      createBinder,
      updateBinder,
      deleteBinder,
      setSlot,
      swapSlots,
      placeInNextEmptySlot,
      findUserByShareCode,
      findPublicBinder,
    }),
    [
      user, ready, signup, login, logout, updateProfile, addCards, updateCard, removeCard,
      createBinder, updateBinder, deleteBinder, setSlot, swapSlots, placeInNextEmptySlot, findUserByShareCode, findPublicBinder,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
