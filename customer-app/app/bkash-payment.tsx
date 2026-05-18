import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { WebView } from "react-native-webview";

import { useCustomerPlaceOrderMutation } from "@/src/hooks/use-customer-api";
import { trackCustomerEvent } from "@/src/lib/analytics";
import { getApiBaseUrl } from "@/src/lib/api";
import {
  clearBkashPaymentDraft,
  getBkashPaymentDraft,
  type BkashPaymentDraft,
} from "@/src/lib/bkash-payment-draft";
import { useCartStore } from "@/src/store/cart-store";
import { palette } from "@/src/theme/palette";

function isTrustedBkashPaymentUrl(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      (hostname === "bka.sh" ||
        hostname.endsWith(".bka.sh") ||
        hostname === "bkash.com" ||
        hostname.endsWith(".bkash.com"))
    );
  } catch {
    return false;
  }
}

export default function BkashPaymentScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    sessionId?: string;
  }>();
  const [loadError, setLoadError] = useState("");
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [callbackHandled, setCallbackHandled] = useState(false);
  const [draft, setDraft] = useState<BkashPaymentDraft | null>(null);
  const [isDraftLoading, setIsDraftLoading] = useState(true);
  const [canRetryOrderCreation, setCanRetryOrderCreation] = useState(false);
  const placeOrderMutation = useCustomerPlaceOrderMutation();
  const clearCart = useCartStore((state) => state.clearCart);
  const isMountedRef = useRef(true);
  const hasNavigatedRef = useRef(false);

  const paymentUrl = draft?.paymentUrl ?? "";
  const bkashReturnPrefix = useMemo(
    () => `${getApiBaseUrl()}/customer/payments/bkash/return`,
    []
  );

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!paymentProcessing) {
      return;
    }

    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => true,
    );

    return () => subscription.remove();
  }, [paymentProcessing]);

  useEffect(() => {
    const sessionId = typeof params.sessionId === "string" ? params.sessionId : "";
    if (!sessionId) {
      setLoadError("bKash session unavailable.");
      setIsDraftLoading(false);
      return;
    }

    let isMounted = true;
    void getBkashPaymentDraft(sessionId).then((nextDraft) => {
      if (!isMounted) return;

      if (!nextDraft) {
        setLoadError("bKash session unavailable. Please start payment again.");
      } else if (!isTrustedBkashPaymentUrl(nextDraft.paymentUrl)) {
        setLoadError("This bKash payment link could not be verified.");
      } else {
        setDraft(nextDraft);
      }

      setIsDraftLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, [params.sessionId]);

  useEffect(() => {
    if (!callbackUrl || !draft || paymentProcessing || callbackHandled) {
      return;
    }

    setCanRetryOrderCreation(false);
    const callbackParams = Linking.parse(callbackUrl).queryParams ?? {};
    const status = typeof callbackParams.status === "string" ? callbackParams.status : "";

    if (!status) {
      return;
    }

    if (status !== "success") {
      setCallbackHandled(true);
      void trackCustomerEvent({
        eventType: status === "cancelled" ? "payment_cancelled" : "payment_failed",
        path: "/bkash-payment",
        screenName: "bkash-payment",
        entityType: "payment",
        entityId:
          typeof callbackParams.paymentID === "string" ? callbackParams.paymentID : "",
        metadata: {
          provider: "Bkash",
          status,
          sessionId:
            typeof callbackParams.sessionId === "string"
              ? callbackParams.sessionId
              : draft.sessionId,
          restaurantId: draft.restaurantId,
        },
      });
      void clearBkashPaymentDraft(draft.sessionId).catch(() => undefined);
      if (!isMountedRef.current) return;

      setLoadError(
        status === "cancelled"
          ? "You cancelled the bKash payment."
          : status === "expired"
            ? "This bKash session expired."
            : "bKash could not confirm the payment."
      );
      return;
    }

    if (typeof callbackParams.orderId === "string" && callbackParams.orderId) {
      setCallbackHandled(true);
      void clearBkashPaymentDraft(draft.sessionId).catch(() => undefined);
      clearCart();
      if (!isMountedRef.current || hasNavigatedRef.current) return;

      hasNavigatedRef.current = true;
      router.replace({
        pathname: "/orders/[orderId]",
        params: {
          orderId: callbackParams.orderId,
          justPlaced: "1",
        },
      });
      return;
    }

    const run = async () => {
      try {
        if (!isMountedRef.current) return;

        setPaymentProcessing(true);
        setCallbackHandled(true);
        void trackCustomerEvent({
          eventType: "payment_completed",
          path: "/bkash-payment",
          screenName: "bkash-payment",
          entityType: "payment",
          entityId:
            typeof callbackParams.paymentID === "string"
              ? callbackParams.paymentID
              : draft.sessionId,
          metadata: {
            provider: "Bkash",
            status: "success",
            sessionId:
              typeof callbackParams.sessionId === "string"
                ? callbackParams.sessionId
                : draft.sessionId,
            restaurantId: draft.restaurantId,
          },
        });

        const response = await placeOrderMutation.mutateAsync({
          restaurantId: draft.restaurantId,
          clientOrderId: draft.clientOrderId,
          paymentMethod: "Bkash",
          voucherCode: draft.voucherCode || undefined,
          paymentReference: {
            provider: "Bkash",
            bkashSessionId:
              typeof callbackParams.sessionId === "string"
                ? callbackParams.sessionId
                : draft.sessionId,
            walletNumber:
              typeof callbackParams.walletNumber === "string"
                ? callbackParams.walletNumber
                : draft.walletNumber,
          },
          items: draft.items,
          deliveryAddress: draft.deliveryAddress,
        });

        void trackCustomerEvent({
          eventType: "order_created",
          path: "/bkash-payment",
          screenName: "bkash-payment",
          entityType: "order",
          entityId: response.order._id,
          metadata: {
            paymentMethod: "Bkash",
            provider: "Bkash",
            restaurantId: draft.restaurantId,
            voucherApplied: Boolean(draft.voucherCode),
          },
        });

        await clearBkashPaymentDraft(draft.sessionId).catch(() => undefined);
        clearCart();
        if (!isMountedRef.current || hasNavigatedRef.current) return;

        hasNavigatedRef.current = true;
        router.replace({
          pathname: "/orders/[orderId]",
          params: {
            orderId: response.order._id,
            justPlaced: "1",
          },
        });
      } catch (error) {
        if (!isMountedRef.current) return;

        setPaymentProcessing(false);
        void trackCustomerEvent({
          eventType: "payment_failed",
          path: "/bkash-payment",
          screenName: "bkash-payment",
          entityType: "payment",
          entityId:
            typeof callbackParams.paymentID === "string"
              ? callbackParams.paymentID
              : draft.sessionId,
          metadata: {
            provider: "Bkash",
            stage: "post_payment_order_submit",
            restaurantId: draft.restaurantId,
            message:
              error instanceof Error
                ? error.message.slice(0, 120)
                : "Payment succeeded, but the order could not be placed.",
          },
        });
        setLoadError(
          error instanceof Error
            ? error.message
            : "Payment succeeded, but the order could not be placed."
        );
        setCanRetryOrderCreation(true);
      }
    };

    void run();
  }, [
    callbackUrl,
    clearCart,
    draft,
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
          {isDraftLoading ? (
            <ActivityIndicator size="large" color={palette.secondary} />
          ) : (
            <Text style={styles.errorText}>
              {loadError || "bKash session unavailable."}
            </Text>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <StatusBar style="dark" />
      <View style={styles.root}>
        <Pressable
          style={[
            styles.backButton,
            { top: 10 + insets.top },
            paymentProcessing ? styles.backButtonDisabled : null,
          ]}
          disabled={paymentProcessing}
          onPress={() => {
            if (!paymentProcessing) {
              router.back();
            }
          }}
        >
          <Ionicons name="chevron-back" size={20} color={palette.foreground} />
        </Pressable>

        <View style={[styles.brandPill, { top: 10 + insets.top, right: 16 }]}>
          <Text style={styles.brandPillText}>bKash checkout</Text>
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
              setLoadError("Could not load the bKash checkout.");
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
            {canRetryOrderCreation ? (
              <Pressable
                style={styles.retryButton}
                onPress={() => {
                  setLoadError("");
                  setCanRetryOrderCreation(false);
                  setCallbackHandled(false);
                }}
              >
                <Text style={styles.retryButtonText}>Create order</Text>
              </Pressable>
            ) : null}
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
  backButtonDisabled: {
    opacity: 0.5,
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
  retryButton: {
    marginTop: 10,
    alignSelf: "center",
    borderRadius: 999,
    backgroundColor: palette.secondary,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  retryButtonText: {
    color: palette.surface,
    fontSize: 13,
    fontWeight: "800",
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
