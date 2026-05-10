import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { LocationSelectorSheet } from "@/src/components/location-selector-sheet";
import { OfflineNoticeCard } from "@/src/components/offline-notice-card";
import {
  useBkashInitiateMutation,
  useCustomerCartQuoteQuery,
  useCustomerPlaceOrderMutation,
} from "@/src/hooks/use-customer-api";
import { trackCustomerEvent } from "@/src/lib/analytics";
import { formatDateTimeAmPm } from "@/src/lib/date-time";
import { useIsOnline } from "@/src/hooks/use-network-status";
import { useCustomerAuthStore } from "@/src/store/auth-store";
import { buildCartItemKey, getCartSubtotal, useCartStore } from "@/src/store/cart-store";
import { useLocationStore } from "@/src/store/location-store";
import { palette } from "@/src/theme/palette";

function formatCurrency(amount: number) {
  return `Tk ${amount.toFixed(0)}`;
}

type PaymentMethod = "Cash" | "Bkash";

const paymentOptions: {
  id: PaymentMethod;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  accentColor: string;
}[] = [
  {
    id: "Cash",
    title: "Cash on delivery",
    subtitle: "Pay when the rider reaches your door.",
    icon: "cash-outline",
    accentColor: "#FFEAF3",
  },
  {
    id: "Bkash",
    title: "bKash",
    subtitle: "Continue to the official hosted payment page.",
    icon: "phone-portrait-outline",
    accentColor: "#FFE4EF",
  },
];

export default function CheckoutScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const [isLocationSheetOpen, setIsLocationSheetOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("Cash");
  const [voucherCodeInput, setVoucherCodeInput] = useState("");
  const [appliedVoucherCode, setAppliedVoucherCode] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const hasCompletedCheckoutRef = useRef(false);
  const [bkashPayment, setBkashPayment] = useState<{
    sessionId: string;
    paymentID: string;
    amount: number;
    walletNumber: string;
    expiresAt: string;
    transactionId?: string;
    confirmedAt?: string;
  } | null>(null);

  const restaurant = useCartStore((state) => state.restaurant);
  const items = useCartStore((state) => state.items);
  const reorderContext = useCartStore((state) => state.reorderContext);
  const clearCart = useCartStore((state) => state.clearCart);
  const setReorderContext = useCartStore((state) => state.setReorderContext);
  const syncPricing = useCartStore((state) => state.syncPricing);
  const selectedLocation = useLocationStore((state) => state.selectedLocation);
  const customer = useCustomerAuthStore((state) => state.customer);
  const isOnline = useIsOnline();
  const bkashWalletNumber = customer?.phone?.trim() ?? "";
  const placeOrderMutation = useCustomerPlaceOrderMutation();
  const bkashInitiateMutation = useBkashInitiateMutation();

  const quoteQuery = useCustomerCartQuoteQuery({
    restaurantId: restaurant?.restaurantId,
    items: items.map((item) => ({
      itemId: item.itemId,
      quantity: item.quantity,
      selectedVariantOptions: item.selectedVariantOptions,
      selectedAddOnOptions: item.selectedAddOnOptions,
    })),
    voucherCode: appliedVoucherCode || undefined,
    latitude: selectedLocation?.latitude,
    longitude: selectedLocation?.longitude,
  });

  const localSubtotal = getCartSubtotal(items);
  const pricing = quoteQuery.data?.pricing;
  const quotedItemsByKey = useMemo(
    () =>
      new Map(
        (quoteQuery.data?.items ?? []).map((item) => [
          buildCartItemKey({
            itemId: item.itemId,
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            selectedVariantOptions: item.selectedVariantOptions,
            selectedAddOnOptions: item.selectedAddOnOptions,
          }),
          item,
        ])
      ),
    [quoteQuery.data?.items]
  );
  const priceChangedCount = useMemo(
    () =>
      items.reduce((count, item) => {
        const quotedItem = quotedItemsByKey.get(item.key);
        return quotedItem && quotedItem.unitPrice !== item.unitPrice ? count + 1 : count;
      }, 0),
    [items, quotedItemsByKey]
  );
  const hasQuoteIssues = quoteQuery.isError;
  const quoteErrorMessage =
    quoteQuery.error instanceof Error
      ? quoteQuery.error.message
      : "We could not verify this cart with the latest restaurant pricing.";

  const itemPayload = useMemo(
    () =>
      items.map((item) => ({
        itemId: item.itemId,
        quantity: item.quantity,
        selectedVariantOptions: item.selectedVariantOptions,
        selectedAddOnOptions: item.selectedAddOnOptions,
      })),
    [items]
  );

  const itemSummary = useMemo(
    () =>
      items.map((item) => ({
        key: item.key,
        name: item.name,
        quantity: item.quantity,
        total: quotedItemsByKey.get(item.key)?.lineTotal ?? item.unitPrice * item.quantity,
        unitPrice: quotedItemsByKey.get(item.key)?.unitPrice ?? item.unitPrice,
        isPriceChanged:
          typeof quotedItemsByKey.get(item.key)?.unitPrice === "number" &&
          quotedItemsByKey.get(item.key)?.unitPrice !== item.unitPrice,
      })),
    [items, quotedItemsByKey]
  );

  useEffect(() => {
    if (!isFocused) {
      return;
    }

    if (hasCompletedCheckoutRef.current) {
      return;
    }

    if (!restaurant || items.length === 0) {
      router.replace("/(tabs)/cart");
      return;
    }

    if (!customer) {
      router.replace({
        pathname: "/sign-in",
        params: { redirectTo: "/checkout" },
      });
    }
  }, [customer, isFocused, items.length, restaurant, router]);

  useEffect(() => {
    setBkashPayment((current) => {
      if (!current) return null;
      if (current.amount !== (pricing?.total ?? localSubtotal)) return null;
      if (current.walletNumber !== bkashWalletNumber) return null;
      return current;
    });
    setPaymentError("");
  }, [appliedVoucherCode, bkashWalletNumber, localSubtotal, pricing?.total]);

  useEffect(() => {
    if (!quoteQuery.data?.items?.length) {
      return;
    }

    syncPricing(
      quoteQuery.data.items.map((item) => ({
        key: buildCartItemKey({
          itemId: item.itemId,
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          selectedVariantOptions: item.selectedVariantOptions,
          selectedAddOnOptions: item.selectedAddOnOptions,
        }),
        unitPrice: item.unitPrice,
      }))
    );
  }, [quoteQuery.data?.items, syncPricing]);

  if (!restaurant || items.length === 0 || !customer) {
    return null;
  }

  async function handleApplyVoucher() {
    const code = voucherCodeInput.trim().toUpperCase();
    setAppliedVoucherCode(code);
    setPaymentError("");
    setBkashPayment(null);
    await quoteQuery.refetch();
  }

  function handleRemoveVoucher() {
    setVoucherCodeInput("");
    setAppliedVoucherCode("");
    setBkashPayment(null);
    setPaymentError("");
  }

  async function handlePayWithBkash() {
    if (!restaurant) return;
    if (!isOnline) {
      setPaymentError("Reconnect to continue with bKash payment.");
      return;
    }

    if (hasQuoteIssues || quoteQuery.isLoading) {
      setPaymentError("Please wait while we verify your cart with the latest restaurant pricing.");
      return;
    }

    if (!/^01\d{9}$/.test(bkashWalletNumber)) {
      setPaymentError("We need a valid account phone number before starting bKash.");
      return;
    }

    setPaymentError("");

    try {
        const response = await bkashInitiateMutation.mutateAsync({
          restaurantId: restaurant.restaurantId,
          items: itemPayload,
          voucherCode: appliedVoucherCode || undefined,
          walletNumber: bkashWalletNumber,
          latitude: selectedLocation?.latitude,
          longitude: selectedLocation?.longitude,
        });
      router.push({
        pathname: "/bkash-payment",
        params: {
          url: response.bkashURL,
          sessionId: response.sessionId,
          paymentID: response.paymentID,
          amount: String(response.amount),
          walletNumber: response.walletNumber,
          expiresAt: response.expiresAt,
          restaurantId: restaurant.restaurantId,
          voucherCode: appliedVoucherCode || "",
          deliveryLabel: selectedLocation?.label ?? "",
          deliveryAddressLine: selectedLocation?.address ?? "",
          deliveryLatitude:
            typeof selectedLocation?.latitude === "number"
              ? String(selectedLocation.latitude)
              : "",
          deliveryLongitude:
            typeof selectedLocation?.longitude === "number"
              ? String(selectedLocation.longitude)
              : "",
          cartPayload: encodeURIComponent(JSON.stringify(itemPayload)),
        },
      });
    } catch (error) {
      setPaymentError(
        error instanceof Error ? error.message : "Could not start bKash payment."
      );
    }
  }

  async function handlePlaceOrder() {
    if (!restaurant || !customer || !selectedLocation || items.length === 0) {
      return;
    }
    if (!isOnline) {
      setPaymentError("Reconnect to place this order.");
      return;
    }

    if (hasQuoteIssues || quoteQuery.isLoading) {
      setPaymentError("Fix your cart pricing before placing the order.");
      return;
    }

    if (paymentMethod === "Bkash" && !bkashPayment?.sessionId) {
      setPaymentError("Complete the bKash payment before placing the order.");
      return;
    }

    try {
      const response = await placeOrderMutation.mutateAsync({
        restaurantId: restaurant.restaurantId,
        paymentMethod,
        voucherCode: appliedVoucherCode || undefined,
        paymentReference:
          paymentMethod === "Bkash"
            ? {
                provider: "Bkash",
                bkashSessionId: bkashPayment?.sessionId,
                walletNumber: bkashPayment?.walletNumber,
              }
            : undefined,
        items: itemPayload,
        deliveryAddress: {
          label: selectedLocation.label,
          addressLine: selectedLocation.address,
          latitude: selectedLocation.latitude,
          longitude: selectedLocation.longitude,
        },
      });

      void trackCustomerEvent({
        eventType: "order_created",
        path: "/checkout",
        screenName: "checkout",
        entityType: "order",
        entityId: response.order._id,
        metadata: {
          itemCount: items.length,
          paymentMethod,
          restaurantId: restaurant.restaurantId,
          total: pricing?.total ?? localSubtotal,
          voucherApplied: Boolean(appliedVoucherCode),
        },
      });
      hasCompletedCheckoutRef.current = true;
      clearCart();
      router.replace({
        pathname: "/orders/[orderId]",
        params: {
          orderId: response.order._id,
          justPlaced: "1",
        },
      });
    } catch {
      // handled in mutation state
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: 154 + Math.max(insets.bottom, 0) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={20} color={palette.foreground} />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>Checkout</Text>
            <Text style={styles.subtitle}>
              Choose address and payment to place your order.
            </Text>
          </View>
        </View>

        {!isOnline ? (
          <View style={styles.offlineWrap}>
            <OfflineNoticeCard description="Your cart is safe, but you need an internet connection to verify prices and place this order." />
          </View>
        ) : null}

        {hasQuoteIssues ? (
          <View style={[styles.networkCard, styles.networkCardWarning]}>
            <Ionicons name="alert-circle-outline" size={18} color={palette.primary} />
            <View style={styles.networkCopy}>
              <Text style={styles.networkTitle}>Cart needs attention</Text>
              <Text style={styles.networkSubtitle}>
                {quoteErrorMessage.includes("not available")
                  ? "One or more items are no longer available. Update your cart before placing this order."
                  : quoteErrorMessage}
              </Text>
            </View>
          </View>
        ) : null}

        {!hasQuoteIssues && priceChangedCount > 0 ? (
          <View style={[styles.networkCard, styles.networkCardInfo]}>
            <Ionicons name="refresh-outline" size={18} color={palette.secondary} />
            <View style={styles.networkCopy}>
              <Text style={styles.networkTitle}>Latest prices applied</Text>
              <Text style={styles.networkSubtitle}>
                {priceChangedCount} item{priceChangedCount === 1 ? "" : "s"} updated before checkout so your total stays accurate.
              </Text>
            </View>
          </View>
        ) : null}

        {reorderContext ? (
          <View style={styles.reorderContextCard}>
            <View style={styles.reorderContextIconWrap}>
              <Ionicons name="refresh-outline" size={16} color={palette.secondary} />
            </View>
            <View style={styles.reorderContextCopy}>
              <Text style={styles.reorderContextTitle}>
                Reordering {reorderContext.orderNumber}
              </Text>
              <Text style={styles.reorderContextSubtitle}>
                These items were refreshed with the latest menu prices before checkout.
              </Text>
            </View>
            <Pressable
              style={styles.reorderContextDismiss}
              onPress={() => setReorderContext(null)}
            >
              <Ionicons name="close" size={15} color={palette.mutedForeground} />
            </Pressable>
          </View>
        ) : null}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Deliver to</Text>
          </View>
          <Pressable style={styles.addressCard} onPress={() => setIsLocationSheetOpen(true)}>
            <View style={styles.addressIconWrap}>
              <Ionicons
                name={selectedLocation?.isDefault ? "home-outline" : "locate-outline"}
                size={18}
                color={palette.foreground}
              />
            </View>
            <View style={styles.addressCopy}>
              <View style={styles.addressTitleRow}>
                <Text style={styles.addressTitle}>
                  {selectedLocation?.label ?? "Choose location"}
                </Text>
                <View style={styles.addressActions}>
                  {selectedLocation?.isDefault ? (
                    <View style={styles.defaultBadge}>
                      <Text style={styles.defaultBadgeText}>Default</Text>
                    </View>
                  ) : null}
                  <View style={styles.changePill}>
                    <Text style={styles.changePillText}>Change</Text>
                  </View>
                </View>
              </View>
              <Text style={styles.addressLine}>
                {selectedLocation?.address ?? "Choose a delivery point before placing the order."}
              </Text>
              {selectedLocation?.lastUsedAt ? (
                <Text style={styles.addressMeta}>
                  Last used {formatDateTimeAmPm(selectedLocation.lastUsedAt)}
                </Text>
              ) : null}
            </View>
          </Pressable>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Voucher</Text>
            <Text style={styles.sectionHint}>Optional</Text>
          </View>
          <View style={styles.surfaceCard}>
            <View style={styles.voucherRow}>
              <TextInput
                value={voucherCodeInput}
                onChangeText={setVoucherCodeInput}
                placeholder="Enter voucher code"
                placeholderTextColor={palette.mutedForeground}
                autoCapitalize="characters"
                style={styles.voucherInput}
              />
              <Pressable style={styles.voucherButton} onPress={handleApplyVoucher}>
                <Text style={styles.voucherButtonText}>Apply</Text>
              </Pressable>
            </View>
            {appliedVoucherCode ? (
              <View style={styles.voucherAppliedRow}>
                <Text style={styles.voucherAppliedText}>Applied voucher: {appliedVoucherCode}</Text>
                <Pressable onPress={handleRemoveVoucher}>
                  <Text style={styles.voucherRemoveText}>Remove</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Payment</Text>
            <Text style={styles.sectionHint}>Choose one</Text>
          </View>
          <View style={styles.paymentList}>
            {paymentOptions.map((option) => {
              const isActive = paymentMethod === option.id;
              return (
                <Pressable
                  key={option.id}
                  style={[styles.paymentCard, isActive ? styles.paymentCardActive : null]}
                  onPress={() => {
                    setPaymentMethod(option.id);
                    setPaymentError("");
                  }}
                >
                  <View style={[styles.paymentIconWrap, { backgroundColor: option.accentColor }]}>
                    <Ionicons name={option.icon} size={18} color={palette.foreground} />
                  </View>
                  <View style={styles.paymentCopy}>
                    <Text style={styles.paymentTitle}>{option.title}</Text>
                    <Text style={styles.paymentSubtitle}>{option.subtitle}</Text>
                  </View>
                  <Ionicons
                    name={isActive ? "radio-button-on" : "radio-button-off-outline"}
                    size={18}
                    color={isActive ? palette.secondary : palette.mutedForeground}
                  />
                </Pressable>
              );
            })}
          </View>

          {paymentError ? <Text style={styles.errorText}>{paymentError}</Text> : null}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Order summary</Text>
          </View>
          <View style={styles.summaryCard}>
            <View style={styles.summaryHeader}>
              <View>
                <Text style={styles.summaryTitle}>{restaurant.restaurantName}</Text>
                <Text style={styles.summaryMeta}>
                  {items.length} item{items.length === 1 ? "" : "s"} ready for delivery
                </Text>
              </View>
              <Pressable style={styles.changeButton} onPress={() => router.push("/(tabs)/cart")}>
                <Text style={styles.changeButtonText}>Edit cart</Text>
              </Pressable>
            </View>

            <View style={styles.summaryItemList}>
              {itemSummary.map((item) => (
                <View key={item.key} style={styles.summaryItemRow}>
                  <View style={styles.summaryItemCopy}>
                    <Text style={styles.summaryItemName} numberOfLines={1}>
                      {item.quantity}x {item.name}
                    </Text>
                    <View style={styles.summaryItemMetaRow}>
                      <Text style={styles.summaryItemMeta}>{formatCurrency(item.unitPrice)} each</Text>
                      {item.isPriceChanged ? (
                        <Text style={styles.itemUpdatedBadge}>Updated</Text>
                      ) : null}
                    </View>
                  </View>
                  <Text style={styles.summaryItemPrice}>{formatCurrency(item.total)}</Text>
                </View>
              ))}
            </View>

            <View style={styles.summaryTotals}>
              <CheckoutSummaryRow
                label="Subtotal"
                value={formatCurrency(pricing?.subtotal ?? localSubtotal)}
              />
              <CheckoutSummaryRow
                label="Delivery fee"
                value={formatCurrency(pricing?.deliveryFee ?? 0)}
              />
              <CheckoutSummaryRow
                label="Discount"
                value={`- ${formatCurrency(pricing?.discountAmount ?? 0)}`}
                highlight={(pricing?.discountAmount ?? 0) > 0}
              />
              <View style={styles.divider} />
              <CheckoutSummaryRow
                label="Total"
                value={formatCurrency(pricing?.total ?? localSubtotal)}
                strong
              />
            </View>

            {quoteQuery.isLoading ? (
              <Text style={styles.summaryHint}>Checking the latest restaurant pricing...</Text>
            ) : null}
          </View>
        </View>
      </ScrollView>

      <View
        style={[
          styles.footerWrap,
          {
            paddingBottom: Math.max(insets.bottom, 12),
          },
        ]}
      >
        <View style={styles.footerCard}>
          <View style={styles.footerCopy}>
            <Text style={styles.footerLabel}>
              {paymentMethod === "Bkash" ? "bKash total" : "Payable now"}
            </Text>
            <Text style={styles.footerAmount}>
              {formatCurrency(pricing?.total ?? localSubtotal)}
            </Text>
          </View>
          <Pressable
            style={[
              styles.placeOrderButton,
              (!selectedLocation ||
                placeOrderMutation.isPending ||
                bkashInitiateMutation.isPending ||
                quoteQuery.isLoading ||
                hasQuoteIssues ||
                !isOnline) &&
                styles.placeOrderButtonDisabled,
            ]}
            disabled={
              !selectedLocation ||
              placeOrderMutation.isPending ||
              bkashInitiateMutation.isPending ||
              quoteQuery.isLoading ||
              hasQuoteIssues ||
              !isOnline
            }
            onPress={paymentMethod === "Bkash" ? handlePayWithBkash : handlePlaceOrder}
          >
            {placeOrderMutation.isPending || bkashInitiateMutation.isPending ? (
              <ActivityIndicator size="small" color={palette.secondary} />
            ) : (
              <Text style={styles.placeOrderButtonText}>
                {hasQuoteIssues
                  ? "Fix cart"
                  : !isOnline
                    ? "Reconnect"
                  : quoteQuery.isLoading
                    ? "Checking..."
                    : paymentMethod === "Bkash"
                      ? "Pay with bKash"
                      : "Place order"}
              </Text>
            )}
          </Pressable>
        </View>
        {placeOrderMutation.isError ? (
          <Text style={styles.footerError}>
            {placeOrderMutation.error instanceof Error
              ? placeOrderMutation.error.message
              : "Could not place the order right now."}
          </Text>
        ) : (
          <Text style={styles.footerNote}>
            {hasQuoteIssues
              ? "Update your cart before you continue."
              : !isOnline
                ? "Reconnect to verify prices and place this order."
              : paymentMethod === "Bkash"
                ? "You will continue to the bKash sandbox to confirm payment."
                : quoteQuery.isLoading
                  ? "We are verifying the latest restaurant prices for this order."
                  : "Your selected saved location will be used for this delivery."}
          </Text>
        )}
      </View>

      <LocationSelectorSheet
        visible={isLocationSheetOpen}
        onClose={() => setIsLocationSheetOpen(false)}
      />
    </SafeAreaView>
  );
}

function CheckoutSummaryRow({
  label,
  value,
  highlight = false,
  strong = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  strong?: boolean;
}) {
  return (
    <View style={styles.summaryRow}>
      <Text
        style={[
          styles.summaryRowLabel,
          highlight ? styles.summaryRowHighlight : null,
          strong ? styles.summaryRowStrong : null,
        ]}
      >
        {label}
      </Text>
      <Text
        style={[
          styles.summaryRowValue,
          highlight ? styles.summaryRowHighlight : null,
          strong ? styles.summaryRowStrong : null,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.background,
  },
  content: {
    gap: 16,
    paddingBottom: 36,
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 8,
    flexDirection: "row",
    gap: 12,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surface,
    shadowColor: palette.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: palette.foreground,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 21,
    color: palette.mutedForeground,
  },
  networkCard: {
    marginHorizontal: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  networkCardWarning: {
    backgroundColor: "#FFF0F6",
    borderColor: "#FFD7C7",
  },
  networkCardInfo: {
    backgroundColor: "#FFF2F8",
    borderColor: "#FFD6E7",
  },
  networkCopy: {
    flex: 1,
    gap: 3,
  },
  networkTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: palette.foreground,
  },
  networkSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: palette.mutedForeground,
  },
  offlineWrap: {
    marginHorizontal: 18,
  },
  reorderContextCard: {
    marginHorizontal: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 22,
    backgroundColor: "#FFEAF3",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    shadowColor: palette.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  reorderContextIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFFCC",
  },
  reorderContextCopy: {
    flex: 1,
    gap: 3,
  },
  reorderContextTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: palette.foreground,
  },
  reorderContextSubtitle: {
    fontSize: 12,
    lineHeight: 18,
    color: palette.mutedForeground,
  },
  reorderContextDismiss: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFFA8",
  },
  section: {
    gap: 8,
  },
  sectionHeader: {
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: palette.foreground,
  },
  sectionHint: {
    fontSize: 12,
    color: palette.mutedForeground,
  },
  addressCard: {
    marginHorizontal: 18,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 16,
    borderRadius: 26,
    backgroundColor: palette.surface,
    shadowColor: palette.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  addressIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceMuted,
  },
  addressCopy: {
    flex: 1,
    gap: 3,
  },
  addressTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  addressTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: palette.foreground,
  },
  changePill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#EEF2FF",
  },
  changePillText: {
    fontSize: 11,
    fontWeight: "800",
    color: palette.sky,
  },
  addressActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  defaultBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#FDEEF5",
  },
  defaultBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    color: palette.secondary,
  },
  addressLine: {
    fontSize: 13,
    lineHeight: 19,
    color: palette.foreground,
  },
  addressMeta: {
    fontSize: 12,
    color: palette.mutedForeground,
  },
  surfaceCard: {
    marginHorizontal: 18,
    padding: 16,
    borderRadius: 26,
    backgroundColor: palette.surface,
    gap: 12,
    shadowColor: palette.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  voucherRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  voucherInput: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.background,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 14,
    color: palette.foreground,
  },
  voucherButton: {
    minHeight: 46,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: "#EEF2FF",
    alignItems: "center",
    justifyContent: "center",
  },
  voucherButtonText: {
    fontSize: 13,
    fontWeight: "800",
    color: palette.sky,
  },
  voucherAppliedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  voucherAppliedText: {
    fontSize: 13,
    fontWeight: "700",
    color: palette.foreground,
  },
  voucherRemoveText: {
    fontSize: 12,
    fontWeight: "700",
    color: palette.secondary,
  },
  paymentList: {
    paddingHorizontal: 18,
    gap: 10,
  },
  paymentCard: {
    padding: 14,
    borderRadius: 24,
    backgroundColor: "#FFEAF3",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    shadowColor: palette.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: 3,
  },
  paymentCardActive: {
    backgroundColor: palette.surface,
  },
  paymentIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  paymentCopy: {
    flex: 1,
    gap: 2,
  },
  paymentTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: palette.foreground,
  },
  paymentSubtitle: {
    fontSize: 12,
    lineHeight: 17,
    color: palette.mutedForeground,
  },
  errorText: {
    marginHorizontal: 18,
    fontSize: 12,
    lineHeight: 18,
    color: "#C62828",
  },
  summaryCard: {
    marginHorizontal: 18,
    padding: 18,
    borderRadius: 28,
    backgroundColor: palette.surface,
    gap: 14,
    shadowColor: palette.shadow,
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },
  summaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  summaryTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: palette.foreground,
  },
  summaryMeta: {
    fontSize: 12,
    marginTop: 2,
    color: palette.mutedForeground,
  },
  changeButton: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: palette.surfaceMuted,
  },
  changeButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: palette.foreground,
  },
  summaryItemList: {
    gap: 10,
  },
  summaryItemRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  summaryItemCopy: {
    flex: 1,
    gap: 3,
  },
  summaryItemName: {
    fontSize: 14,
    color: palette.foreground,
    fontWeight: "600",
  },
  summaryItemMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  summaryItemMeta: {
    fontSize: 12,
    color: palette.mutedForeground,
  },
  itemUpdatedBadge: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    color: palette.secondary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  summaryItemPrice: {
    fontSize: 12,
    color: palette.foreground,
    fontWeight: "600",
  },
  summaryTotals: {
    gap: 10,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  summaryRowLabel: {
    fontSize: 14,
    color: palette.mutedForeground,
  },
  summaryRowValue: {
    fontSize: 14,
    color: palette.foreground,
    fontWeight: "600",
  },
  summaryRowHighlight: {
    color: palette.successText,
  },
  summaryRowStrong: {
    fontSize: 15,
    fontWeight: "800",
    color: palette.foreground,
  },
  divider: {
    height: 1,
    backgroundColor: palette.border,
    marginVertical: 2,
  },
  summaryHint: {
    fontSize: 12,
    lineHeight: 18,
    color: palette.mutedForeground,
  },
  footerWrap: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 0,
  },
  footerCard: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 28,
    backgroundColor: palette.secondary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    shadowColor: palette.shadow,
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  footerCopy: {
    flex: 1,
    gap: 2,
  },
  footerLabel: {
    fontSize: 12,
    color: "rgba(255,255,255,0.82)",
  },
  footerAmount: {
    fontSize: 22,
    fontWeight: "800",
    color: palette.surface,
  },
  placeOrderButton: {
    minWidth: 156,
    height: 46,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surface,
    paddingHorizontal: 16,
  },
  placeOrderButtonDisabled: {
    opacity: 0.72,
  },
  placeOrderButtonText: {
    fontSize: 14,
    fontWeight: "800",
    color: palette.secondary,
  },
  footerNote: {
    marginTop: 8,
    paddingHorizontal: 6,
    fontSize: 12,
    lineHeight: 18,
    color: palette.mutedForeground,
  },
  footerError: {
    marginTop: 8,
    paddingHorizontal: 6,
    fontSize: 12,
    lineHeight: 18,
    color: "#D83A66",
  },
});
