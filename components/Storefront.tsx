'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { api, type ApiError } from '@/lib/api';
import { formatMoney, pickPrice } from '@/lib/format';
import { prefersReducedMotion, useMedia, useOnline, useQuote, useRateLimitSeconds, useResource } from '@/lib/hooks';
import { cart, hydrateStore, lineKey, prefs, useStore, type CartLine } from '@/lib/store';
import type { MenuProduct, PaymentOption, PriceType, StoreSettings } from '@/lib/types';
import CartPanel from './CartPanel';
import OrderView from './OrderView';
import ProductSheet, { TAG_LABELS } from './ProductSheet';
import { ArrowIcon, BagIcon, ClockIcon, GlobeIcon, PhoneIcon, Photo, PinIcon, PlusIcon, Sheet, flyToCart } from './ui';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type StoreState = { kind: 'open' | 'closed' | 'paused' | 'off'; label: string; reason: string | null };

function storeState(s: StoreSettings): StoreState {
  if (!s.onlineFunctionEnabled) return { kind: 'off', label: 'Online ordering off', reason: 'Online ordering is switched off at the moment.' };
  if (s.storePaused || s.isOnlinePaused) return { kind: 'paused', label: 'Paused', reason: 'The kitchen has paused online orders for the moment.' };
  if (!(s.orderTypeOptions ?? []).includes('PICK_UP')) return { kind: 'off', label: 'Pickup unavailable', reason: 'Pickup orders are switched off at the moment.' };
  if (!s.asapAvailable) return { kind: 'closed', label: 'Closed now', reason: 'We are closed right now. Have a look around, and order when we reopen.' };
  return { kind: 'open', label: 'Open now', reason: null };
}

// Runs a state change inside a view transition where the browser supports it.
function transition(change: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (doc.startViewTransition && !prefersReducedMotion()) doc.startViewTransition(() => flushSync(change));
  else change();
}

function fatalCopy(e: ApiError) {
  if (e.kind === 'network') return { eyebrow: 'No connection', title: 'We can’t reach the kitchen.', body: 'Check your connection. The menu will load as soon as you are back online.', retry: true };
  if (e.code === 'STORE_UNPUBLISHED' || e.code === 'FUNCTION_DISABLED')
    return { eyebrow: 'Back soon', title: 'We’re not taking online orders right now.', body: 'Please call or drop by. We would love to see you.', retry: true };
  return {
    eyebrow: 'Out of service',
    title: 'Online ordering is unavailable.',
    body: `Something is wrong on our side${e.code ? ` (${e.code})` : ''}. Please try again in a little while.`,
    retry: true,
  };
}

export default function Storefront() {
  const store = useStore();
  const [ready, setReady] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [sheetProduct, setSheetProduct] = useState<MenuProduct | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [paymentChoice, setPaymentChoice] = useState<PaymentOption | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const isDesktop = useMedia('(min-width: 1100px)');
  const online = useOnline();
  const limitedSeconds = useRateLimitSeconds();
  const cartTitleId = useId();
  const chipsRef = useRef<HTMLDivElement>(null);
  const lang = store.lang;

  useEffect(() => {
    hydrateStore();
    const read = () => {
      const id = new URLSearchParams(window.location.search).get('order');
      setOrderId(id && UUID.test(id) ? id : null);
    };
    read();
    setReady(true);
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);

  const settings = useResource(ready ? `settings:${lang}` : null, (signal) => api.settings(lang, signal));
  const languages = useResource(ready ? 'languages' : null, (signal) => api.languages(signal));
  const menus = useResource(ready && !orderId ? `menus:${lang}` : null, (signal) => api.menus(lang, signal));

  const menuList = useMemo(() => [...(menus.data?.menus ?? [])].sort((a, b) => a.displayOrder - b.displayOrder), [menus.data]);
  const activeMenu = menuList.find((m) => m.id === store.menuId) ?? menuList.find((m) => m.isAvailableNow) ?? menuList[0] ?? null;
  const menu = useResource(activeMenu && !orderId ? `menu:${activeMenu.id}:${lang}` : null, (signal) => api.menu(activeMenu!.id, lang, signal));
  const categories = useMemo(
    () => [...(menu.data?.categories ?? [])].filter((c) => c.products?.length).sort((a, b) => a.displayOrder - b.displayOrder),
    [menu.data],
  );

  const s = settings.data;
  const state = s ? storeState(s) : null;
  const priceType: PriceType = s?.defaultPriceType ?? 'CARD_PRICE';
  const paymentOptions = s?.onlinePaymentOptions ?? [];
  const paymentOption = paymentChoice && paymentOptions.includes(paymentChoice) ? paymentChoice : paymentOptions[0] ?? null;
  const contentLang = lang ?? s?.defaultLanguageCode ?? 'en';
  const quoteState = useQuote(store.lines, paymentOption, lang);
  const count = store.lines.reduce((n, l) => n + l.quantity, 0);
  const brand = s?.subdomain ?? '';

  useEffect(() => {
    if (brand) document.title = `${brand} · Order online for pickup`;
  }, [brand]);

  const inCart = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of store.lines) {
      const k = `${l.productId}/${l.storeMenuCategoryId}`;
      map.set(k, (map.get(k) ?? 0) + l.quantity);
    }
    return map;
  }, [store.lines]);

  // Highlight the section currently under the sticky header.
  useEffect(() => {
    if (!categories.length) return;
    setActiveCategory(categories[0].id);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActiveCategory((visible.target as HTMLElement).dataset.category ?? null);
      },
      { rootMargin: '-140px 0px -55% 0px' },
    );
    document.querySelectorAll('[data-category]').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [categories]);

  useEffect(() => {
    const row = chipsRef.current;
    const chip = row?.querySelector<HTMLElement>('[aria-current="true"]');
    if (row && chip) row.scrollTo({ left: chip.offsetLeft - row.clientWidth / 2 + chip.clientWidth / 2, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [activeCategory]);

  const go = useCallback((id: string | null) => {
    window.history.pushState(null, '', id ? `?order=${id}` : window.location.pathname);
    transition(() => {
      setOrderId(id);
      setCartOpen(false);
      setSheetOpen(false);
    });
    window.scrollTo(0, 0);
  }, []);

  const addLine = useCallback((line: CartLine, source: Element | null) => {
    cart.add(line);
    setAnnouncement(`Added ${line.quantity} ${line.name} to your order.`);
    requestAnimationFrame(() => flyToCart(source));
  }, []);

  const openProduct = (product: MenuProduct) => {
    setSheetProduct(product);
    setSheetOpen(true);
  };

  const menuServing = activeMenu?.isAvailableNow ?? true;
  const canOrder = state?.kind === 'open';
  const blockedReason = state?.reason ?? null;

  const quickAdd = (product: MenuProduct, source: Element | null) => {
    if (product.hasModifier || product.isOpenPrice) return openProduct(product);
    addLine(
      {
        key: lineKey(product.productId, product.storeMenuCategoryId, [], ''),
        productId: product.productId,
        storeMenuCategoryId: product.storeMenuCategoryId,
        name: product.name ?? '',
        imageUrl: product.imageUrl,
        unitPrice: pickPrice(product, priceType),
        quantity: 1,
        note: '',
        modifiers: [],
      },
      source,
    );
  };

  const jumpTo = (categoryId: string) => {
    document.getElementById(`cat-${categoryId}`)?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    setActiveCategory(categoryId);
  };

  const fatal = !s && settings.error && settings.error.kind !== 'rate_limited' ? settings.error : null;
  const menuError = menus.error ?? menu.error;
  const menuLoading = !fatal && (!ready || menus.loading || menu.loading || (!menus.data && !menus.error));
  const recent = store.recent[0] ?? null;
  const total = quoteState.quote ? (priceType === 'CASH_PRICE' ? quoteState.quote.cashTotal : quoteState.quote.cardTotal) : null;

  const cartPanel = (onClose?: () => void) => (
    <CartPanel
      lines={store.lines}
      quoteState={quoteState}
      settings={s}
      paymentOptions={paymentOptions}
      paymentOption={paymentOption}
      onPaymentOption={setPaymentChoice}
      canOrder={!!canOrder}
      blockedReason={blockedReason}
      lang={lang}
      contentLang={contentLang}
      titleId={cartTitleId}
      onClose={onClose}
      onPlaced={go}
      loadingShell={!s}
    />
  );

  const categoryLinks = (variant: 'rail' | 'chips') =>
    categories.map((c) => (
      <button key={c.id} type="button" className={`cat-link cat-link--${variant}`} aria-current={activeCategory === c.id ? 'true' : undefined} onClick={() => jumpTo(c.id)}>
        <span dir="auto">{c.name}</span>
        {variant === 'rail' ? <span className="cat-link__count">{c.products?.length}</span> : null}
      </button>
    ));

  return (
    <div className="app" data-view={orderId ? 'order' : 'menu'}>
      <a className="skip-link" href="#content">
        Skip to content
      </a>

      <div className="banners" aria-live="polite">
        {!online ? <p className="banner banner--offline">You’re offline. Your order is kept on this phone until you’re back.</p> : null}
        {limitedSeconds > 0 ? (
          <p className="banner banner--limit">
            <ClockIcon width={16} height={16} />
            We’re a little busy. Picking back up in <strong>{limitedSeconds}s</strong>.
          </p>
        ) : null}
      </div>

      <header className="topbar">
        <a
          className="brand"
          href="./"
          onClick={(e) => {
            if (orderId) {
              e.preventDefault();
              go(null);
            }
          }}
        >
          <span className="brand__logo">
            {s?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.logoUrl} alt="" width={40} height={40} decoding="async" />
            ) : null}
          </span>
          <span className="brand__name">{brand || (fatal ? null : <span className="skel skel--word" />)}</span>
        </a>
        <div className="topbar__tools">
          {state ? (
            <span className={`status status--${state.kind} status--bar`}>
              <span className="status__dot" aria-hidden="true" />
              {state.label}
            </span>
          ) : null}
          {(languages.data?.languages?.length ?? 0) > 1 ? (
            <label className="lang">
              <span className="sr-only">Menu language</span>
              <GlobeIcon className="lang__icon" />
              <select
                value={lang ?? languages.data!.languages!.find((l) => l.isDefault)?.code ?? ''}
                onChange={(e) => {
                  const picked = languages.data!.languages!.find((l) => l.code === e.target.value);
                  prefs.setLang(picked && !picked.isDefault ? picked.code : null);
                }}
              >
                {languages.data!.languages!.map((l) => (
                  <option key={l.id} value={l.code ?? ''}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {!orderId ? (
            <button type="button" className="topbar__cart" data-cart-target onClick={() => setCartOpen(true)} aria-label={`Your order, ${count} ${count === 1 ? 'item' : 'items'}`}>
              <BagIcon />
              {count ? <span className="badge">{count}</span> : null}
            </button>
          ) : null}
        </div>
      </header>

      {orderId ? (
        <main id="content" className="order-main">
          <OrderView
            orderId={orderId}
            settings={s}
            paymentOptions={paymentOptions}
            lang={lang}
            contentLang={contentLang}
            transactionId={store.recent.find((r) => r.orderId === orderId)?.transactionId ?? null}
            onNewOrder={() => go(null)}
          />
        </main>
      ) : (
        <div className="layout">
          <nav className="rail" aria-label="Menu sections">
            <p className="rail__title">{activeMenu ? <span dir="auto">{activeMenu.name}</span> : 'Menu'}</p>
            {menuLoading ? (
              <div className="rail__skeleton" aria-hidden="true">
                {Array.from({ length: 8 }, (_, i) => (
                  <span key={i} className="skel skel--line" style={{ width: `${55 + ((i * 17) % 35)}%` }} />
                ))}
              </div>
            ) : (
              <div className="rail__list" lang={contentLang}>
                {categoryLinks('rail')}
              </div>
            )}
          </nav>

          <main id="content">
            <section className="hero" aria-labelledby="hero-title">
              <div className="hero__text">
                <p className="hero__top">
                  {state ? (
                    <span className={`status status--${state.kind} status--hero`}>
                      <span className="status__dot" aria-hidden="true" />
                      {state.label}
                    </span>
                  ) : (
                    <span className="skel status--hero" hidden={!!fatal} style={{ width: '6.5rem', height: 32, borderRadius: 999 }} />
                  )}
                  <span className="eyebrow">Order for pickup</span>
                </p>
                <h1 id="hero-title">
                  Order ahead, <em>walk right in.</em>
                </h1>
                <ul className="hero__facts" hidden={!!fatal}>
                  <li>
                    <PinIcon width={18} height={18} />
                    {s ? (
                      s.address?.formattedAddress ? (
                        <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address.formattedAddress)}`} target="_blank" rel="noreferrer">
                          {s.address.formattedAddress}
                        </a>
                      ) : (
                        <span>Pickup at the counter</span>
                      )
                    ) : (
                      <span className="skel skel--line" style={{ width: '14rem' }} />
                    )}
                  </li>
                  <li>
                    <ClockIcon width={18} height={18} />
                    {s ? (
                      <span>{s.defaultPrepTimeMinutes ? `Usually ready in about ${s.defaultPrepTimeMinutes} minutes` : 'Made to order'}</span>
                    ) : (
                      <span className="skel skel--line" style={{ width: '11rem' }} />
                    )}
                  </li>
                  <li>
                    <PhoneIcon width={18} height={18} />
                    {s ? (
                      s.storePhoneNumber ? (
                        <a href={`tel:${s.storePhoneNumber}`}>{s.storePhoneNumber}</a>
                      ) : (
                        <span>Ask at the counter</span>
                      )
                    ) : (
                      <span className="skel skel--line" style={{ width: '7rem' }} />
                    )}
                  </li>
                </ul>
                {recent ? (
                  <button type="button" className="recent" onClick={() => go(recent.orderId)}>
                    <span>
                      Your last order{recent.serial ? <strong> {recent.serial}</strong> : null}
                    </span>
                    <ArrowIcon width={16} height={16} />
                  </button>
                ) : null}
              </div>
              <div className="hero__media">
                {s?.bannerUrl && isDesktop ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.bannerUrl} alt="" loading="lazy" decoding="async" onLoad={(e) => e.currentTarget.classList.add('is-loaded')} />
                ) : null}
              </div>
            </section>

            {fatal ? (
              <section className="state-page" role="alert">
                <p className="eyebrow">{fatalCopy(fatal).eyebrow}</p>
                <h2>{fatalCopy(fatal).title}</h2>
                <p>{fatalCopy(fatal).body}</p>
                <div className="state-page__actions">
                  <button type="button" className="btn btn--primary" onClick={settings.reload}>
                    Try again
                  </button>
                </div>
              </section>
            ) : (
              <>
                {state && state.kind !== 'open' ? (
                  <p className={`notice notice--store notice--${state.kind}`} role="status">
                    {state.reason}
                  </p>
                ) : null}

                <div className="menus" role="group" aria-label="Menus">
                  {menuList.length
                    ? menuList.map((m, i) => (
                        <button
                          key={m.id}
                          type="button"
                          className="menu-tab"
                          aria-pressed={activeMenu?.id === m.id}
                          onClick={() => transition(() => prefs.setMenu(m.id))}
                        >
                          <span className="menu-tab__no">{String(i + 1).padStart(2, '0')}</span>
                          <span className="menu-tab__name" dir="auto" lang={contentLang}>
                            {m.name}
                          </span>
                          {!m.isAvailableNow ? <span className="menu-tab__off">Not serving now</span> : null}
                        </button>
                      ))
                    : !menus.error
                      ? Array.from({ length: 4 }, (_, i) => <span key={i} className="menu-tab menu-tab--skeleton skel" />)
                      : null}
                </div>

                <div className="chips" ref={chipsRef} role="group" aria-label="Menu sections">
                  <div className="chips__row" lang={contentLang}>
                    {menuLoading
                      ? Array.from({ length: 5 }, (_, i) => <span key={i} className="skel skel--chip-sm" />)
                      : categoryLinks('chips')}
                  </div>
                </div>

                {menuError && !menuLoading && !categories.length ? (
                  <section className="state-page state-page--inline" role="alert">
                    <p className="eyebrow">{menuError.kind === 'rate_limited' ? 'One moment' : 'Menu unavailable'}</p>
                    <h2>{menuError.kind === 'rate_limited' ? 'The menu is on its way.' : 'The menu didn’t load.'}</h2>
                    <p>
                      {menuError.kind === 'rate_limited'
                        ? 'We are fetching it again automatically.'
                        : menuError.kind === 'network'
                          ? 'Check your connection and try again.'
                          : `Something went wrong${menuError.code ? ` (${menuError.code})` : ''}.`}
                    </p>
                    {menuError.kind !== 'rate_limited' ? (
                      <div className="state-page__actions">
                        <button type="button" className="btn btn--primary" onClick={() => (menus.error ? menus.reload() : menu.reload())}>
                          Try again
                        </button>
                      </div>
                    ) : null}
                  </section>
                ) : null}

                {activeMenu && !menuServing && !menuLoading ? (
                  <p className="notice notice--store" role="status">
                    This menu isn’t being served right now. You can browse it, but its dishes can’t be ordered at the moment.
                  </p>
                ) : null}

                <div className="sections" key={activeMenu?.id ?? 'none'} lang={contentLang}>
                  {menuLoading ? (
                    <div className="section" aria-busy="true" aria-label="Loading the menu">
                      <span className="skel skel--heading" />
                      <ul className="grid">
                        {Array.from({ length: 6 }, (_, i) => (
                          <li key={i} className="card card--skeleton">
                            <span className="card__text">
                              <span className="skel skel--line" style={{ width: '70%' }} />
                              <span className="skel skel--line" style={{ width: '45%' }} />
                              <span className="skel skel--line" style={{ width: '25%' }} />
                            </span>
                            <span className="photo skel" />
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    categories.map((category) => {
                      const serving = menuServing && category.isAvailableNow;
                      return (
                        <section key={category.id} id={`cat-${category.id}`} data-category={category.id} className="section" aria-labelledby={`cat-title-${category.id}`}>
                          <header className="section__head">
                            <h2 id={`cat-title-${category.id}`} dir="auto">
                              {category.name}
                            </h2>
                            <span className="section__count" lang="en">
                              {category.products!.length} {category.products!.length === 1 ? 'dish' : 'dishes'}
                              {!category.isAvailableNow && menuServing ? ' · not serving now' : ''}
                            </span>
                          </header>
                          <ul className="grid">
                            {category.products!.map((product, i) => {
                              const name = product.name ?? '';
                              const soldOut = product.availabilityStatus !== 'AVAILABLE';
                              const qty = inCart.get(`${product.productId}/${product.storeMenuCategoryId}`) ?? 0;
                              const addable = serving && !soldOut;
                              return (
                                <li key={product.productId} className={`card ${soldOut ? 'is-out' : ''}`} style={{ ['--i' as string]: Math.min(i, 8) }}>
                                  <button type="button" className="card__open" onClick={() => openProduct(product)} aria-haspopup="dialog">
                                    <span className="card__text">
                                      <span className="card__name" dir="auto">
                                        {name}
                                      </span>
                                      {product.description ? (
                                        <span className="card__desc" dir="auto">
                                          {product.description}
                                        </span>
                                      ) : null}
                                      <span className="card__meta" lang="en">
                                        <span className="card__price">{formatMoney(pickPrice(product, priceType))}</span>
                                        {soldOut ? <span className="tag tag--out">Sold out</span> : null}
                                        {(product.tags ?? []).filter((t) => TAG_LABELS[t] && t !== 'SNAP').map((t) => (
                                          <span key={t} className={`tag tag--${t.toLowerCase()}`}>
                                            {TAG_LABELS[t]}
                                          </span>
                                        ))}
                                      </span>
                                    </span>
                                    <Photo src={product.imageUrl} name={name} seed={product.productId} />
                                  </button>
                                  {addable ? (
                                    <button
                                      type="button"
                                      className={`card__add ${qty ? 'has-qty' : ''}`}
                                      lang="en"
                                      aria-label={product.hasModifier ? `Choose options for ${name}` : `Add ${name} to your order${qty ? `, ${qty} already added` : ''}`}
                                      onClick={(e) => quickAdd(product, e.currentTarget.parentElement?.querySelector('.photo') ?? null)}
                                    >
                                      {qty ? <span key={qty} className="card__qty">{qty}</span> : <PlusIcon width={18} height={18} />}
                                    </button>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        </section>
                      );
                    })
                  )}
                  {!menuLoading && !menuError && activeMenu && !categories.length ? (
                    <section className="state-page state-page--inline">
                      <p className="eyebrow">Empty for now</p>
                      <h2>Nothing on this menu yet.</h2>
                      <p>Try one of the other menus above.</p>
                    </section>
                  ) : null}
                </div>
              </>
            )}
          </main>

          <aside className="cart-col" aria-label="Your order" data-cart-target>
            {isDesktop ? cartPanel() : null}
          </aside>
        </div>
      )}

      {!orderId ? (
        <>
          {count > 0 ? (
            <button type="button" className="cart-bar" onClick={() => setCartOpen(true)} data-cart-target>
              <span className="cart-bar__count">{count}</span>
              <span className="cart-bar__label">View your order</span>
              <span className={`cart-bar__total ${quoteState.loading ? 'is-updating' : ''}`}>{total !== null ? formatMoney(total) : ''}</span>
            </button>
          ) : null}
          <Sheet open={cartOpen && !isDesktop} onClose={() => setCartOpen(false)} labelledBy={cartTitleId} variant="cart">
            {!isDesktop ? cartPanel(() => setCartOpen(false)) : null}
          </Sheet>
          <ProductSheet
            product={sheetProduct}
            open={sheetOpen}
            orderable={!!canOrder && menuServing && (categories.find((c) => c.id === sheetProduct?.storeMenuCategoryId)?.isAvailableNow ?? true)}
            blockedReason={blockedReason ?? 'This dish isn’t being served right now.'}
            priceType={priceType}
            lang={lang}
            contentLang={contentLang}
            onClose={() => setSheetOpen(false)}
            onAdd={(line, source) => {
              addLine(line, source);
              setSheetOpen(false);
            }}
          />
        </>
      ) : null}

      <footer className="footer">
        {s?.bannerUrl && !isDesktop ? (
          <div className="footer__media">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.bannerUrl} alt="" loading="lazy" decoding="async" />
          </div>
        ) : null}
        <p className="footer__brand">{brand}</p>
        <p>{s?.address?.formattedAddress}</p>
        <p className="footer__small">Prices and totals are confirmed by the kitchen when you place your order.</p>
      </footer>

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
