import * as React from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import { connectCustomerSocket, disconnectCustomerSocket, getCustomerSocket } from "@/src/lib/socket-client";
import { useCustomerAuthStore } from "@/src/store/auth-store";

type CustomerOrderPayload = {
  _id: string;
  restaurantId?: string;
  orderNumber: string;
  status: string;
  paymentMethod: string;
  terminalReason?: string;
  cancelledBy?: string;
  customerSnapshot?: {
    id?: string;
    fullName?: string;
    phone?: string;
    deliveryAddress?: {
      label?: string;
      addressLine?: string;
      latitude?: number | null;
      longitude?: number | null;
    };
  };
  pricing?: {
    subtotal?: number;
    deliveryFee?: number;
    discountAmount?: number;
    total?: number;
  };
  riderSnapshot?: {
    id?: string;
    name?: string;
    phone?: string;
    vehicleType?: string;
  };
  riderTracking?: {
    isActive?: boolean;
    startedAt?: string;
    lastUpdatedAt?: string;
    freshness?: {
      lastUpdatedAt?: string | null;
      ageSeconds?: number | null;
      isFresh?: boolean;
      isStale?: boolean;
      state?: "live" | "stale" | "unavailable";
    };
    remainingDistanceKm?: number;
    directDistanceKm?: number;
    remainingDurationMinutes?: number;
    speedKmph?: number;
    isNearCustomer?: boolean;
    nearCustomerNotifiedAt?: string | null;
    currentLocation?: {
      latitude?: number;
      longitude?: number;
      heading?: number | null;
      accuracyMeters?: number | null;
    };
  };
  itemsSnapshot?: {
    itemId?: string;
    name?: string;
    quantity?: number;
    unitPrice?: number;
  }[];
  history?: {
    status: string;
    actor: string;
    note?: string;
    createdAt: string;
  }[];
  timestamps?: {
    placedAt?: string;
    acceptedAt?: string;
    preparingAt?: string;
    readyForPickupAt?: string;
    pickedUpAt?: string;
    deliveredAt?: string;
    cancelledAt?: string;
  };
  createdAt: string;
};

type CustomerNotificationPayload = {
  id: string;
  type: string;
  title: string;
  description: string;
  path: string;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
};

type CustomerSupportPayload = {
  id: string;
  status: "open" | "in_progress" | "resolved" | "closed";
  subject: string;
  createdAt: string;
  updatedAt: string;
  messages: {
    id: string;
    senderType: "customer" | "admin";
    senderName: string;
    message: string;
    createdAt: string;
    attachments: {
      url: string;
      publicId?: string;
      fileName?: string;
      fileType?: string;
    }[];
  }[];
};

function upsertOrderList(
  current: CustomerOrderPayload[] | undefined,
  nextOrder: CustomerOrderPayload
) {
  const list = current ?? [];
  const exists = list.some((order) => order._id === nextOrder._id);

  const updated = exists
    ? list.map((order) => (order._id === nextOrder._id ? nextOrder : order))
    : [nextOrder, ...list];

  return [...updated].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );
}

function extractOrderIdFromPath(path?: string) {
  if (!path) return null;
  const match = path.match(/\/orders\/([^/?#]+)/);
  return match?.[1] ?? null;
}

export function useCustomerSocketBridge() {
  const queryClient = useQueryClient();
  const customer = useCustomerAuthStore((state) => state.customer);
  const joinedRef = React.useRef<string | null>(null);
  const appStateRef = React.useRef(AppState.currentState);

  React.useEffect(() => {
    if (!customer?.id) {
      joinedRef.current = null;
      disconnectCustomerSocket();
      return;
    }

    if (appStateRef.current === "active" && joinedRef.current !== customer.id) {
      connectCustomerSocket(customer.id);
      joinedRef.current = customer.id;
    }

    const socket = getCustomerSocket();
    const ensureJoined = () => socket.emit("customer:join", customer.id);

    const handleOrderEvent = (payload: CustomerOrderPayload) => {
      queryClient.setQueryData<CustomerOrderPayload[]>(["customer", "orders"], (current) =>
        upsertOrderList(current, payload)
      );
      queryClient.setQueryData(["customer", "orders", payload._id], payload);
    };

    const handleNotificationCreated = (notification?: CustomerNotificationPayload) => {
      queryClient.invalidateQueries({ queryKey: ["customer", "notifications"] });
      queryClient.invalidateQueries({ queryKey: ["customer", "profile"] });

      const orderId = extractOrderIdFromPath(notification?.path);
      if (orderId) {
        queryClient.invalidateQueries({ queryKey: ["customer", "orders", orderId] });
        queryClient.invalidateQueries({ queryKey: ["customer", "orders"] });
      }

      if (typeof notification?.path === "string" && notification.path.includes("/support-chat")) {
        queryClient.invalidateQueries({ queryKey: ["customer", "support-case"] });
      }
    };

    const handleSupportUpdated = (payload: CustomerSupportPayload) => {
      queryClient.setQueryData(["customer", "support-case", "latest"], payload);
      queryClient.setQueryData(["customer", "support-case", payload.id], payload);
    };

    const handleAppStateChange = (nextState: AppStateStatus) => {
      appStateRef.current = nextState;

      if (nextState === "active") {
        connectCustomerSocket(customer.id);
        joinedRef.current = customer.id;
        ensureJoined();
        queryClient.invalidateQueries({ queryKey: ["customer", "support-case"] });
        return;
      }

      joinedRef.current = null;
      disconnectCustomerSocket();
    };

    socket.on("connect", ensureJoined);
    socket.on("customer.order.created", handleOrderEvent);
    socket.on("customer.order.updated", handleOrderEvent);
    socket.on("customer.notification.created", handleNotificationCreated);
    socket.on("customer.support.updated", handleSupportUpdated);
    const subscription = AppState.addEventListener("change", handleAppStateChange);

    return () => {
      subscription.remove();
      socket.off("connect", ensureJoined);
      socket.off("customer.order.created", handleOrderEvent);
      socket.off("customer.order.updated", handleOrderEvent);
      socket.off("customer.notification.created", handleNotificationCreated);
      socket.off("customer.support.updated", handleSupportUpdated);
    };
  }, [customer?.id, queryClient]);
}
