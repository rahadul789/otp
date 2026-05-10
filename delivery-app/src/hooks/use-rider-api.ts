import {
  keepPreviousData,
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { apiDelete, apiGet, apiPost } from "@/src/lib/api";
import { buildQueryString } from "@/src/lib/query-params";
import { useRiderAuthStore, type RiderProfile } from "@/src/store/auth-store";

export type RiderOrder = {
  id: string;
  orderNumber: string;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  assignmentState?: "unassigned" | "assigned_to_you" | "assigned_to_other";
  isTrackingActiveForRider?: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  pricing?: {
    total?: number;
    deliveryFee?: number;
  };
  timestamps?: Record<string, string>;
  riderSnapshot?: {
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
    currentLocation?: {
      latitude?: number;
      longitude?: number;
      heading?: number | null;
      accuracyMeters?: number | null;
    };
  };
  customer?: {
    name?: string;
    phone?: string;
    deliveryAddress?: {
      label?: string;
      addressLine?: string;
      latitude?: number | null;
      longitude?: number | null;
    };
  };
  restaurant?: {
    id?: string;
    name?: string;
    phone?: string;
    address?: string;
    city?: string;
    latitude?: number | null;
    longitude?: number | null;
    preparationTimeMinutes?: number | null;
  } | null;
  items?: {
    name?: string;
    quantity?: number;
    totalPrice?: number;
  }[];
  history?: {
    status: string;
    actor: string;
    note?: string;
    createdAt: string | null;
  }[];
};

const ACTIVE_ORDER_STATUSES = new Set([
  "New",
  "Accepted",
  "Preparing",
  "ReadyForPickup",
  "PickedUp",
]);

const HISTORY_ORDER_STATUSES = new Set(["Delivered", "Cancelled", "Rejected"]);

function normalizeRiderOrder(order: Partial<RiderOrder> & { _id?: string; id?: string }) {
  const id = order.id ?? order._id ?? "";
  return {
    ...order,
    id,
  } as RiderOrder;
}

function patchScopedOrdersList(
  current: RiderOrder[] | undefined,
  nextOrder: RiderOrder,
  shouldInclude: boolean
) {
  const list = current ?? [];
  const nextIndex = list.findIndex((item) => item.id === nextOrder.id);

  if (!shouldInclude) {
    if (nextIndex === -1) {
      return list;
    }
    return list.filter((item) => item.id !== nextOrder.id);
  }

  if (nextIndex === -1) {
    return [nextOrder, ...list];
  }

  return list.map((item) => (item.id === nextOrder.id ? { ...item, ...nextOrder } : item));
}

export function patchRiderOrderCaches(
  queryClient: QueryClient,
  orderLike: Partial<RiderOrder> & { _id?: string; id?: string }
) {
  const nextOrder = normalizeRiderOrder(orderLike);
  if (!nextOrder.id) {
    return;
  }

  queryClient.setQueryData(["rider", "order", nextOrder.id], nextOrder);
  queryClient.setQueryData<RiderOrder[]>(["rider", "orders", "active"], (current) =>
    patchScopedOrdersList(current, nextOrder, ACTIVE_ORDER_STATUSES.has(nextOrder.status))
  );
  queryClient.setQueryData<RiderOrder[]>(["rider", "orders", "history"], (current) =>
    patchScopedOrdersList(current, nextOrder, HISTORY_ORDER_STATUSES.has(nextOrder.status))
  );
  queryClient.setQueryData<RiderOrder[]>(["rider", "orders", "available"], (current) =>
    patchScopedOrdersList(
      current,
      nextOrder,
      nextOrder.status === "ReadyForPickup" && nextOrder.assignmentState !== "assigned_to_other"
    )
  );
}

type RiderAuthResponse = {
  accessToken: string;
  refreshToken: string;
  rider: RiderProfile;
};

export function useRiderProfileQuery(enabled = true) {
  const isAuthenticated = useRiderAuthStore((state: { accessToken: string }) => Boolean(state.accessToken));

  return useQuery({
    queryKey: ["rider", "profile"],
    enabled: enabled && isAuthenticated,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const response = await apiGet<RiderProfile>("/rider/profile");
      return response.data;
    },
  });
}

export function useUpdateRiderAvailabilityMutation() {
  const queryClient = useQueryClient();
  const setSession = useRiderAuthStore((state) => state.setSession);
  const rider = useRiderAuthStore((state: { rider: RiderProfile | null }) => state.rider);
  const accessToken = useRiderAuthStore((state: { accessToken: string }) => state.accessToken);
  const refreshToken = useRiderAuthStore((state: { refreshToken: string }) => state.refreshToken);

  return useMutation({
    mutationFn: async (isAvailableForAssignments: boolean) => {
      const response = await apiPost<RiderProfile>("/rider/profile/availability", {
        isAvailableForAssignments,
      }, "PATCH");
      return response.data;
    },
    onSuccess: (data: RiderProfile) => {
      queryClient.setQueryData(["rider", "profile"], data);
      void queryClient.invalidateQueries({ queryKey: ["rider", "orders"] });
      if (rider && accessToken && refreshToken) {
        setSession({
          rider: { ...rider, ...data },
          accessToken,
          refreshToken,
        });
      }
    },
  });
}

export function useUpdateRiderProfileLocationMutation() {
  const queryClient = useQueryClient();
  const setSession = useRiderAuthStore((state) => state.setSession);
  const rider = useRiderAuthStore((state: { rider: RiderProfile | null }) => state.rider);
  const accessToken = useRiderAuthStore((state: { accessToken: string }) => state.accessToken);
  const refreshToken = useRiderAuthStore((state: { refreshToken: string }) => state.refreshToken);

  return useMutation({
    mutationFn: async (payload: {
      latitude: number;
      longitude: number;
      heading?: number;
      accuracyMeters?: number;
      speedKmph?: number;
    }) => {
      const response = await apiPost<RiderProfile>("/rider/profile/location", payload, "PATCH");
      return response.data;
    },
    onSuccess: (data: RiderProfile) => {
      queryClient.setQueryData(["rider", "profile"], data);
      if (rider && accessToken && refreshToken) {
        setSession({
          rider: { ...rider, ...data },
          accessToken,
          refreshToken,
        });
      }
    },
  });
}

export function useRiderOrdersQuery(scope: "available" | "active" | "history") {
  const isAuthenticated = useRiderAuthStore((state: { accessToken: string }) => Boolean(state.accessToken));
  const query = buildQueryString({ scope });

  return useQuery({
    queryKey: ["rider", "orders", scope],
    enabled: isAuthenticated,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const response = await apiGet<RiderOrder[]>(`/rider/orders?${query}`);
      return response.data;
    },
  });
}

export function useRiderOrderDetailsQuery(orderId?: string) {
  const isAuthenticated = useRiderAuthStore((state: { accessToken: string }) => Boolean(state.accessToken));

  return useQuery({
    queryKey: ["rider", "order", orderId],
    enabled: isAuthenticated && Boolean(orderId),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const response = await apiGet<RiderOrder>(`/rider/orders/${orderId}`);
      return response.data;
    },
  });
}

export function useStartRiderPhoneAuthMutation() {
  return useMutation({
    mutationFn: async (params: { phone: string }) => {
      const response = await apiPost<{
        verificationSessionId: string;
        expiresInSeconds: number;
      }>("/rider/auth/phone/start", params);
      return response.data;
    },
  });
}

export function useVerifyRiderPhoneAuthMutation() {
  const setSession = useRiderAuthStore((state) => state.setSession);

  return useMutation<
    RiderAuthResponse,
    Error,
    {
      verificationSessionId: string;
      otpCode: string;
      fullName?: string;
    }
  >({
    mutationFn: async (params) => {
      const response = await apiPost<RiderAuthResponse>("/rider/auth/phone/verify", params);
      return response.data;
    },
    onSuccess: (data: RiderAuthResponse) => {
      setSession({
        rider: data.rider,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      });
    },
  });
}

export function usePickupOrderMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (orderId: string) => {
      const response = await apiPost<RiderOrder>(`/rider/orders/${orderId}/pickup`);
      return response.data;
    },
    onSuccess: (data: RiderOrder) => {
      patchRiderOrderCaches(queryClient, data);
    },
  });
}

export function useAcceptOrderMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (orderId: string) => {
      const response = await apiPost<RiderOrder>(`/rider/orders/${orderId}/accept`);
      return response.data;
    },
    onSuccess: (data: RiderOrder) => {
      patchRiderOrderCaches(queryClient, data);
    },
  });
}

export function useDeliverOrderMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (orderId: string) => {
      const response = await apiPost<RiderOrder>(`/rider/orders/${orderId}/deliver`);
      return response.data;
    },
    onSuccess: (data: RiderOrder) => {
      patchRiderOrderCaches(queryClient, data);
    },
  });
}

export function useActivateTrackingMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (orderId: string) => {
      const response = await apiPost<RiderOrder>(`/rider/orders/${orderId}/tracking/activate`);
      return response.data;
    },
    onSuccess: (data: RiderOrder) => {
      patchRiderOrderCaches(queryClient, data);
    },
  });
}

export function useUpdateRiderLocationMutation(orderId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      latitude: number;
      longitude: number;
      heading?: number;
      accuracyMeters?: number;
      speedKmph?: number;
    }) => {
      if (!orderId) {
        throw new Error("Order is not available for tracking.");
      }

      const response = await apiPost<RiderOrder>(`/rider/orders/${orderId}/location`, payload);
      return response.data;
    },
    onSuccess: (data: RiderOrder) => {
      patchRiderOrderCaches(queryClient, data);
    },
  });
}

export function useLogoutRiderMutation() {
  const refreshToken = useRiderAuthStore((state: { refreshToken: string }) => state.refreshToken);
  const clearSession = useRiderAuthStore((state: { clearSession: () => void }) => state.clearSession);

  return useMutation({
    mutationFn: async () => {
      if (!refreshToken) return null;
      await apiPost("/rider/auth/logout", { refreshToken });
      return null;
    },
    onSettled: () => {
      clearSession();
    },
  });
}

export function useRegisterRiderPushTokenMutation() {
  return useMutation({
    mutationFn: async (body: {
      expoPushToken: string;
      platform: "android" | "ios";
      deviceId?: string;
      appVersion?: string;
    }) => {
      const response = await apiPost<{ registered: boolean }>(
        "/rider/push-tokens",
        body
      );
      return response.data;
    },
  });
}

export function useUnregisterRiderPushTokenMutation() {
  return useMutation({
    mutationFn: async (body: { expoPushToken: string }) => {
      const query = encodeURIComponent(body.expoPushToken);
      const response = await apiDelete<{ removed: boolean }>(
        `/rider/push-tokens?expoPushToken=${query}`
      );
      return response.data;
    },
  });
}
