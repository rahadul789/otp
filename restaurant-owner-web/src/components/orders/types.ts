export type OrderStatus =
  | "New"
  | "Accepted"
  | "Preparing"
  | "ReadyForPickup"
  | "PickedUp"
  | "Delivered"
  | "Rejected"
  | "Cancelled"

export type OrderActor = "owner" | "rider" | "system" | "customer"

export type OrderPaymentMethod = "Cash" | "Bkash"

export type OrderTimestampKey =
  | "placedAt"
  | "acceptedAt"
  | "preparingAt"
  | "readyForPickupAt"
  | "pickedUpAt"
  | "deliveredAt"
  | "rejectedAt"
  | "cancelledAt"

export type OrderStatusTimestamps = {
  placedAt: string
  acceptedAt: string | null
  preparingAt: string | null
  readyForPickupAt: string | null
  pickedUpAt: string | null
  deliveredAt: string | null
  rejectedAt: string | null
  cancelledAt: string | null
}

export type OrderStatusHistoryItem = {
  id: string
  status: OrderStatus
  updatedAt: string
  updatedBy: OrderActor
  note?: string
}

export type OrderLineItemAddOn = {
  id: string
  name: string
  price: number
}

export type OrderLineItem = {
  id: string
  name: string
  quantity: number
  unitPrice: number
  variantLabel?: string | null
  addOns: OrderLineItemAddOn[]
}

export type OrderCustomer = {
  name: string
  phone: string
  address: string
}

export type OrderRider = {
  id: string
  name: string
  phone: string
} | null

export type OrderAutoCancelSnapshot = {
  enabled: boolean
  applies: boolean
  autoCancelAfterMinutes: number
  notifyBeforeMinutes: number
  autoCancelAt: string | null
  remainingSeconds: number | null
}

export type Order = {
  id: string
  orderNumber: string
  customer: OrderCustomer
  rider: OrderRider
  items: OrderLineItem[]
  subtotal: number
  deliveryFee: number
  discount: number
  total: number
  paymentMethod: OrderPaymentMethod
  currentStatus: OrderStatus
  cancelledBy?: string
  terminalReason?: string
  kitchenNote: string
  timestamps: OrderStatusTimestamps
  autoCancel?: OrderAutoCancelSnapshot
  history: OrderStatusHistoryItem[]
}

export type OrderOperationalTiming = {
  phaseLabel: string
  primaryLabel: string
  secondaryLabel: string
  tone: "neutral" | "warning" | "critical" | "success"
  lateByMinutes: number | null
  remainingMinutes: number | null
}

export const liveOrderStatuses: OrderStatus[] = [
  "New",
  "Accepted",
  "Preparing",
  "ReadyForPickup",
  "PickedUp",
]

export const historyOrderStatuses: OrderStatus[] = [
  "Delivered",
  "Rejected",
  "Cancelled",
]

export const allowedTransitions: Record<OrderStatus, OrderStatus[]> = {
  New: ["Accepted", "Rejected"],
  Accepted: ["Preparing"],
  Preparing: ["ReadyForPickup"],
  ReadyForPickup: ["PickedUp"],
  PickedUp: ["Delivered"],
  Delivered: [],
  Rejected: [],
  Cancelled: [],
}

export const terminalOrderStatuses: OrderStatus[] = [
  "Delivered",
  "Rejected",
  "Cancelled",
]

export const actorAllowedTransitions: Record<
  OrderActor,
  Partial<Record<OrderStatus, OrderStatus[]>>
> = {
  owner: {
    New: ["Accepted", "Rejected"],
    Accepted: ["Preparing"],
    Preparing: ["ReadyForPickup"],
  },
  rider: {
    ReadyForPickup: ["PickedUp"],
  },
  system: {
    PickedUp: ["Delivered"],
    New: ["Cancelled"],
    Accepted: ["Cancelled"],
    Preparing: ["Cancelled"],
    ReadyForPickup: ["Cancelled"],
  },
  customer: {
    New: ["Cancelled"],
    Accepted: ["Cancelled"],
  },
}

export function canActorTransitionOrder(
  actor: OrderActor,
  currentStatus: OrderStatus,
  nextStatus: OrderStatus
) {
  return actorAllowedTransitions[actor][currentStatus]?.includes(nextStatus) ?? false
}

export const orderStatusLabels: Record<OrderStatus, string> = {
  New: "New",
  Accepted: "Accepted",
  Preparing: "Preparing",
  ReadyForPickup: "Ready for Pickup",
  PickedUp: "On the Way",
  Delivered: "Delivered",
  Rejected: "Rejected",
  Cancelled: "Cancelled",
}

export const orderStatusTimestampKey: Record<OrderStatus, OrderTimestampKey> = {
  New: "placedAt",
  Accepted: "acceptedAt",
  Preparing: "preparingAt",
  ReadyForPickup: "readyForPickupAt",
  PickedUp: "pickedUpAt",
  Delivered: "deliveredAt",
  Rejected: "rejectedAt",
  Cancelled: "cancelledAt",
}

export function formatOrderMoney(amount: number) {
  return `${amount}tk`
}

export function getOrderItemsCount(order: Order) {
  return order.items.reduce((total, item) => total + item.quantity, 0)
}
