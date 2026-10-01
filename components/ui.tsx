'use client';

import { useEffect, useRef, useState, type ReactNode, type SVGProps } from 'react';
import { firstGlyph, hashHue } from '@/lib/format';
import { prefersReducedMotion, useNearViewport } from '@/lib/hooks';

type IconProps = SVGProps<SVGSVGElement>;

const base: IconProps = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
};

export const PlusIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const MinusIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M5 12h14" />
  </svg>
);
export const CloseIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const CheckIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path className="check-path" d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
export const BagIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M5 8h14l-1 12H6L5 8z" />
    <path d="M9 8V7a3 3 0 016 0v1" />
  </svg>
);
export const PinIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M12 21s7-6.1 7-11.5A7 7 0 005 9.5C5 14.9 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.4" />
  </svg>
);
export const PhoneIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a1 1 0 01-1 1A16 16 0 014 5a1 1 0 011-1z" />
  </svg>
);
export const ClockIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);
export const GlobeIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17" />
  </svg>
);
export const ArrowIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
export const BackIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </svg>
);

interface PhotoProps {
  src: string | null;
  name: string;
  seed: string;
  alt?: string;
  eager?: boolean;
  className?: string;
  onNaturalSize?: (width: number, height: number) => void;
}

// A dish photo, or a designed tile carrying the dish's first character when there is none.
export function Photo({ src, name, seed, alt = '', eager, className = '', onNaturalSize }: PhotoProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  const [frameRef, near] = useNearViewport<HTMLSpanElement>();
  const show = eager || near;

  useEffect(() => {
    setFailed(false);
    setLoaded(false);
    const img = ref.current;
    if (img?.complete && img.naturalWidth) {
      setLoaded(true);
      onNaturalSize?.(img.naturalWidth, img.naturalHeight);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, show]);

  if (!src || failed) {
    return (
      <span className={`photo photo--empty ${className}`} data-tone={hashHue(seed)} role={alt ? 'img' : undefined} aria-label={alt || undefined}>
        <span className="photo__glyph" aria-hidden="true">
          {firstGlyph(name)}
        </span>
      </span>
    );
  }
  return (
    <span ref={frameRef} className={`photo ${loaded ? 'is-loaded' : ''} ${className}`}>
      {/* The API offers one full-size file per photo, so each is held back until it is nearly on screen. */}
      {show ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        ref={ref}
        src={src}
        alt={alt}
        decoding="async"
        onLoad={(e) => {
          setLoaded(true);
          onNaturalSize?.(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight);
        }}
        onError={() => setFailed(true)}
      />
      ) : null}
    </span>
  );
}

interface StepperProps {
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  label: string;
  size?: 'sm' | 'md';
}

export function Stepper({ value, min = 1, max = 99, onChange, label, size = 'md' }: StepperProps) {
  return (
    <div className={`stepper stepper--${size}`} role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label={value - 1 <= 0 ? 'Remove' : 'Decrease quantity'}>
        <MinusIcon width={16} height={16} />
      </button>
      <output key={value} aria-live="polite">
        {value}
      </output>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label="Increase quantity">
        <PlusIcon width={16} height={16} />
      </button>
    </div>
  );
}

interface SheetProps {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  variant: 'product' | 'cart';
  children: ReactNode;
}

// Modal built on <dialog>: focus trap, Escape and background inertness come from the platform.
export function Sheet({ open, onClose, labelledBy, variant, children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.classList.remove('is-closing');
      dialog.showModal();
      return;
    }
    if (!open && dialog.open) {
      if (prefersReducedMotion()) {
        dialog.close();
        return;
      }
      dialog.classList.add('is-closing');
      const timer = setTimeout(() => {
        dialog.classList.remove('is-closing');
        dialog.close();
      }, 220);
      return () => clearTimeout(timer);
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`sheet sheet--${variant}`}
      aria-labelledby={labelledBy}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="sheet__body">{children}</div>
    </dialog>
  );
}

// Sends a small copy of the dish photo arcing into the cart button.
export function flyToCart(source: Element | null, color?: string) {
  if (prefersReducedMotion() || !source) return;
  const target = Array.from(document.querySelectorAll<HTMLElement>('[data-cart-target]')).reverse().find((el) => el.getClientRects().length > 0);
  if (!target) return;
  const from = source.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  const size = Math.min(72, Math.max(44, from.width * 0.6));
  const dot = document.createElement('span');
  dot.className = 'fly-dot';
  const img = source.querySelector('img');
  if (img?.currentSrc) dot.style.backgroundImage = `url("${img.currentSrc}")`;
  else if (color) dot.style.background = color;
  dot.style.width = dot.style.height = `${size}px`;
  dot.style.left = `${from.left + from.width / 2 - size / 2}px`;
  dot.style.top = `${from.top + from.height / 2 - size / 2}px`;
  document.body.appendChild(dot);
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  dot
    .animate(
      [
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: `translate(${dx * 0.55}px, ${dy * 0.3 - 60}px) scale(.8)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${dx}px, ${dy}px) scale(.18)`, opacity: 0.4 },
      ],
      { duration: 620, easing: 'cubic-bezier(.3,.7,.3,1)' },
    )
    .finished.finally(() => {
      dot.remove();
      target.classList.remove('is-bumped');
      void target.offsetWidth;
      target.classList.add('is-bumped');
    });
}
