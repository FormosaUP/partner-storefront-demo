// Shapes taken from the partner API's OpenAPI file. Only the fields this site reads are listed.

export type PriceType = 'CASH_PRICE' | 'CARD_PRICE';
export type PaymentOption = 'PAY_IN_STORE' | 'PAY_ONLINE';
export type OrderType = 'FOR_HERE' | 'TO_GO' | 'PICK_UP' | 'DELIVERY' | 'IN_STORE' | 'DINE_IN';
export type AvailabilityStatus = 'AVAILABLE' | 'UNAVAILABLE';
export type FulfillmentBlock = 'PAUSED' | 'CLOSED_HOURS' | 'RESTRICTED' | 'PICKUP_DISABLED' | 'DELIVERY_DISABLED' | 'PAYMENT_OPTION';
export type ScheduleBlock = 'TIME_IN_PAST' | 'STORE_NOT_ACCEPTING_FUTURE' | 'BEYOND_FUTURE_LIMIT' | 'OUTSIDE_OPEN_HOURS';
export type FulfillmentStatus = 'NEW' | 'PREPARING' | 'READY' | 'FULFILLED' | 'CANCELLED';
export type OrderStatusLabel = 'UNPAID' | 'REFUNDED' | 'PARTIALLY_REFUNDED' | 'PENDING' | 'PAID' | 'CANCELLED';
export type AdjustType = 'TAX' | 'FEE' | 'DISCOUNT' | 'CREDIT' | 'FREE_ITEM' | 'TIP' | 'DELIVERY_FEE';

export interface Address {
  city: string | null;
  state: string | null;
  zipCode: string | null;
  address1: string | null;
  address2: string | null;
  formattedAddress: string | null;
}

export interface StoreSettings {
  storeId: string;
  defaultPriceType: PriceType;
  defaultLanguageCode: string | null;
  storePhoneNumber: string | null;
  address: Address | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  defaultPrepTimeMinutes: number | null;
  storePaused: boolean;
  isOnlinePaused: boolean;
  orderTypeOptions: OrderType[] | null;
  minOrderAmount: number | null;
  asapAvailable: boolean;
  allowFutureOrders: boolean;
  schedulableWindows: { start: string; end: string }[] | null;
  preferredTimezone: string | null;
  onlinePaymentOptions: PaymentOption[] | null;
  onlineFunctionEnabled: boolean;
  subdomain: string | null;
}

export interface StoreLanguage {
  id: string;
  code: string | null;
  name: string | null;
  isDefault: boolean;
}

export interface MenuSummary {
  id: string;
  name: string | null;
  description: string | null;
  displayOrder: number;
  isAvailableNow: boolean;
}

export interface MenuProduct {
  productId: string;
  storeMenuCategoryId: string;
  name: string | null;
  description: string | null;
  cashPrice: number;
  cardPrice: number;
  isOpenPrice: boolean;
  imageUrl: string | null;
  availabilityStatus: AvailabilityStatus;
  hasModifier: boolean;
  tags: string[] | null;
}

export interface MenuCategory {
  id: string;
  name: string | null;
  displayOrder: number;
  isAvailableNow: boolean;
  products: MenuProduct[] | null;
}

export interface MenuDetail {
  defaultPriceType: PriceType;
  categories: MenuCategory[] | null;
}

export interface ModifierItem {
  // The option's own id, despite the name. It is what the quote expects as `itemId`.
  modifierId: string;
  name: string | null;
  cardPrice: number;
  cashPrice: number;
  isAvailable: boolean;
}

export interface ProductModifier {
  id: string;
  name: string | null;
  type: 'STANDARD' | 'OPEN_PRICE';
  lowerLimit: number;
  upperLimit: number;
  items: ModifierItem[] | null;
}

export interface ProductModifiers {
  productId: string;
  modifiers: ProductModifier[] | null;
  openPriceModifiers: { id: string; name: string | null; isRequired: boolean }[] | null;
}

export interface PreviewRequestProduct {
  productId: string;
  storeMenuCategoryId: string;
  quantity: number;
  note?: string;
  modifiers?: { id: string; items: { itemId: string; quantity: number }[] }[];
}

export interface PreviewRequest {
  products: PreviewRequestProduct[];
  orderType: OrderType;
  paymentOption: PaymentOption;
  // Store-local wall-clock time without an offset. Left out for "as soon as possible".
  scheduledTime?: string;
  note?: string;
  pickupName?: string;
  pickupPhone?: string;
}

export interface FinancialAdjustment {
  name: string | null;
  adjustType: AdjustType;
  cardSubTotal: number;
  cashSubTotal: number;
}

export interface DiscountDetail {
  discountName: string | null;
  productName?: string | null;
  cardAmount: number;
  cashAmount: number;
}

export interface PreviewModifier {
  id: string;
  name: string | null;
  isMatchLimit: boolean;
  items: { itemId: string; itemName: string | null; quantity: number; isAvailable: boolean }[] | null;
}

export interface PreviewProduct {
  productId: string | null;
  name: string | null;
  quantity: number;
  cardSubTotal: number;
  cashSubTotal: number;
  modifiers: PreviewModifier[] | null;
}

export interface Quote {
  previewOrderId: string;
  cardTotal: number;
  cashTotal: number;
  cardSubTotal: number;
  cashSubTotal: number;
  orderProducts: PreviewProduct[] | null;
  financialAdjustments: FinancialAdjustment[] | null;
  orderProductStocks: { productId: string; isStockSufficient: boolean; availableStock: number | null; isAvailable: boolean }[] | null;
  discountDetails: { productDiscounts: DiscountDetail[] | null; orderDiscounts: DiscountDetail[] | null } | null;
  estimatedWaitMinutes: { min: number; max: number } | null;
  minOrderAmount: number | null;
  meetsMinOrderAmount: boolean | null;
  fulfillmentBlock: FulfillmentBlock | null;
  scheduleBlock: ScheduleBlock | null;
  warnings: string[] | null;
}

export interface CreateOrderRequest {
  previewOrderId: string;
  priceType: PriceType;
  pickupName: string;
  pickupPhone: string;
  agreeToSmsUpdates: boolean;
}

export interface CreatedOrder {
  orderId: string;
  orderSerialNumber: string | null;
}

export interface OrderAdjustment {
  id: string;
  name: string | null;
  adjustType: AdjustType;
  subTotal: number;
  cashSubTotal: number | null;
  cardSubTotal: number | null;
}

export interface OrderProduct {
  id: string;
  productName: string | null;
  note: string | null;
  quantity: number;
  subTotal: number;
  cashSubTotal: number | null;
  cardSubTotal: number | null;
  modifiers: { id: string; modifierName: string | null; modifierItems: { itemId: string; name: string | null; quantity: number }[] | null }[] | null;
}

export interface OrderTransaction {
  transactionId: string;
  transactionStatusLabel: 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'REFUNDED' | 'VOIDED';
  createDatetime: number;
}

export interface OrderDetail {
  id: string;
  shortId: string | null;
  orderStatusLabel: OrderStatusLabel;
  priceType: PriceType;
  subTotal: number;
  cashSubTotal: number | null;
  cardSubTotal: number | null;
  total: number;
  cashTotal: number | null;
  cardTotal: number | null;
  products: OrderProduct[] | null;
  adjustments: OrderAdjustment[] | null;
  transaction: OrderTransaction[] | null;
  orderSerialNumber: string | null;
  checkoutType: PaymentOption;
  pickupName: string | null;
  note: string | null;
  lifecycleStatus: 'ACTIVE' | 'CLOSED' | 'SCHEDULED';
  fulfillmentStatus: FulfillmentStatus;
}

export interface PaymentStart {
  paymentLinkUrl: string | null;
  transactionId: string | null;
}

export interface TransactionState {
  status: string;
  transactionStatusLabel: 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'REFUNDED' | 'VOIDED';
}
