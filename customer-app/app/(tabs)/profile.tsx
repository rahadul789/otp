import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { EmptyStateCard } from "@/src/components/empty-state-card";
import { LocationSelectorSheet } from "@/src/components/location-selector-sheet";
import { OfflineNoticeCard } from "@/src/components/offline-notice-card";
import { Screen } from "@/src/components/screen";
import {
  useCustomerFavoriteRestaurantIdsQuery,
  useCustomerLogoutMutation,
  useCustomerNotificationsQuery,
  useCustomerProfileQuery,
} from "@/src/hooks/use-customer-api";
import { formatDateTimeAmPm } from "@/src/lib/date-time";
import { useIsOnline } from "@/src/hooks/use-network-status";
import { useCustomerAuthStore } from "@/src/store/auth-store";
import { useLocationStore } from "@/src/store/location-store";
import { palette } from "@/src/theme/palette";

export default function ProfileScreen() {
  const router = useRouter();
  const [isLocationSheetOpen, setIsLocationSheetOpen] = useState(false);
  const customer = useCustomerAuthStore((state) => state.customer);
  useCustomerProfileQuery();
  const selectedLocation = useLocationStore((state) => state.selectedLocation);
  const savedLocations = useLocationStore((state) => state.savedLocations);
  const logoutMutation = useCustomerLogoutMutation();
  const notificationsQuery = useCustomerNotificationsQuery();
  const favoriteRestaurantIdsQuery = useCustomerFavoriteRestaurantIdsQuery();
  const isOnline = useIsOnline();
  const unreadCount = notificationsQuery.data?.unreadCount ?? 0;
  const favoriteCount = favoriteRestaurantIdsQuery.data?.length ?? 0;

  const displayName = useMemo(() => customer?.fullName || "Customer", [customer?.fullName]);
  const initials = useMemo(() => {
    const base = displayName
      .split(" ")
      .map((part) => part.trim().charAt(0))
      .join("")
      .slice(0, 2)
      .toUpperCase();

    if (base) return base;
    return customer?.phone?.slice(-2) ?? "CU";
  }, [customer?.phone, displayName]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {!customer ? (
          <View style={styles.emptyWrap}>
            <EmptyStateCard
              title="You are not signed in"
              description="Sign in with your phone to unlock checkout, saved locations, and order history."
              actionLabel="Sign in"
              onPress={() =>
                router.push({
                  pathname: "/sign-in",
                  params: { redirectTo: "/(tabs)/profile" },
                })
              }
            />
          </View>
        ) : (
          <>
            <View style={styles.hero}>
              <View style={styles.heroGlowPrimary} />
              <View style={styles.heroGlowSecondary} />

              <View style={styles.heroTopRow}>
                <Text style={styles.kicker}>Profile</Text>
                <Pressable style={styles.heroGhostButton} onPress={() => router.push("/notifications")}>
                  <Ionicons name="notifications-outline" size={16} color={palette.foreground} />
                  <Text style={styles.heroGhostButtonText}>Alerts</Text>
                  {unreadCount > 0 ? (
                    <View style={styles.heroGhostBadge}>
                      <Text style={styles.heroGhostBadgeText}>
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              </View>

              <View style={styles.identityCard}>
                <View style={styles.avatar}>
                  {customer?.profileImage?.url ? (
                    <Image
                      source={{ uri: customer.profileImage.url }}
                      style={styles.avatarImage}
                      contentFit="cover"
                    />
                  ) : (
                    <Text style={styles.avatarText}>{initials}</Text>
                  )}
                </View>

                <View style={styles.identityCopy}>
                  <Text style={styles.name}>{displayName}</Text>
                  <Text style={styles.subtitle}>
                    Keep your account, delivery locations, notifications, and account requests in one place.
                  </Text>

                  <View style={styles.heroPillRow}>
                    <InfoPill icon="location-outline" text={selectedLocation?.label ?? "No delivery point"} />
                    <InfoPill icon="notifications-outline" text={`${unreadCount} unread`} />
                  </View>
                </View>
              </View>
            </View>

            <View style={styles.section}>
              <SectionHeader
                title="Overview"
                subtitle="Quick signals for the things you use most."
              />

              {!isOnline ? (
                <View style={styles.sectionNoticeWrap}>
                  <OfflineNoticeCard description="Showing your saved profile details. Reconnect to refresh alerts and update account changes." />
                </View>
              ) : null}

              <View style={styles.overviewGrid}>
                <OverviewCard
                  icon="location-outline"
                  label="Locations"
                  value={`${savedLocations.length}`}
                  caption="Saved spots"
                  tint="#FFE4EE"
                  onPress={() => setIsLocationSheetOpen(true)}
                />
                <OverviewCard
                  icon="call-outline"
                  label="Phone"
                  value={customer.phone}
                  caption="Verified"
                  tint="#E8F1FF"
                  onPress={() => router.push("/profile-phone")}
                />
                <OverviewCard
                  icon="heart-outline"
                  label="Favorites"
                  value={`${favoriteCount}`}
                  caption="Saved restaurants"
                  tint="#FFF1C9"
                  onPress={() => router.push("/favorite-restaurants")}
                />
                <OverviewCard
                  icon="help-circle-outline"
                  label="Help center"
                  value="Open"
                  caption="Support and guides"
                  tint="#E8FFF1"
                  onPress={() => router.push("/support")}
                />
              </View>
            </View>

            <View style={styles.section}>
              <SectionHeader
                title="Preferences"
                subtitle="Open a section to manage the details."
              />

              <View style={styles.cardStack}>
                <ProfileNavCard
                  icon="person-outline"
                  tint="#FFE7F1"
                  title="Personal info"
                  onPress={() => router.push("/profile-edit")}
                />
                <ProfileNavCard
                  icon="call-outline"
                  tint="#FFF0E8"
                  title="Phone number"
                  onPress={() => router.push("/profile-phone")}
                />
                <ProfileNavCard
                  icon="navigate-outline"
                  tint="#FFF4E8"
                  title="Delivery locations"
                  onPress={() => setIsLocationSheetOpen(true)}
                />
                <ProfileNavCard
                  icon="notifications-outline"
                  tint="#EEF5FF"
                  title="Notifications center"
                  onPress={() => router.push("/notifications")}
                />
                <ProfileNavCard
                  icon="help-circle-outline"
                  tint="#FFF0E8"
                  title="Help center"
                  onPress={() => router.push("/support")}
                />
                <ProfileNavCard
                  icon="shield-checkmark-outline"
                  tint="#EEF8F2"
                  title="Privacy policy"
                  onPress={() => router.push("/privacy-policy")}
                />
                <ProfileNavCard
                  icon="document-text-outline"
                  tint="#EEF8F2"
                  title="Account requests"
                  onPress={() => router.push("/account-request")}
                />
              </View>
            </View>

            {(customer.previousPhones?.length ?? 0) > 0 ? (
              <View style={styles.section}>
                <SectionHeader
                  title="Account history"
                  subtitle="Past verified numbers tied to this account."
                />
                <View style={styles.cardStack}>
                  <View style={styles.historyCard}>
                    {customer.previousPhones?.map((entry, index) => (
                      <View
                        key={`${entry.phone}-${index}`}
                        style={[
                          styles.historyRow,
                          index < (customer.previousPhones?.length ?? 0) - 1 ? styles.historyRowBorder : null,
                        ]}
                      >
                        <View style={styles.historyDot} />
                        <View style={styles.historyCopy}>
                          <Text style={styles.historyTitle}>{entry.phone}</Text>
                          <Text style={styles.historyMeta}>
                            {entry.changedAt ? formatDateTimeAmPm(entry.changedAt) : "Change date unavailable"}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            ) : null}

            <View style={styles.section}>
              <SectionHeader
                title="Account"
                subtitle="Sign out when you want to return to guest browsing."
              />
              <View style={styles.cardStack}>
                <Pressable style={styles.logoutCard} onPress={() => logoutMutation.mutate()}>
                  <View style={styles.logoutIconWrap}>
                    {logoutMutation.isPending ? (
                      <ActivityIndicator size="small" color={palette.primary} />
                    ) : (
                      <Ionicons name="log-out-outline" size={18} color={palette.primary} />
                    )}
                  </View>
                  <View style={styles.logoutCopy}>
                    <Text style={styles.logoutTitle}>Sign out</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={palette.mutedForeground} />
                </Pressable>
              </View>
            </View>
          </>
        )}
      </ScrollView>

      <LocationSelectorSheet
        visible={isLocationSheetOpen}
        onClose={() => setIsLocationSheetOpen(false)}
      />
    </Screen>
  );
}

function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionSubtitle}>{subtitle}</Text>
    </View>
  );
}

function InfoPill({
  icon,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  return (
    <View style={styles.infoPill}>
      <Ionicons name={icon} size={14} color={palette.foreground} />
      <Text style={styles.infoPillText} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

function OverviewCard({
  icon,
  label,
  value,
  caption,
  tint,
  wide = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  caption: string;
  tint: string;
  wide?: boolean;
  onPress?: () => void;
}) {
  const cardStyle = [styles.overviewCard, wide ? styles.overviewCardWide : null, { backgroundColor: tint }];

  if (!onPress) {
    return (
      <View style={cardStyle}>
        <View style={styles.overviewIconWrap}>
          <Ionicons name={icon} size={18} color={palette.foreground} />
        </View>
        <Text style={styles.overviewValue} numberOfLines={1}>
          {value}
        </Text>
        <Text style={styles.overviewLabel}>{label}</Text>
        <Text style={styles.overviewCaption}>{caption}</Text>
      </View>
    );
  }

  return (
    <Pressable style={cardStyle} onPress={onPress}>
      <View style={styles.overviewIconWrap}>
        <Ionicons name={icon} size={18} color={palette.foreground} />
      </View>
      <Text style={styles.overviewValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.overviewLabel}>{label}</Text>
      <Text style={styles.overviewCaption}>{caption}</Text>
    </Pressable>
  );
}

function ProfileNavCard({
  icon,
  tint,
  title,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  title: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.navCard} onPress={onPress}>
      <View style={[styles.navIconWrap, { backgroundColor: tint }]}>
        <Ionicons name={icon} size={18} color={palette.foreground} />
      </View>
      <View style={styles.navCopy}>
        <Text style={styles.navTitle}>{title}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={palette.mutedForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 40,
    gap: 28,
  },
  emptyWrap: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingTop: 60,
  },
  hero: {
    overflow: "hidden",
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 24,
    backgroundColor: palette.heroBackground,
    borderBottomLeftRadius: 34,
    borderBottomRightRadius: 34,
    gap: 18,
  },
  heroGlowPrimary: {
    position: "absolute",
    top: -54,
    right: -28,
    width: 170,
    height: 170,
    borderRadius: 999,
    backgroundColor: palette.heroOrbPrimary,
  },
  heroGlowSecondary: {
    position: "absolute",
    bottom: -62,
    left: -40,
    width: 160,
    height: 160,
    borderRadius: 999,
    backgroundColor: palette.heroOrbSecondary,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  kicker: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: palette.primary,
  },
  heroGhostButton: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.84)",
  },
  heroGhostBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.secondary,
  },
  heroGhostBadgeText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "800",
    color: "#fff",
  },
  heroGhostButtonText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
    color: palette.foreground,
  },
  identityCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderRadius: 30,
    backgroundColor: "rgba(255,255,255,0.86)",
    shadowColor: palette.shadow,
    shadowOpacity: 1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 999,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FF8DB1",
  },
  avatarImage: {
    width: "100%",
    height: "100%",
  },
  avatarText: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "800",
    color: palette.surface,
  },
  identityCopy: {
    flex: 1,
    gap: 4,
  },
  name: {
    fontSize: 31,
    lineHeight: 37,
    fontWeight: "800",
    color: palette.foreground,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "500",
    color: palette.mutedForeground,
  },
  heroPillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  infoPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: palette.surface,
  },
  infoPillText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
    color: palette.foreground,
    maxWidth: 180,
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
  overviewGrid: {
    paddingHorizontal: 20,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  sectionNoticeWrap: {
    paddingHorizontal: 20,
  },
  overviewCard: {
    width: "48%",
    minHeight: 132,
    padding: 16,
    borderRadius: 28,
    gap: 6,
    shadowColor: palette.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  overviewCardWide: {
    width: "100%",
    minHeight: 112,
  },
  overviewIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.82)",
  },
  overviewValue: {
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "800",
    color: palette.foreground,
  },
  overviewLabel: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.foreground,
  },
  overviewCaption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    color: palette.mutedForeground,
  },
  latestOrderCard: {
    marginTop: 2,
    marginHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderRadius: 28,
    backgroundColor: palette.surface,
    shadowColor: palette.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  latestOrderIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  latestOrderCopy: {
    flex: 1,
    gap: 2,
  },
  latestOrderLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: palette.secondary,
  },
  latestOrderTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    color: palette.foreground,
  },
  latestOrderMeta: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
    color: palette.mutedForeground,
  },
  latestOrderAmountWrap: {
    alignItems: "flex-end",
    gap: 4,
  },
  latestOrderAmount: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    color: palette.foreground,
  },
  cardStack: {
    paddingHorizontal: 20,
    gap: 12,
  },
  navCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderRadius: 28,
    backgroundColor: palette.surface,
    shadowColor: palette.shadow,
    shadowOpacity: 1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  navIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  navCopy: {
    flex: 1,
    gap: 0,
  },
  navTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
    color: palette.foreground,
  },
  historyCard: {
    borderRadius: 28,
    backgroundColor: palette.surface,
    padding: 16,
    shadowColor: palette.shadow,
    shadowOpacity: 1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  historyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 10,
  },
  historyRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  historyDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: palette.primary,
    marginTop: 5,
  },
  historyCopy: { flex: 1, gap: 2 },
  historyTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.foreground,
  },
  historyMeta: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    color: palette.mutedForeground,
  },
  logoutCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderRadius: 28,
    backgroundColor: palette.surface,
    shadowColor: palette.shadow,
    shadowOpacity: 1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  logoutIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFEAF3",
  },
  logoutCopy: {
    flex: 1,
  },
  logoutTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.foreground,
  },
});
