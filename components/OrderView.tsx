'use client';

import { useEffect, useRef, useState } from 'react';
import { api, isAbort, isApiError, type ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { prefs } from '@/lib/store';
import type { FulfillmentStatus, OrderDetail, PaymentOption, StoreSettings, TransactionState } from '@/lib/types';
import { CheckIcon, ClockIcon, PhoneIcon, PinIcon } from './ui';

const STEPS: { status: FulfillmentStatus; label: string }[] = [
  { status: 'NEW', label: 'Received' },
  { status: 'PREPARING', label: 'In the kitchen' },
  { status: 'READY', label: 'Ready' },
  { status: 'FULFILLED', label: 'Picked up' },
];

const HEADLINES: Record<FulfillmentStatus, { title: string; detail: string }> = {
  NEW: { title: 'We have your order.', detail: 'The kitchen has it and will start on it shortly.' },
  PREPARING: { title: 'It’s on the stove.', detail: 'Your order is being prepared right now.' },
  READY: { title: 'Ready when you are.', detail: 'Come to the counter and give your name.' },
  FULFILLED: { title: 'Enjoy your meal.', detail: 'This order has been picked up. Thank you for ordering with us.' },
  CANCELLED: { title: 'This order was cancelled.', detail: 'If that is a surprise, please call us and we will sort it out.' },
};

const DEDUCTIONS = new Set(['DISCOUNT', 'CREDIT', 'FREE_ITEM']);
const POLL_MS = 20000;

interface Props {
  orderId: string;
  settings: StoreSettings | null;
  paymentOptions: PaymentOption[];
  lang: string | null;
  contentLang: string;
  transactionId: string | null;
  onNewOrder: () => void;
}

export default function OrderView({ orderId, settings, paymentOptions, lang, contentLang, transactionId, onNewOrder }: Props) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [transaction, setTransaction] = useState<TransactionState | null>(null);
  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [orderId]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const load = async () => {
      try {
        const data = await api.order(orderId, lang, controller.signal);
        if (stopped) return;
        setOrder(data);
        setError(null);
        const done = data.lifecycleStatus === 'CLOSED' || data.fulfillmentStatus === 'FULFILLED' || data.fulfillmentStatus === 'CANCELLED';
        if (!done) schedule(POLL_MS);
      } catch (e) {
        if (stopped || isAbort(e)) return;
        const err = isApiError(e) ? e : null;
        setError(err);
        if (err?.kind === 'rate_limited') schedule(err.retryAfterMs + 300);
        else if (err?.kind === 'network') schedule(POLL_MS);
      }
    };
    const schedule = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => (document.hidden ? schedule(POLL_MS) : load()), ms);
    };
    const onVisible = () => {
      if (!document.hidden) schedule(0);
    };

    load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [orderId, lang, attempt]);

  useEffect(() => {
    if (!transactionId) return;
    const controller = new AbortController();
    api
      .transaction(transactionId, controller.signal)
      .then(setTransaction)
      .catch(() => undefined);
    return () => controller.abort();
  }, [transactionId, attempt]);

  if (!order) {
    if (error && error.kind !== 'rate_limited') {
      const missing = error.status === 404 || error.status === 400;
      return (
        <section className="state-page" role="alert">
          <p className="eyebrow">{missing ? 'No such ticket' : 'Connection trouble'}</p>
          <h1 ref={headingRef} tabIndex={-1}>
            {missing ? 'We can’t find that order.' : 'We couldn’t load your order.'}
          </h1>
          <p>
            {missing
              ? 'The link may be incomplete, or the order belongs to a different shop.'
              : 'Your order is safe with the kitchen. This page just can’t reach it at the moment.'}
          </p>
          <div className="state-page__actions">
            {!missing ? (
              <button type="button" className="btn btn--primary" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </button>
            ) : null}
            <button type="button" className="btn btn--ghost" onClick={onNewOrder}>
              Back to the menu
            </button>
          </div>
        </section>
      );
    }
    return (
      <section className="ticket-wrap" aria-busy="true" aria-label="Loading your order">
        <h1 ref={headingRef} tabIndex={-1} className="sr-only">
          Loading your order
        </h1>
        <div className="ticket ticket--skeleton">
          <span className="skel skel--line" style={{ width: '30%' }} />
          <span className="skel skel--title" />
          <span className="skel skel--line" style={{ width: '80%' }} />
          <span className="skel skel--line" style={{ width: '60%' }} />
          <span className="skel skel--line" style={{ width: '70%' }} />
        </div>
      </section>
    );
  }

  const status = order.fulfillmentStatus;
  const cancelled = status === 'CANCELLED';
  const stepIndex = STEPS.findIndex((s) => s.status === status);
  const useCash = order.priceType === 'CASH_PRICE';
  const number = order.orderSerialNumber ?? order.shortId ?? '';
  const awaitingPayment = order.checkoutType === 'PAY_ONLINE' && order.orderStatusLabel === 'UNPAID' && !cancelled;
  const headline = awaitingPayment
    ? { title: 'One step left: payment.', detail: 'Your order is saved, but the kitchen will not start until it is paid.' }
    : HEADLINES[status];
  const showBoth = order.checkoutType === 'PAY_IN_STORE' && order.orderStatusLabel === 'UNPAID' && order.cashTotal != null && order.cardTotal != null && order.cashTotal !== order.cardTotal;

  const retryPayment = async () => {
    setPayBusy(true);
    setPayError(null);
    try {
      const back = `${window.location.origin}${window.location.pathname}?order=${order.id}`;
      const payment = await api.startPayment(order.id, `${back}&payment=success`, `${back}&payment=failed`, lang);
      if (!payment.paymentLinkUrl) throw new Error('no link');
      prefs.rememberOrder({ orderId: order.id, serial: number, transactionId: payment.transactionId });
      window.location.assign(payment.paymentLinkUrl);
    } catch (e) {
      setPayError(isApiError(e) && e.kind === 'rate_limited' ? 'Please wait a moment and try again.' : 'We could not open the payment page. Please try again.');
      setPayBusy(false);
    }
  };

  const payAtStore = async () => {
    setPayBusy(true);
    setPayError(null);
    try {
      setOrder(await api.changePaymentOption(order.id, 'PAY_IN_STORE', lang));
    } catch (e) {
      setPayError(
        isApiError(e) && e.code === 'INVALID_PAYMENT_OPTION_UPDATE'
          ? 'This order can no longer be switched to pay at pickup. Please call us.'
          : 'We could not change how this order is paid. Please try again.',
      );
    } finally {
      setPayBusy(false);
    }
  };

  return (
    <section className="ticket-wrap">
      <div className={`ticket ${cancelled ? 'ticket--cancelled' : ''}`}>
        <header className="ticket__head">
          <p className="eyebrow">{cancelled ? 'Order cancelled' : awaitingPayment ? 'Awaiting payment' : 'Order placed'}</p>
          <h1 ref={headingRef} tabIndex={-1}>
            {headline.title}
          </h1>
          <p className="ticket__detail">{headline.detail}</p>
          {number ? (
            <p className="ticket__number">
              <span>Order</span>
              <strong>{number}</strong>
            </p>
          ) : null}
          {!cancelled && !awaitingPayment ? (
            <span className="ticket__stamp" aria-hidden="true">
              <CheckIcon width={30} height={30} />
            </span>
          ) : null}
        </header>

        {!cancelled && !awaitingPayment ? (
          <ol className="tracker" aria-label="Order progress">
            {STEPS.map((s, i) => (
              <li key={s.status} className={i < stepIndex ? 'is-done' : i === stepIndex ? 'is-current' : ''} aria-current={i === stepIndex ? 'step' : undefined}>
                <span className="tracker__dot" aria-hidden="true">
                  {i < stepIndex ? <CheckIcon width={12} height={12} /> : null}
                </span>
                <span className="tracker__label">{s.label}</span>
              </li>
            ))}
          </ol>
        ) : null}

        {error ? (
          <p className="notice notice--warn" role="status">
            {error.kind === 'rate_limited' ? 'Status updates are paused for a moment.' : 'We lost the connection. The status below may be a little behind.'}
          </p>
        ) : null}

        {awaitingPayment ? (
          <div className="ticket__pay">
            {transaction ? <p className="ticket__pay-state">Last payment attempt: {transaction.transactionStatusLabel.toLowerCase()}</p> : null}
            {payError ? (
              <p className="notice notice--error" role="alert">
                {payError}
              </p>
            ) : null}
            <button type="button" className="btn btn--primary btn--block" onClick={retryPayment} disabled={payBusy}>
              Pay {formatMoney(order.total)} now
            </button>
            {paymentOptions.includes('PAY_IN_STORE') ? (
              <button type="button" className="btn btn--ghost btn--block" onClick={payAtStore} disabled={payBusy}>
                Pay at pickup instead
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="ticket__perforation" aria-hidden="true" />

        <dl className="ticket__facts">
          {order.pickupName ? (
            <div>
              <dt>Pickup name</dt>
              <dd dir="auto">{order.pickupName}</dd>
            </div>
          ) : null}
          <div>
            <dt>Payment</dt>
            <dd>
              {order.orderStatusLabel === 'PAID'
                ? 'Paid'
                : order.orderStatusLabel === 'UNPAID'
                  ? order.checkoutType === 'PAY_IN_STORE'
                    ? 'Pay at pickup'
                    : 'Not paid yet'
                  : order.orderStatusLabel.replace(/_/g, ' ').toLowerCase()}
            </dd>
          </div>
        </dl>

        <ul className="ticket__lines" lang={contentLang}>
          {(order.products ?? []).map((p) => (
            <li key={p.id}>
              <span className="ticket__qty">{p.quantity}×</span>
              <span className="ticket__item">
                <span dir="auto">{p.productName}</span>
                {p.modifiers?.length ? (
                  <small dir="auto">
                    {p.modifiers.flatMap((m) => (m.modifierItems ?? []).map((it) => it.name)).join(' · ')}
                  </small>
                ) : null}
                {p.note ? <small dir="auto">“{p.note}”</small> : null}
              </span>
              <span className="ticket__amount">{formatMoney((useCash ? p.cashSubTotal : p.cardSubTotal) ?? p.subTotal)}</span>
            </li>
          ))}
        </ul>
        {order.note ? (
          <p className="ticket__note" dir="auto">
            “{order.note}”
          </p>
        ) : null}

        <dl className="totals totals--ticket">
          <div>
            <dt>Subtotal</dt>
            <dd>{formatMoney(order.subTotal)}</dd>
          </div>
          {(order.adjustments ?? []).map((a) => (
            <div key={a.id} className={DEDUCTIONS.has(a.adjustType) ? 'totals__deduction' : ''}>
              <dt dir="auto">{a.name ?? a.adjustType}</dt>
              <dd>
                {DEDUCTIONS.has(a.adjustType) ? '−' : ''}
                {formatMoney(Math.abs(a.subTotal))}
              </dd>
            </div>
          ))}
          <div className="totals__total">
            <dt>Total</dt>
            <dd>{formatMoney(order.total)}</dd>
          </div>
          {showBoth ? (
            <div className="totals__alt">
              <dt>{useCash ? 'If you pay by card' : 'If you pay in cash'}</dt>
              <dd>{formatMoney((useCash ? order.cardTotal : order.cashTotal) ?? order.total)}</dd>
            </div>
          ) : null}
        </dl>

        <div className="ticket__perforation" aria-hidden="true" />

        <footer className="ticket__foot">
          {settings?.address?.formattedAddress ? (
            <p>
              <PinIcon width={18} height={18} />
              <span>
                Pick up at <strong>{settings.address.formattedAddress}</strong>
              </span>
            </p>
          ) : null}
          {settings?.defaultPrepTimeMinutes && (status === 'NEW' || status === 'PREPARING') && !awaitingPayment ? (
            <p>
              <ClockIcon width={18} height={18} />
              <span>Orders usually take about {settings.defaultPrepTimeMinutes} minutes.</span>
            </p>
          ) : null}
          {settings?.storePhoneNumber ? (
            <p>
              <PhoneIcon width={18} height={18} />
              <span>
                Questions? Call <a href={`tel:${settings.storePhoneNumber}`}>{settings.storePhoneNumber}</a>
              </span>
            </p>
          ) : null}
        </footer>
      </div>
      <button type="button" className="btn btn--ghost ticket-wrap__again" onClick={onNewOrder}>
        Start another order
      </button>
    </section>
  );
}
