import { Ionicons } from "@expo/vector-icons";
import { Redirect } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { RiderLocationAccessCard } from "@/src/components/rider-location-access-card";
import {
  useLogoutRiderMutation,
  useRiderOrdersQuery,
  useRiderProfileQuery,
  useUpdateRiderAvailabilityMutation,
  useUpdateRiderProfileLocationMutation,
} from "@/src/hooks/use-rider-api";
import { useDeliveryCopy } from "@/src/lib/copy";
import { useRiderAuthStore, type RiderProfile } from "@/src/store/auth-store";
import { palette } from "@/src/theme/palette";
import { RiderScreenHeader } from "@/src/components/rider-screen-header";
import { useNetworkStatus } from "@/src/hooks/use-network-status";
import {
  getBestAvailableRiderLocationPayload,
  openRiderLocationSettings,
  requestRiderBackgroundPermission,
  requestRiderForegroundPermission,
} from "@/src/lib/rider-location-permissions";

export default function ProfileScreen() {
  const rider = useRiderAuthStore((state: { rider: RiderProfile | null }) => state.rider);
  const logoutMutation = useLogoutRiderMutation();
  const profileQuery = useRiderProfileQuery(Boolean(rider));
  const availabilityMutation = useUpdateRiderAvailabilityMutation();
  const locationMutation = useUpdateRiderProfileLocationMutation();
  const activeOrdersQuery = useRiderOrdersQuery("active");
  const historyQuery = useRiderOrdersQuery("history");
  const { copy, language, setLanguage } = useDeliveryCopy();
  const isNetworkOnline = useNetworkStatus();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([profileQuery.refetch(), activeOrdersQuery.refetch(), historyQuery.refetch()]);
    } finally {
      setIsRefreshing(false);
    }
  }, [activeOrdersQuery, historyQuery, profileQuery]);

  const handleAvailabilityToggle = async (nextOnlineState: boolean) => {
    if (!isNetworkOnline) {
      Alert.alert(copy.common.offline, "Reconnect before updating rider availability.");
      return;
    }

    try {
      if (nextOnlineState) {
        const permission = await requestRiderForegroundPermission();
        if (permission.status !== "granted") {
          Alert.alert(
            copy.profile.locationPermissionTitle,
            copy.profile.locationPermissionText,
            [
              { text: "Not now", style: "cancel" },
              {
                text: "Settings",
                onPress: () => {
                  void openRiderLocationSettings();
                },
              },
            ],
          );
          return;
        }

        const locationPayload = await getBestAvailableRiderLocationPayload();
        void requestRiderBackgroundPermission().catch(() => undefined);

        await locationMutation.mutateAsync(locationPayload);

        const updatedProfile = await availabilityMutation.mutateAsync(true);

        if (updatedProfile) {
          void profileQuery.refetch();
        }
        return;
      }

      await availabilityMutation.mutateAsync(false);
    } catch (error) {
      Alert.alert(
        copy.profile.statusUpdateFailed,
        error instanceof Error ? error.message : copy.profile.statusUpdateFailedText
      );
    }
  };

  const handleLogoutPress = useCallback(() => {
    if (logoutMutation.isPending) {
      return;
    }

    Alert.alert("Sign out", "Do you want to sign out from the rider app now?", [
      { text: "Stay here", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: () => logoutMutation.mutate(),
      },
    ]);
  }, [logoutMutation]);

  if (!rider) {
    return <Redirect href="/sign-in" />;
  }

  const profile = profileQuery.data ?? rider;
  const activeOrders = activeOrdersQuery.data ?? [];
  const historyOrders = historyQuery.data ?? [];
  const deliveredOrders = historyOrders.filter((order) => order.status === "Delivered");
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 6);
  weekStart.setHours(0, 0, 0, 0);
  const todayDelivered = deliveredOrders.filter((order) => {
    const updatedAt = new Date(order.updatedAt ?? order.createdAt ?? 0).getTime();
    return updatedAt >= todayStart.getTime() && updatedAt <= now;
  });
  const weeklyDelivered = deliveredOrders.filter((order) => {
    const updatedAt = new Date(order.updatedAt ?? order.createdAt ?? 0).getTime();
    return updatedAt >= weekStart.getTime() && updatedAt <= now;
  });
  const isOnline = profile.isAvailableForAssignments !== false;
  const statusTone = !isNetworkOnline ? "offline" : isOnline ? "online" : "paused";
  const statusLabel = !isNetworkOnline ? copy.common.offline : isOnline ? copy.common.online : "Paused";
  const hasActiveAssignedOrders = activeOrders.length > 0 || Boolean(profile.activeTrackingOrderId);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => {
              void handleRefresh();
            }}
            tintColor={palette.primary}
          />
        }
      >
        <RiderScreenHeader
          icon="bicycle"
          title={profile.fullName}
          subtitle={profile.phone}
          statusTone={statusTone}
          statusLabel={statusLabel}
          rightSlot={<Text style={styles.profileMiniLabel}>{copy.profile.title}</Text>}
        />
        <RiderLocationAccessCard />

        <View style={styles.toggleCard}>
          <View style={styles.toggleContent}>
            <Text style={styles.toggleTitle}>{copy.profile.toggleTitle}</Text>
            {!isNetworkOnline && !availabilityMutation.isPending ? (
              <Text style={styles.toggleHint}>Reconnect before changing your rider status.</Text>
            ) : !isOnline && !availabilityMutation.isPending ? (
              <Text style={styles.toggleHint}>{copy.profile.toggleHint}</Text>
            ) : null}
            {hasActiveAssignedOrders ? (
              <Text style={styles.toggleWarning}>{copy.profile.toggleWarning}</Text>
            ) : null}
          </View>
          <View style={styles.toggleControlWrap}>
            <View
              style={[
                styles.statusBadge,
                isOnline ? styles.statusBadgeOnline : styles.statusBadgeOffline,
              ]}
            >
              <Text
                style={[
                  styles.statusBadgeText,
                  !isNetworkOnline
                    ? styles.statusBadgeTextOffline
                    : isOnline
                      ? styles.statusBadgeTextOnline
                      : styles.statusBadgeTextOffline,
                ]}
              >
                {statusLabel}
              </Text>
            </View>
            {availabilityMutation.isPending || locationMutation.isPending ? (
              <ActivityIndicator size="small" color={palette.primary} />
            ) : (
              <Switch
                value={isOnline}
                onValueChange={handleAvailabilityToggle}
                disabled={!isNetworkOnline || availabilityMutation.isPending || locationMutation.isPending}
                trackColor={{ false: "#E2D5C8", true: "#F7B8A7" }}
                thumbColor={isOnline ? palette.primary : palette.foreground}
              />
            )}
          </View>
        </View>

        <View style={styles.summaryRow}>
          <View style={[styles.summaryCard, styles.summaryPink]}>
            <Text style={styles.summaryLabel}>{copy.profile.today}</Text>
            <Text style={styles.summaryValue}>{todayDelivered.length}</Text>
            <Text style={styles.summaryMeta}>{copy.profile.delivered}</Text>
          </View>
          <View style={[styles.summaryCard, styles.summarySky]}>
            <Text style={styles.summaryLabel}>{copy.profile.last7Days}</Text>
            <Text style={styles.summaryValue}>{weeklyDelivered.length}</Text>
            <Text style={styles.summaryMeta}>{copy.profile.delivered}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{copy.profile.vehicle}</Text>
            <Text style={styles.infoValue}>{profile.vehicleType ?? "cycle"}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{copy.profile.riderStatus}</Text>
            <Text style={styles.infoValue}>{statusLabel}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{copy.profile.liveTrip}</Text>
            <Text style={styles.infoValue}>{profile.activeTrackingOrderId || copy.profile.noActiveLiveTrip}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{copy.profile.activeAssignedOrders}</Text>
            <Text style={styles.infoValue}>{activeOrders.length}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{copy.profile.languageTitle ?? copy.common.language}</Text>
          <View style={styles.languageRow}>
            <Pressable
              style={[styles.languageChip, language === "en" ? styles.languageChipActive : null]}
              onPress={() => setLanguage("en")}
            >
              <Text
                style={[
                  styles.languageChipText,
                  language === "en" ? styles.languageChipTextActive : null,
                ]}
              >
                English
              </Text>
            </Pressable>
            <Pressable
              style={[styles.languageChip, language === "bn" ? styles.languageChipActive : null]}
              onPress={() => setLanguage("bn")}
            >
              <Text
                style={[
                  styles.languageChipText,
                  language === "bn" ? styles.languageChipTextActive : null,
                ]}
              >
                বাংলা
              </Text>
            </Pressable>
          </View>
        </View>

        <Pressable
          style={[styles.logoutButton, logoutMutation.isPending && styles.buttonDisabled]}
          onPress={handleLogoutPress}
          disabled={logoutMutation.isPending}
        >
          {logoutMutation.isPending ? (
              <ActivityIndicator size="small" color={palette.primary} />
          ) : (
            <>
              <Ionicons name="log-out-outline" size={18} color={palette.foreground} />
              <Text style={styles.logoutButtonText}>{copy.common.signOut}</Text>
            </>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: palette.background },
  container: { padding: 20, gap: 16, paddingBottom: 120 },
  profileMiniLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: palette.mutedForeground,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  summaryRow: { flexDirection: "row", gap: 12 },
  summaryCard: {
    flex: 1,
    borderRadius: 18,
    padding: 16,
    gap: 6,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  summaryPink: {},
  summarySky: {},
  summaryLabel: { fontSize: 12, fontWeight: "800", color: palette.mutedForeground, textTransform: "uppercase" },
  summaryValue: { fontSize: 18, fontWeight: "800", color: palette.foreground },
  summaryMeta: { fontSize: 12, color: palette.mutedForeground },
  card: {
    backgroundColor: palette.surface,
    borderRadius: 18,
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: palette.border,
  },
  infoRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  infoLabel: { fontSize: 14, color: palette.mutedForeground, flex: 1 },
  infoValue: { fontSize: 14, fontWeight: "700", color: palette.foreground, flex: 1, textAlign: "right" },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
  },
  statusBadgeOnline: { backgroundColor: palette.successSoft, borderColor: "#BFE6D1" },
  statusBadgeOffline: { backgroundColor: "#F4EDE6", borderColor: palette.border },
  statusBadgeText: { fontSize: 12, fontWeight: "800" },
  statusBadgeTextOnline: { color: palette.success },
  statusBadgeTextOffline: { color: palette.mutedForeground },
  toggleCard: {
    backgroundColor: palette.surface,
    borderRadius: 18,
    padding: 18,
    gap: 14,
    borderWidth: 1,
    borderColor: palette.border,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  toggleContent: { flex: 1, gap: 6, paddingRight: 12 },
  toggleTitle: { fontSize: 16, fontWeight: "800", color: palette.foreground },
  toggleHint: { fontSize: 13, color: palette.primary, fontWeight: "700" },
  toggleWarning: { fontSize: 13, color: palette.warning, fontWeight: "700" },
  toggleControlWrap: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  sectionTitle: { fontSize: 15, fontWeight: "800", color: palette.foreground },
  languageRow: { flexDirection: "row", gap: 10 },
  languageChip: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceMuted,
    borderWidth: 1,
    borderColor: palette.border,
  },
  languageChipActive: {
    backgroundColor: palette.primarySoft,
    borderColor: "#FFD0C3",
  },
  languageChipText: { fontSize: 14, fontWeight: "700", color: palette.mutedForeground },
  languageChipTextActive: { color: palette.primary },
  logoutButton: {
    minHeight: 56,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  buttonDisabled: { opacity: 0.72 },
  logoutButtonText: { fontSize: 16, fontWeight: "800", color: palette.foreground },
});
