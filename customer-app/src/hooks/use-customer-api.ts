import { useEffect } from "react";
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiProtectedGet,
  apiProtectedPost,
} from "@/src/lib/api";
import { buildQueryString, compactQueryParams } from "@/src/lib/query-params";
import type {
  CustomerDiscoveryHome,
  CustomerRestaurantDetails,
  DiscoverableRestaurant,
} from "@/src/types/restaurant";
import { useAppBannerStore } from "@/src/store/app-banner-store";
import { useCustomerAuthStore } from "@/src/store/auth-store";
import { buildCartItemKey, useCartStore } from "@/src/store/cart-store";

type NearbyRestaurantsParams = {
  latitude?: number;
  longitude?: number;
  radiusKm: number;
  search?: string;
};

type CustomerSavedLocationResponse = {
  id: string;
  label: string;
  address: string;
  latitude: number;
  longitude: number;
  source: "gps" | "manual" | "saved";
  isDefault?: boolean;
  lastUsedAt?: string | null;
};

type CustomerFavoriteToggleResponse = {
  restaurantId: string;
  isFavorite: boolean;
  favoriteRestaurantIds: string[];
};

type CustomerProfile = {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  notificationSettings?: {
    orderUpdates?: boolean;
    restaurantStatus?: boolean;
    reviewReplies?: boolean;
  };
  accountRequest?: {
    type?: "deactivate" | "delete" | null;
    reason?: string;
    reviewNote?: string;
    reviewedByAdminId?: string | null;
    reviewedByAdminName?: string;
    status?: string;
    requestedAt?: string | null;
    reviewedAt?: string | null;
    history?: {
      action?: string;
      note?: string;
      actorId?: string;
      actorName?: string;
      createdAt?: string | null;
    }[];
  };
  previousPhones?: {
    phone: string;
    changedAt?: string | null;
  }[];
  profileImage?: {
    url?: string;
    publicId?: string;
  };
};

export function useCustomerProfileQuery(enabled = true) {
  const isAuthenticated = useCustomerAuthStore((state) => Boolean(state.accessToken));
  const updateCustomerProfile = useCustomerAuthStore((state) => state.updateCustomerProfile);

  const query = useQuery({
    queryKey: ["customer", "profile"],
    enabled: enabled && isAuthenticated,
    queryFn: async () => {
      const response = await apiProtectedGet<{ customer: CustomerProfile }>("/customer/profile");
      return response.data.customer;
    },
  });

  useEffect(() => {
    if (query.data) {
      updateCustomerProfile(query.data);
    }
  }, [query.data, updateCustomerProfile]);

  return query;
}

type CustomerNotification = {
  id: string;
  type: string;
  title: string;
  description: string;
  path: string;
  campaignId?: string;
  contentType?: "text" | "image" | "image_text" | string;
  imageUrl?: string;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
};

type CustomerNotificationListResponse = {
  items: CustomerNotification[];
  total: number;
  unreadCount: number;
  page: number;
  limit: number;
  hasMore: boolean;
  nextPage: number | null;
};

export type CustomerSupportCaseAttachment = {
  url: string;
  publicId?: string;
  fileName?: string;
  fileType?: string;
};

export type CustomerSupportCaseMessage = {
  id: string;
  senderType: "customer" | "admin";
  senderName: string;
  message: string;
  createdAt: string;
  attachments: CustomerSupportCaseAttachment[];
};

export type CustomerSupportCase = {
  id: string;
  status: "open" | "in_progress" | "resolved" | "closed";
  subject: string;
  createdAt: string;
  updatedAt: string;
  messages: CustomerSupportCaseMessage[];
};

export function useNearbyRestaurantsQuery(params: NearbyRestaurantsParams) {
  const query = buildQueryString(
    compactQueryParams({
      latitude: typeof params.latitude === "number" ? params.latitude : undefined,
      longitude: typeof params.longitude === "number" ? params.longitude : undefined,
      radiusKm: params.radiusKm,
      search: params.search?.trim(),
    })
  );

  return useQuery({
    queryKey: ["customer", "nearby-restaurants", query],
    enabled:
      typeof params.latitude === "number" && typeof params.longitude === "number",
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const response = await apiGet<DiscoverableRestaurant[]>(
        `/customer/restaurants?${query}`
      );
      return response.data;
    },
  });
}

export function useCustomerDiscoveryHomeQuery(params: {
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
}) {
  const query = buildQueryString(
    compactQueryParams({
      latitude: typeof params.latitude === "number" ? params.latitude : undefined,
      longitude: typeof params.longitude === "number" ? params.longitude : undefined,
      radiusKm: typeof params.radiusKm === "number" ? params.radiusKm : undefined,
    })
  );

  return useQuery({
    queryKey: ["customer", "discovery-home", query],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const response = await apiGet<CustomerDiscoveryHome>(
        `/customer/discovery/home${query ? `?${query}` : ""}`
      );
      return response.data;
    },
  });
}

export function useCustomerRestaurantDetailsQuery(params: {
  restaurantId?: string;
  latitude?: number;
  longitude?: number;
}) {
  const query = buildQueryString(
    compactQueryParams({
      latitude: typeof params.latitude === "number" ? params.latitude : undefined,
      longitude: typeof params.longitude === "number" ? params.longitude : undefined,
    })
  );

  return useQuery({
    queryKey: ["customer", "restaurant-details", params.restaurantId, query],
    enabled: Boolean(params.restaurantId),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const response = await apiGet<CustomerRestaurantDetails>(
        `/customer/restaurants/${params.restaurantId}${query ? `?${query}` : ""}`
      );
      return response.data;
    },
  });
}

export function useCustomerSavedLocationsQuery(enabled = true) {
  const isAuthenticated = useCustomerAuthStore((state) => Boolean(state.accessToken));

  return useQuery({
    queryKey: ["customer", "saved-locations"],
    enabled: enabled && isAuthenticated,
    queryFn: async () => {
      const response = await apiProtectedGet<CustomerSavedLocationResponse[]>(
        "/customer/locations"
      );
      return response.data;
    },
  });
}

export function useCustomerFavoriteRestaurantIdsQuery(enabled = true) {
  const isAuthenticated = useCustomerAuthStore((state) => Boolean(state.accessToken));

  return useQuery({
    queryKey: ["customer", "favorite-restaurant-ids"],
    enabled: enabled && isAuthenticated,
    queryFn: async () => {
      const response = await apiProtectedGet<string[]>(
        "/customer/favorites/restaurants"
      );
      return response.data;
    },
  });
}

export function useCustomerFavoriteRestaurantsQuery(params?: {
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
}) {
  const isAuthenticated = useCustomerAuthStore((state) => Boolean(state.accessToken));
  const query = buildQueryString(
    compactQueryParams({
      latitude: typeof params?.latitude === "number" ? params.latitude : undefined,
      longitude: typeof params?.longitude === "number" ? params.longitude : undefined,
      radiusKm: typeof params?.radiusKm === "number" ? params.radiusKm : undefined,
    })
  );

  return useQuery({
    queryKey: ["customer", "favorite-restaurants", query],
    enabled: isAuthenticated,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const response = await apiProtectedGet<DiscoverableRestaurant[]>(
        `/customer/favorites/restaurants/cards${query ? `?${query}` : ""}`
      );
      return response.data;
    },
  });
}

export function useCustomerNotificationsQuery(enabled = true) {
  const isAuthenticated = useCustomerAuthStore((state) => Boolean(state.accessToken));

  return useQuery({
    queryKey: ["customer", "notifications", "summary"],
    enabled: enabled && isAuthenticated,
    queryFn: async () => {
      const response = await apiProtectedGet<CustomerNotificationListResponse>(
        "/customer/notifications?page=1&limit=20"
      );
      return response.data;
    },
  });
}

export function useCustomerNotificationsInfiniteQuery(enabled = true, limit = 20) {
  const isAuthenticated = useCustomerAuthStore((state) => Boolean(state.accessToken));

  return useInfiniteQuery({
    queryKey: ["customer", "notifications", "infinite", limit],
    enabled: enabled && isAuthenticated,
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const response = await apiProtectedGet<CustomerNotificationListResponse>(
        `/customer/notifications?page=${pageParam}&limit=${limit}`
      );
      return response.data;
    },
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextPage : undefined),
  });
}

export function useCustomerLatestSupportCaseQuery(enabled = true) {
  const isAuthenticated = useCustomerAuthStore((state) => Boolean(state.accessToken));

  return useQuery({
    queryKey: ["customer", "support-case", "latest"],
    enabled: enabled && isAuthenticated,
    queryFn: async () => {
      const response = await apiProtectedGet<CustomerSupportCase | null>(
        "/customer/support-cases/latest"
      );
      return response.data;
    },
  });
}

export function useCustomerSupportCaseQuery(caseId?: string, enabled = true) {
  const isAuthenticated = useCustomerAuthStore((state) => Boolean(state.accessToken));

  return useQuery({
    queryKey: ["customer", "support-case", caseId],
    enabled: enabled && isAuthenticated && Boolean(caseId),
    queryFn: async () => {
      const response = await apiProtectedGet<CustomerSupportCase>(
        `/customer/support-cases/${caseId}`
      );
      return response.data;
    },
  });
}

export function useCustomerCreateSupportCaseMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: {
      message: string;
      attachments?: CustomerSupportCaseAttachment[];
    }) => {
      const response = await apiProtectedPost<CustomerSupportCase>(
        "/customer/support-cases",
        body
      );
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["customer", "support-case", "latest"], data);
      queryClient.setQueryData(["customer", "support-case", data.id], data);
    },
  });
}

export function useCustomerSupportCaseMessageMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      supportCaseId: string;
      message: string;
      attachments?: CustomerSupportCaseAttachment[];
    }) => {
      const response = await apiProtectedPost<CustomerSupportCase>(
        `/customer/support-cases/${params.supportCaseId}/messages`,
        {
          message: params.message,
          attachments: params.attachments,
        }
      );
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["customer", "support-case", "latest"], data);
      queryClient.setQueryData(["customer", "support-case", data.id], data);
    },
  });
}

type CartQuoteItemPayload = {
  itemId: string;
  quantity: number;
  selectedVariantOptions?: { groupName: string; optionLabel: string }[];
  selectedAddOnOptions?: { groupName: string; optionLabel: string }[];
};

type OrderSnapshotSelection = {
  groupName?: string;
  optionLabel?: string;
};

type CartQuoteResponse = {
  restaurant: {
    id: string;
    name: string;
  };
  items: {
    itemId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    selectedVariantOptions: { groupName: string; optionLabel: string }[];
    selectedAddOnOptions: { groupName: string; optionLabel: string }[];
  }[];
  pricing: {
    subtotal: number;
    deliveryFee: number;
    discountAmount: number;
    total: number;
  };
  appliedVouchers: {
    id: string;
    code?: string;
    name: string;
    type: string;
    mode: string;
  }[];
};

type BkashInitiateResponse = {
  sessionId: string;
  paymentID: string;
  bkashURL: string;
  amount: number;
  walletNumber: string;
  expiresAt: string;
};

export function useCustomerCartQuoteQuery(params: {
  restaurantId?: string | null;
  items: CartQuoteItemPayload[];
  voucherCode?: string;
  latitude?: number;
  longitude?: number;
}) {
  const itemsKey = JSON.stringify(params.items);

  return useQuery({
    queryKey: [
      "customer",
      "cart-quote",
      params.restaurantId ?? null,
      params.voucherCode ?? null,
      params.latitude ?? null,
      params.longitude ?? null,
      itemsKey,
    ],
    enabled: Boolean(params.restaurantId) && params.items.length > 0,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const response = await apiPost<CartQuoteResponse>("/customer/cart/quote", {
        restaurantId: params.restaurantId,
        items: params.items,
        voucherCode: params.voucherCode,
        latitude: typeof params.latitude === "number" ? params.latitude : undefined,
        longitude: typeof params.longitude === "number" ? params.longitude : undefined,
      });
      return response.data;
    },
  });
}

type CustomerAuthResponse = {
  accessToken: string;
  refreshToken: string;
  customer: CustomerProfile;
};

type CustomerOrderResponse = {
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
    selectedVariantOptions?: OrderSnapshotSelection[];
    selectedAddOnOptions?: OrderSnapshotSelection[];
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
  customerReview?: {
    id: string;
    rating: number;
    comment?: string;
    createdAt?: string;
    ownerReply?: {
      message: string;
      createdAt?: string | null;
      updatedAt?: string | null;
    } | null;
  } | null;
  hasCustomerReview?: boolean;
  createdAt: string;
};

type CustomerReorderInput = Pick<
  CustomerOrderResponse,
  "_id" | "orderNumber" | "restaurantId" | "itemsSnapshot"
>;

type CustomerReorderResult =
  | {
      status: "conflict";
      incomingRestaurantName: string;
      currentRestaurantName: string;
      previewItemName: string;
    }
  | {
      status: "empty";
      skippedCount: number;
      skippedNames: string[];
    }
  | {
      status: "success";
      restaurantId: string;
      restaurantName: string;
      addedItemCount: number;
      skippedCount: number;
      skippedNames: string[];
    };

function upsertCustomerOrderList(
  current: CustomerOrderResponse[] | undefined,
  nextOrder: CustomerOrderResponse
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

type CustomerPhoneStartResponse = {
  flow: "password" | "otp";
  phone: string;
  verificationSessionId?: string;
  expiresInSeconds?: number;
  customer?: {
    fullName?: string;
    email?: string;
  } | null;
};

export function useCustomerPhoneStartMutation() {
  return useMutation({
    mutationFn: async (params: { phone: string }) => {
      const response = await apiPost<CustomerPhoneStartResponse>(
        "/customer/auth/phone/start",
        params
      );
      return response.data;
    },
  });
}

export function useCustomerPasswordSigninMutation() {
  const setSession = useCustomerAuthStore((state) => state.setSession);

  return useMutation({
    mutationFn: async (params: { phone: string; password: string }) => {
      const response = await apiPost<CustomerAuthResponse>(
        "/customer/auth/phone/password",
        params
      );
      return response.data;
    },
    onSuccess: (data) => {
      setSession({
        customer: data.customer,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      });
    },
  });
}

export function useCustomerPhoneOtpVerifyMutation() {
  return useMutation({
    mutationFn: async (params: {
      verificationSessionId: string;
      otpCode: string;
    }) => {
      const response = await apiPost<{
        verificationSessionId: string;
        phone: string;
        expiresInSeconds: number;
      }>("/customer/auth/phone/otp/verify", params);
      return response.data;
    },
  });
}

export function useCustomerPhoneVerifyMutation() {
  const setSession = useCustomerAuthStore((state) => state.setSession);

  return useMutation({
    mutationFn: async (params: {
      verificationSessionId: string;
      fullName?: string;
      email?: string;
      password?: string;
    }) => {
      const response = await apiPost<CustomerAuthResponse>(
        "/customer/auth/phone/verify",
        params
      );
      return response.data;
    },
    onSuccess: (data) => {
      setSession({
        customer: data.customer,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      });
    },
  });
}

export function useCustomerPhoneChangeStartMutation() {
  return useMutation({
    mutationFn: async (params: { phone: string }) => {
      const response = await apiProtectedPost<{
        verificationSessionId: string;
        expiresInSeconds: number;
      }>("/customer/auth/phone-change/start", params);
      return response.data;
    },
  });
}

export function useCustomerPhoneChangeVerifyMutation() {
  const updateCustomerProfile = useCustomerAuthStore((state) => state.updateCustomerProfile);

  return useMutation({
    mutationFn: async (params: {
      verificationSessionId: string;
      otpCode: string;
    }) => {
      const response = await apiProtectedPost<{
        customer: CustomerProfile;
      }>("/customer/auth/phone-change/verify", params);
      return response.data;
    },
    onSuccess: (data) => {
      updateCustomerProfile(data.customer);
    },
  });
}

export function useCustomerProfileUpdateMutation() {
  const queryClient = useQueryClient();
  const updateCustomerProfile = useCustomerAuthStore((state) => state.updateCustomerProfile);

  return useMutation({
    mutationFn: async (params: {
      fullName?: string;
      email?: string;
      profileImage?: {
        url?: string;
        publicId?: string;
      };
      notificationSettings?: {
        orderUpdates?: boolean;
        restaurantStatus?: boolean;
        reviewReplies?: boolean;
      };
    }) => {
      const response = await apiPatch<{
        customer: CustomerProfile;
      }>("/customer/profile", params);
      return response.data;
    },
    onSuccess: (data) => {
      updateCustomerProfile(data.customer);
      queryClient.setQueryData(["customer", "profile"], data.customer);
      useAppBannerStore.getState().showBanner({
        title: "Profile updated",
        description: "Your account details were saved successfully.",
        tone: "success",
      });
    },
  });
}

export function useCustomerMediaUploadSignatureMutation() {
  return useMutation({
    mutationFn: async (body: { folder: string; resourceType?: string }) => {
      const response = await apiProtectedPost<{
        cloudName: string;
        folder: string;
        timestamp: number;
        signature: string;
        apiKey: string;
        resourceType: string;
      }>("/media/upload-signature", body);
      return response.data;
    },
  });
}

export function useCustomerAccountRequestMutation() {
  const updateCustomerProfile = useCustomerAuthStore((state) => state.updateCustomerProfile);

  return useMutation({
    mutationFn: async (params: {
      type: "deactivate" | "delete";
      reason?: string;
    }) => {
      const response = await apiProtectedPost<{
        customer: CustomerProfile;
      }>("/customer/account-request", params);
      return response.data;
    },
    onSuccess: (data) => {
      updateCustomerProfile(data.customer);
      useAppBannerStore.getState().showBanner({
        title: "Request submitted",
        description: "Your account request has been recorded and will be reviewed.",
        tone: "success",
      });
    },
  });
}

export function useCustomerCancelAccountRequestMutation() {
  const updateCustomerProfile = useCustomerAuthStore((state) => state.updateCustomerProfile);

  return useMutation({
    mutationFn: async () => {
      const response = await apiDelete<{
        customer: CustomerProfile;
      }>("/customer/account-request");
      return response.data;
    },
    onSuccess: (data) => {
      updateCustomerProfile(data.customer);
      useAppBannerStore.getState().showBanner({
        title: "Request cancelled",
        description: "Your pending account request has been removed.",
        tone: "success",
      });
    },
  });
}

export function useCustomerOrdersQuery(enabled = true) {
  const isAuthenticated = useCustomerAuthStore((state) => Boolean(state.accessToken));

  return useQuery({
    queryKey: ["customer", "orders"],
    enabled: enabled && isAuthenticated,
    queryFn: async () => {
      const response = await apiProtectedGet<CustomerOrderResponse[]>(
        "/customer/orders"
      );
      return response.data;
    },
  });
}

export function useCustomerOrderDetailsQuery(orderId?: string) {
  const isAuthenticated = useCustomerAuthStore((state) => Boolean(state.accessToken));

  return useQuery({
    queryKey: ["customer", "orders", orderId],
    enabled: Boolean(orderId) && isAuthenticated,
    queryFn: async () => {
      const response = await apiProtectedGet<CustomerOrderResponse>(
        `/customer/orders/${orderId}`
      );
      return response.data;
    },
  });
}

export function useCustomerPlaceOrderMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: {
      restaurantId: string;
      items: CartQuoteItemPayload[];
      paymentMethod: string;
      voucherCode?: string;
      paymentReference?: {
        provider?: "Bkash";
        bkashSessionId?: string;
        walletNumber?: string;
      };
      note?: string;
      deliveryAddress: {
        label: string;
        addressLine: string;
        latitude?: number | null;
        longitude?: number | null;
      };
    }) => {
      const response = await apiProtectedPost<{
        order: CustomerOrderResponse;
        quote: CartQuoteResponse;
      }>("/customer/orders", body);
      return response.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["customer", "orders"] });
    },
  });
}

export function useBkashInitiateMutation() {
  return useMutation({
    mutationFn: async (body: {
      restaurantId: string;
      items: CartQuoteItemPayload[];
      voucherCode?: string;
      walletNumber: string;
      latitude?: number;
      longitude?: number;
    }) => {
      const response = await apiProtectedPost<BkashInitiateResponse>(
        "/customer/payments/bkash/initiate",
        body
      );
      return response.data;
    },
  });
}

export function useCustomerSaveLocationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: {
      label: string;
      address: string;
      latitude: number;
      longitude: number;
      source?: "gps" | "manual" | "saved";
      isDefault?: boolean;
    }) => {
      const response = await apiProtectedPost<CustomerSavedLocationResponse[]>(
        "/customer/locations",
        body
      );
      return response.data;
    },
    onSuccess: async (locations) => {
      queryClient.setQueryData(["customer", "saved-locations"], locations);
    },
  });
}

export function useCustomerToggleFavoriteRestaurantMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (restaurantId: string) => {
      const response = await apiProtectedPost<CustomerFavoriteToggleResponse>(
        `/customer/favorites/restaurants/${restaurantId}/toggle`
      );
      return response.data;
    },
    onMutate: async (restaurantId) => {
      const queryKey = ["customer", "favorite-restaurant-ids"] as const;
      await queryClient.cancelQueries({ queryKey });
      const previousFavoriteIds =
        queryClient.getQueryData<string[]>(queryKey) ?? [];

      const nextFavoriteIds = previousFavoriteIds.includes(restaurantId)
        ? previousFavoriteIds.filter((id) => id !== restaurantId)
        : [...previousFavoriteIds, restaurantId];

      queryClient.setQueryData(queryKey, nextFavoriteIds);

      return { previousFavoriteIds };
    },
    onError: (_error, _restaurantId, context) => {
      if (context?.previousFavoriteIds) {
        queryClient.setQueryData(
          ["customer", "favorite-restaurant-ids"],
          context.previousFavoriteIds
        );
      }
    },
    onSuccess: (data) => {
      queryClient.setQueryData(
        ["customer", "favorite-restaurant-ids"],
        data.favoriteRestaurantIds
      );
    },
  });
}

export function useCustomerSetDefaultLocationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (locationId: string) => {
      const response = await apiPatch<CustomerSavedLocationResponse[]>(
        `/customer/locations/${locationId}/default`,
        {}
      );
      return response.data;
    },
    onSuccess: async (locations) => {
      queryClient.setQueryData(["customer", "saved-locations"], locations);
    },
  });
}

export function useCustomerUpdateLocationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      locationId: string;
      label?: string;
      address?: string;
      latitude?: number;
      longitude?: number;
      source?: "gps" | "manual" | "saved";
      isDefault?: boolean;
    }) => {
      const response = await apiPatch<CustomerSavedLocationResponse[]>(
        `/customer/locations/${params.locationId}`,
        {
          label: params.label,
          address: params.address,
          latitude: params.latitude,
          longitude: params.longitude,
          source: params.source,
          isDefault: params.isDefault,
        }
      );
      return response.data;
    },
    onSuccess: async (locations) => {
      queryClient.setQueryData(["customer", "saved-locations"], locations);
    },
  });
}

export function useCustomerTouchLocationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (locationId: string) => {
      const response = await apiPatch<CustomerSavedLocationResponse[]>(
        `/customer/locations/${locationId}/touch`,
        { lastUsed: true }
      );
      return response.data;
    },
    onSuccess: async (locations) => {
      queryClient.setQueryData(["customer", "saved-locations"], locations);
    },
  });
}

export function useCustomerDeleteLocationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (locationId: string) => {
      const response = await apiDelete<CustomerSavedLocationResponse[]>(
        `/customer/locations/${locationId}`
      );
      return response.data;
    },
    onSuccess: async (locations) => {
      queryClient.setQueryData(["customer", "saved-locations"], locations);
    },
  });
}

export function useCustomerCancelOrderMutation(orderId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body?: { reason?: string }) => {
      if (!orderId) {
        throw new Error("Order id is required to cancel the order.");
      }

      const response = await apiProtectedPost<CustomerOrderResponse>(
        `/customer/orders/${orderId}/cancel`,
        body ?? {}
      );
      return response.data;
    },
    onSuccess: async (order) => {
      queryClient.setQueryData<CustomerOrderResponse[]>(["customer", "orders"], (current) =>
        upsertCustomerOrderList(current, order)
      );
      queryClient.setQueryData(["customer", "orders", orderId], order);
      await queryClient.invalidateQueries({ queryKey: ["customer", "orders"] });
    },
  });
}

export function useCustomerReviewMutation(orderId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: { rating: number; comment?: string }) => {
      if (!orderId) {
        throw new Error("Order id is required to submit a review.");
      }

      const response = await apiProtectedPost<{
        _id: string;
        restaurantId: string;
        customerId: string;
        orderId: string;
        rating: number;
        comment: string;
        ownerReply?: {
          message?: string;
          createdAt?: string | null;
          updatedAt?: string | null;
        };
        createdAt: string;
      }>(`/customer/orders/${orderId}/review`, body);
      return response.data;
    },
    onSuccess: async () => {
      useAppBannerStore.getState().showBanner({
        title: "Review submitted",
        description: "Thanks for sharing your feedback. The restaurant can now review it.",
        tone: "success",
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["customer", "orders"] }),
        queryClient.invalidateQueries({ queryKey: ["customer", "orders", orderId] }),
      ]);
    },
  });
}

function sanitizeSelections(selections: OrderSnapshotSelection[] | undefined) {
  return (selections ?? []).filter(
    (selection): selection is { groupName: string; optionLabel: string } =>
      Boolean(selection.groupName?.trim()) && Boolean(selection.optionLabel?.trim())
  );
}

function isSelectionCountValid(
  count: number,
  group: { minSelect?: number; maxSelect?: number }
) {
  const minSelect = group.minSelect ?? 0;
  const maxSelect = group.maxSelect ?? Number.POSITIVE_INFINITY;
  return count >= minSelect && count <= maxSelect;
}

export function useCustomerReorderMutation() {
  const setCart = useCartStore((state) => state.setCart);
  const setReorderContext = useCartStore((state) => state.setReorderContext);

  return useMutation({
    mutationFn: async (params: {
      order: CustomerReorderInput;
      forceReplace?: boolean;
    }): Promise<CustomerReorderResult> => {
      const restaurantId = params.order.restaurantId;
      const snapshotItems = params.order.itemsSnapshot ?? [];

      if (!restaurantId || !snapshotItems.length) {
        return { status: "empty", skippedCount: snapshotItems.length, skippedNames: [] };
      }

      const detailsResponse = await apiGet<CustomerRestaurantDetails>(
        `/customer/restaurants/${restaurantId}`
      );
      const details = detailsResponse.data;

      const menuItemMap = new Map(details.menuItems.map((item) => [item._id, item]));
      const imageMap = new Map(
        details.menuItems.map((item) => [item._id, item.images?.[0]?.url ?? null] as const)
      );

      const skippedNames: string[] = [];
      const reorderCandidates: (CartQuoteItemPayload & {
        name: string;
        imageUrl?: string | null;
      })[] = [];

      for (const snapshotItem of snapshotItems) {
        const itemId = snapshotItem.itemId?.trim();
        const quantity = Math.max(0, snapshotItem.quantity ?? 0);

        if (!itemId || quantity <= 0) {
          continue;
        }

        const menuItem = menuItemMap.get(itemId);
        if (!menuItem || menuItem.availability === "unavailable") {
          skippedNames.push(snapshotItem.name?.trim() || "Menu item");
          continue;
        }

        const selectedVariantOptions = sanitizeSelections(snapshotItem.selectedVariantOptions);
        const selectedAddOnOptions = sanitizeSelections(snapshotItem.selectedAddOnOptions);

        const validVariantSelections = selectedVariantOptions.filter((selection) => {
          const group = menuItem.variants?.find((entry) => entry.name === selection.groupName);
          return Boolean(
            group?.options.some((option) => option.label === selection.optionLabel)
          );
        });

        const validAddOnSelections = selectedAddOnOptions.filter((selection) => {
          const group = menuItem.addOnGroups?.find((entry) => entry.name === selection.groupName);
          return Boolean(
            group?.options.some((option) => option.label === selection.optionLabel)
          );
        });

        const hasInvalidVariantGroup = (menuItem.variants ?? []).some((group) => {
          const groupCount = validVariantSelections.filter(
            (selection) => selection.groupName === group.name
          ).length;
          return !isSelectionCountValid(groupCount, group);
        });

        const hasInvalidAddOnGroup = (menuItem.addOnGroups ?? []).some((group) => {
          const groupCount = validAddOnSelections.filter(
            (selection) => selection.groupName === group.name
          ).length;
          return !isSelectionCountValid(groupCount, group);
        });

        if (hasInvalidVariantGroup || hasInvalidAddOnGroup) {
          skippedNames.push(snapshotItem.name?.trim() || menuItem.name);
          continue;
        }

        reorderCandidates.push({
          itemId: menuItem._id,
          name: menuItem.name,
          quantity,
          imageUrl: imageMap.get(menuItem._id) ?? null,
          selectedVariantOptions: validVariantSelections,
          selectedAddOnOptions: validAddOnSelections,
        });
      }

      if (!reorderCandidates.length) {
        return {
          status: "empty",
          skippedCount: skippedNames.length,
          skippedNames,
        };
      }

      const currentCart = useCartStore.getState();
      if (
        !params.forceReplace &&
        currentCart.restaurant &&
        currentCart.restaurant.restaurantId !== restaurantId &&
        currentCart.items.length > 0
      ) {
        return {
          status: "conflict",
          incomingRestaurantName: details.restaurant.name,
          currentRestaurantName: currentCart.restaurant.restaurantName,
          previewItemName: reorderCandidates[0]?.name ?? "Selected item",
        };
      }

      const mergedItems = new Map<
        string,
        CartQuoteItemPayload & { name: string; imageUrl?: string | null }
      >();

      const seedItems =
        !params.forceReplace &&
        currentCart.restaurant?.restaurantId === restaurantId &&
        currentCart.items.length > 0
          ? currentCart.items.map((item) => ({
              itemId: item.itemId,
              name: item.name,
              imageUrl: item.imageUrl ?? null,
              quantity: item.quantity,
              selectedVariantOptions: item.selectedVariantOptions,
              selectedAddOnOptions: item.selectedAddOnOptions,
            }))
          : [];

      for (const candidate of [...seedItems, ...reorderCandidates]) {
        const key = buildCartItemKey({
          itemId: candidate.itemId,
          name: candidate.name,
          imageUrl: candidate.imageUrl ?? null,
          quantity: 1,
          unitPrice: 0,
          selectedVariantOptions: candidate.selectedVariantOptions ?? [],
          selectedAddOnOptions: candidate.selectedAddOnOptions ?? [],
        });

        const existing = mergedItems.get(key);
        if (existing) {
          existing.quantity += candidate.quantity;
        } else {
          mergedItems.set(key, { ...candidate });
        }
      }

      const quoteResponse = await apiPost<CartQuoteResponse>("/customer/cart/quote", {
        restaurantId,
        items: Array.from(mergedItems.values()).map((item) => ({
          itemId: item.itemId,
          quantity: item.quantity,
          selectedVariantOptions: item.selectedVariantOptions ?? [],
          selectedAddOnOptions: item.selectedAddOnOptions ?? [],
        })),
      });

      const quotedItems = quoteResponse.data.items;
      const mergedImageMap = new Map<string, string | null>();

      for (const item of currentCart.items) {
        mergedImageMap.set(
          buildCartItemKey({
            itemId: item.itemId,
            name: item.name,
            imageUrl: item.imageUrl ?? null,
            quantity: 1,
            unitPrice: 0,
            selectedVariantOptions: item.selectedVariantOptions,
            selectedAddOnOptions: item.selectedAddOnOptions,
          }),
          item.imageUrl ?? null
        );
      }

      for (const item of reorderCandidates) {
        mergedImageMap.set(
          buildCartItemKey({
            itemId: item.itemId,
            name: item.name,
            imageUrl: item.imageUrl ?? null,
            quantity: 1,
            unitPrice: 0,
            selectedVariantOptions: item.selectedVariantOptions ?? [],
            selectedAddOnOptions: item.selectedAddOnOptions ?? [],
          }),
          item.imageUrl ?? null
        );
      }

      setCart({
        restaurant: {
          restaurantId: quoteResponse.data.restaurant.id,
          restaurantName: quoteResponse.data.restaurant.name,
        },
        items: quotedItems.map((item) => ({
          itemId: item.itemId,
          name: item.name,
          imageUrl:
            mergedImageMap.get(
              buildCartItemKey({
                itemId: item.itemId,
                name: item.name,
                imageUrl: null,
                quantity: 1,
                unitPrice: 0,
                selectedVariantOptions: item.selectedVariantOptions,
                selectedAddOnOptions: item.selectedAddOnOptions,
              })
            ) ?? null,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          selectedVariantOptions: item.selectedVariantOptions,
          selectedAddOnOptions: item.selectedAddOnOptions,
        })),
      });
      setReorderContext({
        orderId: params.order._id,
        orderNumber: params.order.orderNumber,
      });

      return {
        status: "success",
        restaurantId: quoteResponse.data.restaurant.id,
        restaurantName: quoteResponse.data.restaurant.name,
        addedItemCount: reorderCandidates.length,
        skippedCount: skippedNames.length,
        skippedNames,
      };
    },
  });
}

export function useCustomerMarkNotificationReadMutation() {
    const queryClient = useQueryClient();
  
    return useMutation({
      mutationFn: async (notificationId: string) => {
      const response = await apiPatch<CustomerNotificationListResponse>(
        `/customer/notifications/${notificationId}/read`,
        {}
      );
        return response.data;
      },
      onSuccess: async () => {
        queryClient.invalidateQueries({ queryKey: ["customer", "notifications"] });
      },
    });
  }

export function useCustomerMarkAllNotificationsReadMutation() {
  const queryClient = useQueryClient();

  return useMutation({
      mutationFn: async () => {
        const response = await apiPatch<CustomerNotificationListResponse>(
        "/customer/notifications/read-all",
        {}
      );
        return response.data;
      },
      onSuccess: async () => {
        queryClient.invalidateQueries({ queryKey: ["customer", "notifications"] });
      },
    });
  }

export function useCustomerLogoutMutation() {
  const clearSession = useCustomerAuthStore((state) => state.clearSession);
  const refreshToken = useCustomerAuthStore((state) => state.refreshToken);

  return useMutation({
    mutationFn: async () => {
      if (!refreshToken) return null;
      const response = await apiPost<{ revoked: boolean }>("/customer/auth/logout", {
        refreshToken,
      });
      return response.data;
    },
    onSettled: () => {
      clearSession();
    },
  });
}

export function useRegisterCustomerPushTokenMutation() {
  return useMutation({
    mutationFn: async (body: {
      expoPushToken: string;
      platform: "android" | "ios";
      deviceId?: string;
      appVersion?: string;
    }) => {
      const response = await apiProtectedPost<{ registered: boolean }>(
        "/customer/push-tokens",
        body
      );
      return response.data;
    },
  });
}

export function useUnregisterCustomerPushTokenMutation() {
  return useMutation({
    mutationFn: async (body: { expoPushToken: string }) => {
      const response = await apiDelete<{ removed: boolean }>(
        `/customer/push-tokens?expoPushToken=${encodeURIComponent(body.expoPushToken)}`
      );
      return response.data;
    },
  });
}
