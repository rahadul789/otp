import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useEffect, useState } from "react";

import { OwnerStatusBadge } from "@/src/components/owner-status-badge";
import { Screen } from "@/src/components/screen";
import { StatusPill } from "@/src/components/status-pill";
import {
  useOwnerLogoutMutation,
  useOwnerPlatformContentQuery,
  useOwnerStoreSettingsQuery,
  useUpdateOwnerStoreSettingsMutation,
} from "@/src/hooks/use-owner-api";
import { useOwnerAuthStore } from "@/src/store/auth-store";
import { palette } from "@/src/theme/palette";

export default function AccountScreen() {
  const router = useRouter();
  const owner = useOwnerAuthStore((state) => state.owner);
  const lifecycleStatus = useOwnerAuthStore((state) => state.restaurantLifecycleStatus);
  const storeQuery = useOwnerStoreSettingsQuery();
  const platformContentQuery = useOwnerPlatformContentQuery();
  const logoutMutation = useOwnerLogoutMutation();
  const updateStoreSettingsMutation = useUpdateOwnerStoreSettingsMutation();
  const [isWebLinkVisible, setIsWebLinkVisible] = useState(false);
  const [contactPhone, setContactPhone] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const store = storeQuery.data;
  const webDashboardUrl =
    platformContentQuery.data?.operations?.ownerApp?.webDashboardUrl?.trim() || "";

  useEffect(() => {
    setContactPhone(store?.contact?.phone ?? "");
  }, [store?.contact?.phone]);

  async function refreshAccount() {
    setIsRefreshing(true);
    try {
      await Promise.all([storeQuery.refetch(), platformContentQuery.refetch()]);
    } finally {
      setIsRefreshing(false);
    }
  }

  function confirmLogout() {
    Alert.alert("Sign out?", "You can sign in again with your owner account.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          await logoutMutation.mutateAsync();
          router.replace("/sign-in" as never);
        },
      },
    ]);
  }

  async function openWebDashboard() {
    if (!webDashboardUrl) {
      Alert.alert("Link not configured", "Ask admin to add the owner dashboard URL.");
      return;
    }

    const canOpen = await Linking.canOpenURL(webDashboardUrl);
    if (!canOpen) {
      Alert.alert("Cannot open link", webDashboardUrl);
      return;
    }

    await Linking.openURL(webDashboardUrl);
  }

  async function saveRestaurantContact() {
    const cleanPhone = contactPhone.replace(/\D/g, "").slice(0, 11);
    setContactPhone(cleanPhone);

    if (!/^01\d{9}$/.test(cleanPhone)) {
      Alert.alert("Invalid phone number", "Enter a valid 11-digit restaurant contact number.");
      return;
    }

    try {
      await updateStoreSettingsMutation.mutateAsync({ phone: cleanPhone });
      Alert.alert("Contact updated", "Riders will see this restaurant contact number.");
    } catch (error) {
      Alert.alert(
        "Unable to update contact",
        error instanceof Error ? error.message : "Please try again.",
      );
    }
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={refreshAccount}
            tintColor={palette.primary}
          />
        }
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Account</Text>
            <Text style={styles.subtitle}>Owner access and restaurant status.</Text>
          </View>
          <OwnerStatusBadge isOnline={store?.runtime?.isOnline} />
        </View>

        <View style={styles.profileCard}>
          <Text style={styles.profileName}>{owner?.fullName ?? "Owner"}</Text>
          <Text style={styles.profilePhone}>{owner?.phone ?? "Phone not available"}</Text>
          <View style={styles.pillRow}>
            <StatusPill
              label={owner?.isPhoneVerified ? "Phone verified" : "Phone pending"}
              tone={owner?.isPhoneVerified ? "success" : "warning"}
            />
            <StatusPill
              label={lifecycleStatus || "Restaurant status"}
              tone={lifecycleStatus === "approved" ? "success" : "info"}
            />
          </View>
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.restaurantTop}>
            <View style={styles.restaurantIcon}>
              <Ionicons name="restaurant-outline" size={19} color={palette.primary} />
            </View>
            <View style={styles.restaurantTextWrap}>
              <Text numberOfLines={1} style={styles.restaurantName}>
                {store?.name ?? "Restaurant"}
              </Text>
              <Text style={styles.restaurantMeta}>
                {store?.runtime?.isOnline ? "Online for orders" : "Offline now"}
              </Text>
            </View>
            <StatusPill
              label={store?.runtime?.isOnline ? "Online" : "Offline"}
              tone={store?.runtime?.isOnline ? "success" : "danger"}
            />
          </View>
        </View>

        <View style={styles.contactCard}>
          <View style={styles.contactHeader}>
            <View style={styles.restaurantIcon}>
              <Ionicons name="call-outline" size={19} color={palette.primary} />
            </View>
            <View style={styles.restaurantTextWrap}>
              <Text style={styles.restaurantName}>Restaurant contact</Text>
              <Text style={styles.restaurantMeta}>Shown to riders for pickup and order help.</Text>
            </View>
          </View>
          <View style={styles.phoneInputShell}>
            <Ionicons name="call-outline" size={17} color={palette.mutedForeground} />
            <TextInput
              value={contactPhone}
              onChangeText={(value) => setContactPhone(value.replace(/\D/g, "").slice(0, 11))}
              placeholder="01XXXXXXXXX"
              placeholderTextColor="#9A8D91"
              keyboardType="phone-pad"
              style={styles.phoneInput}
              maxLength={11}
            />
          </View>
          <Pressable
            style={[
              styles.saveContactButton,
              updateStoreSettingsMutation.isPending ? styles.disabled : null,
            ]}
            onPress={saveRestaurantContact}
            disabled={updateStoreSettingsMutation.isPending}
          >
            {updateStoreSettingsMutation.isPending ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Text style={styles.saveContactText}>Save contact</Text>
                <Ionicons name="checkmark-circle-outline" size={17} color="#FFFFFF" />
              </>
            )}
          </Pressable>
        </View>

        <View style={styles.infoCard}>
          <Ionicons name="desktop-outline" size={19} color={palette.primary} />
          <View style={styles.infoTextWrap}>
            <Text style={styles.infoTitle}>Use web for setup</Text>
            <Text style={styles.infoText}>
              Menu creation, full restaurant settings, reports, and advanced analytics stay on
              the web dashboard.
            </Text>
            {isWebLinkVisible ? (
              <View style={styles.webLinkBox}>
                <Text selectable style={styles.webLinkText}>
                  {webDashboardUrl || "Admin has not configured the web dashboard link."}
                </Text>
                {webDashboardUrl ? (
                  <Pressable style={styles.openLinkButton} onPress={openWebDashboard}>
                    <Text style={styles.openLinkText}>Open</Text>
                    <Ionicons name="open-outline" size={15} color="#FFFFFF" />
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
          <Pressable
            hitSlop={8}
            onPress={() => setIsWebLinkVisible((value) => !value)}
          >
            <Text style={styles.showLinkText}>{isWebLinkVisible ? "Hide" : "Show"}</Text>
          </Pressable>
        </View>

        <Pressable
          style={[styles.logoutButton, logoutMutation.isPending ? styles.disabled : null]}
          onPress={confirmLogout}
          disabled={logoutMutation.isPending}
        >
          {logoutMutation.isPending ? (
            <ActivityIndicator size="small" color={palette.danger} />
          ) : (
            <>
              <Ionicons name="log-out-outline" size={18} color={palette.danger} />
              <Text style={styles.logoutText}>Sign out</Text>
            </>
          )}
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 18,
    gap: 14,
  },
  header: {
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
  subtitle: {
    marginTop: 3,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
    color: palette.mutedForeground,
  },
  profileCard: {
    borderRadius: 22,
    backgroundColor: palette.surface,
    padding: 16,
    gap: 8,
    shadowColor: palette.shadow,
    shadowOpacity: 1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  profileName: {
    fontSize: 21,
    lineHeight: 27,
    fontWeight: "900",
    color: palette.foreground,
  },
  profilePhone: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.mutedForeground,
  },
  pillRow: {
    marginTop: 4,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  sectionCard: {
    borderRadius: 20,
    backgroundColor: palette.surface,
    padding: 15,
  },
  contactCard: {
    borderRadius: 20,
    backgroundColor: palette.surface,
    padding: 15,
    gap: 12,
  },
  contactHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  restaurantTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  restaurantIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.primarySoft,
  },
  restaurantTextWrap: {
    flex: 1,
  },
  restaurantName: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
    color: palette.foreground,
  },
  restaurantMeta: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
    color: palette.mutedForeground,
  },
  phoneInputShell: {
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.background,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 13,
  },
  phoneInput: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
    color: palette.foreground,
    paddingVertical: 0,
    includeFontPadding: false,
  },
  saveContactButton: {
    minHeight: 46,
    borderRadius: 15,
    backgroundColor: palette.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  saveContactText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  infoCard: {
    borderRadius: 20,
    backgroundColor: palette.primarySoft,
    padding: 15,
    flexDirection: "row",
    gap: 11,
  },
  infoTextWrap: {
    flex: 1,
    gap: 3,
  },
  infoTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "900",
    color: palette.foreground,
  },
  infoText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
    color: palette.mutedForeground,
  },
  showLinkText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
    color: palette.primary,
  },
  webLinkBox: {
    marginTop: 10,
    borderRadius: 14,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 10,
    gap: 10,
  },
  webLinkText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.foreground,
  },
  openLinkButton: {
    alignSelf: "flex-start",
    minHeight: 36,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: palette.foreground,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  openLinkText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  logoutButton: {
    minHeight: 52,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: palette.dangerSoft,
    backgroundColor: palette.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  logoutText: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "900",
    color: palette.danger,
  },
  disabled: {
    opacity: 0.7,
  },
});
