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

  // Keep the current link in view inside its own scroller (the chip row, or the desktop rail), without moving the page.
  useEffect(() => {
    const link = activeRef.current;
    const behavior = prefersReducedMotion() ? 'auto' : 'smooth';
    if (variant === 'chips') {
      const row = link?.closest<HTMLElement>('.chips');
      if (link && row) row.scrollTo({ left: link.offsetLeft - row.clientWidth / 2 + link.clientWidth / 2, behavior });
    } else {
      const rail = link?.closest<HTMLElement>('.rail');
      if (link && rail && rail.scrollHeight > rail.clientHeight)
        rail.scrollTo({ top: link.offsetTop - rail.clientHeight / 2 + link.clientHeight / 2, behavior });
    }
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
