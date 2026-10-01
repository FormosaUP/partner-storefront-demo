import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api, ApiError, isAbort, isApiError, rateLimitGate } from './api';
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

// Warms the cache for a key the visitor is about to ask for, e.g. a menu tab under their finger.
export function prefetchResource<T>(key: string, loader: (signal?: AbortSignal) => Promise<T>) {
  if (resourceCache.has(key) || prefetching.has(key)) return;
  prefetching.add(key);
  loader()
    .then((data) => resourceCache.set(key, data))
    .catch(() => undefined)
    .finally(() => prefetching.delete(key));
}

// Loads once per key. Retries on its own after a rate limit, and when the connection comes back.
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    const retry = () => setAttempt((n) => n + 1);
    setState((s) => ({ ...s, loading: true, error: null }));

    loaderRef
      .current(controller.signal)
      .then((data) => {
        if (cached) resourceCache.set(key, data);
        setState({ key, data, error: null, loading: false });
      })
      .catch((e) => {
        if (isAbort(e)) return;
        const error = toApiError(e);
        setState((s) => ({ key, data: s.key === key ? s.data : ((resourceCache.get(key) as T | undefined) ?? null), error, loading: false }));
        if (error.kind === 'rate_limited') timer = setTimeout(retry, error.retryAfterMs + 300);
        if (error.kind === 'network') window.addEventListener('online', retry, { once: true });
      });

    return () => {
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener('online', retry);
    };
  }, [key, attempt]);

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
  quote: Quote | null;
  error: ApiError | null;
  loading: boolean;
  refresh: () => void;
  // Replaces the shown quote with one fetched elsewhere, e.g. the re-price before placing.
  adopt: (quote: Quote) => void;
}

// Re-prices the cart shortly after it stops changing.
export function useQuote(lines: CartLine[], paymentOption: PaymentOption | null, lang: string | null): QuoteState {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const signature = JSON.stringify(toPreviewProducts(lines));

  useEffect(() => {
    if (!lines.length || !paymentOption) {
      setQuote(null);
      setError(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    setLoading(true);
    const timer = setTimeout(() => {
      api
        .preview({ products: toPreviewProducts(lines), orderType: 'PICK_UP', paymentOption }, lang, controller.signal)
        .then((q) => {
          setQuote(q);
          setError(null);
          setLoading(false);
        })
        .catch((e) => {
          if (isAbort(e)) return;
          const err = toApiError(e);
          setError(err);
          setLoading(false);
          if (err.kind === 'rate_limited') retryTimer = setTimeout(() => setAttempt((n) => n + 1), err.retryAfterMs + 300);
        });
    }, 450);
    return () => {
      clearTimeout(timer);
      clearTimeout(retryTimer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, paymentOption, lang, attempt]);

  const refresh = useCallback(() => setAttempt((n) => n + 1), []);
  return { quote, error, loading, refresh, adopt: setQuote };
}

// Seconds left on the shared rate-limit gate, or 0.
export function useRateLimitSeconds() {
  const until = useSyncExternalStore(rateLimitGate.subscribe, rateLimitGate.until, () => 0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until <= Date.now()) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);
  return Math.max(0, Math.ceil((until - now) / 1000));
}

export function useMedia(query: string) {
  return useSyncExternalStore(
    (fn) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', fn);
      return () => mq.removeEventListener('change', fn);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export function useOnline() {
  return useSyncExternalStore(
    (fn) => {
      window.addEventListener('online', fn);
      window.addEventListener('offline', fn);
      return () => {
        window.removeEventListener('online', fn);
        window.removeEventListener('offline', fn);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
