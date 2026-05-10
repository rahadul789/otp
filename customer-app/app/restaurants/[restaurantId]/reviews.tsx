import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyStateCard } from "@/src/components/empty-state-card";
import { useCustomerRestaurantDetailsQuery } from "@/src/hooks/use-customer-api";
import { useLocationStore } from "@/src/store/location-store";
import { palette } from "@/src/theme/palette";
import type { CustomerRestaurantDetails } from "@/src/types/restaurant";

function formatReviewDate(value?: string) {
  if (!value) return "Recently";
  return new Date(value).toLocaleDateString("en-BD", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function buildReviewPreviewText(
  review: CustomerRestaurantDetails["recentReviews"][number]
) {
  const comment = review.comment?.trim();
  if (comment) {
    return comment;
  }

  return `Rated this place ${review.rating} out of 5.`;
}

function ReviewStars({ rating }: { rating: number }) {
  return (
    <View style={styles.reviewStarsRow}>
      {Array.from({ length: 5 }).map((_, index) => (
        <Ionicons
          key={index}
          name={index < rating ? "star" : "star-outline"}
          size={13}
          color={index < rating ? "#F6B93B" : palette.mutedForeground}
        />
      ))}
    </View>
  );
}

export default function RestaurantReviewsScreen() {
  const router = useRouter();
  const { restaurantId } = useLocalSearchParams<{ restaurantId: string }>();
  const selectedLocation = useLocationStore((state) => state.selectedLocation);

  const detailsQuery = useCustomerRestaurantDetailsQuery({
    restaurantId,
    latitude: selectedLocation?.latitude,
    longitude: selectedLocation?.longitude,
  });

  const restaurant = detailsQuery.data?.restaurant;
  const recentReviews = detailsQuery.data?.recentReviews ?? [];

  if (detailsQuery.isLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.centerState}>
          <ActivityIndicator size="small" color={palette.primary} />
          <Text style={styles.centerStateText}>Loading reviews...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (detailsQuery.isError || !restaurant) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.centerState}>
          <EmptyStateCard
            title="Could not load reviews"
            description="Please go back and try again."
            actionLabel="Back"
            onPress={() => router.back()}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={20} color={palette.foreground} />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.kicker}>Reviews</Text>
            <Text style={styles.title}>{restaurant.name}</Text>
            <Text style={styles.subtitle}>
              {typeof restaurant.avgRating === "number" && (restaurant.reviewCount ?? 0) > 0
                ? `${restaurant.avgRating} average from ${restaurant.reviewCount} customer reviews`
                : "Customer feedback will appear here once reviews start coming in."}
            </Text>
          </View>
        </View>

        {recentReviews.length ? (
          <View style={styles.reviewList}>
            {recentReviews.map((review) => (
              <View key={review.id} style={styles.reviewCard}>
                <View style={styles.reviewTopRow}>
                  <View style={styles.reviewIdentityRow}>
                    <View style={styles.reviewAvatar}>
                      <Text style={styles.reviewAvatarText}>
                        {(review.customerName ?? "F").trim().slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.reviewIdentityCopy}>
                      <Text style={styles.reviewCustomerName}>
                        {review.customerName ?? "Foodbela customer"}
                      </Text>
                      <View style={styles.reviewMetaRow}>
                        <ReviewStars rating={review.rating} />
                        <Text style={styles.reviewDate}>{formatReviewDate(review.createdAt)}</Text>
                      </View>
                    </View>
                  </View>
                </View>

                <Text style={styles.reviewBody}>{buildReviewPreviewText(review)}</Text>

                {review.ownerReply?.message ? (
                  <View style={styles.replyCard}>
                    <Text style={styles.replyLabel}>Restaurant replied</Text>
                    <Text style={styles.replyBody}>{review.ownerReply.message}</Text>
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.emptyWrap}>
            <EmptyStateCard
              title="No reviews yet"
              description="This restaurant has not received customer reviews yet."
              actionLabel="Back to restaurant"
              onPress={() => router.back()}
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.background,
  },
  content: {
    paddingBottom: 36,
    gap: 16,
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 8,
    flexDirection: "row",
    gap: 12,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surface,
    shadowColor: palette.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  kicker: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: palette.secondary,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "800",
    color: palette.foreground,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: palette.mutedForeground,
  },
  reviewList: {
    paddingHorizontal: 18,
    gap: 12,
  },
  reviewCard: {
    padding: 16,
    borderRadius: 24,
    backgroundColor: palette.surface,
    gap: 12,
    shadowColor: palette.shadow,
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  reviewTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  reviewIdentityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  reviewAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFEAF3",
  },
  reviewAvatarText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    color: palette.secondary,
  },
  reviewIdentityCopy: {
    flex: 1,
    gap: 3,
  },
  reviewCustomerName: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    color: palette.foreground,
  },
  reviewMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  reviewStarsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  reviewDate: {
    fontSize: 11,
    lineHeight: 15,
    color: palette.mutedForeground,
  },
  reviewBody: {
    fontSize: 13,
    lineHeight: 20,
    color: palette.foreground,
  },
  replyCard: {
    borderRadius: 18,
    padding: 12,
    backgroundColor: palette.surfaceMuted,
    gap: 4,
  },
  replyLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    color: palette.primary,
    textTransform: "uppercase",
  },
  replyBody: {
    fontSize: 12,
    lineHeight: 18,
    color: palette.foreground,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 20,
  },
  centerStateText: {
    fontSize: 14,
    lineHeight: 18,
    color: palette.foreground,
    fontWeight: "600",
  },
  emptyWrap: {
    paddingHorizontal: 18,
  },
});
