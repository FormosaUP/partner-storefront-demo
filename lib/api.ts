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

// 'unconfirmed': the request may or may not have taken effect (no usable answer came back).
export type ApiErrorKind = 'network' | 'rate_limited' | 'api' | 'unconfirmed';

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
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

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

function closeGate(res: Response): number {
  const now = Date.now();
  let ms = 0;
  const raw = res.headers.get('Retry-After');
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) ms = seconds * 1000;
    else if (!Number.isNaN(Date.parse(raw))) ms = Date.parse(raw) - now;
  }
  if (ms <= 0) {
    // Header not readable from the browser. Back off on our own, doubling up to two minutes,
    // but only once per closure: parallel requests rejected together count as one event.
    if (limitedUntil > now) return limitedUntil - now;
    backoffMs = Math.min(backoffMs ? backoffMs * 2 : 15000, 120000);
    ms = backoffMs;
  }
  limitedUntil = Math.max(limitedUntil, now + Math.max(1000, ms));
  gateListeners.forEach((fn) => fn());
  return limitedUntil - now;
}

// Spreads retries out so everything waiting on the gate does not fire in the same instant.
export const retryDelay = (ms: number) => ms + 300 + Math.random() * 900;

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
  // For writes that must not be repeated blindly: anything short of a clear answer becomes 'unconfirmed'.
  mustConfirm?: boolean;
  timeoutMs?: number;
}

interface Envelope<T> {
  isSuccess?: boolean;
  data?: T;
  error?: { message?: string; validationErrors?: ValidationError[] } | null;
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const wait = limitedUntil - Date.now();
  if (wait > 0) throw new ApiError('rate_limited', 429, null, 'Rate limited', [], wait);

  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.lang) headers['X-Context-Language'] = opts.lang;

  const timeout = opts.timeoutMs ? new AbortController() : null;
  const timer = timeout ? setTimeout(() => timeout.abort(), opts.timeoutMs) : undefined;
  const unanswered = () => new ApiError(opts.mustConfirm ? 'unconfirmed' : 'network', 0, null, 'No usable response');

  try {
    let res: Response;
    try {
      res = await fetch(API_BASE + path, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: timeout?.signal ?? opts.signal,
      });
    } catch (e) {
      if (opts.signal?.aborted && isAbort(e)) throw e;
      throw unanswered();
    }

    if (res.status === 429) {
      const ms = closeGate(res);
      throw new ApiError('rate_limited', 429, null, 'Rate limited', [], ms);
    }

    let envelope: Envelope<T> | null = null;
    try {
      envelope = (await res.json()) as Envelope<T> | null;
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      envelope = null;
    }
    const answered = !!envelope && typeof envelope === 'object' && typeof envelope.isSuccess === 'boolean';

    if (res.ok && answered && envelope!.isSuccess) {
      backoffMs = 0;
      return envelope!.data as T;
    }
    // A cut-off body or a gateway error page says nothing about whether the write happened.
    if (!answered && opts.mustConfirm && (res.ok || res.status >= 500)) throw unanswered();
    throw new ApiError(
      'api',
      res.status,
      errorCode(envelope),
      envelope?.error?.message ?? `Request failed (${res.status})`,
      envelope?.error?.validationErrors ?? [],
    );
  } finally {
    clearTimeout(timer);
  }
}

const id = (value: string) => encodeURIComponent(value);
const at = (scheduledTime?: string | null) => (scheduledTime ? `?scheduledTime=${encodeURIComponent(scheduledTime)}` : '');

export const api = {
  settings: (signal?: AbortSignal) => request<StoreSettings>('GET', '/api/v1/Store/Settings', { signal }),

  languages: (signal?: AbortSignal) => request<{ languages: StoreLanguage[] | null }>('GET', '/api/v1/Store/Languages', { signal }),

  // With a scheduled time, availability is judged for that time instead of for now.
  menus: (lang?: string | null, scheduledTime?: string | null, signal?: AbortSignal) =>
    request<{ menus: MenuSummary[] | null }>('GET', `/api/v1/Menu${at(scheduledTime)}`, { lang, signal }),

  menu: (menuId: string, lang?: string | null, scheduledTime?: string | null, signal?: AbortSignal) =>
    request<MenuDetail>('GET', `/api/v1/Menu/${id(menuId)}${at(scheduledTime)}`, { lang, signal }),

  modifiers: (productId: string, storeMenuCategoryId: string, lang?: string | null, signal?: AbortSignal) =>
    request<ProductModifiers>('GET', `/api/v1/Product/Modifiers?ProductId=${id(productId)}&StoreMenuCategoryId=${id(storeMenuCategoryId)}`, { lang, signal }),

  preview: (body: PreviewRequest, lang?: string | null, signal?: AbortSignal) => request<Quote>('POST', '/api/v1/Order/Preview', { body, lang, signal }),

  placeOrder: (body: CreateOrderRequest, lang?: string | null) =>
    request<CreatedOrder>('POST', '/api/v1/Order', { body, lang, mustConfirm: true, timeoutMs: 30000 }),

  order: (orderId: string, lang?: string | null, signal?: AbortSignal) => request<OrderDetail>('GET', `/api/v1/Order/${id(orderId)}`, { lang, signal }),

  changePaymentOption: (orderId: string, paymentOption: PaymentOption, lang?: string | null) =>
    request<OrderDetail>('PATCH', `/api/v1/Order/${id(orderId)}`, { body: { paymentOption }, lang }),

  startPayment: (orderId: string, successCallbackUrl: string, failCallbackUrl: string, lang?: string | null) =>
    request<PaymentStart>('POST', '/api/v1/Transaction/Initial', {
      body: { orderId, paymentMethod: 'ONLINE_PAYMENT', successCallbackUrl, failCallbackUrl },
      lang,
      timeoutMs: 30000,
    }),

  transaction: (transactionId: string, signal?: AbortSignal) => request<TransactionState>('GET', `/api/v1/Transaction/Status/${id(transactionId)}`, { signal }),
};

// The hosted payment page must be an https address before the customer is sent to it.
export const isSafePaymentUrl = (url: string | null | undefined): url is string => {
  try {
    return !!url && new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
};
