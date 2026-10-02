import { useSyncExternalStore } from 'react';
import { isUuid } from './api';
import { isWallClock } from './schedule';
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
  // The pickup time chosen for a scheduled order, as the store-local wall-clock string.
  scheduledFor?: string | null;
}

interface Persisted {
  lines: CartLine[];
  lang: string | null;
  menuId: string | null;
  recent: RecentOrder[];
  // Set when an order was sent but no answer came back, so the warning survives a reload.
  unconfirmedAt: number | null;
  // Chosen pickup time (store-local wall clock), or null for as soon as possible.
  pickupTime: string | null;
}

const KEY = 'storefront.v1';
const MAX_QUANTITY = 99;
const empty: Persisted = { lines: [], lang: null, menuId: null, recent: [], unconfirmedAt: null, pickupTime: null };

let state: Persisted = empty;
const listeners = new Set<() => void>();

const isLine = (l: unknown): l is CartLine => {
  const x = l as CartLine | null;
  return (
    !!x &&
    typeof x.key === 'string' &&
    isUuid(x.productId) &&
    isUuid(x.storeMenuCategoryId) &&
    typeof x.name === 'string' &&
    typeof x.unitPrice === 'number' &&
    Number.isInteger(x.quantity) &&
    x.quantity > 0 &&
    typeof x.note === 'string' &&
    Array.isArray(x.modifiers) &&
    x.modifiers.every((m) => m && isUuid(m.id) && Array.isArray(m.items) && m.items.every((i) => i && isUuid(i.itemId)))
  );
};

// Storage is shared with every other page on this origin, so nothing read from it is trusted as-is.
function parse(raw: string | null): Persisted {
  if (!raw) return empty;
  try {
    const p = JSON.parse(raw) as Partial<Persisted> | null;
    if (!p || typeof p !== 'object') return empty;
    return {
      lines: Array.isArray(p.lines) ? p.lines.filter(isLine) : [],
      lang: typeof p.lang === 'string' && p.lang.length <= 12 ? p.lang : null,
      menuId: isUuid(p.menuId) ? p.menuId : null,
      recent: Array.isArray(p.recent)
        ? p.recent
            .filter((r) => r && isUuid(r.orderId))
            .map((r) => ({
              orderId: r.orderId,
              serial: typeof r.serial === 'string' ? r.serial : null,
              transactionId: isUuid(r.transactionId) ? r.transactionId : null,
              scheduledFor: isWallClock(r.scheduledFor) ? r.scheduledFor : null,
            }))
            .slice(0, 5)
        : [],
      unconfirmedAt: typeof p.unconfirmedAt === 'number' ? p.unconfirmedAt : null,
      pickupTime: isWallClock(p.pickupTime) ? p.pickupTime : null,
    };
  } catch {
    return empty;
  }
}

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
  const read = () => {
    try {
      state = parse(localStorage.getItem(KEY));
    } catch {
      state = empty;
    }
    listeners.forEach((fn) => fn());
  };
  read();
  // Another tab changed the cart or placed an order: follow it rather than overwrite it later.
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) read();
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
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
    .map(
      (m) =>
        `${m.id}:${m.items
          .map((i) => i.itemId)
          .sort()
          .join(',')}`,
    )
    .sort()
    .join('|');
  return `${productId}/${storeMenuCategoryId}/${mods}/${note.trim()}`;
}

export const cart = {
  add(line: CartLine) {
    const existing = state.lines.find((l) => l.key === line.key);
    set({
      lines: existing
        ? state.lines.map((l) => (l.key === line.key ? { ...l, quantity: Math.min(MAX_QUANTITY, l.quantity + line.quantity) } : l))
        : [...state.lines, line],
    });
  },
  setQuantity(key: string, quantity: number) {
    set({
      lines:
        quantity <= 0
          ? state.lines.filter((l) => l.key !== key)
          : state.lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(MAX_QUANTITY, quantity) } : l)),
    });
  },
  clear() {
    set({ lines: [] });
  },
};

export const prefs = {
  setLang: (lang: string | null) => set({ lang }),
  setMenu: (menuId: string) => set({ menuId }),
  setUnconfirmed: (at: number | null) => set({ unconfirmedAt: at }),
  setPickupTime: (pickupTime: string | null) => set({ pickupTime }),
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
    ...(l.modifiers.length ? { modifiers: l.modifiers.map((m) => ({ id: m.id, items: m.items.map((i) => ({ itemId: i.itemId, quantity: 1 })) })) } : {}),
  }));
}
