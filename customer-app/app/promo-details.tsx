import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyStateCard } from "@/src/components/empty-state-card";
import { PromoDetailsSkeleton } from "@/src/components/loading-skeleton";
import { RemoteImage } from "@/src/components/remote-image";
import { Screen } from "@/src/components/screen";
import { useCustomerNotificationCampaignQuery } from "@/src/hooks/use-customer-api";
import { formatDateTimeAmPm } from "@/src/lib/date-time";
import { resolveCustomerRoute } from "@/src/lib/customer-routes";
import { palette } from "@/src/theme/palette";

function paramValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default function PromoDetailsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    campaignId?: string;
    title?: string;
    body?: string;
    imageUrl?: string;
    ctaLabel?: string;
    ctaPath?: string;
  }>();
  const campaignId = paramValue(params.campaignId);
  const fallbackTitle = paramValue(params.title);
  const fallbackBody = paramValue(params.body);
  const fallbackImageUrl = paramValue(params.imageUrl);
  const fallbackCtaLabel = paramValue(params.ctaLabel);
  const fallbackCtaPath = paramValue(params.ctaPath);
  const campaignQuery = useCustomerNotificationCampaignQuery(campaignId, Boolean(campaignId));
  const notification = campaignQuery.data;

  const title = notification?.title || fallbackTitle || "Foodbela offer";
  const body =
    notification?.description ||
    fallbackBody ||
    "This offer is available in Foodbela. Open nearby restaurants and enjoy fresh deals.";
  const imageUrl = notification?.imageUrl || fallbackImageUrl;
  const ctaLabel = notification?.ctaLabel || fallbackCtaLabel;
  const ctaPath = notification?.ctaPath || fallbackCtaPath;
  const safeCtaPath = resolveCustomerRoute(ctaPath, null);
  const showCta = Boolean(ctaLabel.trim() && safeCtaPath);
  const createdAt = notification?.createdAt ? formatDateTimeAmPm(notification.createdAt) : "";

  return (
    <Screen>
      <View style={styles.container}>
        <View style={styles.topBar}>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={20} color={palette.foreground} />
          </Pressable>
          <View style={styles.topCopy}>
            <Text style={styles.eyebrow}>Offer details</Text>
            <Text style={styles.title} numberOfLines={1}>
              Foodbela
            </Text>
          </View>
        </View>

        {campaignQuery.isLoading ? (
          <View style={styles.feedbackWrap}>
            <PromoDetailsSkeleton />
          </View>
        ) : campaignQuery.isError && !fallbackTitle ? (
          <View style={styles.feedbackWrap}>
            <EmptyStateCard
              title="Offer could not load"
              description="Please try again from your notifications."
              actionLabel="Back"
              onPress={() => router.back()}
            />
          </View>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              styles.content,
              { paddingBottom: Math.max(insets.bottom, 16) + 22 },
            ]}
          >
            <View style={styles.heroCard}>
              {imageUrl ? (
                <RemoteImage
                  uri={imageUrl}
                  style={styles.heroImage}
                  fallbackIcon="gift-outline"
                  fallbackIconSize={34}
                  accessibilityLabel={`${title} offer image`}
                />
              ) : (
                <View style={styles.heroFallback}>
                  <Text style={styles.heroEmoji}>🍔</Text>
                </View>
              )}
              <View style={styles.heroGlass}>
                <View style={styles.offerBadge}>
                  <Ionicons name="sparkles-outline" size={15} color={palette.secondary} />
                  <Text style={styles.offerBadgeText}>Foodbela offer</Text>
                </View>
                <Text style={styles.offerTitle}>{title}</Text>
                <Text style={styles.offerBody}>{body}</Text>
                {createdAt ? (
                  <View style={styles.timeRow}>
                    <Ionicons name="time-outline" size={15} color={palette.mutedForeground} />
                    <Text style={styles.timeText}>{createdAt}</Text>
                  </View>
                ) : null}
              </View>
            </View>

            {showCta ? (
              <Pressable
                style={styles.primaryButton}
                onPress={() => router.push(safeCtaPath as never)}
              >
                <Text style={styles.primaryButtonText}>{ctaLabel}</Text>
                <Ionicons name="arrow-forward" size={18} color={palette.surface} />
              </Pressable>
            ) : (
              <View style={styles.noActionCard}>
                <Ionicons name="information-circle-outline" size={19} color={palette.mutedForeground} />
                <Text style={styles.noActionText}>
                  This offer does not need another step. Check nearby restaurants when you are ready.
                </Text>
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    paddingHorizontal: 18,
    paddingTop: 4,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
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
  topCopy: { flex: 1 },
  eyebrow: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    color: palette.secondary,
  },
  title: {
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "900",
    color: palette.foreground,
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
    fontWeight: "700",
    color: palette.mutedForeground,
  },
  content: {
    paddingHorizontal: 18,
    gap: 16,
  },
  heroCard: {
    borderRadius: 30,
    backgroundColor: "rgba(255, 255, 255, 0.82)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.92)",
    overflow: "hidden",
    shadowColor: palette.shadow,
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  heroImage: {
    width: "100%",
    height: 220,
    backgroundColor: palette.surfaceMuted,
  },
  heroFallback: {
    height: 220,
    backgroundColor: "#FFF0F6",
    alignItems: "center",
    justifyContent: "center",
  },
  heroEmoji: {
    fontSize: 58,
    lineHeight: 68,
  },
  heroGlass: {
    padding: 18,
    gap: 10,
  },
  offerBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    backgroundColor: "#FFF0F6",
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  offerBadgeText: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: "800",
    color: palette.secondary,
  },
  offerTitle: {
    fontSize: 24,
    lineHeight: 31,
    fontWeight: "900",
    color: palette.foreground,
  },
  offerBody: {
    fontSize: 14,
    lineHeight: 22,
    color: palette.mutedForeground,
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingTop: 2,
  },
  timeText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    color: palette.mutedForeground,
  },
  primaryButton: {
    minHeight: 54,
    borderRadius: 27,
    backgroundColor: palette.secondary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    shadowColor: palette.secondary,
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 9 },
    elevation: 4,
  },
  primaryButtonText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
    color: palette.surface,
  },
  noActionCard: {
    borderRadius: 22,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  noActionText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: palette.mutedForeground,
  },
});
