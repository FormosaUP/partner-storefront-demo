import type {
  CreatedOrder,
  CreateOrderRequest,
  MenuDetail,
  MenuSummary,
  OrderDetail,
  PaymentOption,
  PaymentStart,
  PreviewRequest,
  ProductModifiers,
  Quote,
  StoreLanguage,
  StoreSettings,
  TransactionState,
} from './types';

export const API_BASE = 'https://api-dev.ulite.com/online-order/partner';

export interface ValidationError {
  propertyName: string | null;
  errorMessage: string | null;
}

export type ApiErrorKind = 'network' | 'rate_limited' | 'api';

export class ApiError extends Error {
  constructor(
    public kind: ApiErrorKind,
    public status: number,
    public code: string | null,
    message: string,
    public validationErrors: ValidationError[] = [],
    public retryAfterMs = 0,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;
export const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

// Shared rate-limit gate: once a 429 arrives, nothing is sent until its Retry-After has passed.
let limitedUntil = 0;
let backoffMs = 0;
const gateListeners = new Set<() => void>();

export const rateLimitGate = {
  subscribe(fn: () => void) {
    gateListeners.add(fn);
    return () => {
      gateListeners.delete(fn);
    };
  },
  until: () => limitedUntil,
};

function closeGate(ms: number) {
  limitedUntil = Date.now() + ms;
  gateListeners.forEach((fn) => fn());
}

function retryAfterMs(res: Response): number {
  const raw = res.headers.get('Retry-After');
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(1000, seconds * 1000);
    const date = Date.parse(raw);
    if (!Number.isNaN(date)) return Math.max(1000, date - Date.now());
  }
  // Header not readable from the browser: back off on our own, doubling up to two minutes.
  backoffMs = Math.min(backoffMs ? backoffMs * 2 : 15000, 120000);
  return backoffMs;
}

function errorCode(body: unknown): string | null {
  const b = body as { error?: { code?: unknown; resultCode?: unknown }; code?: unknown } | null;
  if (typeof b?.error?.code === 'string') return b.error.code;
  if (typeof b?.error?.resultCode === 'string') return b.error.resultCode;
  if (typeof b?.code === 'string') return b.code;
  return null;
}

interface RequestOptions {
  body?: unknown;
  lang?: string | null;
  signal?: AbortSignal;
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const wait = limitedUntil - Date.now();
  if (wait > 0) throw new ApiError('rate_limited', 429, null, 'Rate limited', [], wait);

  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.lang) headers['X-Context-Language'] = opts.lang;

  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new ApiError('network', 0, null, 'Network request failed');
  }

  if (res.status === 429) {
    const ms = retryAfterMs(res);
    closeGate(ms);
    throw new ApiError('rate_limited', 429, null, 'Rate limited', [], ms);
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const envelope = body as { isSuccess?: boolean; data?: T; error?: { message?: string; validationErrors?: ValidationError[] } } | null;

  if (!res.ok || !envelope || envelope.isSuccess === false) {
    throw new ApiError(
      'api',
      res.status,
      errorCode(body),
      envelope?.error?.message ?? `Request failed (${res.status})`,
      envelope?.error?.validationErrors ?? [],
    );
  }
  backoffMs = 0;
  return envelope.data as T;
}

export const api = {
  settings: (lang?: string | null, signal?: AbortSignal) =>
    request<StoreSettings>('GET', '/api/v1/Store/Settings', { lang, signal }),

  languages: (signal?: AbortSignal) =>
    request<{ languages: StoreLanguage[] | null }>('GET', '/api/v1/Store/Languages', { signal }),

  menus: (lang?: string | null, signal?: AbortSignal) =>
    request<{ menus: MenuSummary[] | null }>('GET', '/api/v1/Menu', { lang, signal }),

  menu: (menuId: string, lang?: string | null, signal?: AbortSignal) =>
    request<MenuDetail>('GET', `/api/v1/Menu/${menuId}`, { lang, signal }),

  modifiers: (productId: string, storeMenuCategoryId: string, lang?: string | null, signal?: AbortSignal) =>
    request<ProductModifiers>(
      'GET',
      `/api/v1/Product/Modifiers?ProductId=${productId}&StoreMenuCategoryId=${storeMenuCategoryId}`,
      { lang, signal },
    ),

  preview: (body: PreviewRequest, lang?: string | null, signal?: AbortSignal) =>
    request<Quote>('POST', '/api/v1/Order/Preview', { body, lang, signal }),

  placeOrder: (body: CreateOrderRequest, lang?: string | null) =>
    request<CreatedOrder>('POST', '/api/v1/Order', { body, lang }),

  order: (orderId: string, lang?: string | null, signal?: AbortSignal) =>
    request<OrderDetail>('GET', `/api/v1/Order/${orderId}`, { lang, signal }),

  changePaymentOption: (orderId: string, paymentOption: PaymentOption, lang?: string | null) =>
    request<OrderDetail>('PATCH', `/api/v1/Order/${orderId}`, { body: { paymentOption }, lang }),

  startPayment: (orderId: string, successCallbackUrl: string, failCallbackUrl: string, lang?: string | null) =>
    request<PaymentStart>('POST', '/api/v1/Transaction/Initial', {
      body: { orderId, paymentMethod: 'ONLINE_PAYMENT', successCallbackUrl, failCallbackUrl },
      lang,
    }),

  transaction: (transactionId: string, signal?: AbortSignal) =>
    request<TransactionState>('GET', `/api/v1/Transaction/Status/${transactionId}`, { signal }),
};
