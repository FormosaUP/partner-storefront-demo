'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { prefersReducedMotion } from '@/lib/hooks';
import type { MenuCategory } from '@/lib/types';

// The section in view lives outside React state, so scrolling re-renders these links and nothing else.
let current: string | null = null;
const listeners = new Set<() => void>();

export const activeCategory = {
  get: () => current,
  set(id: string | null) {
    if (id === current) return;
    current = id;
    listeners.forEach((fn) => fn());
  },
};

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

interface Props {
  variant: 'rail' | 'chips';
  categories: MenuCategory[];
  onJump: (categoryId: string) => void;
}

export function CategoryLinks({ variant, categories, onJump }: Props) {
  const active = useSyncExternalStore(subscribe, activeCategory.get, () => null);
  const activeRef = useRef<HTMLButtonElement>(null);

  // Keep the current chip centred in its scrolling row.
  useEffect(() => {
    if (variant !== 'chips') return;
    const chip = activeRef.current;
    const row = chip?.closest<HTMLElement>('.chips');
    if (chip && row) row.scrollTo({ left: chip.offsetLeft - row.clientWidth / 2 + chip.clientWidth / 2, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [active, variant]);

  return categories.map((c) => (
    <button
      key={c.id}
      ref={active === c.id ? activeRef : undefined}
      type="button"
      className={`cat-link cat-link--${variant}`}
      aria-current={active === c.id ? 'true' : undefined}
      onClick={() => onJump(c.id)}
    >
      <span dir="auto">{c.name}</span>
      {variant === 'rail' ? <span className="cat-link__count">{c.products?.length}</span> : null}
    </button>
  ));
}
