import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyStateCard } from "@/src/components/empty-state-card";
import { Screen } from "@/src/components/screen";
import {
  useCustomerNotificationsInfiniteQuery,
  useCustomerMarkAllNotificationsReadMutation,
  useCustomerMarkNotificationReadMutation,
  useCustomerNotificationsQuery,
} from "@/src/hooks/use-customer-api";
import { formatDateTimeAmPm } from "@/src/lib/date-time";
import { palette } from "@/src/theme/palette";

function getToneStyle(type: string) {
  switch (type) {
    case "order_status":
      return {
        cardTint: "#FFE8F0",
        icon: "receipt-outline" as const,
        iconColor: palette.secondary,
      };
    case "support_reply":
      return {
        cardTint: "#EAF2FF",
        icon: "chatbubble-ellipses-outline" as const,
        iconColor: palette.sky,
      };
    case "restaurant_status":
      return {
        cardTint: "#FFF2E6",
        icon: "storefront-outline" as const,
        iconColor: palette.primary,
      };
    default:
      return {
        cardTint: "#EAF2FF",
        icon: "notifications-outline" as const,
        iconColor: palette.sky,
      };
  }
}

export default function NotificationsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    fromPush?: string;
    notificationId?: string;
    campaignId?: string;
    targetPath?: string;
  }>();
  const insets = useSafeAreaInsets();
  useCustomerNotificationsQuery();
  const notificationsQuery = useCustomerNotificationsInfiniteQuery();
  const markReadMutation = useCustomerMarkNotificationReadMutation();
  const markAllMutation = useCustomerMarkAllNotificationsReadMutation();
  const pushedNotificationKey = params.notificationId || params.campaignId || "";
  const notifications = useMemo(() => {
    const rawNotifications = notificationsQuery.data?.pages.flatMap((page) => page.items) ?? [];
    if (!pushedNotificationKey) return rawNotifications;
    return [...rawNotifications].sort((left, right) => {
      const leftMatch =
        left.id === pushedNotificationKey || left.campaignId === pushedNotificationKey;
      const rightMatch =
        right.id === pushedNotificationKey || right.campaignId === pushedNotificationKey;
      return Number(rightMatch) - Number(leftMatch);
    });
  }, [pushedNotificationKey, notificationsQuery.data?.pages]);
  const isInitialLoading = notificationsQuery.isLoading && notifications.length === 0;
  const isRefreshing = notificationsQuery.isRefetching && !notificationsQuery.isFetchingNextPage;
  const targetPath = Array.isArray(params.targetPath) ? params.targetPath[0] : params.targetPath;
  const openedFromPush = params.fromPush === "1";

  const openNotification = async (notification: {
    id: string;
    path: string;
    isRead: boolean;
  }) => {
    if (!notification.isRead) {
      await markReadMutation.mutateAsync(notification.id).catch(() => undefined);
    }

    if (notification.path) {
      router.push(notification.path as never);
      return;
    }

    router.push("/(tabs)/orders");
  };

  return (
    <Screen>
      <View style={styles.container}>
        <View style={[styles.topBar, { paddingTop: 4 }]}>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={20} color={palette.foreground} />
          </Pressable>

          <Text style={styles.title}>Notifications</Text>

          <Pressable
            style={[
              styles.markAllButton,
              (markAllMutation.isPending || notifications.length === 0) && styles.buttonDisabled,
            ]}
            disabled={markAllMutation.isPending || notifications.length === 0}
            onPress={() => markAllMutation.mutate()}
          >
            {markAllMutation.isPending ? (
              <ActivityIndicator size="small" color={palette.foreground} />
            ) : (
              <Text style={styles.markAllText}>Mark all read</Text>
            )}
          </Pressable>
        </View>

        {openedFromPush && targetPath ? (
          <View style={styles.pushContextCard}>
            <View style={styles.pushContextIcon}>
              <Ionicons name="open-outline" size={18} color={palette.secondary} />
            </View>
            <View style={styles.pushContextCopy}>
              <Text style={styles.pushContextTitle}>Notification opened</Text>
              <Text style={styles.pushContextText}>
                Review the update here, or continue to the related screen.
              </Text>
            </View>
            <Pressable
              style={styles.pushContextAction}
              onPress={() => router.push(targetPath as never)}
            >
              <Text style={styles.pushContextActionText}>Open</Text>
            </Pressable>
          </View>
        ) : null}

        {isInitialLoading ? (
          <View style={styles.feedbackWrap}>
            <View style={styles.loadingCard}>
              <ActivityIndicator size="small" color={palette.primary} />
              <Text style={styles.loadingText}>Loading notifications...</Text>
            </View>
          </View>
        ) : notificationsQuery.isError ? (
          <View style={styles.feedbackWrap}>
            <EmptyStateCard
              title="Could not load notifications"
              description="Please try again in a moment."
              actionLabel="Retry"
              onPress={() => notificationsQuery.refetch()}
            />
          </View>
        ) : notifications.length === 0 ? (
          <View style={styles.feedbackWrap}>
            <EmptyStateCard
              title="No notifications yet"
              description="Order and restaurant updates will appear here."
            />
          </View>
        ) : (
          <FlatList
            data={notifications}
            keyExtractor={(item) => item.id}
            contentContainerStyle={[
              styles.list,
              { paddingBottom: Math.max(insets.bottom, 16) + 18 },
            ]}
            showsVerticalScrollIndicator={false}
            onRefresh={() => notificationsQuery.refetch()}
            refreshing={isRefreshing}
            onEndReachedThreshold={0.35}
            onEndReached={() => {
              if (notificationsQuery.hasNextPage && !notificationsQuery.isFetchingNextPage) {
                void notificationsQuery.fetchNextPage();
              }
            }}
            ListFooterComponent={
              notificationsQuery.isFetchingNextPage ? (
                <View style={styles.footerLoading}>
                  <ActivityIndicator size="small" color={palette.primary} />
                </View>
              ) : null
            }
            renderItem={({ item: notification }) => {
              const tone = getToneStyle(notification.type);
              const isPushMatch =
                Boolean(pushedNotificationKey) &&
                (notification.id === pushedNotificationKey ||
                  notification.campaignId === pushedNotificationKey);

              return (
                <Pressable
                  key={notification.id}
                  style={[
                    styles.card,
                    !notification.isRead ? styles.cardUnread : null,
                    isPushMatch ? styles.cardFocused : null,
                  ]}
                  onPress={() => openNotification(notification)}
                >
                  <View style={[styles.cardIconWrap, { backgroundColor: tone.cardTint }]}>
                    <Ionicons name={tone.icon} size={18} color={tone.iconColor} />
                  </View>

                  <View style={styles.cardCopy}>
                    <View style={styles.cardHeader}>
                      <Text style={styles.cardTitle}>{notification.title}</Text>
                      {!notification.isRead ? <View style={styles.unreadDot} /> : null}
                    </View>
                    <Text style={styles.cardDescription}>{notification.description}</Text>
                    {notification.imageUrl ? (
                      <Image
                        source={{ uri: notification.imageUrl }}
                        style={styles.cardImage}
                        resizeMode="cover"
                      />
                    ) : null}
                    <View style={styles.cardFooter}>
                      <Text style={styles.cardTime}>{formatDateTimeAmPm(notification.createdAt)}</Text>
                      <Ionicons name="chevron-forward" size={16} color={palette.mutedForeground} />
                    </View>
                  </View>
                </Pressable>
              );
            }}
          />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    paddingHorizontal: 18,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    flex: 1,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "800",
    color: palette.foreground,
  },
  markAllButton: {
    minHeight: 38,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  markAllText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    color: palette.foreground,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  feedbackWrap: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  loadingCard: {
    borderRadius: 24,
    backgroundColor: palette.surface,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    color: palette.mutedForeground,
  },
  list: {
    paddingHorizontal: 18,
    gap: 12,
  },
  pushContextCard: {
    marginHorizontal: 18,
    marginBottom: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#F8BBD0",
    backgroundColor: "#FFF4F8",
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  pushContextIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#FFE3EE",
    alignItems: "center",
    justifyContent: "center",
  },
  pushContextCopy: {
    flex: 1,
    gap: 2,
  },
  pushContextTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    color: palette.foreground,
  },
  pushContextText: {
    fontSize: 12,
    lineHeight: 17,
    color: palette.mutedForeground,
  },
  pushContextAction: {
    minHeight: 36,
    borderRadius: 18,
    backgroundColor: palette.foreground,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  pushContextActionText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    color: palette.surface,
  },
  footerLoading: {
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    flexDirection: "row",
    gap: 12,
    borderRadius: 24,
    backgroundColor: palette.surface,
    padding: 14,
    borderWidth: 1,
    borderColor: "transparent",
  },
  cardUnread: {
    borderColor: "#F5D0DF",
    backgroundColor: "#FFF9FC",
  },
  cardFocused: {
    borderColor: palette.secondary,
    shadowColor: palette.secondary,
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  cardIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  cardCopy: {
    flex: 1,
    gap: 6,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    color: palette.foreground,
  },
  unreadDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: palette.secondary,
  },
  cardDescription: {
    fontSize: 13,
    lineHeight: 19,
    color: palette.mutedForeground,
  },
  cardImage: {
    width: "100%",
    height: 132,
    borderRadius: 18,
    backgroundColor: palette.surfaceMuted,
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  cardTime: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    color: palette.mutedForeground,
  },
});
