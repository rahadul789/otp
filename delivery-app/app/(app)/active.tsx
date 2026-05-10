import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { startTransition, useCallback, useDeferredValue, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useRiderOrdersQuery } from "@/src/hooks/use-rider-api";
import { useDeliveryCopy } from "@/src/lib/copy";
import { formatDateTime } from "@/src/lib/date-time";
import { useRiderAuthStore } from "@/src/store/auth-store";
import { palette } from "@/src/theme/palette";
import { RiderScreenHeader } from "@/src/components/rider-screen-header";
import { useNetworkStatus } from "@/src/hooks/use-network-status";

export default function ActiveOrdersScreen() {
  const rider = useRiderAuthStore((state) => state.rider);
  const ordersQuery = useRiderOrdersQuery("active");
  const { copy } = useDeliveryCopy();
  const isNetworkOnline = useNetworkStatus();
  const isAssignmentsPaused = rider?.isAvailableForAssignments === false;
  const statusTone = !isNetworkOnline ? "offline" : isAssignmentsPaused ? "paused" : "online";
  const statusLabel = !isNetworkOnline
    ? copy.common.offline
    : isAssignmentsPaused
      ? "Paused"
      : copy.common.online;
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const normalizedSearchQuery = deferredSearchQuery.trim().toLowerCase();
  const activeText = copy.active as Record<string, unknown>;
  const activeCopy = {
    searchPlaceholder: (activeText.searchPlaceholder as string | undefined) ?? "Search active trips",
    noMatchingTitle: (activeText.noMatchingTitle as string | undefined) ?? "No matching trips",
    noMatchingText:
      (activeText.noMatchingText as string | undefined) ?? "Try another search to find the trip you need.",
    tripsCount:
      (activeText.tripsCount as ((count: number) => string) | undefined) ??
      ((count: number) => `${count} ${count === 1 ? "active trip" : "active trips"}`),
  };

  const orders = useMemo(() => ordersQuery.data ?? [], [ordersQuery.data]);
  const filteredOrders = useMemo(
    () =>
      orders.filter((order) =>
        !normalizedSearchQuery
          ? true
          : [order.orderNumber, order.restaurant?.name, order.customer?.name, order.status]
              .filter(Boolean)
              .some((value) => value!.toLowerCase().includes(normalizedSearchQuery))
      ),
    [normalizedSearchQuery, orders]
  );

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await ordersQuery.refetch();
    } finally {
      setIsRefreshing(false);
    }
  }, [ordersQuery]);

  const handleSearchChange = useCallback((value: string) => {
    startTransition(() => {
      setSearchQuery(value);
    });
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <FlatList
        data={filteredOrders}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.headerWrap}>
            <RiderScreenHeader
              icon="flash"
              title={copy.active.title}
              subtitle={copy.active.subtitle}
              statusTone={statusTone}
              statusLabel={statusLabel}
            />

            <View style={styles.searchShell}>
              <Ionicons name="search-outline" size={18} color={palette.mutedForeground} />
              <TextInput
                value={searchQuery}
                onChangeText={handleSearchChange}
                placeholder={activeCopy.searchPlaceholder}
                placeholderTextColor="#9F948A"
                style={styles.searchInput}
              />
              {searchQuery ? (
                <Pressable style={styles.searchClearButton} onPress={() => setSearchQuery("")}>
                  <Ionicons name="close" size={14} color={palette.mutedForeground} />
                </Pressable>
              ) : null}
            </View>

            <Text style={styles.resultsText}>{activeCopy.tripsCount(filteredOrders.length)}</Text>
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => {
              void handleRefresh();
            }}
            tintColor={palette.primaryStrong}
          />
        }
        ListEmptyComponent={
          ordersQuery.isLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="small" color={palette.primaryStrong} />
            </View>
          ) : (
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <Ionicons name="bicycle-outline" size={24} color={palette.primaryStrong} />
              </View>
              <Text style={styles.emptyTitle}>
                {searchQuery ? activeCopy.noMatchingTitle : copy.active.emptyTitle}
              </Text>
              <Text style={styles.emptyText}>
                {searchQuery
                  ? activeCopy.noMatchingText
                  : !isNetworkOnline
                    ? "Reconnect to refresh your active trips."
                    : copy.active.emptyText}
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => router.push(`/orders/${item.id}`)}>
            <View style={styles.row}>
              <Text style={styles.orderNumber}>{item.orderNumber}</Text>
              <View style={styles.tripStatusChip}>
                <Text style={styles.tripStatusText}>{item.status}</Text>
              </View>
            </View>
            <Text style={styles.name}>{item.restaurant?.name ?? copy.common.restaurant}</Text>
            <Text style={styles.metaStrong}>{item.customer?.name ?? copy.common.customer}</Text>
            <Text style={styles.meta}>
              {item.status === "PickedUp" ? "Heading to customer" : "Heading to restaurant"}
            </Text>
            <Text style={styles.meta}>{formatDateTime(item.updatedAt ?? item.createdAt)}</Text>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: palette.background },
  listContent: { paddingHorizontal: 20, paddingBottom: 24, gap: 14, flexGrow: 1 },
  headerWrap: { paddingTop: 16, paddingBottom: 14, gap: 12 },
  searchShell: {
    minHeight: 50,
    borderRadius: 18,
    paddingHorizontal: 14,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: palette.foreground,
    paddingVertical: 0,
  },
  searchClearButton: {
    width: 24,
    height: 24,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceMuted,
  },
  resultsText: {
    fontSize: 12,
    fontWeight: "700",
    color: palette.mutedForeground,
  },
  centered: { minHeight: 320, alignItems: "center", justifyContent: "center" },
  card: {
    backgroundColor: palette.surface,
    borderRadius: 24,
    padding: 16,
    gap: 6,
    borderWidth: 1,
    borderColor: palette.border,
  },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  orderNumber: { fontSize: 16, fontWeight: "800", color: palette.foreground },
  tripStatusChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "#FFE7F0",
  },
  tripStatusText: { fontSize: 12, fontWeight: "800", color: palette.secondary },
  name: { fontSize: 15, fontWeight: "700", color: palette.foreground },
  metaStrong: { fontSize: 13, fontWeight: "700", color: palette.foreground },
  meta: { fontSize: 13, color: palette.mutedForeground },
  emptyState: {
    flex: 1,
    minHeight: 320,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  emptyTitle: { fontSize: 18, fontWeight: "800", color: palette.foreground },
  emptyText: {
    fontSize: 14,
    lineHeight: 21,
    color: palette.mutedForeground,
    textAlign: "center",
    maxWidth: 280,
  },
});
