import { useSyncExternalStore } from 'react';
import type { PreviewRequest } from './types';

export interface CartModifier {
  id: string;
  name: string;
  items: { itemId: string; name: string; price: number }[];
}

export interface CartLine {
  key: string;
  productId: string;
  storeMenuCategoryId: string;
  name: string;
  imageUrl: string | null;
  // Listed price of one unit including its options, in the store's default price type.
  unitPrice: number;
  quantity: number;
  note: string;
  modifiers: CartModifier[];
}

export interface RecentOrder {
  orderId: string;
  serial: string | null;
  transactionId?: string | null;
}

interface Persisted {
  lines: CartLine[];
  lang: string | null;
  menuId: string | null;
  recent: RecentOrder[];
}

const KEY = 'storefront.v1';
const empty: Persisted = { lines: [], lang: null, menuId: null, recent: [] };

let state: Persisted = empty;
const listeners = new Set<() => void>();

function set(next: Partial<Persisted>) {
  state = { ...state, ...next };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable: the cart simply lives for this visit.
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function hydrateStore() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = { ...empty, ...JSON.parse(raw) };
  } catch {
    state = empty;
  }
  listeners.forEach((fn) => fn());
}

export function useStore(): Persisted {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => empty,
  );
}

export function lineKey(productId: string, storeMenuCategoryId: string, modifiers: CartModifier[], note: string) {
  const mods = modifiers
    .map((m) => `${m.id}:${m.items.map((i) => i.itemId).sort().join(',')}`)
    .sort()
    .join('|');
  return `${productId}/${storeMenuCategoryId}/${mods}/${note.trim()}`;
}

export const cart = {
  add(line: CartLine) {
    const existing = state.lines.find((l) => l.key === line.key);
    set({
      lines: existing
        ? state.lines.map((l) => (l.key === line.key ? { ...l, quantity: l.quantity + line.quantity } : l))
        : [...state.lines, line],
    });
  },
  setQuantity(key: string, quantity: number) {
    set({
      lines:
        quantity <= 0
          ? state.lines.filter((l) => l.key !== key)
          : state.lines.map((l) => (l.key === key ? { ...l, quantity } : l)),
    });
  },
  clear() {
    set({ lines: [] });
  },
};

export const prefs = {
  setLang: (lang: string | null) => set({ lang }),
  setMenu: (menuId: string) => set({ menuId }),
  rememberOrder(order: RecentOrder) {
    set({ recent: [order, ...state.recent.filter((r) => r.orderId !== order.orderId)].slice(0, 5) });
  },
};

export function toPreviewProducts(lines: CartLine[]): PreviewRequest['products'] {
  return lines.map((l) => ({
    productId: l.productId,
    storeMenuCategoryId: l.storeMenuCategoryId,
    quantity: l.quantity,
    ...(l.note.trim() ? { note: l.note.trim() } : {}),
    ...(l.modifiers.length
      ? { modifiers: l.modifiers.map((m) => ({ id: m.id, items: m.items.map((i) => ({ itemId: i.itemId, quantity: 1 })) })) }
      : {}),
  }));
}
