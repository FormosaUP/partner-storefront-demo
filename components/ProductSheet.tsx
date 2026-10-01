'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { formatMoney, pickPrice } from '@/lib/format';
import { useResource } from '@/lib/hooks';
import { lineKey, type CartLine, type CartModifier } from '@/lib/store';
import type { MenuProduct, PriceType, ProductModifier } from '@/lib/types';
import { CheckIcon, CloseIcon, Photo, Sheet, Stepper } from './ui';

export const TAG_LABELS: Record<string, string> = {
  POPULAR: 'Popular',
  SPICY: 'Spicy',
  ALCOHOL: 'Contains alcohol',
  SNAP: 'SNAP eligible',
};

interface Props {
  product: MenuProduct | null;
  open: boolean;
  orderable: boolean;
  blockedReason: string | null;
  priceType: PriceType;
  lang: string | null;
  contentLang: string;
  onClose: () => void;
  onAdd: (line: CartLine, source: Element | null) => void;
}

const groupHint = (g: ProductModifier) => {
  if (g.lowerLimit > 0 && g.lowerLimit === g.upperLimit) return `Choose ${g.lowerLimit}`;
  if (g.lowerLimit > 0) return `Choose ${g.lowerLimit} to ${g.upperLimit}`;
  return g.upperLimit > 1 ? `Optional, up to ${g.upperLimit}` : 'Optional';
};

export default function ProductSheet({ product, open, orderable, blockedReason, priceType, lang, contentLang, onClose, onAdd }: Props) {
  const titleId = useId();
  const photoRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const [showMissing, setShowMissing] = useState(false);
  const [lowRes, setLowRes] = useState(false);

  const needsOptions = !!product?.hasModifier;
  const options = useResource(
    product && open && needsOptions ? `mods:${product.productId}:${product.storeMenuCategoryId}:${lang}` : null,
    (signal) => api.modifiers(product!.productId, product!.storeMenuCategoryId, lang, signal),
  );

  useEffect(() => {
    setSelected({});
    setQuantity(1);
    setNote('');
    setShowMissing(false);
    setLowRes(false);
  }, [product?.productId, product?.storeMenuCategoryId, open]);

  const groups = useMemo(
    () => (options.data?.modifiers ?? []).filter((g) => g.type === 'STANDARD' && (g.items?.length ?? 0) > 0),
    [options.data],
  );
  // Open-price options cannot be expressed in a quote request, so a dish that requires one is not orderable here.
  const needsOpenPrice = (options.data?.openPriceModifiers ?? []).some((m) => m.isRequired);

  if (!product) return <Sheet open={false} onClose={onClose} labelledBy={titleId} variant="product">{null}</Sheet>;

  const name = product.name ?? '';
  const soldOut = product.availabilityStatus !== 'AVAILABLE';
  const missing = groups.filter((g) => (selected[g.id]?.length ?? 0) < g.lowerLimit);
  const optionsReady = !needsOptions || (!!options.data && !options.loading);

  const optionsPrice = groups.reduce(
    (sum, g) => sum + (g.items ?? []).filter((i) => selected[g.id]?.includes(i.modifierId)).reduce((s, i) => s + pickPrice(i, priceType), 0),
    0,
  );
  const unitPrice = pickPrice(product, priceType) + optionsPrice;

  const toggle = (g: ProductModifier, itemId: string) => {
    setSelected((prev) => {
      const current = prev[g.id] ?? [];
      const has = current.includes(itemId);
      let next: string[];
      if (g.upperLimit <= 1) next = has ? (g.lowerLimit === 0 ? [] : current) : [itemId];
      else if (has) next = current.filter((id) => id !== itemId);
      else if (current.length >= g.upperLimit) return prev;
      else next = [...current, itemId];
      return { ...prev, [g.id]: next };
    });
  };

  const submit = () => {
    if (missing.length) {
      setShowMissing(true);
      document.getElementById(`group-${missing[0].id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    const modifiers: CartModifier[] = groups
      .filter((g) => selected[g.id]?.length)
      .map((g) => ({
        id: g.id,
        name: g.name ?? '',
        items: (g.items ?? [])
          .filter((i) => selected[g.id].includes(i.modifierId))
          .map((i) => ({ itemId: i.modifierId, name: i.name ?? '', price: pickPrice(i, priceType) })),
      }));
    onAdd(
      {
        key: lineKey(product.productId, product.storeMenuCategoryId, modifiers, note),
        productId: product.productId,
        storeMenuCategoryId: product.storeMenuCategoryId,
        name,
        imageUrl: product.imageUrl,
        unitPrice,
        quantity,
        note: note.trim(),
        modifiers,
      },
      photoRef.current,
    );
  };

  const disabledReason = soldOut
    ? 'Sold out today'
    : product.isOpenPrice || needsOpenPrice
      ? 'Priced at the counter. Please order this one in store.'
      : !orderable
        ? blockedReason
        : null;

  return (
    <Sheet open={open} onClose={onClose} labelledBy={titleId} variant="product">
      <article className="dish" lang={contentLang}>
        <button type="button" className="icon-btn dish__close" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>
        <div className="dish__scroll">
          <div ref={photoRef} className={`dish__photo ${lowRes ? 'dish__photo--small' : ''} ${product.imageUrl ? '' : 'dish__photo--none'}`}>
            <Photo
              key={product.productId}
              src={product.imageUrl}
              name={name}
              seed={product.productId}
              alt={product.imageUrl ? name : ''}
              eager
              onNaturalSize={(w) => setLowRes(w < 520)}
            />
          </div>
          <header className="dish__head">
            <h2 id={titleId} dir="auto">
              {name}
            </h2>
            <p className="dish__price">{formatMoney(pickPrice(product, priceType))}</p>
            {product.description ? (
              <p className="dish__desc" dir="auto">
                {product.description}
              </p>
            ) : null}
            {product.tags?.some((t) => TAG_LABELS[t]) ? (
              <ul className="tags" lang="en">
                {product.tags.filter((t) => TAG_LABELS[t]).map((t) => (
                  <li key={t} className={`tag tag--${t.toLowerCase()}`}>
                    {TAG_LABELS[t]}
                  </li>
                ))}
              </ul>
            ) : null}
          </header>

          {needsOptions && !optionsReady && !options.error ? (
            <div className="options options--loading" aria-busy="true" aria-label="Loading options">
              <span className="skel skel--line" style={{ width: '40%' }} />
              <span className="skel skel--chip" />
              <span className="skel skel--chip" />
              <span className="skel skel--line" style={{ width: '32%' }} />
              <span className="skel skel--chip" />
            </div>
          ) : null}

          {needsOptions && options.error ? (
            <div className="inline-state" role="alert" lang="en">
              <p>
                {options.error.kind === 'rate_limited'
                  ? 'One moment. We are loading the options again shortly.'
                  : 'The options for this dish did not load.'}
              </p>
              {options.error.kind !== 'rate_limited' ? (
                <button type="button" className="btn btn--ghost btn--sm" onClick={options.reload}>
                  Try again
                </button>
              ) : null}
            </div>
          ) : null}

          {optionsReady
            ? groups.map((g) => {
                const count = selected[g.id]?.length ?? 0;
                const single = g.upperLimit <= 1;
                const satisfied = count >= g.lowerLimit && (g.lowerLimit > 0 || count > 0);
                const isMissing = showMissing && count < g.lowerLimit;
                return (
                  <fieldset key={g.id} id={`group-${g.id}`} className={`options ${isMissing ? 'is-missing' : ''}`}>
                    <legend>
                      <span className="options__name" dir="auto">
                        {g.name}
                      </span>
                      <span className={`options__rule ${satisfied ? 'is-done' : ''}`} lang="en">
                        {satisfied ? <CheckIcon width={14} height={14} /> : null}
                        {g.lowerLimit > 0 && !satisfied ? 'Required · ' : ''}
                        {groupHint(g)}
                      </span>
                    </legend>
                    {isMissing ? (
                      <p className="options__error" role="alert" lang="en">
                        Please make a choice here.
                      </p>
                    ) : null}
                    <div className="options__list">
                      {(g.items ?? []).map((item) => {
                        const checked = selected[g.id]?.includes(item.modifierId) ?? false;
                        const full = !single && !checked && count >= g.upperLimit;
                        const price = pickPrice(item, priceType);
                        return (
                          <label key={item.modifierId} className={`option ${checked ? 'is-checked' : ''} ${!item.isAvailable || full ? 'is-disabled' : ''}`}>
                            <input
                              type={single ? 'radio' : 'checkbox'}
                              name={`group-${g.id}`}
                              checked={checked}
                              disabled={!item.isAvailable || full}
                              onChange={() => toggle(g, item.modifierId)}
                              onClick={() => {
                                if (single && checked && g.lowerLimit === 0) toggle(g, item.modifierId);
                              }}
                            />
                            <span className="option__mark" aria-hidden="true">
                              <CheckIcon width={14} height={14} />
                            </span>
                            <span className="option__name" dir="auto">
                              {item.name}
                            </span>
                            <span className="option__price" lang="en">
                              {!item.isAvailable ? 'Sold out' : price > 0 ? `+${formatMoney(price)}` : ''}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                );
              })
            : null}

          <div className="dish__note" lang="en">
            <label htmlFor={`${titleId}-note`}>Note for the kitchen</label>
            <textarea
              id={`${titleId}-note`}
              rows={2}
              maxLength={200}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Allergies, no scallion, sauce on the side…"
            />
          </div>
        </div>

        <footer className="dish__foot" lang="en">
          {disabledReason ? (
            <p className="dish__blocked" role="status">
              {disabledReason}
            </p>
          ) : (
            <>
              <Stepper value={quantity} onChange={setQuantity} label="Quantity" />
              <button type="button" className="btn btn--primary btn--grow" onClick={submit} disabled={!optionsReady}>
                <span>Add to order</span>
                <span className="btn__amount">{formatMoney(unitPrice * quantity)}</span>
              </button>
            </>
          )}
        </footer>
      </article>
    </Sheet>
  );
}
