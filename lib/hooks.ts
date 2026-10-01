import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api, ApiError, isAbort, isApiError, rateLimitGate, retryDelay } from './api';
import { toPreviewProducts, type CartLine } from './store';
import type { PaymentOption, Quote } from './types';

export interface Resource<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
}

const toApiError = (e: unknown) => (isApiError(e) ? e : new ApiError('api', 0, null, 'Unexpected error'));

const resourceCache = new Map<string, unknown>();
const prefetching = new Set<string>();
const NETWORK_RETRY_MS = 10000;

// Warms the cache for a key the visitor is about to ask for, e.g. a menu tab under their finger.
export function prefetchResource<T>(key: string, loader: (signal?: AbortSignal) => Promise<T>) {
  if (resourceCache.has(key) || prefetching.has(key)) return;
  prefetching.add(key);
  loader()
    .then((data) => resourceCache.set(key, data))
    .catch(() => undefined)
    .finally(() => prefetching.delete(key));
}

// Loads once per key. Retries on its own after a rate limit or a network failure.
// With `cached`, a key seen before is served from memory at once and refreshed in the background.
export function useResource<T>(key: string | null, loader: (signal: AbortSignal) => Promise<T>, cached = false): Resource<T> {
  const [state, setState] = useState<{ key: string | null; data: T | null; error: ApiError | null; loading: boolean }>({
    key: null,
    data: null,
    error: null,
    loading: key !== null,
  });
  const [attempt, setAttempt] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const retry = () => setAttempt((n) => n + 1);
    setState((s) => ({ ...s, loading: true, error: null }));

    loaderRef
      .current(controller.signal)
      .then((data) => {
        if (cancelled) return;
        if (cached) resourceCache.set(key, data);
        setState({ key, data, error: null, loading: false });
      })
      .catch((e) => {
        if (cancelled || isAbort(e)) return;
        const error = toApiError(e);
        setState((s) => ({ key, data: s.key === key ? s.data : ((resourceCache.get(key) as T | undefined) ?? null), error, loading: false }));
        if (error.kind === 'rate_limited') timer = setTimeout(retry, retryDelay(error.retryAfterMs));
        if (error.kind === 'network') {
          // "online" covers a dropped connection; the timer covers failures the browser does not report as offline.
          window.addEventListener('online', retry, { once: true });
          timer = setTimeout(retry, NETWORK_RETRY_MS);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener('online', retry);
    };
  }, [key, attempt, cached]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const fresh = state.key === key;
  const data = fresh ? state.data : key !== null && cached ? ((resourceCache.get(key) as T | undefined) ?? null) : null;
  return {
    data,
    error: fresh ? state.error : null,
    loading: key !== null && data === null && (state.loading || !fresh),
    reload,
  };
}

export interface QuoteState {
  // The quote for the cart as it is now. While a new one is being fetched, the previous one is kept so totals can dim instead of vanish.
  quote: Quote | null;
  // False while `quote` belongs to an earlier version of the cart.
  current: boolean;
  error: ApiError | null;
  loading: boolean;
  refresh: () => void;
  // Replaces the shown quote with one fetched elsewhere, e.g. the re-price before placing.
  adopt: (quote: Quote) => void;
}

// Re-prices the cart shortly after it stops changing.
export function useQuote(lines: CartLine[], paymentOption: PaymentOption | null, lang: string | null): QuoteState {
  const [held, setHeld] = useState<{ key: string; quote: Quote } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const key = lines.length && paymentOption ? `${JSON.stringify(toPreviewProducts(lines))}|${paymentOption}|${lang}` : null;

  useEffect(() => {
    if (key === null || !paymentOption) {
      setHeld(null);
      setError(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      api
        .preview({ products: toPreviewProducts(lines), orderType: 'PICK_UP', paymentOption }, lang, controller.signal)
        .then((quote) => {
          if (cancelled) return;
          setHeld({ key, quote });
          setLoading(false);
        })
        .catch((e) => {
          if (cancelled || isAbort(e)) return;
          const err = toApiError(e);
          setError(err);
          setLoading(false);
          if (err.kind === 'rate_limited') retryTimer = setTimeout(() => setAttempt((n) => n + 1), retryDelay(err.retryAfterMs));
        });
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(retryTimer);
      controller.abort();
    };
    // `lines` is represented by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const refresh = useCallback(() => setAttempt((n) => n + 1), []);
  const adopt = useCallback((quote: Quote) => key !== null && setHeld({ key, quote }), [key]);
  const current = held !== null && held.key === key;
  // A quote for an older cart is only worth showing while its replacement is on the way.
  return { quote: current || loading ? (held?.quote ?? null) : null, current, error, loading, refresh, adopt };
}

// Seconds left on the shared rate-limit gate, or 0. Ticks only while the gate is closed.
export function useRateLimitSeconds() {
  const until = useSyncExternalStore(rateLimitGate.subscribe, rateLimitGate.until, () => 0);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const left = () => Math.max(0, Math.ceil((until - Date.now()) / 1000));
    setSeconds(left());
    if (left() === 0) return;
    const timer = setInterval(() => {
      setSeconds(left());
      if (left() === 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [until]);
  return seconds;
}

export function useMedia(query: string) {
  const subscribe = useCallback(
    (fn: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', fn);
      return () => mq.removeEventListener('change', fn);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

function subscribeOnline(fn: () => void) {
  window.addEventListener('online', fn);
  window.addEventListener('offline', fn);
  return () => {
    window.removeEventListener('online', fn);
    window.removeEventListener('offline', fn);
  };
}

export function useOnline() {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

export const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// True once the element has come within reach of the viewport. Used to hold back heavy photos.
// Takes a callback ref so it also works for elements that mount after the first render.
export function useNearViewport<T extends Element>(margin = '350px') {
  const [element, setElement] = useState<T | null>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (!element || near) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: margin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, near, margin]);
  return [setElement, near] as const;
}
