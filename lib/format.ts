import type { FulfillmentBlock, PriceType, ScheduleBlock } from './types';

const money = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The API carries no currency code, so amounts are shown with a bare "$".
export const formatMoney = (amount: number) => `$${money.format(amount)}`;

export const pickPrice = (p: { cashPrice: number; cardPrice: number }, type: PriceType) =>
  type === 'CASH_PRICE' ? p.cashPrice : p.cardPrice;

export const fulfillmentBlockText: Record<FulfillmentBlock, string> = {
  PAUSED: 'The kitchen has paused online orders for the moment.',
  CLOSED_HOURS: 'We are closed right now, so this order cannot be placed.',
  RESTRICTED: 'Online ordering is not available at this time.',
  PICKUP_DISABLED: 'Pickup orders are switched off at the moment.',
  DELIVERY_DISABLED: 'Delivery is not available.',
  PAYMENT_OPTION: 'That way of paying is not accepted. Please choose another.',
};

export const scheduleBlockText: Record<ScheduleBlock, string> = {
  TIME_IN_PAST: 'The pickup time has already passed.',
  STORE_NOT_ACCEPTING_FUTURE: 'We are not taking orders for later.',
  BEYOND_FUTURE_LIMIT: 'That pickup time is too far ahead.',
  OUTSIDE_OPEN_HOURS: 'That pickup time is outside our opening hours.',
};

// Stable hue per product so photo-less dishes keep the same tile between visits.
export function hashHue(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 4;
}

export const firstGlyph = (text: string) => Array.from(text.trim().replace(/^[\d\s.\-#]+/, '') || text.trim())[0] ?? '';
