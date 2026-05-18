import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  type OwnerAuthResponse,
} from "@/src/lib/api";
import { useOwnerAuthStore } from "@/src/store/auth-store";

export type OwnerListResponse<T> = {
  items: T[];
  total: number;
  unreadCount?: number;
};

export type OwnerStoreSettings = {
  id: string;
  name: string;
  description?: string;
  contact?: {
    phone?: string;
    email?: string;
  };
  preparationTimeMinutes?: number | null;
  logo?: { url?: string };
  coverImage?: { url?: string };
  runtime?: {
    isOnline?: boolean;
    isVisible?: boolean;
    currentOperationalStatus?: string;
  };
  settings?: {
    notifications?: {
      newOrder?: boolean;
      cancellation?: boolean;
      payouts?: boolean;
      support?: boolean;
    };
  };
};

export type OwnerOrderStatus =
  | "New"
  | "Accepted"
  | "Preparing"
  | "ReadyForPickup"
  | "PickedUp"
  | "Delivered"
  | "Cancelled"
  | "Rejected";

export type OwnerOrder = {
  _id: string;
  orderNumber: string;
  status: OwnerOrderStatus;
  paymentMethod: string;
  pricing?: {
    subtotal?: number;
    deliveryFee?: number;
    discountAmount?: number;
    total?: number;
  };
  customerSnapshot?: {
    fullName?: string;
    phone?: string;
    deliveryAddress?: {
      label?: string;
      addressLine?: string;
      details?: string;
      district?: string;
      area?: string;
    };
  };
  itemsSnapshot?: {
    itemId?: string;
    name?: string;
    quantity?: number;
    unitPrice?: number;
    selectedVariantOptions?: { groupName: string; optionLabel: string }[];
    selectedAddOnOptions?: { groupName: string; optionLabel: string }[];
  }[];
  timestamps?: Record<string, string | undefined>;
  autoCancel?: {
    enabled: boolean;
    applies: boolean;
    autoCancelAt: string | null;
    remainingSeconds: number | null;
  };
  preparationMeta?: {
    autoStarted?: boolean;
  };
  preparationTiming?: {
    phase:
      | "not_started"
      | "accepted"
      | "preparing"
      | "preparing_late"
      | "completed";
    label: string;
    baseMinutes: number;
    extraMinutes: number;
    totalMinutes: number;
    maxExtraMinutes: number;
    startedAt: string | null;
    targetStartAt: string | null;
    targetReadyAt: string | null;
    remainingSeconds: number | null;
    lateBySeconds: number;
    canExtend: boolean;
    extensionOptions: number[];
    autoStarted: boolean;
  };
  history?: {
    status: OwnerOrderStatus;
    actor: "owner" | "customer" | "system" | "rider";
    note?: string;
    createdAt: string;
  }[];
};

export type OwnerMenuItem = {
  _id: string;
  categoryId: string;
  name: string;
  description?: string;
  status: "active" | "archived";
  availability?: "available" | "unavailable";
  basePrice: number;
  isPopular?: boolean;
  images?: { url?: string }[];
};

export type OwnerDashboardSummary = {
  restaurant: {
    id: string;
    name: string;
    isOnline: boolean;
    isVisible: boolean;
    currentOperationalStatus: string;
  };
  metrics: {
    totalOrders: number;
    totalRevenue: number;
    totalNetEarnings: number;
    pendingOrders: number;
    completedOrders: number;
    averageOrderValue: number;
    nextEstimatedPayoutAt: string | null;
  };
};

export type OwnerPayoutSummary = {
  pendingBalance: number;
  availableBalance: number;
  paidOutBalance: number;
  requestedPayoutBalance: number;
  lifetimeGrossAmount?: number;
  lifetimeNetEarnings: number;
  lifetimeCommission?: number;
  lifetimeDiscountCost?: number;
  lifetimeDeliveryCost?: number;
  nextSettlementAvailableAt: string | null;
  lastPayout?: {
    _id?: string;
    amount: number;
    status: string;
    requestedAt: string;
    processedAt?: string | null;
  } | null;
  payoutMethod?: {
    _id: string;
    type: "bkash" | "bank";
    accountName: string;
    accountNumber: string;
    bankName?: string;
    branchName?: string;
    isVerified?: boolean;
  } | null;
};

export type OwnerPlatformContent = {
  operations?: {
    ownerApp?: {
      webDashboardUrl?: string;
    };
  };
};

export type OwnerOtpSessionResponse = {
  verificationSessionId: string;
  expiresInSeconds?: number;
  resendAvailableInSeconds?: number;
  otpSent?: boolean;
  mockCode?: string | null;
};

export type OwnerOtpVerifyResponse = {
  verified: boolean;
  purpose: string;
  nextStatus?: string;
};

export function useOwnerSigninMutation() {
  const setSession = useOwnerAuthStore((state) => state.setSession);

  return useMutation({
    mutationFn: async (payload: { phone: string; password: string }) => {
      const response = await apiPost<OwnerAuthResponse>(
        "/auth/owner/signin",
        payload,
        false,
      );
      return response.data;
    },
    onSuccess: (data) => {
      setSession({
        owner: data.owner,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        restaurantLifecycleStatus: data.restaurantLifecycleStatus,
      });
    },
  });
}

export function useOwnerOtpSigninStartMutation() {
  return useMutation({
    mutationFn: async (payload: { phone: string }) => {
      const response = await apiPost<OwnerOtpSessionResponse>(
        "/auth/owner/otp/signin/start",
        payload,
        false,
      );
      return response.data;
    },
  });
}

export function useOwnerOtpSigninVerifyMutation() {
  const setSession = useOwnerAuthStore((state) => state.setSession);

  return useMutation({
    mutationFn: async (payload: { verificationSessionId: string; otpCode: string }) => {
      const response = await apiPost<OwnerAuthResponse>(
        "/auth/owner/otp/signin/verify",
        payload,
        false,
      );
      return response.data;
    },
    onSuccess: (data) => {
      setSession({
        owner: data.owner,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        restaurantLifecycleStatus: data.restaurantLifecycleStatus,
      });
    },
  });
}

export function useOwnerPasswordResetStartMutation() {
  return useMutation({
    mutationFn: async (payload: { phone: string }) => {
      const response = await apiPost<OwnerOtpSessionResponse>(
        "/auth/owner/password/forgot",
        payload,
        false,
      );
      return response.data;
    },
  });
}

export function useOwnerOtpVerifyMutation() {
  return useMutation({
    mutationFn: async (payload: { verificationSessionId: string; otpCode: string }) => {
      const response = await apiPost<OwnerOtpVerifyResponse>(
        "/auth/otp/verify",
        payload,
        false,
      );
      return response.data;
    },
  });
}

export function useOwnerPasswordResetMutation() {
  return useMutation({
    mutationFn: async (payload: { verificationSessionId: string; newPassword: string }) => {
      const response = await apiPost<{ reset: boolean }>(
        "/auth/password/reset",
        payload,
        false,
      );
      return response.data;
    },
  });
}

export function useOwnerLogoutMutation() {
  const clearSession = useOwnerAuthStore((state) => state.clearSession);
  const refreshToken = useOwnerAuthStore((state) => state.refreshToken);
  const registeredPushToken = useOwnerAuthStore((state) => state.registeredPushToken);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (registeredPushToken) {
        const query = encodeURIComponent(registeredPushToken);
        await apiDelete(`/owner/push-tokens?expoPushToken=${query}`).catch(() => null);
      }

      if (!refreshToken) return null;
      const response = await apiPost<{ revoked: boolean }>("/auth/owner/logout", {
        refreshToken,
      });
      return response.data;
    },
    onSettled: () => {
      queryClient.clear();
      clearSession();
    },
  });
}

export function useOwnerStoreSettingsQuery(enabled = true) {
  return useQuery({
    queryKey: ["owner", "store-settings"],
    enabled,
    queryFn: async () => {
      const response = await apiGet<OwnerStoreSettings>("/owner/store-settings");
      return response.data;
    },
  });
}

export function useOwnerDashboardSummaryQuery(enabled = true) {
  return useQuery({
    queryKey: ["owner", "dashboard", "summary", "today"],
    enabled,
    queryFn: async () => {
      const response = await apiGet<OwnerDashboardSummary>(
        "/owner/dashboard/summary?preset=today",
      );
      return response.data;
    },
  });
}

export function useUpdateOwnerRestaurantStatusMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: { isOnline: boolean }) => {
      const response = await apiPatch<OwnerStoreSettings>(
        "/owner/restaurant-status",
        payload,
      );
      return response.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["owner", "store-settings"] });
      await queryClient.invalidateQueries({ queryKey: ["owner", "dashboard"] });
    },
  });
}

export function useUpdateOwnerStoreSettingsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: { phone?: string }) => {
      const response = await apiPatch<OwnerStoreSettings>(
        "/owner/store-settings",
        payload,
      );
      return response.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["owner", "store-settings"] });
    },
  });
}

export function useOwnerOrdersQuery(
  enabled = true,
  params?: {
    tab?: "live" | "history";
    status?: string;
    pageSize?: number;
  },
) {
  const searchParams = new URLSearchParams();
  if (params?.tab) searchParams.set("tab", params.tab);
  if (params?.status) searchParams.set("status", params.status);
  if (params?.pageSize) searchParams.set("pageSize", String(params.pageSize));
  const query = searchParams.toString();

  return useQuery({
    queryKey: ["owner", "orders", params ?? {}],
    enabled,
    refetchInterval: enabled ? 20_000 : false,
    queryFn: async () => {
      const response = await apiGet<OwnerListResponse<OwnerOrder>>(
        `/owner/orders${query ? `?${query}` : ""}`,
      );
      return response.data;
    },
  });
}

export function useOwnerOrderDetailsQuery(orderId?: string) {
  return useQuery({
    queryKey: ["owner", "orders", "details", orderId],
    enabled: Boolean(orderId),
    queryFn: async () => {
      const response = await apiGet<OwnerOrder>(`/owner/orders/${orderId}`);
      return response.data;
    },
  });
}

export function useOwnerOrderTransitionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      orderId: string;
      nextStatus: "Accepted" | "Rejected" | "Preparing" | "ReadyForPickup" | "Cancelled";
      note?: string;
    }) => {
      const response = await apiPost<OwnerOrder>(
        `/owner/orders/${payload.orderId}/transition`,
        {
          nextStatus: payload.nextStatus,
          actor: "owner",
          note: payload.note,
        },
      );
      return response.data;
    },
    onSuccess: async (order) => {
      await queryClient.invalidateQueries({ queryKey: ["owner", "orders"] });
      queryClient.setQueryData(["owner", "orders", "details", order._id], order);
      await queryClient.invalidateQueries({
        queryKey: ["owner", "orders", "details", order._id],
      });
      await queryClient.invalidateQueries({ queryKey: ["owner", "dashboard"] });
    },
  });
}

export function useExtendOwnerOrderPreparationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: { orderId: string; minutes: 5 | 10 }) => {
      const response = await apiPost<OwnerOrder>(
        `/owner/orders/${payload.orderId}/preparation/extend`,
        {
          minutes: payload.minutes,
        },
      );
      return response.data;
    },
    onSuccess: async (order) => {
      await queryClient.invalidateQueries({ queryKey: ["owner", "orders"] });
      queryClient.setQueryData(["owner", "orders", "details", order._id], order);
      await queryClient.invalidateQueries({
        queryKey: ["owner", "orders", "details", order._id],
      });
      await queryClient.invalidateQueries({ queryKey: ["owner", "dashboard"] });
    },
  });
}

export type OwnerMenuSort = "nameAsc" | "priceLow" | "priceHigh";

export function useOwnerMenuItemsQuery(
  enabled = true,
  params?: {
    search?: string;
    sortBy?: OwnerMenuSort;
  },
) {
  const search = params?.search?.trim() ?? "";
  const sortBy = params?.sortBy ?? "nameAsc";
  const query = new URLSearchParams({
    pageSize: "80",
    sortBy,
    ...(search ? { search } : {}),
  }).toString();

  return useQuery({
    queryKey: ["owner", "menu-items", { search, sortBy }],
    enabled,
    queryFn: async () => {
      const response = await apiGet<OwnerListResponse<OwnerMenuItem>>(
        `/owner/menu-items?${query}`,
      );
      return response.data;
    },
  });
}

export function useUpdateOwnerMenuItemMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      id: string;
      availability: "available" | "unavailable";
    }) => {
      const response = await apiPatch<OwnerMenuItem>(
        `/owner/menu-items/${payload.id}`,
        { availability: payload.availability },
      );
      return response.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["owner", "menu-items"] });
    },
  });
}

export function useOwnerPayoutSummaryQuery(enabled = true) {
  return useQuery({
    queryKey: ["owner", "payouts", "summary"],
    enabled,
    queryFn: async () => {
      const response = await apiGet<OwnerPayoutSummary>("/owner/payouts/summary");
      return response.data;
    },
  });
}

export function useOwnerPlatformContentQuery(enabled = true) {
  return useQuery({
    queryKey: ["public", "content", "owner-app"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const response = await apiGet<OwnerPlatformContent>("/public/content");
      return response.data;
    },
  });
}

export function useRegisterOwnerPushTokenMutation() {
  return useMutation({
    mutationFn: async (body: {
      expoPushToken: string;
      platform: "android" | "ios";
      deviceId?: string;
      appVersion?: string;
    }) => {
      const response = await apiPost<{ registered: boolean }>(
        "/owner/push-tokens",
        body,
      );
      return response.data;
    },
  });
}

export function useUnregisterOwnerPushTokenMutation() {
  return useMutation({
    mutationFn: async (body: { expoPushToken: string }) => {
      const query = encodeURIComponent(body.expoPushToken);
      const response = await apiDelete<{ removed: boolean }>(
        `/owner/push-tokens?expoPushToken=${query}`,
      );
      return response.data;
    },
  });
}
