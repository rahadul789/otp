import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Animated, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useEffect, useMemo, useRef } from "react";

import { EmptyStateCard } from "@/src/components/empty-state-card";
import { OfflineNoticeCard } from "@/src/components/offline-notice-card";
import { Screen } from "@/src/components/screen";
import { useCustomerCartQuoteQuery, useCustomerRestaurantDetailsQuery } from "@/src/hooks/use-customer-api";
import { useIsOnline } from "@/src/hooks/use-network-status";
import { useCustomerAuthStore } from "@/src/store/auth-store";
import { buildCartItemKey, getCartItemCount, getCartSubtotal, useCartStore } from "@/src/store/cart-store";
import { useLocationStore } from "@/src/store/location-store";
import { palette } from "@/src/theme/palette";

function formatCurrency(amount: number) {
  return `Tk ${amount.toFixed(0)}`;
}

function formatSelectedOptions(
  options: { groupName: string; optionLabel: string }[]
) {
  if (options.length === 0) {
    return null;
  }

  const groupedOptions = new Map<string, Map<string, number>>();

  options.forEach((option) => {
    const groupName = option.groupName?.trim() || "Option";
    const optionLabel = option.optionLabel?.trim() || "Selected";
    const optionCounts = groupedOptions.get(groupName) ?? new Map<string, number>();
    optionCounts.set(optionLabel, (optionCounts.get(optionLabel) ?? 0) + 1);
    groupedOptions.set(groupName, optionCounts);
  });

  return Array.from(groupedOptions.entries())
    .map(([groupName, optionCounts]) => {
      const summary = Array.from(optionCounts.entries())
        .map(([optionLabel, count]) => (count > 1 ? `${optionLabel} x${count}` : optionLabel))
        .join(", ");

      return `${groupName}: ${summary}`;
    })
    .join(" • ");
}

export default function CartScreen() {
  const router = useRouter();
  const restaurant = useCartStore((state) => state.restaurant);
  const items = useCartStore((state) => state.items);
  const reorderContext = useCartStore((state) => state.reorderContext);
  const setReorderContext = useCartStore((state) => state.setReorderContext);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const removeItem = useCartStore((state) => state.removeItem);
  const clearCart = useCartStore((state) => state.clearCart);
  const syncPricing = useCartStore((state) => state.syncPricing);
  const selectedLocation = useLocationStore((state) => state.selectedLocation);
  const customer = useCustomerAuthStore((state) => state.customer);
  const isOnline = useIsOnline();
  const offerUnlockAnim = useRef(new Animated.Value(1)).current;

  const quoteQuery = useCustomerCartQuoteQuery({
    restaurantId: restaurant?.restaurantId,
    items: items.map((item) => ({
      itemId: item.itemId,
      quantity: item.quantity,
      selectedVariantOptions: item.selectedVariantOptions,
      selectedAddOnOptions: item.selectedAddOnOptions,
    })),
    latitude: selectedLocation?.latitude,
    longitude: selectedLocation?.longitude,
  });

  const itemCount = getCartItemCount(items);
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
  const quoteErrorMessage = quoteQuery.error instanceof Error
    ? quoteQuery.error.message
    : "We could not verify your cart with the latest restaurant pricing.";
  const restaurantDetailsQuery = useCustomerRestaurantDetailsQuery({
    restaurantId: restaurant?.restaurantId,
    latitude: selectedLocation?.latitude,
    longitude: selectedLocation?.longitude,
  });
  const autoAppliedOffer = useMemo(
    () =>
      restaurantDetailsQuery.data?.activeOffers.find(
        (offer) =>
          offer.mode === "auto" && typeof offer.minimumOrderAmount === "number"
      ) ?? null,
    [restaurantDetailsQuery.data?.activeOffers]
  );
  const offerProgress = useMemo(() => {
    if (!autoAppliedOffer || !autoAppliedOffer.minimumOrderAmount) {
      return null;
    }

    const target = Math.max(autoAppliedOffer.minimumOrderAmount, 1);
    const subtotal = pricing?.subtotal ?? localSubtotal;
    const remaining = Math.max(0, target - subtotal);
    const ratio = Math.max(0, Math.min(1, subtotal / target));
    const unlocked = remaining <= 0;

    return { target, subtotal, remaining, ratio, unlocked };
  }, [autoAppliedOffer, localSubtotal, pricing?.subtotal]);

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

  useEffect(() => {
    if (!offerProgress?.unlocked) {
      offerUnlockAnim.setValue(1);
      return;
    }

    Animated.sequence([
      Animated.timing(offerUnlockAnim, {
        toValue: 1.03,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(offerUnlockAnim, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();
  }, [offerProgress?.unlocked, offerUnlockAnim]);

  async function handleCheckout() {
    if (!restaurant || items.length === 0 || hasQuoteIssues || quoteQuery.isLoading || !isOnline) return;

    if (!selectedLocation) {
      router.push("/location-picker");
      return;
    }

    if (!customer) {
      router.push({
        pathname: "/sign-in",
        params: { redirectTo: "/checkout" },
      });
      return;
    }

    router.push("/checkout");
  }

  return (
    <Screen>
      <View style={styles.container}>
        {items.length === 0 ? (
          <View style={styles.emptyWrap}>
            <EmptyStateCard
              title="Your cart is empty"
              description="Add something you would like to order, and it will appear here for checkout."
              actionLabel="Browse restaurants"
              onPress={() => router.push("/(tabs)/browse")}
            />
          </View>
        ) : (
          <>
            <ScrollView
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.header}>
                <Text style={styles.kicker}>Cart</Text>
                <Text style={styles.title}>Your cart</Text>
                <Text style={styles.subtitle}>
                  Review your items, pricing, and checkout details before placing the order.
                </Text>
                {!isOnline ? (
                  <OfflineNoticeCard description="Your cart is saved on this device. Reconnect to verify availability and continue to checkout." />
                ) : null}
                <View style={styles.headerStatRow}>
                  <View style={[styles.infoPill, { backgroundColor: "#FFE9F1" }]}>
                    <View style={styles.infoPillTopRow}>
                      <Ionicons name="bag-handle-outline" size={13} color={palette.foreground} />
                      <Text style={styles.infoPillLabel}>Items</Text>
                    </View>
                    <Text style={styles.infoPillValue}>{itemCount}</Text>
                  </View>
                  <View style={[styles.infoPill, { backgroundColor: "#FFEAF3" }]}>
                    <View style={styles.infoPillTopRow}>
                      <Ionicons name="pricetag-outline" size={13} color={palette.foreground} />
                      <Text style={styles.infoPillLabel}>Discount</Text>
                    </View>
                    <Text style={styles.infoPillValue}>
                      {(pricing?.discountAmount ?? 0) > 0
                        ? `-${formatCurrency(pricing?.discountAmount ?? 0)}`
                        : "No deal yet"}
                    </Text>
                  </View>
                  <View style={[styles.infoPill, { backgroundColor: "#EAF2FF" }]}>
                    <View style={styles.infoPillTopRow}>
                      <Ionicons name="navigate-outline" size={13} color={palette.foreground} />
                      <Text style={styles.infoPillLabel}>Location</Text>
                    </View>
                    <Text style={styles.infoPillValue}>
                      {selectedLocation ? "Ready" : "Missing"}
                    </Text>
                  </View>
                </View>
              </View>

              {hasQuoteIssues ? (
                <View style={styles.validationCard}>
                  <View style={styles.validationIconWrap}>
                    <Ionicons name="alert-circle" size={18} color={palette.warningText} />
                  </View>
                  <View style={styles.validationCopy}>
                    <Text style={styles.validationTitle}>Cart needs attention</Text>
                    <Text style={styles.validationSubtitle}>
                      {quoteErrorMessage.includes("not available")
                        ? "One or more items are no longer available. Remove them or refresh your cart before checkout."
                        : quoteErrorMessage}
                    </Text>
                  </View>
                </View>
              ) : null}

              {!hasQuoteIssues && priceChangedCount > 0 ? (
                <View style={styles.validationCard}>
                  <View style={[styles.validationIconWrap, styles.validationIconWrapInfo]}>
                    <Ionicons name="refresh" size={18} color={palette.secondary} />
                  </View>
                  <View style={styles.validationCopy}>
                    <Text style={styles.validationTitle}>Prices updated</Text>
                    <Text style={styles.validationSubtitle}>
                      {priceChangedCount} item{priceChangedCount === 1 ? "" : "s"} now reflect the latest restaurant pricing.
                    </Text>
                  </View>
                </View>
              ) : null}

              {reorderContext ? (
                <View style={styles.reorderBadgeCard}>
                  <View style={styles.reorderBadgeIconWrap}>
                    <Ionicons name="refresh-outline" size={16} color={palette.secondary} />
                  </View>
                <View style={styles.reorderBadgeCopy}>
                  <Text style={styles.reorderBadgeTitle}>
                    Reordered from {reorderContext.orderNumber}
                  </Text>
                    <Text style={styles.reorderBadgeSubtitle}>
                      We refreshed these items using the restaurant&apos;s latest prices and currently available options.
                    </Text>
                </View>
                  <Pressable
                    style={styles.reorderBadgeClose}
                    onPress={() => setReorderContext(null)}
                  >
                    <Ionicons name="close" size={15} color={palette.mutedForeground} />
                  </Pressable>
                </View>
              ) : null}

              <View style={styles.restaurantCard}>
                <View style={styles.restaurantCardHeader}>
                  <View style={styles.restaurantCardCopy}>
                    <Text style={styles.restaurantName}>
                      {restaurant?.restaurantName ?? "Restaurant"}
                    </Text>
                    <Text style={styles.restaurantMeta}>
                      {itemCount} item{itemCount === 1 ? "" : "s"} in this cart
                    </Text>
                  </View>
                  <Pressable onPress={clearCart} style={styles.clearButton}>
                    <Text style={styles.clearButtonText}>Clear</Text>
                  </Pressable>
                </View>

                <View style={styles.itemList}>
                  {items.map((item) => (
                    <View key={item.key} style={styles.itemRow}>
                      {(() => {
                        const quotedItem = quotedItemsByKey.get(item.key);
                        const displayUnitPrice = quotedItem?.unitPrice ?? item.unitPrice;
                        const displayLineTotal =
                          quotedItem?.lineTotal ?? displayUnitPrice * item.quantity;
                        const isPriceChanged =
                          typeof quotedItem?.unitPrice === "number" &&
                          quotedItem.unitPrice !== item.unitPrice;
                        const variantSummary = formatSelectedOptions(item.selectedVariantOptions);
                        const addOnSummary = formatSelectedOptions(item.selectedAddOnOptions);

                        return (
                          <>
                      {item.imageUrl ? (
                        <Image source={{ uri: item.imageUrl }} style={styles.itemImage} />
                      ) : (
                        <View style={styles.itemFallback}>
                          <Ionicons name="fast-food-outline" size={20} color={palette.primary} />
                        </View>
                      )}

                      <View style={styles.itemCopy}>
                        <Text style={styles.itemName}>{item.name}</Text>
                        {variantSummary ? <Text style={styles.itemMeta}>{variantSummary}</Text> : null}
                        {addOnSummary ? <Text style={styles.itemMeta}>{addOnSummary}</Text> : null}
                        <View style={styles.itemFooterRow}>
                          <View style={styles.itemPriceWrap}>
                            <Text style={styles.itemPrice}>{formatCurrency(displayUnitPrice)} each</Text>
                            {isPriceChanged ? (
                              <Text style={styles.itemPriceChanged}>Updated</Text>
                            ) : null}
                          </View>
                          <Text style={styles.itemLineTotal}>
                            {formatCurrency(displayLineTotal)}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.itemActions}>
                        <View style={styles.quantityControl}>
                          <Pressable
                            onPress={() => updateQuantity(item.key, item.quantity - 1)}
                            style={styles.quantityButton}
                          >
                            <Ionicons
                              name={item.quantity === 1 ? "trash-outline" : "remove"}
                              size={15}
                              color={palette.foreground}
                            />
                          </Pressable>
                          <Text style={styles.quantityText}>{item.quantity}</Text>
                          <Pressable
                            onPress={() => updateQuantity(item.key, item.quantity + 1)}
                            style={[styles.quantityButton, styles.quantityButtonPrimary]}
                          >
                            <Ionicons name="add" size={15} color="#fff" />
                          </Pressable>
                        </View>

                        <Pressable onPress={() => removeItem(item.key)}>
                          <Text style={styles.removeText}>Remove</Text>
                        </Pressable>
                      </View>
                          </>
                        );
                      })()}
                    </View>
                  ))}
                </View>

                {restaurant?.restaurantId ? (
                  <Pressable
                    style={styles.addMoreButton}
                    onPress={() =>
                      router.push({
                        pathname: "/restaurants/[restaurantId]",
                        params: { restaurantId: restaurant.restaurantId },
                      })
                    }
                  >
                    <Ionicons name="add-circle-outline" size={16} color={palette.secondary} />
                    <Text style={styles.addMoreButtonText}>Add more</Text>
                  </Pressable>
                ) : null}
              </View>

              <View style={styles.summaryCard}>
                {autoAppliedOffer && offerProgress ? (
                  <Animated.View
                    style={[
                      styles.offerProgressCard,
                      offerProgress.unlocked ? styles.offerProgressCardUnlocked : null,
                      { transform: [{ scale: offerUnlockAnim }] },
                    ]}
                  >
                    <View style={styles.offerProgressHeader}>
                      <View style={styles.offerProgressBadge}>
                        <Ionicons
                          name={offerProgress.unlocked ? "checkmark-circle" : "sparkles-outline"}
                          size={15}
                          color={offerProgress.unlocked ? palette.successText : palette.secondary}
                        />
                        <Text
                          style={[
                            styles.offerProgressBadgeText,
                            offerProgress.unlocked ? styles.offerProgressBadgeTextUnlocked : null,
                          ]}
                        >
                          {offerProgress.unlocked ? "Offer unlocked" : autoAppliedOffer.name}
                        </Text>
                      </View>
                      <Text style={styles.offerProgressValue}>
                        {formatCurrency(offerProgress.subtotal)} / {formatCurrency(offerProgress.target)}
                      </Text>
                    </View>
                    <Text style={styles.offerProgressSubtitle}>
                      {offerProgress.unlocked
                        ? "This discount will apply automatically at checkout."
                        : `${formatCurrency(offerProgress.remaining)} more to unlock it.`}
                    </Text>
                    <View style={styles.offerTrack}>
                      <View
                        style={[
                          styles.offerFill,
                          offerProgress.unlocked ? styles.offerFillUnlocked : null,
                          { width: `${offerProgress.ratio * 100}%` },
                        ]}
                      />
                    </View>
                  </Animated.View>
                ) : null}
                <Text style={styles.summaryTitle}>Order summary</Text>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Items subtotal</Text>
                  <Text style={styles.summaryValue}>
                    {formatCurrency(pricing?.subtotal ?? localSubtotal)}
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Delivery fee</Text>
                  <Text style={styles.summaryValue}>
                    {formatCurrency(pricing?.deliveryFee ?? 0)}
                  </Text>
                </View>
                {(pricing?.discountAmount ?? 0) > 0 ? (
                  <View style={styles.summaryRow}>
                    <Text style={[styles.summaryLabel, styles.summaryHighlight]}>Discount</Text>
                    <Text style={[styles.summaryValue, styles.summaryHighlight]}>
                      -{formatCurrency(pricing?.discountAmount ?? 0)}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.divider} />
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryStrong}>Estimated total</Text>
                  <Text style={styles.summaryStrong}>
                    {formatCurrency(pricing?.total ?? localSubtotal)}
                  </Text>
                </View>
              </View>
            </ScrollView>

            <View style={styles.checkoutWrap}>
              <View style={styles.checkoutCard}>
                <View style={styles.checkoutCopy}>
                  <Text style={styles.checkoutLabel}>
                    {!customer ? "Sign in first" : "Ready for checkout"}
                  </Text>
                  <Text style={styles.checkoutAmount}>
                    {formatCurrency(pricing?.total ?? localSubtotal)}
                  </Text>
                </View>
                <Pressable
                  style={[
                    styles.checkoutButton,
                    hasQuoteIssues || quoteQuery.isLoading || !isOnline ? styles.checkoutButtonDisabled : null,
                  ]}
                  onPress={handleCheckout}
                  disabled={hasQuoteIssues || quoteQuery.isLoading || !isOnline}
                >
                  <Text style={styles.checkoutButtonText}>
                    {!customer
                      ? "Sign in to checkout"
                      : !isOnline
                        ? "Reconnect to continue"
                      : hasQuoteIssues
                        ? "Fix cart to continue"
                        : quoteQuery.isLoading
                          ? "Checking latest prices..."
                          : "Continue to checkout"}
                  </Text>
                </Pressable>
              </View>
            </View>
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  emptyWrap: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  content: {
    paddingBottom: 160,
    gap: 20,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 14,
    gap: 6,
  },
  kicker: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: palette.secondary,
  },
  title: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: "800",
    color: palette.foreground,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 23,
    fontWeight: "500",
    color: palette.mutedForeground,
  },
  headerStatRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 8,
  },
  infoPill: {
    flex: 1,
    minHeight: 72,
    borderRadius: 18,
    paddingHorizontal: 10,
    paddingVertical: 10,
    justifyContent: "center",
  },
  infoPillTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  infoPillLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    color: palette.mutedForeground,
  },
  infoPillValue: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.foreground,
  },
  validationCard: {
    marginHorizontal: 20,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 24,
    backgroundColor: palette.surface,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    shadowColor: palette.shadow,
    shadowOpacity: 0.6,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  validationIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.warningSurface,
  },
  validationIconWrapInfo: {
    backgroundColor: "#FFEAF3",
  },
  validationCopy: {
    flex: 1,
    gap: 3,
  },
  validationTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    color: palette.foreground,
  },
  validationSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: palette.mutedForeground,
  },
  reorderBadgeCard: {
    marginHorizontal: 20,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 24,
    backgroundColor: "#FFEAF3",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    shadowColor: palette.shadow,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  reorderBadgeIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFFCC",
  },
  reorderBadgeCopy: {
    flex: 1,
    gap: 3,
  },
  reorderBadgeTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    color: palette.foreground,
  },
  reorderBadgeSubtitle: {
    fontSize: 12,
    lineHeight: 18,
    color: palette.mutedForeground,
  },
  reorderBadgeClose: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFFA8",
  },
  restaurantCard: {
    marginHorizontal: 20,
    padding: 20,
    borderRadius: 38,
    backgroundColor: palette.surface,
    gap: 14,
    shadowColor: palette.shadow,
    shadowOpacity: 1,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 7,
  },
  restaurantCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  restaurantCardCopy: {
    flex: 1,
    gap: 2,
  },
  restaurantName: {
    fontSize: 21,
    lineHeight: 27,
    fontWeight: "800",
    color: palette.foreground,
  },
  restaurantMeta: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    color: palette.mutedForeground,
  },
  clearButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: palette.surfaceMuted,
  },
  clearButtonText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    color: palette.foreground,
  },
  itemList: {
    gap: 10,
  },
  addMoreButton: {
    marginTop: 4,
    alignSelf: "flex-start",
    minHeight: 40,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: palette.surfaceMuted,
    borderWidth: 1,
    borderColor: palette.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  addMoreButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: palette.foreground,
  },
  itemRow: {
    flexDirection: "row",
    gap: 14,
    padding: 10,
    borderRadius: 24,
    backgroundColor: palette.surfaceMuted,
  },
  itemImage: {
    width: 74,
    height: 74,
    borderRadius: 18,
    backgroundColor: palette.surface,
  },
  itemFallback: {
    width: 74,
    height: 74,
    borderRadius: 18,
    backgroundColor: palette.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  itemCopy: {
    flex: 1,
    gap: 6,
  },
  itemName: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.foreground,
  },
  itemMeta: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    color: palette.mutedForeground,
  },
  itemFooterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 2,
  },
  itemPriceWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  itemPrice: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    color: palette.mutedForeground,
  },
  itemPriceChanged: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    color: palette.secondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  itemLineTotal: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.foreground,
  },
  itemActions: {
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 10,
  },
  quantityControl: {
    minWidth: 96,
    height: 36,
    paddingHorizontal: 4,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFEAF3",
  },
  quantityButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surface,
  },
  quantityButtonPrimary: {
    backgroundColor: palette.secondary,
  },
  quantityText: {
    minWidth: 20,
    textAlign: "center",
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.foreground,
  },
  removeText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    color: palette.primary,
  },
  summaryCard: {
    marginHorizontal: 20,
    padding: 20,
    borderRadius: 38,
    backgroundColor: palette.surface,
    gap: 10,
    shadowColor: palette.shadow,
    shadowOpacity: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  offerProgressCard: {
    marginBottom: 14,
    padding: 14,
    borderRadius: 24,
    backgroundColor: palette.surfaceMuted,
    gap: 8,
  },
  offerProgressCardUnlocked: {
    backgroundColor: palette.successSurface,
  },
  offerProgressHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  offerProgressBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  offerProgressBadgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    color: palette.secondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  offerProgressBadgeTextUnlocked: {
    color: palette.successText,
  },
  offerProgressValue: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    color: palette.foreground,
  },
  offerProgressSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    color: palette.mutedForeground,
  },
  offerTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: "#F3DDCC",
    overflow: "hidden",
  },
  offerFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: palette.secondary,
  },
  offerFillUnlocked: {
    backgroundColor: palette.successText,
  },
  summaryTitle: {
    fontSize: 21,
    lineHeight: 27,
    fontWeight: "800",
    color: palette.foreground,
    marginBottom: 2,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  summaryLabel: {
    fontSize: 15,
    lineHeight: 23,
    fontWeight: "500",
    color: palette.mutedForeground,
  },
  summaryValue: {
    fontSize: 15,
    lineHeight: 23,
    fontWeight: "500",
    color: palette.foreground,
  },
  summaryHighlight: {
    color: palette.successText,
  },
  summaryStrong: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.foreground,
  },
  divider: {
    height: 1,
    backgroundColor: palette.border,
    marginVertical: 2,
  },
  checkoutWrap: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 0,
  },
  checkoutCard: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 38,
    backgroundColor: palette.secondary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    shadowColor: palette.shadow,
    shadowOpacity: 1,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 7,
  },
  checkoutCopy: {
    flex: 1,
    gap: 2,
  },
  checkoutLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    color: "rgba(255,255,255,0.82)",
  },
  checkoutAmount: {
    fontSize: 21,
    lineHeight: 27,
    fontWeight: "800",
    color: "#fff",
  },
  checkoutButton: {
    minWidth: 164,
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surface,
  },
  checkoutButtonDisabled: {
    opacity: 0.72,
  },
  checkoutButtonText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.secondary,
  },
});
