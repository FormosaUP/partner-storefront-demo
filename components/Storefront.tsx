'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { api, isUuid, type ApiError } from '@/lib/api';
import { formatMoney, pickPrice } from '@/lib/format';
import { prefersReducedMotion, prefetchResource, useMedia, useOnline, useQuote, useRateLimitSeconds, useResource } from '@/lib/hooks';
import { buildDays, hasSlot } from '@/lib/schedule';
import { cart, hydrateStore, lineKey, prefs, useStore, type CartLine } from '@/lib/store';
import type { MenuProduct, PaymentOption, PriceType, StoreSettings } from '@/lib/types';
import CartPanel from './CartPanel';
import { activeCategory, CategoryLinks } from './CategoryNav';
import { MenuSection } from './MenuSections';
import OrderView from './OrderView';
import ProductSheet from './ProductSheet';
import { ArrowIcon, BagIcon, ClockIcon, GlobeIcon, PhoneIcon, PinIcon, Sheet, flyToCart } from './ui';

type StoreState = { kind: 'open' | 'closed' | 'paused' | 'off'; label: string; reason: string | null };

function storeState(s: StoreSettings): StoreState {
  if (!s.onlineFunctionEnabled) return { kind: 'off', label: 'Online ordering off', reason: 'Online ordering is switched off at the moment.' };
  if (s.storePaused || s.isOnlinePaused) return { kind: 'paused', label: 'Paused', reason: 'The kitchen has paused online orders for the moment.' };
  if (!(s.orderTypeOptions ?? []).includes('PICK_UP'))
    return { kind: 'off', label: 'Pickup unavailable', reason: 'Pickup orders are switched off at the moment.' };
  if (!s.asapAvailable) return { kind: 'closed', label: 'Closed now', reason: 'We are closed right now. Have a look around, and order when we reopen.' };
  return { kind: 'open', label: 'Open now', reason: null };
}

const SETTINGS_MAX_AGE_MS = 2 * 60 * 1000;

// Runs a state change inside a view transition where the browser supports it.
function transition(change: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (doc.startViewTransition && !prefersReducedMotion()) doc.startViewTransition(() => flushSync(change));
  else change();
}

function fatalCopy(e: ApiError) {
  if (e.kind === 'network')
    return {
      eyebrow: 'No connection',
      title: 'We can’t reach the kitchen.',
      body: 'Check your connection. The menu will load as soon as you are back online.',
      retry: true,
    };
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
  const [announcement, setAnnouncement] = useState('');
  const [mounted, setMounted] = useState(2);
  const [menuShown, setMenuShown] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [minute, setMinute] = useState(0);
  const [pickupExpired, setPickupExpired] = useState(false);
  const jumping = useRef(false);
  const settingsAt = useRef(0);
  const isDesktop = useMedia('(min-width: 1100px)');
  // The banner is shown from tablet width up. Phones skip it: the only file on offer is 5760px wide.
  const isWide = useMedia('(min-width: 700px)');
  const [bannerFailed, setBannerFailed] = useState(false);
  const online = useOnline();
  const limitedSeconds = useRateLimitSeconds();
  const cartTitleId = useId();
  const lang = store.lang;

  useEffect(() => {
    const stopSync = hydrateStore();
    const read = () => {
      const id = new URLSearchParams(window.location.search).get('order');
      setOrderId(isUuid(id) ? id : null);
      setCartOpen(false);
      setSheetOpen(false);
    };
    read();
    setReady(true);
    window.addEventListener('popstate', read);
    return () => {
      stopSync();
      window.removeEventListener('popstate', read);
    };
  }, []);

  // The menu is fetched the first time it is shown and then kept, so returning from an order page costs nothing.
  useEffect(() => {
    if (ready && !orderId) setMenuShown(true);
  }, [ready, orderId]);

  const settings = useResource(ready ? 'settings' : null, (signal) => api.settings(signal));
  const languages = useResource(ready ? 'languages' : null, (signal) => api.languages(signal));
  // A scheduled pickup time changes which menus and sections are on offer, so it is part of what is asked for.
  const pickupTime = store.pickupTime;
  const menus = useResource(
    menuShown ? `menus:${lang}:${pickupTime ?? 'asap'}` : null,
    (signal) => api.menus(lang, pickupTime, signal),
    true,
    `menus:${lang}:`,
  );

  const menuList = useMemo(() => [...(menus.data?.menus ?? [])].sort((a, b) => a.displayOrder - b.displayOrder), [menus.data]);
  const activeMenu = menuList.find((m) => m.id === store.menuId) ?? menuList.find((m) => m.isAvailableNow) ?? menuList[0] ?? null;
  // A returning visitor's last menu starts loading alongside the menu list instead of after it.
  const menuId = activeMenu?.id ?? (!menus.data && !menus.error ? store.menuId : null);
  const menu = useResource(
    menuShown && menuId ? `menu:${menuId}:${lang}:${pickupTime ?? 'asap'}` : null,
    (signal) => api.menu(menuId!, lang, pickupTime, signal),
    true,
    `menu:${menuId}:${lang}:`,
  );
  const categories = useMemo(
    () => [...(menu.data?.categories ?? [])].filter((c) => c.products?.length).sort((a, b) => a.displayOrder - b.displayOrder),
    [menu.data],
  );

  const s = settings.data;
  const state = s ? storeState(s) : null;
  const priceType: PriceType = s?.defaultPriceType ?? 'CARD_PRICE';
  const paymentOptions = s?.onlinePaymentOptions ?? [];
  const paymentOption = paymentChoice && paymentOptions.includes(paymentChoice) ? paymentChoice : (paymentOptions[0] ?? null);
  const contentLang = lang ?? s?.defaultLanguageCode ?? 'en';
  const quoteState = useQuote(orderId ? [] : store.lines, paymentOption, lang, pickupTime);
  const count = store.lines.reduce((n, l) => n + l.quantity, 0);
  const brand = s?.subdomain ?? '';
  const fatal = !s && settings.error && settings.error.kind !== 'rate_limited' ? settings.error : null;
  const menuError = menus.error ?? menu.error;
  const menuLoading = !fatal && !menu.data && (!ready || menus.loading || menu.loading || (!menus.data && !menus.error));

  useEffect(() => {
    if (brand) document.title = `${brand} · Order online for pickup`;
  }, [brand]);

  // Opening status can change while the page sits open, so settings are refreshed when the visitor comes back to it.
  const reloadSettings = settings.reload;
  useEffect(() => {
    if (s) settingsAt.current = Date.now();
  }, [s]);
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden && settingsAt.current && Date.now() - settingsAt.current > SETTINGS_MAX_AGE_MS) reloadSettings();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reloadSettings]);

  // Pickup times on offer, rebuilt every minute so a time the store's clock has passed drops out.
  useEffect(() => {
    const timer = setInterval(() => setMinute((n) => n + 1), 60000);
    return () => clearInterval(timer);
  }, []);
  const days = useMemo(
    () => buildDays(s?.allowFutureOrders ? s.schedulableWindows : null, s?.preferredTimezone),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s, minute],
  );
  const asapAvailable = !!s?.asapAvailable;
  useEffect(() => {
    if (!s) return;
    const first = days[0]?.slots[0]?.value ?? null;
    if (pickupTime && !hasSlot(days, pickupTime)) {
      // The chosen time has passed or is no longer offered: move to the nearest choice and say so.
      prefs.setPickupTime(asapAvailable ? null : first);
      setPickupExpired(true);
    } else if (!pickupTime && !asapAvailable && first) {
      // Closed right now but taking orders for later: start from the earliest time.
      prefs.setPickupTime(first);
    }
  }, [s, days, pickupTime, asapAvailable]);

  const schedule = {
    days,
    value: pickupTime,
    onChange: (value: string | null) => {
      prefs.setPickupTime(value);
      setPickupExpired(false);
    },
    asapAvailable,
    prepMinutes: s?.defaultPrepTimeMinutes ?? null,
    timezone: s?.preferredTimezone ?? null,
    expired: pickupExpired,
  };

  // A remembered language the store no longer offers falls back to the store default.
  const languageCodes = languages.data?.languages;
  useEffect(() => {
    if (lang && languageCodes && !languageCodes.some((l) => l.code === lang)) prefs.setLang(null);
  }, [lang, languageCodes]);

  const inCart = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of store.lines) {
      const k = `${l.productId}/${l.storeMenuCategoryId}`;
      map.set(k, (map.get(k) ?? 0) + l.quantity);
    }
    return map;
  }, [store.lines]);

  useEffect(() => {
    setMounted(2);
    if (categories.length <= 2) return;
    let handle = 0;
    // Safari has no requestIdleCallback, so a short timer stands in for it there.
    const hasIdle = typeof window.requestIdleCallback === 'function';
    const idle = (fn: () => void): number => (hasIdle ? window.requestIdleCallback(fn, { timeout: 400 }) : (setTimeout(fn, 60) as unknown as number));
    const cancel = (id: number) => (hasIdle ? window.cancelIdleCallback(id) : clearTimeout(id));
    let shown = 2;
    const step = () => {
      shown += 2;
      setMounted(shown);
      if (shown < categories.length) handle = idle(step);
    };
    handle = idle(step);
    return () => cancel(handle);
  }, [categories]);

  // Highlight the section currently under the sticky header.
  useEffect(() => {
    if (!categories.length) return;
    if (!categories.some((c) => c.id === activeCategory.get())) activeCategory.set(categories[0].id);
    // Track every section inside the band, not just the ones that changed, and pick the topmost.
    const inBand = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.category ?? '';
          if (e.isIntersecting) inBand.add(id);
          else inBand.delete(id);
        }
        if (jumping.current) return;
        const top = categories.find((c) => inBand.has(c.id));
        if (top) activeCategory.set(top.id);
      },
      { rootMargin: '-140px 0px -55% 0px' },
    );
    document.querySelectorAll('[data-category]').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [categories, mounted, menuLoading, orderId]);

  const go = useCallback((id: string | null) => {
    window.history.pushState(null, '', id ? `?order=${id}` : window.location.pathname);
    transition(() => {
      setOrderId(id);
      setCartOpen(false);
      setSheetOpen(false);
      window.scrollTo(0, 0);
    });
    if (!id) document.getElementById('content')?.focus({ preventScroll: true });
  }, []);

  const addLine = useCallback((line: CartLine, source: Element | null) => {
    cart.add(line);
    setAnnouncement(`Added ${line.quantity} ${line.name} to your cart.`);
    requestAnimationFrame(() => flyToCart(source));
  }, []);

  const openProduct = useCallback((product: MenuProduct) => {
    setSheetProduct(product);
    setSheetOpen(true);
  }, []);

  const warmMenu = (id: string) => prefetchResource(`menu:${id}:${lang}:${pickupTime ?? 'asap'}`, () => api.menu(id, lang, pickupTime));

  const menuServing = activeMenu?.isAvailableNow ?? true;

  const quickAdd = useCallback(
    (product: MenuProduct, source: Element | null) => {
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
    },
    [addLine, openProduct, priceType],
  );

  const jumpTo = useCallback(
    (categoryId: string) => {
      if (!document.getElementById(`cat-${categoryId}`)) flushSync(() => setMounted(categories.length));
      const target = document.getElementById(`cat-${categoryId}`);
      if (!target) return;
      // Hold the highlight on the chosen section while the page travels past the ones in between.
      jumping.current = true;
      activeCategory.set(categoryId);
      target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
      window.setTimeout(
        () => {
          // Sections above may have changed height as they rendered; settle exactly on the target.
          target.scrollIntoView({ behavior: 'auto', block: 'start' });
          jumping.current = false;
        },
        prefersReducedMotion() ? 50 : 700,
      );
    },
    [categories.length],
  );

  const recent = store.recent[0] ?? null;
  const barCash = paymentOption !== 'PAY_ONLINE' && priceType === 'CASH_PRICE';
  const total = quoteState.quote ? (barCash ? quoteState.quote.cashTotal : quoteState.quote.cardTotal) : null;
  const orderingUnavailable = fatal
    ? 'We can’t load the shop right now. Please try again in a little while.'
    : s && !paymentOptions.length
      ? 'The shop has not set up a way to pay for online orders yet. Please call us to order.'
      : null;

  const cartPanel = (onClose?: () => void) => (
    <CartPanel
      lines={store.lines}
      quoteState={quoteState}
      settings={s}
      paymentOptions={paymentOptions}
      paymentOption={paymentOption}
      onPaymentOption={setPaymentChoice}
      unavailable={orderingUnavailable}
      unconfirmedAt={store.unconfirmedAt}
      schedule={schedule}
      onBusy={setPlacing}
      lang={lang}
      contentLang={contentLang}
      titleId={cartTitleId}
      onClose={onClose}
      onPlaced={go}
    />
  );

  return (
    <div className="app" data-view={orderId ? 'order' : 'menu'}>
      <a className="skip-link" href="#content">
        Skip to content
      </a>

      <div className="banners" aria-live="polite">
        {!online ? <p className="banner banner--offline">You’re offline. Your cart is saved.</p> : null}
        {limitedSeconds > 0 ? (
          <p className="banner banner--limit">
            <ClockIcon width={16} height={16} />
            We’re a little busy. Picking back up shortly.
            {/* The ticking number is for the eye only; a live region would read it out every second. */}
            <strong aria-hidden="true">{limitedSeconds}s</strong>
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
          <span className="brand__name">{brand || (fatal || s ? null : <span className="skel skel--word" />)}</span>
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
            <button
              type="button"
              className="topbar__cart"
              data-cart-target
              onClick={() => setCartOpen(true)}
              aria-label={`Your cart, ${count} ${count === 1 ? 'item' : 'items'}`}
            >
              <BagIcon />
              {count ? <span className="badge">{count}</span> : null}
            </button>
          ) : null}
        </div>
      </header>

      {orderId ? (
        <main id="content" className="order-main" tabIndex={-1}>
          <OrderView
            key={orderId}
            orderId={orderId}
            settings={s}
            paymentOptions={paymentOptions}
            lang={lang}
            contentLang={contentLang}
            scheduledFor={store.recent.find((r) => r.orderId === orderId)?.scheduledFor ?? null}
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
                <CategoryLinks variant="rail" categories={categories} onJump={jumpTo} />
              </div>
            )}
          </nav>

          <main id="content" tabIndex={-1} inert={placing}>
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
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address.formattedAddress)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
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
                    <span>Your last order{recent.serial ? <strong> {recent.serial}</strong> : null}</span>
                    <ArrowIcon width={16} height={16} />
                  </button>
                ) : null}
              </div>
              {/* Tablet and desktop only. If the store has no banner, or it fails to decode, the hero falls back to text alone. */}
              {isWide && s && (!s.bannerUrl || bannerFailed) ? null : (
                <div className="hero__media">
                  {s?.bannerUrl && isWide ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={s.bannerUrl}
                      alt=""
                      fetchPriority="high"
                      decoding="async"
                      onLoad={(e) => e.currentTarget.classList.add('is-loaded')}
                      onError={() => setBannerFailed(true)}
                    />
                  ) : null}
                </div>
              )}
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
                    {state.kind === 'closed' && days.length
                      ? 'We are closed right now, but you can order ahead: choose a pickup time in your cart.'
                      : state.reason}
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
                          onClick={() => prefs.setMenu(m.id)}
                          onPointerEnter={() => warmMenu(m.id)}
                          onFocus={() => warmMenu(m.id)}
                        >
                          <span className="menu-tab__no">{String(i + 1).padStart(2, '0')}</span>
                          <span className="menu-tab__name" dir="auto" lang={contentLang}>
                            {m.name}
                          </span>
                          {!m.isAvailableNow ? <span className="menu-tab__off">Not serving now</span> : null}
                        </button>
                      ))
                    : !menus.error && !menus.data
                      ? Array.from({ length: 4 }, (_, i) => <span key={i} className="menu-tab menu-tab--skeleton skel" />)
                      : null}
                </div>

                <div className="chips" role="group" aria-label="Menu sections">
                  <div className="chips__row" lang={contentLang}>
                    {menuLoading ? (
                      Array.from({ length: 5 }, (_, i) => <span key={i} className="skel skel--chip-sm" />)
                    ) : (
                      <CategoryLinks variant="chips" categories={categories} onJump={jumpTo} />
                    )}
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
                    categories
                      .slice(0, mounted)
                      .map((category) => (
                        <MenuSection
                          key={category.id}
                          category={category}
                          menuServing={menuServing}
                          priceType={priceType}
                          inCart={inCart}
                          onOpen={openProduct}
                          onQuickAdd={quickAdd}
                        />
                      ))
                  )}
                  {menus.data && !menuList.length ? (
                    <section className="state-page state-page--inline">
                      <p className="eyebrow">Coming soon</p>
                      <h2>The menu isn’t published yet.</h2>
                      <p>Please check back a little later.</p>
                    </section>
                  ) : null}
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

          <aside className="cart-col" aria-label="Your cart" data-cart-target>
            {isDesktop ? cartPanel() : null}
          </aside>
        </div>
      )}

      {!orderId ? (
        <>
          {count > 0 ? (
            <button type="button" className="cart-bar" onClick={() => setCartOpen(true)} data-cart-target>
              <span className="cart-bar__count">{count}</span>
              <span className="cart-bar__label">View your cart</span>
              <span className={`cart-bar__total ${quoteState.loading ? 'is-updating' : ''}`}>{total !== null ? formatMoney(total) : ''}</span>
            </button>
          ) : null}
          <Sheet open={cartOpen && !isDesktop} onClose={() => setCartOpen(false)} labelledBy={cartTitleId} variant="cart">
            {!isDesktop ? cartPanel(() => setCartOpen(false)) : null}
          </Sheet>
          <ProductSheet
            product={sheetProduct}
            open={sheetOpen}
            orderable={menuServing && (categories.find((c) => c.products?.some((p) => p === sheetProduct))?.isAvailableNow ?? true)}
            blockedReason="This dish isn’t being served right now."
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
