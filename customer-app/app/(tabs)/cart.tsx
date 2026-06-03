import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ActivityIndicator, Animated, Pressable, ScrollView, Text, View } from "react-native";
import { useEffect, useMemo, useRef } from "react";

import { styles } from "@/src/components/cart/cart-screen.styles";
import { EmptyStateCard } from "@/src/components/empty-state-card";
import { OfflineNoticeCard } from "@/src/components/offline-notice-card";
import { RemoteImage } from "@/src/components/remote-image";
import { Screen } from "@/src/components/screen";
import { useCustomerCartQuoteQuery, useCustomerRestaurantDetailsQuery } from "@/src/hooks/use-customer-api";
import { useIsOnline } from "@/src/hooks/use-network-status";
import { applyCurrentLocation } from "@/src/lib/current-location";
import { formatCurrency } from "@/src/lib/currency";
import { formatShortOrderIdLabel } from "@/src/lib/order-id";
import {
  getRestaurantOutOfDeliveryAreaCopy,
  isRestaurantOutOfDeliveryAreaError,
} from "@/src/lib/serviceability";
import { useCustomerAuthStore } from "@/src/store/auth-store";
import { buildCartItemKey, getCartItemCount, getCartSubtotal, useCartStore } from "@/src/store/cart-store";
import { useLocationStore } from "@/src/store/location-store";
import { palette } from "@/src/theme/palette";

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
  const isServiceabilityBlocked =
    hasQuoteIssues && isRestaurantOutOfDeliveryAreaError(quoteErrorMessage);
  const checkoutDisabled =
    (hasQuoteIssues && !isServiceabilityBlocked) ||
    quoteQuery.isLoading ||
    !isOnline;
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
  const appliedAutoVoucher = useMemo(
    () =>
      quoteQuery.data?.appliedVouchers.find(
        (voucher) => voucher.mode === "auto" && (voucher.discountAmount ?? 0) > 0
      ) ?? null,
    [quoteQuery.data?.appliedVouchers]
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
    if (!restaurant || items.length === 0 || quoteQuery.isLoading || !isOnline) return;

    if (isServiceabilityBlocked) {
      router.push("/location-picker");
      return;
    }

    if (hasQuoteIssues) return;

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

  async function handleUseCurrentLocation() {
    try {
      await applyCurrentLocation();
    } catch {
      router.push("/location-picker");
    }
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
                    <Text style={styles.validationTitle}>
                      {isServiceabilityBlocked ? "Outside delivery area" : "Cart needs attention"}
                    </Text>
                    <Text style={styles.validationSubtitle}>
                      {isServiceabilityBlocked
                        ? getRestaurantOutOfDeliveryAreaCopy(restaurant?.restaurantName)
                        : quoteErrorMessage.includes("not available")
                        ? "One or more items are no longer available. Remove them or refresh your cart before checkout."
                        : quoteErrorMessage}
                    </Text>
                    {isServiceabilityBlocked ? (
                      <View style={styles.validationActions}>
                        <Pressable
                          style={[styles.validationAction, styles.validationActionPrimary]}
                          onPress={() => router.push("/location-picker")}
                        >
                          <Ionicons name="location-outline" size={14} color={palette.surface} />
                          <Text style={styles.validationActionPrimaryText}>Change location</Text>
                        </Pressable>
                        <Pressable
                          style={styles.validationAction}
                          onPress={() => {
                            void handleUseCurrentLocation();
                          }}
                        >
                          <Ionicons name="navigate-circle-outline" size={14} color={palette.foreground} />
                          <Text style={styles.validationActionText}>My location</Text>
                        </Pressable>
                      </View>
                    ) : null}
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
                    Reordered from {formatShortOrderIdLabel(reorderContext.orderNumber)}
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
                      <RemoteImage
                        uri={item.imageUrl}
                        style={styles.itemImage}
                        fallbackIcon="fast-food-outline"
                        fallbackIconSize={20}
                        fallbackTint={palette.primary}
                        accessibilityLabel={`${item.name} cart item photo`}
                      />

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
                        ? appliedAutoVoucher
                          ? `${appliedAutoVoucher.name} is applied to this cart.`
                          : "This discount will apply automatically at checkout."
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
                    <Text style={[styles.summaryLabel, styles.summaryHighlight]}>
                      {appliedAutoVoucher
                        ? `Discount (${appliedAutoVoucher.name})`
                        : "Discount"}
                    </Text>
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
                    {isServiceabilityBlocked
                      ? "Location needs update"
                      : !customer
                        ? "Sign in first"
                        : "Ready for checkout"}
                  </Text>
                  <Text style={styles.checkoutAmount}>
                    {formatCurrency(pricing?.total ?? localSubtotal)}
                  </Text>
                </View>
                <Pressable
                  style={[
                    styles.checkoutButtonLift,
                    checkoutDisabled ? styles.checkoutButtonLiftDisabled : null,
                  ]}
                  onPress={handleCheckout}
                  disabled={checkoutDisabled}
                >
                  <View
                    style={[
                      styles.checkoutButton,
                      checkoutDisabled ? styles.checkoutButtonDisabled : null,
                    ]}
                  >
                    <View style={styles.checkoutButtonSheen} />
                    {quoteQuery.isLoading ? (
                      <ActivityIndicator
                        size="small"
                        color={palette.secondary}
                        style={styles.checkoutButtonSpinner}
                      />
                    ) : null}
                    <Text style={styles.checkoutButtonText}>
                      {!customer
                        ? isServiceabilityBlocked
                          ? "Change location"
                          : "Sign in to checkout"
                        : !isOnline
                          ? "Reconnect to continue"
                        : isServiceabilityBlocked
                          ? "Change location"
                        : hasQuoteIssues
                          ? "Fix cart to continue"
                          : quoteQuery.isLoading
                            ? "Checking latest prices..."
                            : "Continue to checkout"}
                    </Text>
                  </View>
                </Pressable>
              </View>
            </View>
          </>
        )}
      </View>
    </Screen>
  );
}
