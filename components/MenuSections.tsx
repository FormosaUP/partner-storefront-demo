'use client';

import { memo } from 'react';
import { formatMoney, pickPrice } from '@/lib/format';
import type { MenuCategory, MenuProduct, PriceType } from '@/lib/types';
import { TAG_LABELS } from './ProductSheet';
import { Photo, PlusIcon } from './ui';

interface CardProps {
  product: MenuProduct;
  index: number;
  qty: number;
  addable: boolean;
  priceType: PriceType;
  onOpen: (product: MenuProduct) => void;
  onQuickAdd: (product: MenuProduct, source: Element | null) => void;
}

// Memoised: with a hundred dishes on screen, a cart or scroll update must only touch the cards it changes.
const ProductCard = memo(function ProductCard({ product, index, qty, addable, priceType, onOpen, onQuickAdd }: CardProps) {
  const name = product.name ?? '';
  const soldOut = product.availabilityStatus !== 'AVAILABLE';
  return (
    <li className={`card ${soldOut ? 'is-out' : ''}`} style={{ ['--i' as string]: Math.min(index, 8) }}>
      <button type="button" className="card__open" onClick={() => onOpen(product)} aria-haspopup="dialog">
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
            {(product.tags ?? [])
              .filter((t) => TAG_LABELS[t] && t !== 'SNAP')
              .map((t) => (
                <span key={t} className={`tag tag--${t.toLowerCase()}`}>
                  {TAG_LABELS[t]}
                </span>
              ))}
          </span>
        </span>
        <Photo src={product.imageUrl} name={name} seed={product.productId} />
      </button>
      {addable && !soldOut ? (
        <button
          type="button"
          className={`card__add ${qty ? 'has-qty' : ''}`}
          lang="en"
          aria-label={product.hasModifier ? `Choose options for ${name}` : `Add ${name} to your cart${qty ? `, ${qty} already added` : ''}`}
          onClick={(e) => onQuickAdd(product, e.currentTarget.parentElement?.querySelector('.photo') ?? null)}
        >
          {qty ? (
            <span key={qty} className="card__qty">
              {qty}
            </span>
          ) : (
            <PlusIcon width={18} height={18} />
          )}
        </button>
      ) : null}
    </li>
  );
});

interface SectionProps {
  category: MenuCategory;
  menuServing: boolean;
  priceType: PriceType;
  inCart: Map<string, number>;
  onOpen: (product: MenuProduct) => void;
  onQuickAdd: (product: MenuProduct, source: Element | null) => void;
}

export const MenuSection = memo(function MenuSection({ category, menuServing, priceType, inCart, onOpen, onQuickAdd }: SectionProps) {
  const products = category.products ?? [];
  const serving = menuServing && category.isAvailableNow;
  return (
    <section id={`cat-${category.id}`} data-category={category.id} className="section" aria-labelledby={`cat-title-${category.id}`}>
      <header className="section__head">
        <h2 id={`cat-title-${category.id}`} dir="auto">
          {category.name}
        </h2>
        <span className="section__count" lang="en">
          {products.length} {products.length === 1 ? 'dish' : 'dishes'}
          {!category.isAvailableNow && menuServing ? ' · not serving now' : ''}
        </span>
      </header>
      <ul className="grid">
        {products.map((product, i) => (
          <ProductCard
            key={product.productId}
            product={product}
            index={i}
            qty={inCart.get(`${product.productId}/${product.storeMenuCategoryId}`) ?? 0}
            addable={serving}
            priceType={priceType}
            onOpen={onOpen}
            onQuickAdd={onQuickAdd}
          />
        ))}
      </ul>
    </section>
  );
});
