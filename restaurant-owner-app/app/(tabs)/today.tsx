import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";

import { OwnerStatusBadge } from "@/src/components/owner-status-badge";
import { Screen } from "@/src/components/screen";
import { StatusPill } from "@/src/components/status-pill";
import {
  useOwnerDashboardSummaryQuery,
  useOwnerOrdersQuery,
  useOwnerStoreSettingsQuery,
  useUpdateOwnerRestaurantStatusMutation,
} from "@/src/hooks/use-owner-api";
import { formatCurrency, formatTime, getOrderPlacedAt } from "@/src/lib/format";
import {
  formatAutoCancelCountdown,
  getAutoCancelRemainingSeconds,
  getPrepStartRemainingSeconds,
  getPreparationLateSeconds,
  getPreparationRemainingSeconds,
  getOrderStatusLabel,
  getOrderStatusTone,
} from "@/src/lib/order-status";
import { palette } from "@/src/theme/palette";

export default function TodayScreen() {
  const router = useRouter();
  const storeQuery = useOwnerStoreSettingsQuery();
  const dashboardQuery = useOwnerDashboardSummaryQuery();
  const liveOrdersQuery = useOwnerOrdersQuery(true, {
    tab: "live",
    pageSize: 5,
  });
  const statusMutation = useUpdateOwnerRestaurantStatusMutation();
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now());
  const store = storeQuery.data;
  const dashboard = dashboardQuery.data;
  const liveOrders = liveOrdersQuery.data?.items ?? [];
  const isOnline = store?.runtime?.isOnline ?? dashboard?.restaurant.isOnline ?? false;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  async function handleToggleOnline() {
    try {
      await statusMutation.mutateAsync({ isOnline: !isOnline });
    } catch {
      return;
    }
  }

  async function refreshAll() {
    setIsPullRefreshing(true);
    try {
      await Promise.all([
        storeQuery.refetch(),
        dashboardQuery.refetch(),
        liveOrdersQuery.refetch(),
      ]);
    } finally {
      setIsPullRefreshing(false);
    }
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isPullRefreshing}
            onRefresh={refreshAll}
            tintColor={palette.primary}
          />
        }
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>Owner operations</Text>
            <Text style={styles.title}>Today</Text>
          </View>
          <OwnerStatusBadge isOnline={isOnline} />
        </View>

        <View style={styles.restaurantCard}>
          <View style={styles.restaurantTop}>
            <View style={styles.restaurantNameWrap}>
              <Text numberOfLines={1} style={styles.restaurantName}>
                {store?.name ?? dashboard?.restaurant.name ?? "Restaurant"}
              </Text>
              <StatusPill
                label={isOnline ? "Online" : "Offline"}
                tone={isOnline ? "success" : "danger"}
              />
            </View>
            <View style={styles.switchWrap}>
              {statusMutation.isPending ? (
                <ActivityIndicator size="small" color={palette.primary} />
              ) : null}
              <Switch
                value={isOnline}
                disabled={statusMutation.isPending}
                onValueChange={handleToggleOnline}
                trackColor={{ false: palette.dangerSoft, true: palette.successSoft }}
                thumbColor={isOnline ? palette.success : palette.danger}
              />
            </View>
          </View>
          <Text style={styles.restaurantMeta}>
            {store?.runtime?.currentOperationalStatus ??
              dashboard?.restaurant.currentOperationalStatus ??
              "Operational status will appear here."}
          </Text>
        </View>

        <View style={styles.metricGrid}>
          <MetricCard
            label="Orders"
            value={`${dashboard?.metrics.totalOrders ?? 0}`}
            icon="receipt-outline"
          />
          <MetricCard
            label="Sales"
            value={formatCurrency(dashboard?.metrics.totalRevenue)}
            icon="cash-outline"
          />
          <MetricCard
            label="Pending"
            value={`${dashboard?.metrics.pendingOrders ?? liveOrders.length}`}
            icon="time-outline"
          />
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Live orders</Text>
          <Pressable onPress={() => router.push("/(tabs)/orders" as never)}>
            <Text style={styles.sectionAction}>View all</Text>
          </Pressable>
        </View>

        {liveOrdersQuery.isLoading ? (
          <View style={styles.feedbackCard}>
            <ActivityIndicator size="small" color={palette.primary} />
            <Text style={styles.feedbackText}>Loading live orders</Text>
          </View>
        ) : liveOrders.length ? (
          <View style={styles.orderList}>
            {liveOrders.map((order) => {
              const placedTime = formatTime(getOrderPlacedAt(order));
              const autoCancelSeconds = getAutoCancelRemainingSeconds(order, now);
              const prepStartSeconds = getPrepStartRemainingSeconds(order, now);
              const prepRemainingSeconds = getPreparationRemainingSeconds(order, now);
              const prepLateSeconds = getPreparationLateSeconds(order, now);
              const showPrepPill =
                prepStartSeconds !== null || prepRemainingSeconds !== null;
              const prepPillText =
                order.status === "Accepted" && prepStartSeconds !== null
                  ? `Prep in ${formatAutoCancelCountdown(prepStartSeconds)}`
                  : order.status === "Preparing" && prepRemainingSeconds !== null
                    ? prepRemainingSeconds > 0
                      ? `Prep ${formatAutoCancelCountdown(prepRemainingSeconds)}`
                      : `Late ${formatAutoCancelCountdown(prepLateSeconds)}`
                    : "";

              return (
                <Pressable
                  key={order._id}
                  style={styles.orderCard}
                  onPress={() =>
                    router.push({
                      pathname: "/orders/[orderId]",
                      params: { orderId: order._id },
                    } as never)
                  }
                >
                  <View style={styles.orderRow}>
                    <View style={styles.orderTextBlock}>
                      <Text style={styles.orderNumber}>{order.orderNumber}</Text>
                      <Text style={styles.orderMeta}>
                        {order.customerSnapshot?.fullName || "Customer"} -{" "}
                        {order.itemsSnapshot?.length ?? 0} items
                      </Text>
                      {order.status === "New" ? (
                        <Text style={styles.orderPlacedText}>
                          Placed {placedTime || "just now"}
                        </Text>
                      ) : null}
                    </View>
                    <View style={styles.orderStatusStack}>
                      <StatusPill
                        label={getOrderStatusLabel(order.status)}
                        tone={getOrderStatusTone(order.status)}
                      />
                      {autoCancelSeconds !== null ? (
                        <View style={styles.autoCancelPill}>
                          <Ionicons
                            name="timer-outline"
                            size={12}
                            color={palette.danger}
                          />
                          <Text style={styles.autoCancelText}>
                            {formatAutoCancelCountdown(autoCancelSeconds)}
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
                            color={
                              prepRemainingSeconds === 0
                                ? palette.danger
                                : palette.primary
                            }
                          />
                          <Text
                            style={[
                              styles.prepPillText,
                              prepRemainingSeconds === 0
                                ? styles.prepPillTextLate
                                : null,
                            ]}
                          >
                            {prepPillText}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <Ionicons name="checkmark-done-outline" size={26} color={palette.success} />
            <Text style={styles.emptyTitle}>No active orders</Text>
            <Text style={styles.emptyText}>
              New orders will appear here as soon as customers place them.
            </Text>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function MetricCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <View style={styles.metricCard}>
      <Ionicons name={icon} size={18} color={palette.primary} />
      <Text numberOfLines={1} style={styles.metricValue}>
        {value}
      </Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 18,
    gap: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  kicker: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
    color: palette.primary,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 31,
    lineHeight: 38,
    fontWeight: "900",
    color: palette.foreground,
  },
  restaurantCard: {
    borderRadius: 22,
    backgroundColor: palette.surface,
    padding: 16,
    gap: 10,
    shadowColor: palette.shadow,
    shadowOpacity: 1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  restaurantTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  restaurantNameWrap: {
    flex: 1,
    gap: 8,
  },
  restaurantName: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "900",
    color: palette.foreground,
  },
  restaurantMeta: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
    color: palette.mutedForeground,
  },
  switchWrap: {
    minHeight: 44,
    minWidth: 78,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  metricGrid: {
    flexDirection: "row",
    gap: 10,
  },
  metricCard: {
    flex: 1,
    minHeight: 94,
    borderRadius: 18,
    backgroundColor: palette.surface,
    padding: 13,
    justifyContent: "center",
    gap: 5,
  },
  metricValue: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "900",
    color: palette.foreground,
  },
  metricLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
    color: palette.mutedForeground,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    fontSize: 19,
    lineHeight: 25,
    fontWeight: "900",
    color: palette.foreground,
  },
  sectionAction: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "900",
    color: palette.primary,
  },
  feedbackCard: {
    minHeight: 120,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: palette.surface,
  },
  feedbackText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.mutedForeground,
  },
  orderList: {
    gap: 10,
  },
  orderCard: {
    borderRadius: 18,
    backgroundColor: palette.surface,
    padding: 14,
  },
  orderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  orderTextBlock: {
    flex: 1,
  },
  orderNumber: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
    color: palette.foreground,
  },
  orderMeta: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
    color: palette.mutedForeground,
  },
  orderPlacedText: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
    color: palette.primary,
  },
  orderStatusStack: {
    alignItems: "flex-end",
    gap: 6,
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
  emptyCard: {
    minHeight: 150,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: palette.surface,
    padding: 18,
  },
  emptyTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "900",
    color: palette.foreground,
  },
  emptyText: {
    textAlign: "center",
    fontSize: 13,
    lineHeight: 19,
    color: palette.mutedForeground,
    fontWeight: "600",
  },
});
