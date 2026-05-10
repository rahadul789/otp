import { Ionicons } from "@expo/vector-icons";
import LottieView from "lottie-react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ReorderCartSwitchModal } from "@/src/components/orders/reorder-cart-switch-modal";
import { EmptyStateCard } from "@/src/components/empty-state-card";
import { OfflineNoticeCard } from "@/src/components/offline-notice-card";
import {
  useCustomerOrdersQuery,
  useCustomerReorderMutation,
} from "@/src/hooks/use-customer-api";
import { useIsOnline } from "@/src/hooks/use-network-status";
import { useAppBannerStore } from "@/src/store/app-banner-store";
import { useCustomerAuthStore } from "@/src/store/auth-store";
import { palette } from "@/src/theme/palette";

type CustomerOrderSummary = {
  _id: string;
  restaurantId?: string;
  orderNumber: string;
  status: string;
  paymentMethod: string;
  pricing?: { total?: number };
  itemsSnapshot?: {
    itemId?: string;
    name?: string;
    quantity?: number;
    unitPrice?: number;
    selectedVariantOptions?: { groupName?: string; optionLabel?: string }[];
    selectedAddOnOptions?: { groupName?: string; optionLabel?: string }[];
  }[];
  riderSnapshot?: { name?: string; phone?: string };
  customerSnapshot?: {
    deliveryAddress?: {
      addressLine?: string;
    };
  };
  hasCustomerReview?: boolean;
  createdAt?: string;
  terminalReason?: string;
  cancelledBy?: string;
};

function formatCurrency(amount: number) {
  return `Tk ${amount.toFixed(0)}`;
}

function formatDateTime(value?: string) {
  if (!value) return "Recently";
  return new Date(value).toLocaleString("en-BD", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function isActiveStatus(status: string) {
  return ["New", "Accepted", "Preparing", "ReadyForPickup", "PickedUp"].includes(status);
}

function isCancelledStatus(status: string) {
  return ["Cancelled", "Rejected"].includes(status);
}

function canRateOrder(status: string, hasCustomerReview?: boolean) {
  return status === "Delivered" && !hasCustomerReview;
}

function getCancelledOrderMessage(order: CustomerOrderSummary) {
  if (order.status === "Rejected") return "The restaurant could not accept this order.";
  if (order.cancelledBy === "customer") return "You cancelled this order.";
  if (
    order.cancelledBy === "system" ||
    order.terminalReason === "system_auto_cancel_unaccepted" ||
    order.terminalReason?.toLowerCase().includes("auto-cancel")
  ) {
    return "Auto-cancelled because the restaurant did not accept in time.";
  }
  if (order.cancelledBy === "owner" || order.cancelledBy === "restaurant") {
    return "The restaurant cancelled this order.";
  }
  return "This order was cancelled.";
}

function getStatusTone(status: string) {
  switch (status) {
    case "Delivered":
      return { background: "#EAF7EE", text: palette.successText, icon: "checkmark-circle" as const };
    case "Cancelled":
    case "Rejected":
      return { background: "#FFEAF3", text: palette.primary, icon: "close-circle" as const };
    case "PickedUp":
      return { background: "#E8F1FF", text: palette.sky, icon: "bicycle" as const };
    default:
      return { background: "#FFE8F0", text: palette.secondary, icon: "time" as const };
  }
}

function getActiveOrderHeadline(status: string) {
  switch (status) {
    case "New":
      return "Waiting for restaurant confirmation";
    case "Accepted":
      return "Restaurant confirmed your order";
    case "Preparing":
      return "Your food is being prepared";
    case "ReadyForPickup":
      return "Packed and ready for pickup";
    case "PickedUp":
      return "Rider is on the way";
    default:
      return "Active order";
  }
}

function getActiveOrderSupportingCopy(order: CustomerOrderSummary) {
  switch (order.status) {
    case "New":
      return "The restaurant has received your order and will review it shortly.";
    case "Accepted":
      return "The kitchen has accepted your order and is lining things up now.";
    case "Preparing":
      return "The kitchen is finishing your food now. Pickup updates will show next.";
    case "ReadyForPickup":
      return order.riderSnapshot?.name
        ? `${order.riderSnapshot.name} is lined up to collect your order soon.`
        : "Your order is packed and rider pickup is being coordinated.";
    case "PickedUp":
      return order.riderSnapshot?.name
        ? `${order.riderSnapshot.name} is bringing your order to you now.`
        : "Your rider is on the move with this order.";
    default:
      return "Open the order to see the latest delivery details.";
  }
}

export default function OrdersScreen() {
  const router = useRouter();
  const customer = useCustomerAuthStore((state) => state.customer);
  const ordersQuery = useCustomerOrdersQuery();
  const reorderMutation = useCustomerReorderMutation();
  const showBanner = useAppBannerStore((state) => state.showBanner);
  const isOnline = useIsOnline();
  const [reorderConflictOrder, setReorderConflictOrder] =
    useState<CustomerOrderSummary | null>(null);
  const [reorderConflictMeta, setReorderConflictMeta] = useState<{
    currentRestaurantName: string;
    incomingRestaurantName: string;
    previewItemName: string;
  } | null>(null);

  const orders = ordersQuery.data ?? [];
  const activeOrders = orders.filter((order) => isActiveStatus(order.status));
  const deliveredOrders = orders.filter((order) => order.status === "Delivered");
  const cancelledOrders = orders.filter((order) => isCancelledStatus(order.status));

  const handleReorder = async (order: CustomerOrderSummary, forceReplace = false) => {
    void Haptics.selectionAsync();
    const result = await reorderMutation.mutateAsync({
      order: {
        _id: order._id,
        orderNumber: order.orderNumber,
        restaurantId: order.restaurantId,
        itemsSnapshot: order.itemsSnapshot,
      },
      forceReplace,
    });

    if (result.status === "conflict") {
      setReorderConflictOrder(order);
      setReorderConflictMeta({
        currentRestaurantName: result.currentRestaurantName,
        incomingRestaurantName: result.incomingRestaurantName,
        previewItemName: result.previewItemName,
      });
      return;
    }

    if (result.status === "empty") {
      showBanner({
        title: "Could not reorder this order",
        description:
          result.skippedCount > 0
            ? "Those items are no longer available with their previous configuration."
            : "We could not rebuild this order right now.",
        tone: "warning",
      });
      return;
    }

    showBanner({
      title:
        result.skippedCount > 0
          ? "Reordered what is still available"
          : "Items added to your cart",
      description:
        result.skippedCount > 0
          ? `${result.addedItemCount} item${result.addedItemCount === 1 ? "" : "s"} added. ${result.skippedCount} could not be added.`
          : `Added ${result.addedItemCount} item${result.addedItemCount === 1 ? "" : "s"} from this delivered order.`,
      tone: result.skippedCount > 0 ? "warning" : "success",
    });
    router.push("/(tabs)/cart");
  };

  if (!customer) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.emptyState}>
          <LottieView
            source={require("@/assets/animations/waiting.json")}
            autoPlay
            loop
            style={styles.emptyAnimation}
          />
          <EmptyStateCard
            title="Sign in to see your orders"
            description="Your full order history stays tied to your verified customer account."
            actionLabel="Sign in"
            onPress={() =>
              router.push({
                pathname: "/sign-in",
                params: { redirectTo: "/(tabs)/orders" },
              })
            }
          />
        </View>
      </SafeAreaView>
    );
  }

  if (ordersQuery.isLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.loadingWrap}>
          <View style={styles.loadingCard}>
            <View style={styles.loadingIndicatorWrap}>
              <ActivityIndicator size="small" color={palette.primary} />
            </View>
            <Text style={styles.loadingTitle}>Loading your orders</Text>
            <Text style={styles.loadingText}>
              Pulling your latest delivery timeline and history.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (ordersQuery.isError) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.emptyState}>
          <EmptyStateCard
            title={isOnline ? "Could not load your orders" : "Orders are unavailable offline"}
            description={
              isOnline
                ? "Please try again in a moment."
                : "Reconnect to load your latest order history and live updates."
            }
            actionLabel={isOnline ? "Retry" : "Browse restaurants"}
            onPress={isOnline ? () => ordersQuery.refetch() : () => router.push("/(tabs)/browse")}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (!orders.length) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.emptyState}>
          <LottieView
            source={require("@/assets/animations/waiting.json")}
            autoPlay
            loop
            style={styles.emptyAnimation}
          />
          <EmptyStateCard
            title="No orders yet"
            description="Once you place an order, live status and history will show up here."
            actionLabel="Browse restaurants"
            onPress={() => router.push("/(tabs)/browse")}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.kicker}>Orders</Text>
          <Text style={styles.title}>Track your orders</Text>
          <Text style={styles.subtitle}>
            Live orders stay first, with your past orders right below.
          </Text>
          {!isOnline ? (
            <OfflineNoticeCard description="Showing your last synced orders. Live delivery updates will resume when you're back online." />
          ) : null}
          <View style={styles.statRow}>
            <InfoPill
              icon="flash-outline"
              label="Active"
              value={`${activeOrders.length}`}
              tint="#FFE9F1"
            />
            <InfoPill
              icon="checkmark-done-outline"
              label="Delivered"
              value={`${deliveredOrders.length}`}
              tint="#EAF7EE"
            />
          </View>
        </View>

        {activeOrders.length ? (
          <Section title="Active orders" subtitle="These are the orders that still need your attention.">
            {activeOrders.map((order) => (
              <OrderCard
                key={order._id}
                order={order}
                onPress={() =>
                  router.push({
                    pathname: "/orders/[orderId]",
                    params: { orderId: order._id },
                  })
                }
                onTrackPress={() =>
                  router.push({
                    pathname: "/orders/[orderId]/tracking",
                    params: { orderId: order._id },
                  })
                }
              />
            ))}
          </Section>
        ) : null}

        {deliveredOrders.length ? (
          <Section title="Past orders" subtitle="Delivered orders you may want to revisit or review.">
            {deliveredOrders.map((order) => (
              <OrderCard
                key={order._id}
                order={order}
                reorderPending={reorderMutation.isPending && reorderMutation.variables?.order._id === order._id}
                onReorderPress={() => {
                  void handleReorder(order);
                }}
                onPress={() =>
                  router.push({
                    pathname: "/orders/[orderId]",
                    params: { orderId: order._id },
                  })
                }
              />
            ))}
          </Section>
        ) : null}

        {cancelledOrders.length ? (
          <Section title="Cancelled orders" subtitle="Orders that were cancelled or rejected stay here for later.">
            {cancelledOrders.map((order) => (
              <OrderCard
                key={order._id}
                order={order}
                onPress={() =>
                  router.push({
                    pathname: "/orders/[orderId]",
                    params: { orderId: order._id },
                  })
                }
              />
            ))}
          </Section>
        ) : null}
      </ScrollView>

      <ReorderCartSwitchModal
        visible={Boolean(reorderConflictOrder && reorderConflictMeta)}
        previewItemName={reorderConflictMeta?.previewItemName ?? "Delivered items"}
        currentRestaurantName={reorderConflictMeta?.currentRestaurantName ?? "your current cart"}
        incomingRestaurantName={reorderConflictMeta?.incomingRestaurantName ?? "this restaurant"}
        onClose={() => {
          setReorderConflictOrder(null);
          setReorderConflictMeta(null);
        }}
        onConfirm={() => {
          if (!reorderConflictOrder) return;
          setReorderConflictMeta(null);
          void handleReorder(reorderConflictOrder, true).finally(() => {
            setReorderConflictOrder(null);
          });
        }}
      />
    </SafeAreaView>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionSubtitle}>{subtitle}</Text>
      </View>
      <View style={styles.cardList}>{children}</View>
    </View>
  );
}

function InfoPill({
  icon,
  label,
  value,
  tint,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  tint: string;
}) {
  return (
    <View style={[styles.infoPill, { backgroundColor: tint }]}>
      <View style={styles.infoPillTopRow}>
        <Ionicons name={icon} size={13} color={palette.foreground} />
        <Text style={styles.infoPillLabel}>{label}</Text>
      </View>
      <Text style={styles.infoPillValue}>{value}</Text>
    </View>
  );
}

function OrderCard({
  order,
  onPress,
  onTrackPress,
  onReorderPress,
  reorderPending,
}: {
  order: CustomerOrderSummary;
  onPress: () => void;
  onTrackPress?: () => void;
  onReorderPress?: () => void;
  reorderPending?: boolean;
}) {
  const isActive = isActiveStatus(order.status);
  const isCancelled = isCancelledStatus(order.status);
  const tone = getStatusTone(order.status);

  if (isActive) {
    const progressWidth =
      order.status === "New"
        ? "18%"
        : order.status === "Accepted"
          ? "36%"
          : order.status === "Preparing"
            ? "62%"
            : order.status === "ReadyForPickup"
              ? "80%"
              : "100%";

    return (
      <Pressable
        style={[styles.orderCard, styles.orderCardActive]}
        onPress={onPress}
      >
        <View style={styles.activeCardTopAccent} />

        <View style={styles.orderTopRow}>
          <View style={styles.orderCopy}>
            <View style={styles.activeNowPill}>
              <Ionicons name="radio-outline" size={13} color={palette.secondary} />
              <Text style={styles.activeNowText}>Active order</Text>
            </View>
            <Text style={styles.orderRestaurant}>{getActiveOrderHeadline(order.status)}</Text>
            <Text style={styles.orderMeta}>
              {order.orderNumber} • {formatDateTime(order.createdAt)}
            </Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: tone.background }]}>
            <Ionicons name={tone.icon} size={13} color={tone.text} />
            <Text style={[styles.statusPillText, { color: tone.text }]}>{order.status}</Text>
          </View>
        </View>

        <Text style={styles.activeSummaryText}>
          {getActiveOrderSupportingCopy(order)}
        </Text>

        <View style={styles.activeProgressCard}>
          <View style={styles.activeProgressTopRow}>
            <View style={styles.activeProgressChip}>
              <Ionicons name="bag-handle-outline" size={14} color={palette.secondary} />
              <Text style={styles.activeProgressChipText}>{order.status}</Text>
            </View>
            <Text style={styles.activeProgressMeta}>
              {(order.itemsSnapshot?.length ?? 0)} item{(order.itemsSnapshot?.length ?? 0) === 1 ? "" : "s"} • {order.paymentMethod}
            </Text>
          </View>

          <View style={styles.activeProgressTrack}>
            <View style={[styles.activeProgressFill, { width: progressWidth }]} />
          </View>

          <View style={styles.activeDestinationRow}>
            <Ionicons name="location-outline" size={15} color={palette.mutedForeground} />
            <Text style={styles.orderAddress} numberOfLines={1}>
              {order.customerSnapshot?.deliveryAddress?.addressLine ?? "Delivery address unavailable"}
            </Text>
          </View>
        </View>

        <View style={styles.activeActionsRow}>
          <Pressable style={styles.trackLiveButton} onPress={onTrackPress ?? onPress}>
            <Ionicons
              name={order.status === "PickedUp" ? "radio-outline" : "receipt-outline"}
              size={14}
              color="#fff"
            />
            <Text style={styles.trackLiveButtonText}>
              {order.status === "PickedUp" ? "Track live" : "Open order"}
            </Text>
          </Pressable>

          <View style={styles.orderTotalWrap}>
            <Text style={styles.orderTotal}>{formatCurrency(order.pricing?.total ?? 0)}</Text>
            <Ionicons name="chevron-forward" size={16} color={palette.mutedForeground} />
          </View>
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      style={[styles.orderCard, isActive ? styles.orderCardActive : null]}
      onPress={onPress}
    >
      {isActive ? <View style={styles.activeCardTopAccent} /> : null}

      <View style={styles.orderTopRow}>
        <View style={styles.orderCopy}>
          {isActive ? (
            <View style={styles.activeNowPill}>
              <Ionicons name="radio-outline" size={13} color={palette.secondary} />
              <Text style={styles.activeNowText}>Live order</Text>
            </View>
          ) : null}
          <Text style={styles.orderRestaurant}>{order.orderNumber}</Text>
          <Text style={styles.orderMeta}>{formatDateTime(order.createdAt)}</Text>
          <Text style={styles.orderMeta}>
            {(order.itemsSnapshot?.length ?? 0)} item{(order.itemsSnapshot?.length ?? 0) === 1 ? "" : "s"} • {order.paymentMethod}
          </Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: tone.background }]}>
          <Ionicons name={tone.icon} size={13} color={tone.text} />
          <Text style={[styles.statusPillText, { color: tone.text }]}>{order.status}</Text>
        </View>
      </View>

      <View style={styles.orderItemsWrap}>
        {(order.itemsSnapshot ?? []).slice(0, 3).map((item, index) => (
          <Text key={`${item.itemId ?? item.name ?? "item"}-${index}`} style={styles.orderItemLine}>
            {item.quantity ?? 0} x {item.name ?? "Menu item"}
          </Text>
        ))}
        {(order.itemsSnapshot?.length ?? 0) > 3 ? (
          <Text style={styles.orderMoreItems}>+{(order.itemsSnapshot?.length ?? 0) - 3} more items</Text>
        ) : null}
      </View>

      <View style={styles.orderBottomRow}>
        <View style={styles.orderBottomLeft}>
          {isActive ? (
            <Pressable style={styles.trackLivePill} onPress={onTrackPress ?? onPress}>
              <Ionicons name="radio-outline" size={14} color={palette.secondary} />
              <Text style={styles.trackLiveText}>Track live</Text>
            </Pressable>
          ) : (
            <View style={styles.orderAddressWrap}>
              <Ionicons name="location-outline" size={15} color={palette.mutedForeground} />
              <Text style={styles.orderAddress} numberOfLines={1}>
                {order.customerSnapshot?.deliveryAddress?.addressLine ?? "Delivery address unavailable"}
              </Text>
            </View>
          )}

          {isActive ? (
            <Text style={styles.orderAddress} numberOfLines={1}>
              {order.customerSnapshot?.deliveryAddress?.addressLine ?? "Open for live delivery details."}
            </Text>
          ) : isCancelled ? (
            <Text style={styles.orderAddress} numberOfLines={2}>
              {getCancelledOrderMessage(order)}
            </Text>
          ) : canRateOrder(order.status, order.hasCustomerReview) ? (
            <Text style={styles.orderAddress}>Open to leave your review.</Text>
          ) : (
            <Text style={styles.orderAddress}>Open to see the full breakdown again.</Text>
          )}
        </View>
        <View style={styles.orderTotalWrap}>
          <Text style={styles.orderTotal}>{formatCurrency(order.pricing?.total ?? 0)}</Text>
          <Ionicons name="chevron-forward" size={16} color={palette.mutedForeground} />
        </View>
      </View>

      {order.status === "Delivered" && onReorderPress ? (
        <Pressable
          style={[styles.reorderButton, reorderPending ? styles.reorderButtonDisabled : null]}
          onPress={onReorderPress}
          disabled={reorderPending}
        >
          {reorderPending ? (
            <ActivityIndicator size="small" color={palette.secondary} />
          ) : (
            <>
              <Ionicons name="refresh-outline" size={16} color={palette.secondary} />
              <Text style={styles.reorderButtonText}>Reorder</Text>
            </>
          )}
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: palette.background },
  content: { paddingBottom: 48, gap: 28 },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    gap: 8,
  },
  kicker: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: palette.sky,
  },
  title: {
    fontSize: 31,
    lineHeight: 37,
    fontWeight: "800",
    color: palette.foreground,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 23,
    fontWeight: "500",
    color: palette.mutedForeground,
    maxWidth: "92%",
  },
  statRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 8,
  },
  infoPill: {
    flex: 1,
    minHeight: 70,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 12,
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
    fontWeight: "700",
    color: palette.foreground,
  },
  infoPillValue: {
    fontSize: 19,
    lineHeight: 24,
    fontWeight: "800",
    color: palette.foreground,
  },
  infoPillCaption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    color: palette.mutedForeground,
  },
  section: { gap: 14 },
  sectionHeader: {
    paddingHorizontal: 20,
    gap: 3,
  },
  sectionTitle: {
    fontSize: 21,
    lineHeight: 27,
    fontWeight: "800",
    color: palette.foreground,
  },
  sectionSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "500",
    color: palette.mutedForeground,
  },
  cardList: { paddingHorizontal: 20, gap: 14 },
  orderCard: {
    position: "relative",
    padding: 20,
    borderRadius: 30,
    backgroundColor: palette.surface,
    gap: 14,
    shadowColor: palette.shadow,
    shadowOpacity: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  orderCardActive: {
    backgroundColor: "#FFF8F2",
    borderWidth: 1.5,
    borderColor: "#FFD7C3",
    shadowColor: "rgba(255, 122, 89, 0.24)",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 1,
    shadowRadius: 22,
    elevation: 8,
  },
  activeCardTopAccent: {
    position: "absolute",
    top: 0,
    left: 18,
    right: 18,
    height: 4,
    borderBottomLeftRadius: 999,
    borderBottomRightRadius: 999,
    backgroundColor: palette.primary,
  },
  orderTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  orderCopy: { flex: 1, gap: 4 },
  activeNowPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#FFE8F0",
    marginBottom: 2,
  },
  activeNowText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
    color: palette.secondary,
  },
  orderRestaurant: {
    fontSize: 21,
    lineHeight: 27,
    fontWeight: "800",
    color: palette.foreground,
  },
  orderMeta: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    color: palette.mutedForeground,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statusPillText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
  },
  orderItemsWrap: { gap: 4 },
  orderItemLine: { fontSize: 14, lineHeight: 20, color: palette.foreground },
  orderMoreItems: { fontSize: 12, lineHeight: 16, color: palette.mutedForeground },
  activeSummaryText: {
    fontSize: 13,
    lineHeight: 20,
    color: palette.foreground,
    fontWeight: "600",
  },
  activeProgressCard: {
    borderRadius: 22,
    backgroundColor: "#FFFDFE",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: "#F7D7E3",
  },
  activeProgressTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  activeProgressChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    backgroundColor: "#FFEAF3",
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  activeProgressChipText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    color: palette.secondary,
  },
  activeProgressMeta: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    color: palette.mutedForeground,
    flexShrink: 1,
    textAlign: "right",
  },
  activeProgressTrack: {
    width: "100%",
    height: 8,
    borderRadius: 999,
    backgroundColor: "#F7DDE7",
    overflow: "hidden",
  },
  activeProgressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: palette.secondary,
  },
  activeDestinationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  activeActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  trackLiveButton: {
    minHeight: 42,
    borderRadius: 999,
    backgroundColor: palette.secondary,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  trackLiveButtonText: {
    fontSize: 13,
    lineHeight: 18,
    color: "#fff",
    fontWeight: "800",
  },
  orderBottomRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 12,
  },
  orderBottomLeft: {
    flex: 1,
    gap: 6,
  },
  orderAddressWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  orderAddress: { fontSize: 12, lineHeight: 18, color: palette.mutedForeground, flex: 1 },
  trackLivePill: {
    alignSelf: "flex-start",
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "#FFE8F0",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  trackLiveText: {
    fontSize: 12,
    lineHeight: 16,
    color: palette.secondary,
    fontWeight: "700",
  },
  orderTotalWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  orderTotal: { fontSize: 14, lineHeight: 18, fontWeight: "700", color: palette.foreground },
  reorderButton: {
    minHeight: 42,
    borderRadius: 999,
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    backgroundColor: "#FFEAF3",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  reorderButtonDisabled: {
    opacity: 0.7,
  },
  reorderButtonText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    color: palette.secondary,
  },
  loadingWrap: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  loadingCard: {
    paddingHorizontal: 22,
    paddingVertical: 24,
    borderRadius: 30,
    backgroundColor: palette.surface,
    alignItems: "center",
    gap: 10,
    shadowColor: palette.shadow,
    shadowOpacity: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  loadingIndicatorWrap: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.primarySoft,
  },
  loadingTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "800",
    color: palette.foreground,
  },
  loadingText: {
    fontSize: 14,
    lineHeight: 22,
    color: palette.mutedForeground,
    textAlign: "center",
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    gap: 10,
  },
  emptyAnimation: {
    width: 190,
    height: 190,
  },
});
