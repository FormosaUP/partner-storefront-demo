'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { api, isApiError, type ApiError } from '@/lib/api';
import { formatMoney, fulfillmentBlockText, scheduleBlockText } from '@/lib/format';
import { useRateLimitSeconds, type QuoteState } from '@/lib/hooks';
import { cart, prefs, toPreviewProducts, type CartLine } from '@/lib/store';
import type { PaymentOption, Quote, StoreSettings } from '@/lib/types';
import { ArrowIcon, BackIcon, BagIcon, CloseIcon, Photo, Stepper } from './ui';

const PAYMENT_LABELS: Record<PaymentOption, { title: string; detail: string }> = {
  PAY_IN_STORE: { title: 'Pay at pickup', detail: 'Settle up at the counter when you collect.' },
  PAY_ONLINE: { title: 'Pay online now', detail: 'You will be taken to a secure payment page.' },
};

const DEDUCTIONS = new Set(['DISCOUNT', 'CREDIT', 'FREE_ITEM']);

interface Props {
  lines: CartLine[];
  quoteState: QuoteState;
  settings: StoreSettings | null;
  paymentOptions: PaymentOption[];
  paymentOption: PaymentOption | null;
  onPaymentOption: (option: PaymentOption) => void;
  canOrder: boolean;
  blockedReason: string | null;
  lang: string | null;
  contentLang: string;
  titleId: string;
  onClose?: () => void;
  onPlaced: (orderId: string) => void;
  loadingShell: boolean;
}

type Uncertain = { phone: string | null };

function lineProblems(quote: Quote | null, lines: CartLine[]) {
  const problems = new Map<string, string>();
  if (!quote) return problems;
  const bad = new Set((quote.orderProductStocks ?? []).filter((s) => !s.isAvailable || !s.isStockSufficient).map((s) => s.productId));
  const priced = quote.orderProducts ?? [];
  lines.forEach((line, i) => {
    if (bad.has(line.productId)) problems.set(line.key, 'No longer available. Please remove it.');
    const match = priced.length === lines.length && priced[i]?.productId === line.productId ? priced[i] : null;
    if (match?.modifiers?.some((m) => !m.isMatchLimit || m.items?.some((it) => !it.isAvailable))) {
      problems.set(line.key, 'One of its options changed. Please remove it and add it again.');
    }
  });
  return problems;
}

export default function CartPanel(props: Props) {
  const { lines, quoteState, settings, paymentOptions, paymentOption, canOrder, blockedReason, lang, contentLang, titleId, onClose } = props;
  const { quote, error: quoteError, loading: quoting } = quoteState;
  const formId = useId();
  const [step, setStep] = useState<'cart' | 'checkout'>('cart');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [orderNote, setOrderNote] = useState('');
  const [sms, setSms] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; phone?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [uncertain, setUncertain] = useState<Uncertain | null>(null);
  const limitedSeconds = useRateLimitSeconds();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const count = lines.reduce((n, l) => n + l.quantity, 0);
  const showCash = paymentOption === 'PAY_IN_STORE' && !!quote && quote.cashTotal !== quote.cardTotal;
  const useCash = settings?.defaultPriceType === 'CASH_PRICE';
  const total = quote ? (useCash ? quote.cashTotal : quote.cardTotal) : null;
  const subTotal = quote ? (useCash ? quote.cashSubTotal : quote.cardSubTotal) : null;
  const problems = lineProblems(quote, lines);
  const pricedLines = quote?.orderProducts?.length === lines.length ? quote.orderProducts : null;

  const quoteBlock = quote?.fulfillmentBlock
    ? fulfillmentBlockText[quote.fulfillmentBlock]
    : quote?.scheduleBlock
      ? scheduleBlockText[quote.scheduleBlock]
      : quote?.meetsMinOrderAmount === false
        ? `The minimum order is ${formatMoney(quote.minOrderAmount ?? 0)}. Add a little more to continue.`
        : null;
  const blocked = !canOrder ? blockedReason : quoteBlock ?? (problems.size ? 'Some items need your attention before you can check out.' : null);

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
    if (next.name) document.getElementById(`${formId}-name`)?.focus();
    else if (next.phone) document.getElementById(`${formId}-phone`)?.focus();
  };

  const place = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (placing || !paymentOption || !settings) return;
    const cleanName = name.trim();
    const cleanPhone = phone.replace(/[\s().-]/g, '');
    const errors: { name?: string; phone?: string } = {};
    if (!cleanName) errors.name = 'Tell us who is picking up.';
    if (!/^\+?\d{7,15}$/.test(cleanPhone)) errors.phone = 'Enter a phone number we can reach you on, digits only.';
    setFieldErrors(errors);
    setFormError(null);
    setUncertain(null);
    if (errors.name || errors.phone) {
      document.getElementById(errors.name ? `${formId}-name` : `${formId}-phone`)?.focus();
      return;
    }

    setPlacing(true);
    try {
      // Quotes expire after five minutes, so price once more right before placing.
      const fresh = await api.preview(
        {
          products: toPreviewProducts(lines),
          orderType: 'PICK_UP',
          paymentOption,
          pickupName: cleanName,
          pickupPhone: cleanPhone,
          ...(orderNote.trim() ? { note: orderNote.trim() } : {}),
        },
        lang,
      );
      const freshProblems = lineProblems(fresh, lines);
      if (fresh.fulfillmentBlock || fresh.scheduleBlock || fresh.meetsMinOrderAmount === false || freshProblems.size) {
        quoteState.adopt(fresh);
        setStep('cart');
        setFormError(null);
        return;
      }
      if (quote && (fresh.cardTotal !== quote.cardTotal || fresh.cashTotal !== quote.cashTotal)) {
        quoteState.adopt(fresh);
        setFormError('The total has changed since you last looked. Please check the new amount, then place your order.');
        return;
      }

      let created;
      try {
        created = await api.placeOrder(
          { previewOrderId: fresh.previewOrderId, priceType: settings.defaultPriceType, pickupName: cleanName, pickupPhone: cleanPhone, agreeToSmsUpdates: sms },
          lang,
        );
      } catch (err) {
        // A lost response, or a quote reported missing, cannot tell us whether an order was created.
        if (isApiError(err) && (err.kind === 'network' || err.code === 'PREVIEW_ORDER_NOT_FOUND')) {
          setUncertain({ phone: settings.storePhoneNumber });
          return;
        }
        throw err;
      }

      prefs.rememberOrder({ orderId: created.orderId, serial: created.orderSerialNumber });
      cart.clear();
      setStep('cart');

      if (paymentOption === 'PAY_ONLINE') {
        const back = `${window.location.origin}${window.location.pathname}?order=${created.orderId}`;
        try {
          const payment = await api.startPayment(created.orderId, `${back}&payment=success`, `${back}&payment=failed`, lang);
          if (payment.paymentLinkUrl) {
            prefs.rememberOrder({ orderId: created.orderId, serial: created.orderSerialNumber, transactionId: payment.transactionId });
            window.location.assign(payment.paymentLinkUrl);
            return;
          }
        } catch {
          // The order exists; its page offers to try the payment again.
        }
      }
      props.onPlaced(created.orderId);
    } catch (err) {
      if (isApiError(err)) {
        if (err.validationErrors.length) applyValidation(err);
        else setFormError(describe(err));
      } else {
        setFormError('Something unexpected happened. Please try again.');
      }
    } finally {
      setPlacing(false);
    }
  };

  const header = (
    <header className="cart__head">
      {step === 'checkout' ? (
        <button type="button" className="icon-btn" onClick={() => goto('cart')} aria-label="Back to your order">
          <BackIcon />
        </button>
      ) : null}
      <h2 id={titleId} ref={headingRef} tabIndex={-1}>
        {step === 'cart' ? 'Your order' : 'Pickup details'}
      </h2>
      {step === 'cart' && count ? <span className="cart__count">{count} {count === 1 ? 'item' : 'items'}</span> : null}
      {onClose ? (
        <button type="button" className="icon-btn cart__close" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>
      ) : null}
    </header>
  );

  if (props.loadingShell) {
    return (
      <section className="cart" aria-busy="true" aria-label="Your order">
        <header className="cart__head">
          <h2 id={titleId}>Your order</h2>
        </header>
        <div className="cart__skeleton">
          <span className="skel skel--line" style={{ width: '70%' }} />
          <span className="skel skel--line" style={{ width: '45%' }} />
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
          <p>Tap the plus on any dish and it will land on this ticket.</p>
          {onClose ? (
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Browse the menu
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  const totals = (
    <div className={`totals ${quoting ? 'is-updating' : ''}`} aria-live="polite" aria-busy={quoting}>
      {quote ? (
        <dl>
          <div>
            <dt>Subtotal</dt>
            <dd>{formatMoney(subTotal ?? 0)}</dd>
          </div>
          {(quote.discountDetails?.orderDiscounts ?? []).concat(quote.discountDetails?.productDiscounts ?? []).map((d, i) => (
            <div key={`d${i}`} className="totals__deduction">
              <dt dir="auto">{d.discountName ?? 'Discount'}</dt>
              <dd>−{formatMoney(Math.abs(useCash ? d.cashAmount : d.cardAmount))}</dd>
            </div>
          ))}
          {(quote.financialAdjustments ?? []).map((a, i) => {
            const amount = Math.abs(useCash ? a.cashSubTotal : a.cardSubTotal);
            const deduction = DEDUCTIONS.has(a.adjustType);
            return (
              <div key={`a${i}`} className={deduction ? 'totals__deduction' : ''}>
                <dt dir="auto">{a.name ?? a.adjustType}</dt>
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
          {showCash ? (
            <div className="totals__alt">
              <dt>{useCash ? 'If you pay by card' : 'If you pay in cash'}</dt>
              <dd>{formatMoney(useCash ? quote.cardTotal : quote.cashTotal)}</dd>
            </div>
          ) : null}
        </dl>
      ) : quoteError ? (
        <div className="inline-state" role="alert">
          <p>
            {quoteError.kind === 'rate_limited'
              ? `Pricing will resume in ${limitedSeconds || 'a few'} seconds.`
              : quoteError.kind === 'network'
                ? 'We could not price your order. Check your connection.'
                : quoteError.validationErrors[0]?.errorMessage ?? `We could not price this order${quoteError.code ? ` (${quoteError.code})` : ''}.`}
          </p>
          {quoteError.kind !== 'rate_limited' ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={quoteState.refresh}>
              Try again
            </button>
          ) : null}
        </div>
      ) : (
        <div className="totals__skeleton" aria-label="Pricing your order">
          <span className="skel skel--line" />
          <span className="skel skel--line skel--strong" />
        </div>
      )}
      {quote?.estimatedWaitMinutes ? (
        <p className="totals__wait">
          Ready in about {quote.estimatedWaitMinutes.min}–{quote.estimatedWaitMinutes.max} minutes
        </p>
      ) : null}
      {(quote?.warnings ?? []).map((w, i) => (
        <p key={i} className="notice notice--warn" dir="auto">
          {w}
        </p>
      ))}
    </div>
  );

  if (uncertain) {
    return (
      <section className="cart" aria-labelledby={titleId}>
        {header}
        <div className="cart__uncertain" ref={errorRef} tabIndex={-1} role="alert">
          <p className="eyebrow">We lost the line</p>
          <h3>We can’t tell whether your order went through.</h3>
          <p>
            The connection dropped while the order was on its way to the kitchen, so it may or may not have arrived. Please check with us before
            ordering again, so you are not charged for two.
          </p>
          {uncertain.phone ? (
            <a className="btn btn--primary" href={`tel:${uncertain.phone}`}>
              Call {uncertain.phone}
            </a>
          ) : null}
          <button type="button" className="btn btn--ghost" onClick={() => setUncertain(null)}>
            Back to my order
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className={`cart cart--${step}`} aria-labelledby={titleId}>
      {header}
      {step === 'cart' ? (
        <>
          <div className="cart__scroll">
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
                        <Stepper size="sm" min={0} value={line.quantity} onChange={(q) => cart.setQuantity(line.key, q)} label={`Quantity of ${line.name}`} />
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
            {blocked ? (
              <p className="notice notice--block" role="status">
                {blocked}
              </p>
            ) : null}
            <button type="button" className="btn btn--primary btn--block" disabled={!quote || !!blocked || quoting} onClick={() => goto('checkout')}>
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
                onChange={(e) => setName(e.target.value)}
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
                onChange={(e) => setPhone(e.target.value)}
                aria-invalid={!!fieldErrors.phone}
                aria-describedby={`${formId}-phone-hint${fieldErrors.phone ? ` ${formId}-phone-err` : ''}`}
                required
              />
              <p className="field__hint" id={`${formId}-phone-hint`}>
                The kitchen uses it to find your order, and your confirmation is sent to it.
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
              {paymentOptions.map((option) => (
                <label key={option} className={`pay__option ${paymentOption === option ? 'is-checked' : ''}`}>
                  <input type="radio" name="payment" checked={paymentOption === option} onChange={() => props.onPaymentOption(option)} />
                  <span className="pay__dot" aria-hidden="true" />
                  <span>
                    <span className="pay__title">{PAYMENT_LABELS[option].title}</span>
                    <span className="pay__detail">{PAYMENT_LABELS[option].detail}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          </div>
          <footer className="cart__foot">
            {totals}
            {blocked ? (
              <p className="notice notice--block" role="status">
                {blocked}
              </p>
            ) : null}
            <button type="submit" className={`btn btn--primary btn--block ${placing ? 'is-busy' : ''}`} disabled={placing || !quote || !!blocked || limitedSeconds > 0} aria-busy={placing}>
              {placing ? (
                <span>Sending to the kitchen…</span>
              ) : limitedSeconds > 0 ? (
                <span>Please wait {limitedSeconds}s</span>
              ) : (
                <>
                  <span>Place order</span>
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
