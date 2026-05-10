import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { EmptyStateCard } from "@/src/components/empty-state-card";
import { RestaurantHeroCard } from "@/src/components/restaurant-hero-card";
import { Screen } from "@/src/components/screen";
import {
  useCustomerFavoriteRestaurantIdsQuery,
  useCustomerFavoriteRestaurantsQuery,
  useCustomerToggleFavoriteRestaurantMutation,
} from "@/src/hooks/use-customer-api";
import { getCustomerAuthErrorMessage } from "@/src/lib/auth-error-message";
import { useCustomerAuthStore } from "@/src/store/auth-store";
import { useLocationStore } from "@/src/store/location-store";
import { palette } from "@/src/theme/palette";
import type { DiscoverableRestaurant } from "@/src/types/restaurant";

function restaurantSubtitle(restaurant: DiscoverableRestaurant) {
  const parts = [
    restaurant.cuisineTypes?.slice(0, 2).join(" • "),
    restaurant.tags?.find(Boolean),
  ].filter(Boolean);

  return parts.join(" • ");
}

export default function FavoriteRestaurantsScreen() {
  const router = useRouter();
  const customer = useCustomerAuthStore((state) => state.customer);
  const selectedLocation = useLocationStore((state) => state.selectedLocation);
  const favoriteRestaurantsQuery = useCustomerFavoriteRestaurantsQuery({
    latitude: selectedLocation?.latitude,
    longitude: selectedLocation?.longitude,
    radiusKm: 25,
  });
  const favoriteRestaurantIdsQuery = useCustomerFavoriteRestaurantIdsQuery();
  const toggleFavoriteMutation = useCustomerToggleFavoriteRestaurantMutation();
  const [pendingFavoriteIds, setPendingFavoriteIds] = useState<string[]>([]);

  const favoriteRestaurantIdsSet = useMemo(
    () => new Set(favoriteRestaurantIdsQuery.data ?? []),
    [favoriteRestaurantIdsQuery.data]
  );

  const restaurants = useMemo(
    () =>
      (favoriteRestaurantsQuery.data ?? []).filter((restaurant) =>
        favoriteRestaurantIdsSet.has(restaurant._id)
      ),
    [favoriteRestaurantIdsSet, favoriteRestaurantsQuery.data]
  );

  const isInitialLoading = favoriteRestaurantsQuery.isLoading && !restaurants.length;
  const isRefreshing =
    favoriteRestaurantsQuery.isRefetching && !favoriteRestaurantsQuery.isFetching;

  const handleToggleFavorite = async (restaurantId: string) => {
    if (!customer || pendingFavoriteIds.includes(restaurantId)) {
      return;
    }

    setPendingFavoriteIds((current) => [...current, restaurantId]);
    try {
      await toggleFavoriteMutation.mutateAsync(restaurantId);
    } catch (error) {
      const message = getCustomerAuthErrorMessage(
        error,
        "Could not update favorites right now."
      );
      console.warn(message);
    } finally {
      setPendingFavoriteIds((current) => current.filter((id) => id !== restaurantId));
    }
  };

  return (
    <Screen>
      <FlatList
        data={restaurants}
        keyExtractor={(item) => item._id}
        renderItem={({ item }) => (
          <RestaurantHeroCard
            compact
            name={item.name}
            subtitle={restaurantSubtitle(item)}
            imageUrl={item.coverImage?.url ?? item.logo?.url ?? null}
            isOpen={item.isOpen ?? true}
            offerLabel={undefined}
            distanceKm={item.distanceKm}
            avgRating={item.avgRating}
            reviewCount={item.reviewCount}
            preparationTimeMinutes={item.preparationTimeMinutes}
            lowestMenuPrice={item.lowestMenuPrice}
            isFavorite={favoriteRestaurantIdsSet.has(item._id)}
            favoriteDisabled={pendingFavoriteIds.includes(item._id)}
            onToggleFavorite={() => {
              void handleToggleFavorite(item._id);
            }}
            onPress={() => router.push(`/restaurants/${item._id}` as never)}
          />
        )}
        contentContainerStyle={styles.content}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.header}>
            <Pressable style={styles.backButton} onPress={() => router.back()}>
              <Ionicons name="chevron-back" size={20} color={palette.foreground} />
            </Pressable>
            <View style={styles.headerCopy}>
              <Text style={styles.kicker}>Favorites</Text>
              <Text style={styles.title}>Saved restaurants</Text>
              <Text style={styles.subtitle}>
                Revisit the places you liked most and keep them one tap away.
              </Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          isInitialLoading ? (
            <View style={styles.feedbackWrap}>
              <ActivityIndicator size="small" color={palette.secondary} />
              <Text style={styles.loadingText}>Loading your favorites...</Text>
            </View>
          ) : (
            <View style={styles.feedbackWrap}>
              <EmptyStateCard
                title="No favorites yet"
                description="Tap the heart on any restaurant card and it will appear here for quick access."
                actionLabel="Browse restaurants"
                onPress={() => router.push("/(tabs)/browse")}
              />
            </View>
          )
        }
        onRefresh={() => {
          void Promise.all([
            favoriteRestaurantsQuery.refetch(),
            favoriteRestaurantIdsQuery.refetch(),
          ]);
        }}
        refreshing={isRefreshing}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 36,
    flexGrow: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 18,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCopy: {
    flex: 1,
    gap: 4,
    paddingTop: 2,
  },
  kicker: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: palette.secondary,
  },
  title: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "800",
    color: palette.foreground,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
    color: palette.mutedForeground,
  },
  separator: {
    height: 14,
  },
  feedbackWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    color: palette.mutedForeground,
  },
});
