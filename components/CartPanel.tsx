'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { api, isApiError, isSafePaymentUrl, type ApiError } from '@/lib/api';
import { blockText, formatMoney } from '@/lib/format';
import { describeTime } from '@/lib/schedule';
import { useRateLimitSeconds, type QuoteState } from '@/lib/hooks';
import { cart, prefs, toPreviewProducts, type CartLine } from '@/lib/store';
import type { PaymentOption, PaymentStart, PriceType, Quote, StoreSettings } from '@/lib/types';
import PickupTime, { type ScheduleProps } from './PickupTime';
import { ArrowIcon, BackIcon, BagIcon, CloseIcon, Photo, Stepper } from './ui';

const PAYMENT_LABELS: Record<string, { title: string; detail: string }> = {
  PAY_IN_STORE: { title: 'Pay at pickup', detail: 'Settle up at the counter when you collect.' },
  PAY_ONLINE: { title: 'Pay online now', detail: 'You will be taken to a secure payment page.' },
};

const DEDUCTIONS = new Set(['DISCOUNT', 'CREDIT', 'FREE_ITEM']);
// How long an unanswered order keeps warning the customer before the cart is offered again.
const UNCONFIRMED_WINDOW_MS = 30 * 60 * 1000;

interface Props {
  lines: CartLine[];
  quoteState: QuoteState;
  settings: StoreSettings | null;
  // Set when ordering cannot work at all (settings failed, or the store lists no way to pay).
  unavailable: string | null;
  paymentOptions: PaymentOption[];
  paymentOption: PaymentOption | null;
  onPaymentOption: (option: PaymentOption) => void;
  unconfirmedAt: number | null;
  schedule: ScheduleProps;
  lang: string | null;
  contentLang: string;
  titleId: string;
  onClose?: () => void;
  onPlaced: (orderId: string) => void;
  onBusy: (busy: boolean) => void;
}

function lineProblems(quote: Quote | null, lines: CartLine[]) {
  const problems = new Map<string, string>();
  if (!quote) return problems;
  const stocks = new Map((quote.orderProductStocks ?? []).map((s) => [s.productId, s]));
  const priced = quote.orderProducts ?? [];
  lines.forEach((line, i) => {
    const stock = stocks.get(line.productId);
    if (stock && !stock.isAvailable) problems.set(line.key, 'No longer available. Please remove it.');
    else if (stock && !stock.isStockSufficient) {
      problems.set(
        line.key,
        stock.availableStock != null && stock.availableStock > 0
          ? `Only ${stock.availableStock} left. Please lower the quantity.`
          : 'Not enough left. Please remove it.',
      );
    }
    const match = priced.length === lines.length && priced[i]?.productId === line.productId ? priced[i] : null;
    if (match?.modifiers?.some((m) => !m.isMatchLimit || m.items?.some((it) => !it.isAvailable))) {
      problems.set(line.key, 'One of its options changed. Please remove it and add it again.');
    }
  });
  return problems;
}

export default function CartPanel(props: Props) {
  const { lines, quoteState, settings, paymentOptions, paymentOption, lang, contentLang, titleId, onClose, onBusy } = props;
  const { quote, current, error: quoteError, loading: quoting } = quoteState;
  const { schedule } = props;
  const formId = useId();
  const [step, setStep] = useState<'cart' | 'checkout'>('cart');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('+1 ');
  const [orderNote, setOrderNote] = useState('');
  const [sms, setSms] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; phone?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const placingRef = useRef(false);
  const limitedSeconds = useRateLimitSeconds();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const count = lines.reduce((n, l) => n + l.quantity, 0);
  // Paying online means paying by card, so the card price applies whatever the store's default is.
  const priceType: PriceType = paymentOption === 'PAY_ONLINE' ? 'CARD_PRICE' : (settings?.defaultPriceType ?? 'CARD_PRICE');
  const useCash = priceType === 'CASH_PRICE';
  const showOther = paymentOption === 'PAY_IN_STORE' && !!quote && quote.cashTotal !== quote.cardTotal;
  const total = quote ? (useCash ? quote.cashTotal : quote.cardTotal) : null;
  const subTotal = quote ? (useCash ? quote.cashSubTotal : quote.cardSubTotal) : null;
  const problems = lineProblems(current ? quote : null, lines);
  const pricedLines = quote?.orderProducts?.length === lines.length ? quote.orderProducts : null;
  const uncertain = props.unconfirmedAt !== null && Date.now() - props.unconfirmedAt < UNCONFIRMED_WINDOW_MS;

  const quoteBlock = (q: Quote | null, forStep: 'cart' | 'checkout'): string | null => {
    if (!q) return null;
    if (q.fulfillmentBlock) {
      // A rejected payment option is settled on the checkout step, where the other options are offered.
      if (q.fulfillmentBlock === 'PAYMENT_OPTION' && forStep === 'cart' && paymentOptions.length > 1) return null;
      // Closed for orders right now, but a later time can still be booked.
      if (q.fulfillmentBlock === 'CLOSED_HOURS' && !schedule.value && schedule.days.length)
        return 'We are closed right now. Choose a later pickup time above to order ahead.';
      return blockText(q.fulfillmentBlock);
    }
    if (q.scheduleBlock) return blockText(q.scheduleBlock);
    if (q.meetsMinOrderAmount === false) return `The minimum order is ${formatMoney(q.minOrderAmount ?? 0)}. Add a little more to continue.`;
    return null;
  };
  const blocked = quoteBlock(current ? quote : null, step) ?? (problems.size ? 'Some items need your attention before you can check out.' : null);

  useEffect(() => {
    if (!lines.length) setStep('cart');
  }, [lines.length]);

  useEffect(() => {
    if (formError || uncertain) errorRef.current?.focus();
  }, [formError, uncertain]);

  const goto = (next: 'cart' | 'checkout') => {
    setStep(next);
    setFormError(null);
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  const describe = (e: ApiError): string => {
    if (e.kind === 'rate_limited') return 'We are getting a lot of requests. Give it a moment and try again.';
    if (e.kind === 'network') return 'We could not reach the kitchen. Check your connection and try again.';
    if (e.code === 'STORE_UNPUBLISHED' || e.code === 'FUNCTION_DISABLED') return 'Online ordering has just been switched off. Please call us to order.';
    return `Something went wrong on our side${e.code ? ` (${e.code})` : ''}. Please try again.`;
  };

  const applyValidation = (e: ApiError) => {
    const next: { name?: string; phone?: string } = {};
    const rest: string[] = [];
    for (const v of e.validationErrors) {
      const prop = (v.propertyName ?? '').toLowerCase();
      if (prop.includes('pickupname')) next.name = v.errorMessage ?? 'Please check your name.';
      else if (prop.includes('pickupphone')) next.phone = v.errorMessage ?? 'Please check your phone number.';
      else if (v.errorMessage) rest.push(v.errorMessage);
    }
    setFieldErrors(next);
    if (rest.length || (!next.name && !next.phone)) setFormError(rest.join(' ') || describe(e));
    else if (next.name) document.getElementById(`${formId}-name`)?.focus();
    else document.getElementById(`${formId}-phone`)?.focus();
  };

  const setBusy = (busy: boolean) => {
    placingRef.current = busy;
    setPlacing(busy);
    onBusy(busy);
  };

  const place = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (placingRef.current || !paymentOption || !settings) return;
    const cleanName = name.trim();
    const digits = phone.replace(/[\s().-]/g, '');
    // A number typed without a country code is taken as a US number.
    const cleanPhone = digits.startsWith('+') ? digits : `+1${digits}`;
    const errors: { name?: string; phone?: string } = {};
    if (!cleanName) errors.name = 'Tell us who is picking up.';
    if (cleanPhone.startsWith('+1') ? !/^\+1\d{10}$/.test(cleanPhone) : !/^\+\d{8,15}$/.test(cleanPhone)) {
      errors.phone = cleanPhone.startsWith('+1') ? 'Enter the 10-digit number after +1.' : 'Enter the full number, starting with + and the country code.';
    }
    setFieldErrors(errors);
    setFormError(null);
    if (errors.name || errors.phone) {
      document.getElementById(errors.name ? `${formId}-name` : `${formId}-phone`)?.focus();
      return;
    }
    if (!navigator.onLine) {
      setFormError('You are offline, so nothing was sent. Reconnect and try again.');
      return;
    }

    setBusy(true);
    try {
      // Quotes expire after five minutes, so price once more right before placing.
      const fresh = await api.preview(
        {
          products: toPreviewProducts(lines),
          orderType: 'PICK_UP',
          paymentOption,
          pickupName: cleanName,
          ...(schedule.value ? { scheduledTime: schedule.value } : {}),
          pickupPhone: cleanPhone,
          ...(orderNote.trim() ? { note: orderNote.trim() } : {}),
        },
        lang,
      );
      const freshBlock = quoteBlock(fresh, 'checkout');
      if (freshBlock || lineProblems(fresh, lines).size) {
        quoteState.adopt(fresh);
        // A payment-option block is fixed on this step; anything else is fixed in the cart.
        if (fresh.fulfillmentBlock === 'PAYMENT_OPTION' && paymentOptions.length > 1) setFormError(freshBlock);
        else goto('cart');
        return;
      }
      if (quote && current && (fresh.cardTotal !== quote.cardTotal || fresh.cashTotal !== quote.cashTotal)) {
        quoteState.adopt(fresh);
        setFormError('The total has changed since you last looked. Please check the new amount, then place your order.');
        return;
      }

      let created;
      try {
        created = await api.placeOrder(
          { previewOrderId: fresh.previewOrderId, priceType, pickupName: cleanName, pickupPhone: cleanPhone, agreeToSmsUpdates: sms },
          lang,
        );
      } catch (err) {
        // No clear answer, or a quote reported missing right after it was issued: an order may or may not exist.
        if (isApiError(err) && (err.kind === 'unconfirmed' || err.code === 'PREVIEW_ORDER_NOT_FOUND')) {
          prefs.setUnconfirmed(Date.now());
          return;
        }
        throw err;
      }

      prefs.setUnconfirmed(null);
      prefs.rememberOrder({ orderId: created.orderId, serial: created.orderSerialNumber, scheduledFor: schedule.value });

      let payment: PaymentStart | null = null;
      if (paymentOption === 'PAY_ONLINE') {
        const back = `${window.location.origin}${window.location.pathname}?order=${created.orderId}`;
        try {
          payment = await api.startPayment(created.orderId, `${back}&payment=success`, `${back}&payment=failed`, lang);
        } catch {
          // The order exists; its page offers to start the payment again.
        }
      }

      cart.clear();
      prefs.setPickupTime(null);
      // Show the order page first, so Back from the payment page lands on the order rather than an empty cart.
      props.onPlaced(created.orderId);
      if (payment && isSafePaymentUrl(payment.paymentLinkUrl)) {
        prefs.rememberOrder({
          orderId: created.orderId,
          serial: created.orderSerialNumber,
          transactionId: payment.transactionId,
          scheduledFor: schedule.value,
        });
        window.location.assign(payment.paymentLinkUrl);
      }
    } catch (err) {
      if (isApiError(err)) {
        if (err.validationErrors.length) applyValidation(err);
        else setFormError(describe(err));
      } else {
        setFormError('Something unexpected happened. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const closeButton = onClose ? (
    <button type="button" className="icon-btn cart__close" onClick={onClose} aria-label="Close" lang="en">
      <CloseIcon />
    </button>
  ) : null;

  const header = (
    <header className="cart__head">
      {step === 'checkout' && !uncertain ? (
        <button type="button" className="icon-btn" onClick={() => goto('cart')} aria-label="Back to your cart" disabled={placing}>
          <BackIcon />
        </button>
      ) : null}
      <h2 id={titleId} ref={headingRef} tabIndex={-1}>
        {step === 'cart' || uncertain ? 'Your cart' : 'Pickup details'}
      </h2>
      {step === 'cart' && count && !uncertain ? (
        <span className="cart__count">
          {count} {count === 1 ? 'item' : 'items'}
        </span>
      ) : null}
      {closeButton}
    </header>
  );

  if (props.unavailable) {
    return (
      <section className="cart cart--empty" aria-labelledby={titleId}>
        {header}
        <div className="cart__empty" role="status">
          <p className="cart__empty-title">Ordering is unavailable</p>
          <p>{props.unavailable}</p>
        </div>
      </section>
    );
  }

  if (!settings) {
    return (
      <section className="cart" aria-busy="true" aria-labelledby={titleId}>
        {header}
        <div className="cart__skeleton">
          <span className="skel skel--line" style={{ width: '70%' }} />
          <span className="skel skel--line" style={{ width: '45%' }} />
        </div>
      </section>
    );
  }

  if (uncertain) {
    return (
      <section className="cart" aria-labelledby={titleId}>
        {header}
        <div className="cart__uncertain" ref={errorRef} tabIndex={-1} role="alert">
          <p className="eyebrow">Not confirmed</p>
          <h3>We can’t tell whether your order went through.</h3>
          <p>
            We sent it to the kitchen but did not get a clear answer back, so it may or may not have arrived. Please check with us before ordering again, so you
            don’t end up with two.
          </p>
          {settings.storePhoneNumber ? (
            <a className="btn btn--primary" href={`tel:${settings.storePhoneNumber}`}>
              Call {settings.storePhoneNumber}
            </a>
          ) : null}
          <button type="button" className="btn btn--ghost" onClick={() => prefs.setUnconfirmed(null)}>
            I’ve checked, back to my cart
          </button>
        </div>
      </section>
    );
  }

  if (!lines.length) {
    return (
      <section className="cart cart--empty" aria-labelledby={titleId}>
        {header}
        <div className="cart__empty">
          <span className="cart__empty-mark" aria-hidden="true">
            <BagIcon width={28} height={28} />
          </span>
          <p className="cart__empty-title">Nothing here yet</p>
          <p>Tap the plus on any dish and it will land in your cart.</p>
          {onClose ? (
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Browse the menu
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  // Some stores report a discount both as an adjustment and in the discount details; list it once.
  const adjustments = quote?.financialAdjustments ?? [];
  const discounts = adjustments.some((a) => DEDUCTIONS.has(a.adjustType))
    ? []
    : (quote?.discountDetails?.orderDiscounts ?? []).concat(quote?.discountDetails?.productDiscounts ?? []);
  const wait = quote?.estimatedWaitMinutes;

  const totals = (
    <div className={`totals ${quoting ? 'is-updating' : ''}`} aria-busy={quoting}>
      <p className="totals__pickup">
        <span>Pickup</span>
        <strong>{schedule.value ? describeTime(schedule.value, schedule.timezone) : 'As soon as possible'}</strong>
      </p>
      {quote ? (
        <dl>
          <div>
            <dt>Subtotal</dt>
            <dd>{formatMoney(subTotal ?? 0)}</dd>
          </div>
          {discounts.map((d, i) => (
            <div key={`d${i}`} className="totals__deduction">
              <dt dir="auto">{d.discountName ?? 'Discount'}</dt>
              <dd>−{formatMoney(Math.abs(useCash ? d.cashAmount : d.cardAmount))}</dd>
            </div>
          ))}
          {adjustments.map((a, i) => {
            const amount = Math.abs(useCash ? a.cashSubTotal : a.cardSubTotal);
            const deduction = DEDUCTIONS.has(a.adjustType);
            return (
              <div key={`a${i}`} className={deduction ? 'totals__deduction' : ''}>
                <dt dir="auto">{a.name ?? (deduction ? 'Discount' : 'Taxes and fees')}</dt>
                <dd>
                  {deduction ? '−' : ''}
                  {formatMoney(amount)}
                </dd>
              </div>
            );
          })}
          <div className="totals__total">
            <dt>Total</dt>
            <dd>{formatMoney(total ?? 0)}</dd>
          </div>
          {showOther ? (
            <div className="totals__alt">
              <dt>{useCash ? 'If you pay by card' : 'If you pay in cash'}</dt>
              <dd>{formatMoney(useCash ? quote.cardTotal : quote.cashTotal)}</dd>
            </div>
          ) : null}
        </dl>
      ) : quoteError ? (
        <div className="inline-state" role="status">
          <p>
            {quoteError.kind === 'rate_limited'
              ? 'Pricing will resume in a moment.'
              : quoteError.kind === 'network'
                ? 'We could not price your cart. Check your connection.'
                : (quoteError.validationErrors[0]?.errorMessage ?? `We could not price this cart${quoteError.code ? ` (${quoteError.code})` : ''}.`)}
          </p>
          {quoteError.kind !== 'rate_limited' ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={quoteState.refresh}>
              Try again
            </button>
          ) : null}
        </div>
      ) : (
        <div className="totals__skeleton">
          <span className="skel skel--line" />
          <span className="skel skel--line skel--strong" />
        </div>
      )}
      {wait ? <p className="totals__wait">Ready in about {wait.min === wait.max ? wait.min : `${wait.min}–${wait.max}`} minutes</p> : null}
      {(quote?.warnings ?? []).map((w, i) => (
        <p key={i} className="notice notice--warn" dir="auto">
          {w}
        </p>
      ))}
      {/* Announced once per settled price, not on every keystroke of a re-price. */}
      <p className="sr-only" role="status">
        {current && !quoting && total !== null ? `Cart total ${formatMoney(total)}` : ''}
      </p>
    </div>
  );

  const blockNotice = blocked ? (
    <p className="notice notice--block" role="status">
      {blocked}
    </p>
  ) : null;

  return (
    <section className={`cart cart--${step}`} aria-labelledby={titleId}>
      {header}
      {step === 'cart' ? (
        <>
          <div className="cart__scroll">
            <PickupTime {...schedule} />
            <ul className="lines" lang={contentLang}>
              {lines.map((line, i) => {
                const priced = pricedLines?.[i]?.productId === line.productId ? pricedLines[i] : null;
                const amount = priced ? (useCash ? priced.cashSubTotal : priced.cardSubTotal) : line.unitPrice * line.quantity;
                const problem = problems.get(line.key);
                return (
                  <li key={line.key} className={`line ${problem ? 'has-problem' : ''}`}>
                    <Photo src={line.imageUrl} name={line.name} seed={line.productId} className="line__photo" />
                    <div className="line__main">
                      <p className="line__name" dir="auto">
                        {priced?.name ?? line.name}
                      </p>
                      {line.modifiers.length ? (
                        <p className="line__mods" dir="auto">
                          {line.modifiers.flatMap((m) => m.items.map((it) => it.name)).join(' · ')}
                        </p>
                      ) : null}
                      {line.note ? (
                        <p className="line__note" dir="auto">
                          “{line.note}”
                        </p>
                      ) : null}
                      {problem ? (
                        <p className="line__problem" role="alert" lang="en">
                          {problem}
                        </p>
                      ) : null}
                      <div className="line__row" lang="en">
                        <Stepper
                          size="sm"
                          min={0}
                          value={line.quantity}
                          onChange={(q) => {
                            cart.setQuantity(line.key, q);
                            // The row is about to disappear; keep focus inside the panel.
                            if (q <= 0) headingRef.current?.focus();
                          }}
                          label={`Quantity of ${line.name}`}
                        />
                        <span className="line__amount">{formatMoney(amount)}</span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
          <footer className="cart__foot">
            {totals}
            {blockNotice}
            <button
              type="button"
              className="btn btn--primary btn--block"
              disabled={!quote || !current || !!blocked || quoting}
              onClick={() => goto('checkout')}
            >
              <span>Continue to pickup details</span>
              <ArrowIcon width={18} height={18} />
            </button>
          </footer>
        </>
      ) : (
        <form id={formId} className="checkout" onSubmit={place} noValidate>
          <div className="cart__scroll">
            {formError ? (
              <div className="notice notice--error" role="alert" ref={errorRef} tabIndex={-1}>
                {formError}
              </div>
            ) : null}
            <div className={`field ${fieldErrors.name ? 'has-error' : ''}`}>
              <label htmlFor={`${formId}-name`}>Name for the order</label>
              <input
                id={`${formId}-name`}
                type="text"
                autoComplete="name"
                value={name}
                maxLength={60}
                onChange={(e) => {
                  setName(e.target.value);
                  if (fieldErrors.name) setFieldErrors((f) => ({ ...f, name: undefined }));
                }}
                aria-invalid={!!fieldErrors.name}
                aria-describedby={fieldErrors.name ? `${formId}-name-err` : undefined}
                required
              />
              {fieldErrors.name ? (
                <p className="field__error" id={`${formId}-name-err`}>
                  {fieldErrors.name}
                </p>
              ) : null}
            </div>
            <div className={`field ${fieldErrors.phone ? 'has-error' : ''}`}>
              <label htmlFor={`${formId}-phone`}>Mobile number</label>
              <input
                id={`${formId}-phone`}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                maxLength={24}
                onChange={(e) => {
                  setPhone(e.target.value);
                  if (fieldErrors.phone) setFieldErrors((f) => ({ ...f, phone: undefined }));
                }}
                aria-invalid={!!fieldErrors.phone}
                aria-describedby={`${formId}-phone-hint${fieldErrors.phone ? ` ${formId}-phone-err` : ''}`}
                required
              />
              <p className="field__hint" id={`${formId}-phone-hint`}>
                Starts with the country code, +1 for the US. The kitchen uses it to find your order, and your confirmation is sent to it.
              </p>
              {fieldErrors.phone ? (
                <p className="field__error" id={`${formId}-phone-err`}>
                  {fieldErrors.phone}
                </p>
              ) : null}
            </div>
            <label className="check">
              <input type="checkbox" checked={sms} onChange={(e) => setSms(e.target.checked)} />
              <span className="check__box" aria-hidden="true" />
              <span>Text me updates about this order</span>
            </label>
            <div className="field">
              <label htmlFor={`${formId}-note`}>
                Note for the whole order <span className="field__optional">optional</span>
              </label>
              <textarea id={`${formId}-note`} rows={2} maxLength={200} value={orderNote} onChange={(e) => setOrderNote(e.target.value)} />
            </div>

            <fieldset className="pay">
              <legend>Payment</legend>
              {paymentOptions.map((option) => {
                const label = PAYMENT_LABELS[option] ?? { title: option.replace(/_/g, ' ').toLowerCase(), detail: '' };
                return (
                  <label key={option} className={`pay__option ${paymentOption === option ? 'is-checked' : ''}`}>
                    <input type="radio" name="payment" checked={paymentOption === option} onChange={() => props.onPaymentOption(option)} disabled={placing} />
                    <span className="pay__dot" aria-hidden="true" />
                    <span>
                      <span className="pay__title">{label.title}</span>
                      <span className="pay__detail">{label.detail}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          </div>
          <footer className="cart__foot">
            {totals}
            {blockNotice}
            <button
              type="submit"
              className={`btn btn--primary btn--block ${placing ? 'is-busy' : ''}`}
              disabled={placing || !quote || !current || quoting || !!blocked || limitedSeconds > 0}
              aria-busy={placing}
            >
              {placing ? (
                <span>Sending to the kitchen…</span>
              ) : limitedSeconds > 0 ? (
                <span>Please wait a moment</span>
              ) : (
                <>
                  <span>{paymentOption === 'PAY_ONLINE' ? 'Place order and pay' : 'Place order'}</span>
                  <span className="btn__amount">{total !== null ? formatMoney(total) : ''}</span>
                </>
              )}
            </button>
          </footer>
        </form>
      )}
    </section>
  );
}
