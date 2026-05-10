import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { WebView } from "react-native-webview";

import { useCustomerPlaceOrderMutation } from "@/src/hooks/use-customer-api";
import { getApiBaseUrl } from "@/src/lib/api";
import { useCartStore } from "@/src/store/cart-store";
import { palette } from "@/src/theme/palette";

type CartQuoteItemPayload = {
  itemId: string;
  quantity: number;
  selectedVariantOptions?: { groupName: string; optionLabel: string }[];
  selectedAddOnOptions?: { groupName: string; optionLabel: string }[];
};

function isCartQuoteItemPayload(value: unknown): value is CartQuoteItemPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.itemId === "string" &&
    candidate.itemId.length > 0 &&
    typeof candidate.quantity === "number" &&
    Number.isFinite(candidate.quantity) &&
    candidate.quantity > 0
  );
}

export default function BkashPaymentScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    url?: string;
    sessionId?: string;
    walletNumber?: string;
    restaurantId?: string;
    voucherCode?: string;
    deliveryLabel?: string;
    deliveryAddressLine?: string;
    deliveryLatitude?: string;
    deliveryLongitude?: string;
    cartPayload?: string;
  }>();
  const [loadError, setLoadError] = useState("");
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [callbackHandled, setCallbackHandled] = useState(false);
  const placeOrderMutation = useCustomerPlaceOrderMutation();
  const clearCart = useCartStore((state) => state.clearCart);

  const paymentUrl = useMemo(
    () => (typeof params.url === "string" ? params.url : ""),
    [params.url]
  );
  const bkashReturnPrefix = useMemo(
    () => `${getApiBaseUrl()}/customer/payments/bkash/return`,
    []
  );

  useEffect(() => {
    if (!callbackUrl || paymentProcessing || callbackHandled) {
      return;
    }

    const callbackParams = Linking.parse(callbackUrl).queryParams ?? {};
    const status = typeof callbackParams.status === "string" ? callbackParams.status : "";

    if (!status) {
      return;
    }

    if (status !== "success") {
      setCallbackHandled(true);
      setLoadError(
        status === "cancelled"
          ? "You cancelled the bKash payment."
          : status === "expired"
            ? "This bKash session expired."
            : "bKash could not confirm the payment."
      );
      return;
    }

    const rawCartPayload =
      typeof params.cartPayload === "string" ? params.cartPayload : "";
    let parsedCartPayload: CartQuoteItemPayload[] = [];

    try {
      const decodedPayload = rawCartPayload
        ? JSON.parse(decodeURIComponent(rawCartPayload))
        : [];

      if (!Array.isArray(decodedPayload) || !decodedPayload.every(isCartQuoteItemPayload)) {
        setLoadError("Payment succeeded, but the order details could not be restored.");
        return;
      }

      parsedCartPayload = decodedPayload;
    } catch {
      setLoadError("Payment succeeded, but the order details could not be restored.");
      return;
    }

    if (
      !params.restaurantId ||
      !params.deliveryLabel ||
      !params.deliveryAddressLine ||
      !parsedCartPayload.length
    ) {
      setLoadError("Payment succeeded, but the order data is incomplete.");
      return;
    }

    const run = async () => {
      try {
        setPaymentProcessing(true);
        setCallbackHandled(true);

        const response = await placeOrderMutation.mutateAsync({
          restaurantId: params.restaurantId as string,
          paymentMethod: "Bkash",
          voucherCode:
            typeof params.voucherCode === "string" && params.voucherCode
              ? params.voucherCode
              : undefined,
          paymentReference: {
            provider: "Bkash",
            bkashSessionId:
              typeof callbackParams.sessionId === "string"
                ? callbackParams.sessionId
                : typeof params.sessionId === "string"
                  ? params.sessionId
                  : undefined,
            walletNumber:
              typeof callbackParams.walletNumber === "string"
                ? callbackParams.walletNumber
                : typeof params.walletNumber === "string"
                  ? params.walletNumber
                  : undefined,
          },
          items: parsedCartPayload,
          deliveryAddress: {
            label: params.deliveryLabel as string,
            addressLine: params.deliveryAddressLine as string,
            latitude:
              typeof params.deliveryLatitude === "string" && params.deliveryLatitude
                ? Number(params.deliveryLatitude)
                : undefined,
            longitude:
              typeof params.deliveryLongitude === "string" && params.deliveryLongitude
                ? Number(params.deliveryLongitude)
                : undefined,
          },
        });

        clearCart();
        router.replace({
          pathname: "/orders/[orderId]",
          params: {
            orderId: response.order._id,
            justPlaced: "1",
          },
        });
      } catch (error) {
        setPaymentProcessing(false);
      setLoadError(
          error instanceof Error
            ? error.message
            : "Payment succeeded, but the order could not be placed."
        );
      }
    };

    void run();
  }, [
    callbackUrl,
    clearCart,
    params.cartPayload,
    params.deliveryAddressLine,
    params.deliveryLabel,
    params.deliveryLatitude,
    params.deliveryLongitude,
    params.restaurantId,
    params.sessionId,
    params.voucherCode,
    params.walletNumber,
    callbackHandled,
    paymentProcessing,
    placeOrderMutation,
    router,
  ]);

  if (!paymentUrl) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <StatusBar style="dark" />
        <View style={styles.emptyState}>
          <Pressable style={styles.backButton} onPress={() => router.replace("/checkout")}>
            <Ionicons name="chevron-back" size={20} color={palette.foreground} />
          </Pressable>
          <Text style={styles.errorText}>bKash session unavailable.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <StatusBar style="dark" />
      <View style={styles.root}>
        <Pressable
          style={[styles.backButton, { top: 10 + insets.top }]}
          onPress={() => router.back()}
        >
          <Ionicons name="chevron-back" size={20} color={palette.foreground} />
        </Pressable>

        <View style={[styles.brandPill, { top: 10 + insets.top, right: 16 }]}>
          <Text style={styles.brandPillText}>bKash sandbox</Text>
        </View>

        <View style={[styles.webviewFrame, { marginTop: 66 + insets.top, marginBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.webviewWrap}>
          {paymentProcessing ? (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color={palette.secondary} />
            </View>
          ) : null}

          <WebView
            source={{ uri: paymentUrl }}
            startInLoadingState
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            javaScriptEnabled
            domStorageEnabled
            onShouldStartLoadWithRequest={(request) => {
              if (request.url.startsWith(bkashReturnPrefix) && request.url.includes("status=")) {
                setCallbackUrl(request.url);
                return false;
              }

              return true;
            }}
            onNavigationStateChange={(state) => {
              if (state.url.startsWith(bkashReturnPrefix) && state.url.includes("status=")) {
                setCallbackUrl(state.url);
              }
            }}
            onError={() => {
              setLoadError("Could not load the bKash sandbox.");
            }}
            renderLoading={() => (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="large" color={palette.secondary} />
              </View>
            )}
          />
          </View>
        </View>

        {loadError ? (
          <View style={[styles.bottomNotice, { bottom: Math.max(insets.bottom, 12) }]}>
            <Text style={styles.bottomNoticeText}>{loadError}</Text>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.background,
  },
  root: {
    flex: 1,
    backgroundColor: palette.background,
  },
  backButton: {
    position: "absolute",
    left: 16,
    zIndex: 2,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surface,
    shadowColor: palette.shadow,
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  brandPill: {
    position: "absolute",
    zIndex: 2,
    minHeight: 42,
    paddingHorizontal: 14,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFE7F1",
    shadowColor: palette.shadow,
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  brandPillText: {
    fontSize: 12,
    fontWeight: "800",
    color: palette.secondary,
  },
  webviewFrame: {
    flex: 1,
    marginHorizontal: 16,
    borderRadius: 26,
    backgroundColor: palette.surface,
    overflow: "hidden",
    shadowColor: palette.shadow,
    shadowOpacity: 0.16,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
    borderWidth: 1,
    borderColor: "#F0E3EA",
  },
  webviewWrap: {
    flex: 1,
    backgroundColor: palette.surface,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surface,
    zIndex: 1,
  },
  bottomNotice: {
    position: "absolute",
    left: 16,
    right: 16,
    borderRadius: 18,
    backgroundColor: palette.surface,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: palette.shadow,
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  bottomNoticeText: {
    fontSize: 13,
    lineHeight: 18,
    color: palette.foreground,
    textAlign: "center",
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    paddingHorizontal: 24,
  },
  errorText: {
    fontSize: 14,
    lineHeight: 20,
    color: palette.foreground,
    textAlign: "center",
  },
});
