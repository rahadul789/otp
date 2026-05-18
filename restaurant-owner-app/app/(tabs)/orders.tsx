import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { OwnerStatusBadge } from "@/src/components/owner-status-badge";
import { Screen } from "@/src/components/screen";
import { StatusPill } from "@/src/components/status-pill";
import {
  type OwnerOrder,
  type OwnerOrderStatus,
  useOwnerOrdersQuery,
  useOwnerOrderTransitionMutation,
} from "@/src/hooks/use-owner-api";
import { formatCurrency, formatTime, getOrderPlacedAt } from "@/src/lib/format";
import {
  canOwnerCancelOrder,
  formatAutoCancelCountdown,
  getAutoCancelRemainingSeconds,
  getPrepStartRemainingSeconds,
  getPreparationLateSeconds,
  getPreparationRemainingSeconds,
  getOrderStatusLabel,
  getOrderStatusTone,
  isOrderHistoryStatus,
} from "@/src/lib/order-status";
import { palette } from "@/src/theme/palette";

const filters: { label: string; status: OwnerOrderStatus | "" }[] = [
  { label: "Live", status: "" },
  { label: "New", status: "New" },
  { label: "Preparing", status: "Preparing" },
  { label: "Ready", status: "ReadyForPickup" },
  { label: "Done", status: "Delivered" },
  { label: "Cancelled", status: "Cancelled" },
];

export default function OrdersScreen() {
  const router = useRouter();
  const [selectedStatus, setSelectedStatus] = useState<OwnerOrderStatus | "">("");
  const [pendingAction, setPendingAction] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now());
  const isHistoryStatus = isOrderHistoryStatus(selectedStatus);
  const ordersQuery = useOwnerOrdersQuery(true, {
    tab: isHistoryStatus ? "history" : "live",
    status: selectedStatus || undefined,
    pageSize: 80,
  });
  const transitionMutation = useOwnerOrderTransitionMutation();
  const orders = ordersQuery.data?.items ?? [];

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  async function transitionOrder(
    order: OwnerOrder,
    nextStatus: "Accepted" | "Rejected" | "Preparing" | "ReadyForPickup" | "Cancelled",
    note?: string,
  ) {
    const actionKey = `${order._id}:${nextStatus}`;
    setPendingAction(actionKey);
    try {
      await transitionMutation.mutateAsync({
        orderId: order._id,
        nextStatus,
        note,
      });
    } catch (error) {
      Alert.alert(
        "Order update failed",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setPendingAction("");
    }
  }

  function confirmReject(order: OwnerOrder) {
    Alert.alert(
      "Reject order?",
      "This will notify the customer that the restaurant cannot accept the order.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reject",
          style: "destructive",
          onPress: () =>
            void transitionOrder(order, "Rejected", "Rejected from owner mobile app."),
        },
      ],
    );
  }

  function confirmCancel(order: OwnerOrder) {
    Alert.alert(
      "Cancel order?",
      "This will notify the customer and stop the current order flow.",
      [
        { text: "Keep order", style: "cancel" },
        {
          text: "Cancel order",
          style: "destructive",
          onPress: () =>
            void transitionOrder(order, "Cancelled", "Cancelled from owner mobile app."),
        },
      ],
    );
  }

  async function refreshOrders() {
    setIsRefreshing(true);
    try {
      await ordersQuery.refetch();
    } finally {
      setIsRefreshing(false);
    }
  }

  function openOrderDetails(orderId: string) {
    router.push({
      pathname: "/orders/[orderId]",
      params: { orderId },
    } as never);
  }

  function renderOrder({ item }: { item: OwnerOrder }) {
    const isCardPending = pendingAction.startsWith(`${item._id}:`);
    const isActionPending = (nextStatus: string) =>
      pendingAction === `${item._id}:${nextStatus}`;
    const autoCancelSeconds = getAutoCancelRemainingSeconds(item, now);
    const prepStartSeconds = getPrepStartRemainingSeconds(item, now);
    const prepRemainingSeconds = getPreparationRemainingSeconds(item, now);
    const prepLateSeconds = getPreparationLateSeconds(item, now);
    const showPrepPill = prepStartSeconds !== null || prepRemainingSeconds !== null;
    const prepPillText =
      item.status === "Accepted" && prepStartSeconds !== null
        ? `Prep in ${formatAutoCancelCountdown(prepStartSeconds)}`
        : item.status === "Preparing" && prepRemainingSeconds !== null
          ? prepRemainingSeconds > 0
            ? `Prep ${formatAutoCancelCountdown(prepRemainingSeconds)}`
            : `Late ${formatAutoCancelCountdown(prepLateSeconds)}`
          : "";

    return (
      <Pressable
        style={styles.orderCard}
        onPress={() => openOrderDetails(item._id)}
      >
        <View style={styles.orderTop}>
          <View style={styles.orderMain}>
            <Text style={styles.orderNumber}>{item.orderNumber}</Text>
            <Text style={styles.orderMeta}>
              {formatTime(getOrderPlacedAt(item)) || "Just now"} -{" "}
              {item.itemsSnapshot?.length ?? 0} items -{" "}
              {item.paymentMethod || "Payment"}
            </Text>
          </View>
          <View style={styles.orderStatusStack}>
            <StatusPill
              label={getOrderStatusLabel(item.status)}
              tone={getOrderStatusTone(item.status)}
            />
            {autoCancelSeconds !== null ? (
              <View style={styles.autoCancelPill}>
                <Ionicons name="timer-outline" size={12} color={palette.danger} />
                <Text style={styles.autoCancelText}>
                  Auto {formatAutoCancelCountdown(autoCancelSeconds)}
                </Text>
              </View>
            ) : null}
            {showPrepPill ? (
              <View
                style={[
                  styles.prepPill,
                  prepRemainingSeconds === 0 ? styles.prepPillLate : null,
                ]}
              >
                <Ionicons
                  name="restaurant-outline"
                  size={12}
                  color={prepRemainingSeconds === 0 ? palette.danger : palette.primary}
                />
                <Text
                  style={[
                    styles.prepPillText,
                    prepRemainingSeconds === 0 ? styles.prepPillTextLate : null,
                  ]}
                >
                  {prepPillText}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        <Text style={styles.customerText}>
          {item.customerSnapshot?.fullName || "Customer"} -{" "}
          {formatCurrency(item.pricing?.total)}
        </Text>

        {item.itemsSnapshot?.slice(0, 3).map((orderItem, index) => (
          <Text key={`${orderItem.itemId ?? orderItem.name}-${index}`} style={styles.itemText}>
            {orderItem.quantity ?? 1}x {orderItem.name ?? "Item"}
          </Text>
        ))}

        <View style={styles.actions}>
          {item.status === "New" ? (
            <>
              <Pressable
                style={[styles.actionButton, styles.rejectButton]}
                disabled={isCardPending}
                onPress={() => confirmReject(item)}
              >
                {isActionPending("Rejected") ? (
                  <ActivityIndicator size="small" color={palette.danger} />
                ) : (
                  <Text style={styles.rejectButtonText}>Reject</Text>
                )}
              </Pressable>
              <Pressable
                style={[styles.actionButton, styles.acceptButton]}
                disabled={isCardPending}
                onPress={() => transitionOrder(item, "Accepted")}
              >
                {isActionPending("Accepted") ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.acceptButtonText}>Accept</Text>
                )}
              </Pressable>
            </>
          ) : item.status === "Accepted" ? (
            <>
              {canOwnerCancelOrder(item.status) ? (
                <Pressable
                  style={[styles.actionButton, styles.rejectButton]}
                  disabled={isCardPending}
                  onPress={() => confirmCancel(item)}
                >
                  {isActionPending("Cancelled") ? (
                    <ActivityIndicator size="small" color={palette.danger} />
                  ) : (
                    <Text style={styles.rejectButtonText}>Cancel</Text>
                  )}
                </Pressable>
              ) : null}
              <Pressable
                style={[styles.actionButton, styles.acceptButton]}
                disabled={isCardPending}
                onPress={() => transitionOrder(item, "Preparing")}
              >
                {isActionPending("Preparing") ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.acceptButtonText}>Start preparing</Text>
                )}
              </Pressable>
            </>
          ) : item.status === "Preparing" ? (
            <>
              {canOwnerCancelOrder(item.status) ? (
                <Pressable
                  style={[styles.actionButton, styles.rejectButton]}
                  disabled={isCardPending}
                  onPress={() => confirmCancel(item)}
                >
                  {isActionPending("Cancelled") ? (
                    <ActivityIndicator size="small" color={palette.danger} />
                  ) : (
                    <Text style={styles.rejectButtonText}>Cancel</Text>
                  )}
                </Pressable>
              ) : null}
              <Pressable
                style={[styles.actionButton, styles.acceptButton]}
                disabled={isCardPending}
                onPress={() => transitionOrder(item, "ReadyForPickup")}
              >
                {isActionPending("ReadyForPickup") ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.acceptButtonText}>Mark ready</Text>
                )}
              </Pressable>
            </>
          ) : (
            <Pressable
              style={[styles.actionButton, styles.viewButton]}
              onPress={() => openOrderDetails(item._id)}
            >
              <Text style={styles.viewButtonText}>Open details</Text>
            </Pressable>
          )}
        </View>
      </Pressable>
    );
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Orders</Text>
        <OwnerStatusBadge />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroller}
        contentContainerStyle={styles.filterRow}
      >
        {filters.map((filter) => {
          const isActive = selectedStatus === filter.status;
          return (
            <Pressable
              key={filter.label}
              style={[styles.filterChip, isActive ? styles.filterChipActive : null]}
              onPress={() => setSelectedStatus(filter.status)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  isActive ? styles.filterChipTextActive : null,
                ]}
              >
                {filter.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <FlatList
        data={orders}
        keyExtractor={(item) => item._id}
        renderItem={renderOrder}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={refreshOrders}
            tintColor={palette.primary}
          />
        }
        ListEmptyComponent={
          ordersQuery.isLoading ? (
            <View style={styles.feedbackCard}>
              <ActivityIndicator size="small" color={palette.primary} />
              <Text style={styles.feedbackText}>Loading orders</Text>
            </View>
          ) : (
            <View style={styles.feedbackCard}>
              <Ionicons name="receipt-outline" size={26} color={palette.mutedForeground} />
              <Text style={styles.feedbackTitle}>No orders here</Text>
              <Text style={styles.feedbackText}>
                Orders matching this filter will appear here.
              </Text>
            </View>
          )
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "900",
    color: palette.foreground,
  },
  filterScroller: {
    flexGrow: 0,
    height: 54,
    marginBottom: 8,
  },
  filterRow: {
    paddingHorizontal: 18,
    paddingTop: 4,
    paddingBottom: 10,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  filterChip: {
    minHeight: 36,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  filterChipActive: {
    backgroundColor: palette.foreground,
    borderColor: palette.foreground,
  },
  filterChipText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    color: palette.foreground,
  },
  filterChipTextActive: {
    color: "#FFFFFF",
  },
  listContent: {
    paddingHorizontal: 18,
    paddingBottom: 28,
  },
  orderCard: {
    borderRadius: 22,
    backgroundColor: palette.surface,
    padding: 15,
    gap: 10,
  },
  orderTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  orderMain: {
    flex: 1,
  },
  orderStatusStack: {
    alignItems: "flex-end",
    gap: 6,
  },
  orderNumber: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "900",
    color: palette.foreground,
  },
  orderMeta: {
    marginTop: 3,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
    color: palette.mutedForeground,
  },
  customerText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    color: palette.foreground,
  },
  itemText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
    color: palette.mutedForeground,
  },
  actions: {
    flexDirection: "row",
    gap: 8,
  },
  autoCancelPill: {
    minHeight: 24,
    borderRadius: 999,
    paddingHorizontal: 8,
    backgroundColor: palette.dangerSoft,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  autoCancelText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
    color: palette.danger,
  },
  prepPill: {
    minHeight: 24,
    borderRadius: 999,
    paddingHorizontal: 8,
    backgroundColor: palette.primarySoft,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  prepPillLate: {
    backgroundColor: palette.dangerSoft,
  },
  prepPillText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
    color: palette.primary,
  },
  prepPillTextLate: {
    color: palette.danger,
  },
  actionButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  acceptButton: {
    backgroundColor: palette.foreground,
  },
  acceptButtonText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  rejectButton: {
    backgroundColor: palette.dangerSoft,
  },
  rejectButtonText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "900",
    color: palette.danger,
  },
  viewButton: {
    backgroundColor: palette.surfaceMuted,
  },
  viewButtonText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "900",
    color: palette.foreground,
  },
  feedbackCard: {
    minHeight: 240,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 20,
  },
  feedbackTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "900",
    color: palette.foreground,
  },
  feedbackText: {
    textAlign: "center",
    fontSize: 13,
    lineHeight: 19,
    color: palette.mutedForeground,
    fontWeight: "600",
  },
});
