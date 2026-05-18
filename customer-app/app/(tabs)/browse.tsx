import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { EmptyStateCard } from "@/src/components/empty-state-card";
import { styles } from "@/src/components/browse/browse-screen.styles";
import { OfflineNoticeCard } from "@/src/components/offline-notice-card";
import { RestaurantHeroCard } from "@/src/components/restaurant-hero-card";
import { Screen } from "@/src/components/screen";
import { DELIVERY_RADIUS_KM } from "@/src/config/service-area";
import {
  useCustomerDiscoveryHomeQuery,
  useCustomerFavoriteRestaurantIdsQuery,
  useNearbyRestaurantsQuery,
  useCustomerToggleFavoriteRestaurantMutation,
} from "@/src/hooks/use-customer-api";
import { useCustomerAuthStore } from "@/src/store/auth-store";
import { useBrowseHistoryStore } from "@/src/store/browse-history-store";
import { useIsOnline } from "@/src/hooks/use-network-status";
import { openLocationPermissionSettings } from "@/src/lib/location-permissions";
import { useLocationStore } from "@/src/store/location-store";
import { palette } from "@/src/theme/palette";
import type { DiscoverableRestaurant } from "@/src/types/restaurant";

type BrowseFilter = "all" | "open" | "offers" | "featured";
type BrowseSort = "nearest" | "fastest" | "topRated";
type BrowseRating = 0 | 4 | 4.5;
type BrowseLowestPrice = 0 | 200 | 400 | 700;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function restaurantSubtitle(restaurant: DiscoverableRestaurant) {
  return [restaurant.cuisineTypes?.slice(0, 2).join(" • "), restaurant.address?.city]
    .filter(Boolean)
    .join(" • ");
}

function restaurantCardSubtitle(restaurant: DiscoverableRestaurant) {
  return restaurant.cuisineTypes?.slice(0, 2).join(" • ") ?? "";
}

function formatVisitedTime(value?: string) {
  if (!value) return "Visited recently";

  const visitedAt = new Date(value).getTime();
  if (Number.isNaN(visitedAt)) return "Visited recently";

  const diffMinutes = Math.max(
    0,
    Math.round((Date.now() - visitedAt) / (1000 * 60))
  );

  if (diffMinutes < 1) return "Visited just now";
  if (diffMinutes < 60) return `Visited ${diffMinutes}m ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `Visited ${diffHours}h ago`;

  const diffDays = Math.round(diffHours / 24);
  return `Visited ${diffDays}d ago`;
}

export default function BrowseScreen() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<BrowseFilter>("all");
  const [sortBy, setSortBy] = useState<BrowseSort>("nearest");
  const [minimumRating, setMinimumRating] = useState<BrowseRating>(0);
  const [maximumLowestPrice, setMaximumLowestPrice] =
    useState<BrowseLowestPrice>(0);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [draftFilter, setDraftFilter] = useState<BrowseFilter>("all");
  const [draftSortBy, setDraftSortBy] = useState<BrowseSort>("nearest");
  const [draftMinimumRating, setDraftMinimumRating] = useState<BrowseRating>(0);
  const [draftMaximumLowestPrice, setDraftMaximumLowestPrice] =
    useState<BrowseLowestPrice>(0);
  const isAuthenticated = useCustomerAuthStore((state) =>
    Boolean(state.accessToken)
  );
  const recentSearches = useBrowseHistoryStore((state) => state.recentSearches);
  const recentVisitedRestaurants = useBrowseHistoryStore(
    (state) => state.recentVisitedRestaurants
  );
  const addRecentSearch = useBrowseHistoryStore((state) => state.addRecentSearch);
  const removeRecentSearch = useBrowseHistoryStore((state) => state.removeRecentSearch);
  const addRecentVisitedRestaurant = useBrowseHistoryStore(
    (state) => state.addRecentVisitedRestaurant
  );
  const selectedLocation = useLocationStore((state) => state.selectedLocation);
  const isOnline = useIsOnline();
  const permissionGranted = useLocationStore((state) => state.permissionGranted);

  const nearbyRestaurantsQuery = useNearbyRestaurantsQuery({
    latitude: selectedLocation?.latitude,
    longitude: selectedLocation?.longitude,
    radiusKm: DELIVERY_RADIUS_KM,
    search: searchQuery,
  });

  const homeDiscoveryQuery = useCustomerDiscoveryHomeQuery({
    latitude: selectedLocation?.latitude,
    longitude: selectedLocation?.longitude,
    radiusKm: DELIVERY_RADIUS_KM,
  });
  const favoriteRestaurantIdsQuery = useCustomerFavoriteRestaurantIdsQuery();
  const toggleFavoriteMutation = useCustomerToggleFavoriteRestaurantMutation();

  const restaurants = useMemo(
    () => nearbyRestaurantsQuery.data ?? [],
    [nearbyRestaurantsQuery.data]
  );

  const featuredIds = useMemo(
    () => new Set((homeDiscoveryQuery.data?.featuredRestaurants ?? []).map((item) => item._id)),
    [homeDiscoveryQuery.data?.featuredRestaurants]
  );
  const offerIds = useMemo(
    () => new Set((homeDiscoveryQuery.data?.restaurantsWithOffers ?? []).map((item) => item._id)),
    [homeDiscoveryQuery.data?.restaurantsWithOffers]
  );
  const offerLabelByRestaurantId = useMemo(
    () =>
      new Map(
        (homeDiscoveryQuery.data?.activeOffers ?? [])
          .filter((offer) => offer.restaurantId)
          .map((offer) => [
            offer.restaurantId as string,
            offer.type === "free_delivery"
              ? "Free delivery"
              : offer.type === "percentage" && typeof offer.discountValue === "number"
                ? `${offer.discountValue}% off`
                : typeof offer.discountValue === "number"
                  ? `Tk ${offer.discountValue} off`
                  : "Offer available",
          ])
      ),
    [homeDiscoveryQuery.data?.activeOffers]
  );
  const favoriteRestaurantIdsSet = useMemo(
    () => new Set(favoriteRestaurantIdsQuery.data ?? []),
    [favoriteRestaurantIdsQuery.data]
  );
  const favoritePendingRestaurantId = toggleFavoriteMutation.isPending
    ? toggleFavoriteMutation.variables
    : null;

  const filteredRestaurants = useMemo(() => {
    const next = restaurants.filter((restaurant) => {
      if (activeFilter === "open") return restaurant.isOpen !== false;
      if (activeFilter === "offers") return offerIds.has(restaurant._id);
      if (activeFilter === "featured") return featuredIds.has(restaurant._id);
      return true;
    }).filter((restaurant) => {
      if (!minimumRating) return true;
      return (restaurant.avgRating ?? 0) >= minimumRating;
    }).filter((restaurant) => {
      if (!maximumLowestPrice) return true;
      if (typeof restaurant.lowestMenuPrice !== "number") return false;
      return restaurant.lowestMenuPrice <= maximumLowestPrice;
    });

    return [...next].sort((left, right) => {
      if (sortBy === "fastest") {
        return (left.preparationTimeMinutes ?? Number.MAX_SAFE_INTEGER) -
          (right.preparationTimeMinutes ?? Number.MAX_SAFE_INTEGER);
      }

      if (sortBy === "topRated") {
        return (right.avgRating ?? 0) - (left.avgRating ?? 0);
      }

      return (left.distanceKm ?? Number.MAX_SAFE_INTEGER) - (right.distanceKm ?? Number.MAX_SAFE_INTEGER);
    });
  }, [
    activeFilter,
    featuredIds,
    maximumLowestPrice,
    minimumRating,
    offerIds,
    restaurants,
    sortBy,
  ]);

  const activeFilterLabel = useMemo(() => {
    switch (activeFilter) {
      case "open":
        return "Open now";
      case "offers":
        return "Offers";
      case "featured":
        return "Featured";
      default:
        return "All";
    }
  }, [activeFilter]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (activeFilter !== "all") count += 1;
    if (sortBy !== "nearest") count += 1;
    if (minimumRating !== 0) count += 1;
    if (maximumLowestPrice !== 0) count += 1;
    return count;
  }, [activeFilter, maximumLowestPrice, minimumRating, sortBy]);

  const openFilters = () => {
    setDraftFilter(activeFilter);
    setDraftSortBy(sortBy);
    setDraftMinimumRating(minimumRating);
    setDraftMaximumLowestPrice(maximumLowestPrice);
    setIsFilterOpen(true);
  };

  const openLocationPicker = () => {
    router.push("/location-picker");
  };

  const handleMissingLocationPress = () => {
    if (permissionGranted === false) {
      void openLocationPermissionSettings();
      return;
    }

    openLocationPicker();
  };

  const commitRecentSearch = () => {
    addRecentSearch(searchQuery);
  };

  const handleToggleFavorite = async (restaurantId: string) => {
    if (!isAuthenticated) {
      router.push({
        pathname: "/sign-in",
        params: { redirectTo: "/(tabs)/browse" },
      });
      return;
    }

    if (favoritePendingRestaurantId === restaurantId) {
      return;
    }

    try {
      await toggleFavoriteMutation.mutateAsync(restaurantId);
    } catch {
      return;
    }
  };

  const openRestaurant = (restaurant: DiscoverableRestaurant) => {
    if (searchQuery.trim()) {
      commitRecentSearch();
    }

    addRecentVisitedRestaurant({
      id: restaurant._id,
      name: restaurant.name,
      subtitle: restaurantCardSubtitle(restaurant),
      imageUrl: restaurant.coverImage?.url || restaurant.logo?.url || null,
      isOpen: restaurant.isOpen !== false,
      offerLabel: offerLabelByRestaurantId.get(restaurant._id) ?? null,
      distanceKm: restaurant.distanceKm,
      avgRating: restaurant.avgRating,
      reviewCount: restaurant.reviewCount,
      lowestMenuPrice: restaurant.lowestMenuPrice,
      preparationTimeMinutes: restaurant.preparationTimeMinutes,
    });

    router.push({
      pathname: "/restaurants/[restaurantId]",
      params: { restaurantId: restaurant._id },
    });
  };

  const renderRestaurant = ({ item }: { item: DiscoverableRestaurant }) => (
    <RestaurantHeroCard
      name={item.name}
      subtitle={restaurantCardSubtitle(item)}
      imageUrl={item.coverImage?.url || item.logo?.url || null}
      isOpen={item.isOpen !== false}
      offerLabel={offerLabelByRestaurantId.get(item._id)}
      distanceKm={item.distanceKm}
      avgRating={item.avgRating}
      reviewCount={item.reviewCount}
      lowestMenuPrice={item.lowestMenuPrice}
      preparationTimeMinutes={item.preparationTimeMinutes}
      isFavorite={favoriteRestaurantIdsSet.has(item._id)}
      favoriteDisabled={favoritePendingRestaurantId === item._id}
      onToggleFavorite={() => handleToggleFavorite(item._id)}
      compact
      onPress={() => openRestaurant(item)}
    />
  );

  return (
    <Screen>
      <FlatList
        data={filteredRestaurants}
        keyExtractor={(item) => item._id}
        renderItem={renderRestaurant}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        ItemSeparatorComponent={() => <View style={{ height: 14 }} />}
        ListHeaderComponent={
          <View style={styles.headerWrap}>
            <View style={styles.headerCard}>
              {!isOnline ? (
                <OfflineNoticeCard description="Browse is showing the last available data. Reconnect to refresh menus, prices, and availability." />
              ) : null}
              <View style={styles.searchRow}>
                <View style={styles.searchBar}>
                  <Ionicons name="search" size={18} color={palette.mutedForeground} />
                  <TextInput
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder="Search by restaurant or menu"
                    placeholderTextColor={palette.mutedForeground}
                    style={styles.searchInput}
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    returnKeyType="search"
                    onSubmitEditing={commitRecentSearch}
                  />
                  {searchQuery.trim() ? (
                    <Pressable onPress={() => setSearchQuery("")} style={styles.clearButton}>
                      <Ionicons name="close" size={16} color={palette.mutedForeground} />
                    </Pressable>
                  ) : null}
                </View>
                <Pressable style={styles.filterButton} onPress={openFilters}>
                  <Ionicons name="options-outline" size={18} color="#fff" />
                  {activeFilterCount ? (
                    <View style={styles.filterBadge}>
                      <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
                    </View>
                  ) : null}
                </Pressable>
              </View>

              <View style={styles.sortRow}>
                <Text style={styles.sortSummary}>
                  {filteredRestaurants.length} result
                  {filteredRestaurants.length === 1 ? "" : "s"} • {activeFilterLabel}
                </Text>
                {activeFilterCount > 0 ? (
                  <Pressable
                    style={styles.clearFiltersBadge}
                    onPress={() => {
                      setActiveFilter("all");
                      setSortBy("nearest");
                      setMinimumRating(0);
                      setMaximumLowestPrice(0);
                    }}
                  >
                    <Ionicons
                      name="close-circle"
                      size={13}
                      color={palette.foreground}
                    />
                    <Text style={styles.clearFiltersBadgeText}>Clear</Text>
                  </Pressable>
                ) : null}
              </View>
              {!searchQuery.trim() && recentSearches.length > 0 ? (
                <View style={styles.historyBlock}>
                  <Text style={styles.historyLabel}>Recent searches</Text>
                  <View style={styles.recentSearchRow}>
                    {recentSearches.map((query) => (
                      <View key={query} style={styles.recentSearchChip}>
                        <Pressable
                          style={styles.recentSearchMain}
                          onPress={() => setSearchQuery(query)}
                        >
                          <Ionicons
                            name="time-outline"
                            size={13}
                            color={palette.mutedForeground}
                          />
                          <Text
                            numberOfLines={1}
                            style={styles.recentSearchText}
                          >
                            {query}
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => removeRecentSearch(query)}
                          hitSlop={8}
                          style={styles.recentSearchRemove}
                        >
                          <Ionicons
                            name="close"
                            size={12}
                            color={palette.mutedForeground}
                          />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
              {!searchQuery.trim() && recentVisitedRestaurants.length > 0 ? (
                <View style={styles.historyBlock}>
                  <Text style={styles.historyLabel}>Recently visited</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.recentVisitedRow}
                  >
                    {recentVisitedRestaurants.map((restaurant) => (
                      <View
                        key={restaurant.id}
                        style={styles.recentVisitedCardWrap}
                      >
                        <Pressable
                          style={styles.recentVisitedCard}
                          onPress={() =>
                            router.push({
                              pathname: "/restaurants/[restaurantId]",
                              params: { restaurantId: restaurant.id },
                            })
                          }
                        >
                          <View style={styles.recentVisitedThumb}>
                            {restaurant.imageUrl ? (
                              <Image
                                source={{ uri: restaurant.imageUrl }}
                                style={styles.recentVisitedImage}
                              />
                            ) : (
                              <View
                                style={styles.recentVisitedImageFallback}
                              >
                                <Ionicons
                                  name="restaurant-outline"
                                  size={18}
                                  color={palette.secondary}
                                />
                              </View>
                            )}
                          </View>
                          <View style={styles.recentVisitedCopy}>
                            <Text
                              numberOfLines={1}
                              style={styles.recentVisitedTitle}
                            >
                              {restaurant.name}
                            </Text>
                            {restaurant.subtitle ? (
                              <Text
                                numberOfLines={1}
                                style={styles.recentVisitedSubtitle}
                              >
                                {restaurant.subtitle}
                              </Text>
                            ) : null}
                            <Text style={styles.recentVisitedMeta}>
                              {formatVisitedTime(restaurant.visitedAt)}
                            </Text>
                          </View>
                          <Pressable
                            style={[
                              styles.recentVisitedHeart,
                              favoriteRestaurantIdsSet.has(restaurant.id)
                                ? styles.recentVisitedHeartActive
                                : null,
                            ]}
                            onPress={() =>
                              handleToggleFavorite(restaurant.id)
                            }
                            disabled={
                              favoritePendingRestaurantId === restaurant.id
                            }
                            hitSlop={8}
                          >
                            <Ionicons
                              name={
                                favoriteRestaurantIdsSet.has(restaurant.id)
                                  ? "heart"
                                  : "heart-outline"
                              }
                              size={14}
                              color={
                                favoriteRestaurantIdsSet.has(restaurant.id)
                                  ? "#fff"
                                  : palette.foreground
                              }
                            />
                          </Pressable>
                        </Pressable>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              ) : null}
            </View>
          </View>
        }
        ListEmptyComponent={
          !selectedLocation ? (
            <EmptyStateCard
              title={
                permissionGranted === false
                  ? "Location permission is needed"
                  : "Choose your location first"
              }
              description="Pick your delivery point first so we can show restaurants that truly serve your area."
              actionLabel={
                permissionGranted === false ? "Allow location" : "Choose location"
              }
              onPress={handleMissingLocationPress}
            />
          ) : nearbyRestaurantsQuery.isLoading ? (
            <View style={styles.feedbackCard}>
              <ActivityIndicator size="small" color={palette.primary} />
              <Text style={styles.feedbackText}>Loading restaurants...</Text>
            </View>
          ) : nearbyRestaurantsQuery.isError ? (
            isOnline ? (
              <EmptyStateCard
                title="Browse is unavailable right now"
                description="Please try again in a moment."
                actionLabel="Try again"
                onPress={() => nearbyRestaurantsQuery.refetch()}
              />
            ) : (
              <EmptyStateCard
                title="Browse is unavailable offline"
                description="Check your internet connection to load restaurants for this area again."
              />
            )
          ) : (
            <EmptyStateCard
              title={
                isOnline ? "No restaurants found" : "Restaurants are unavailable offline"
              }
              description={
                isOnline
                  ? "Try another search, filter, or location to see more restaurants."
                  : "Check your internet connection to load restaurants for this area again."
              }
              actionLabel={isOnline ? "Choose location" : undefined}
              onPress={isOnline ? openLocationPicker : undefined}
            />
          )
        }
      />

      <Modal visible={isFilterOpen} transparent animationType="fade" onRequestClose={() => setIsFilterOpen(false)}>
        <View style={styles.filterModalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setIsFilterOpen(false)} />
          <View style={styles.filterModalCard}>
            <View style={styles.filterAccentOrb} />
            <View style={styles.filterModalHeader}>
              <View>
                <View style={styles.filterPill}>
                  <Ionicons name="sparkles" size={12} color={palette.primary} />
                  <Text style={styles.filterPillText}>Browse filters</Text>
                </View>
                <Text style={styles.filterModalTitle}>Filters</Text>
                <Text style={styles.filterModalSubtitle}>Choose what you want to see</Text>
              </View>
              <Pressable style={styles.filterModalClose} onPress={() => setIsFilterOpen(false)}>
                <Ionicons name="close" size={18} color={palette.foreground} />
              </Pressable>
            </View>

            <View style={styles.filterSection}>
              <View style={styles.filterSectionHeader}>
                <View style={styles.filterSectionIconWrap}>
                  <Ionicons name="grid-outline" size={14} color="#A14A74" />
                </View>
                <Text style={styles.filterSectionLabel}>Show</Text>
              </View>
              <View style={styles.filterOptionsRow}>
                {[
                  { key: "all", label: "All" },
                  { key: "open", label: "Open now" },
                  { key: "offers", label: "Offers" },
                  { key: "featured", label: "Featured" },
                ].map((filter) => {
                  const isActive = draftFilter === filter.key;
                  return (
                    <Pressable
                      key={filter.key}
                      style={[styles.filterChip, isActive ? styles.filterChipActive : null]}
                      onPress={() => setDraftFilter(filter.key as BrowseFilter)}
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
              </View>
            </View>

            <View style={styles.filterSection}>
              <View style={styles.filterSectionHeader}>
                <View style={styles.filterSectionIconWrap}>
                  <Ionicons name="swap-vertical-outline" size={14} color="#A14A74" />
                </View>
                <Text style={styles.filterSectionLabel}>Sort by</Text>
              </View>
              <View style={styles.filterOptionsRow}>
                {[
                  { key: "nearest", label: "Nearest" },
                  { key: "fastest", label: "Fastest" },
                  { key: "topRated", label: "Top rated" },
                ].map((option) => {
                  const isActive = draftSortBy === option.key;
                  return (
                    <Pressable
                      key={option.key}
                      style={[styles.filterChip, isActive ? styles.filterChipActive : null]}
                      onPress={() => setDraftSortBy(option.key as BrowseSort)}
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          isActive ? styles.filterChipTextActive : null,
                        ]}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.filterSection}>
              <View style={styles.filterSectionHeader}>
                <View style={styles.filterSectionIconWrap}>
                  <Ionicons name="star-outline" size={14} color="#A14A74" />
                </View>
                <Text style={styles.filterSectionLabel}>Ratings</Text>
              </View>
              <View style={styles.filterOptionsRow}>
                {[
                  { key: 0, label: "Any" },
                  { key: 4, label: "4.0+" },
                  { key: 4.5, label: "4.5+" },
                ].map((option) => {
                  const isActive = draftMinimumRating === option.key;
                  return (
                    <Pressable
                      key={option.label}
                      style={[styles.filterChip, isActive ? styles.filterChipActive : null]}
                      onPress={() => setDraftMinimumRating(option.key as BrowseRating)}
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          isActive ? styles.filterChipTextActive : null,
                        ]}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.filterSection}>
              <View style={styles.filterSectionHeader}>
                <View style={styles.filterSectionIconWrap}>
                  <Ionicons name="cash-outline" size={14} color="#A14A74" />
                </View>
                <Text style={styles.filterSectionLabel}>Starting price</Text>
              </View>
              <View style={styles.filterOptionsRow}>
                {[
                  { key: 0, label: "Any" },
                  { key: 200, label: "Up to Tk 200" },
                  { key: 400, label: "Up to Tk 400" },
                  { key: 700, label: "Up to Tk 700" },
                ].map((option) => {
                  const isActive = draftMaximumLowestPrice === option.key;
                  return (
                    <Pressable
                      key={option.label}
                      style={[
                        styles.filterChip,
                        isActive ? styles.filterChipActive : null,
                      ]}
                      onPress={() =>
                        setDraftMaximumLowestPrice(
                          option.key as BrowseLowestPrice
                        )
                      }
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          isActive ? styles.filterChipTextActive : null,
                        ]}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.filterFooter}>
              <Pressable
                style={styles.filterResetButton}
                onPress={() => {
                  setDraftFilter("all");
                  setDraftSortBy("nearest");
                  setDraftMinimumRating(0);
                  setDraftMaximumLowestPrice(0);
                }}
              >
                <Text style={styles.filterResetText}>Reset</Text>
              </Pressable>
              <Pressable
                style={styles.filterApplyButton}
                onPress={() => {
                  setActiveFilter(draftFilter);
                  setSortBy(draftSortBy);
                  setMinimumRating(draftMinimumRating);
                  setMaximumLowestPrice(draftMaximumLowestPrice);
                  setIsFilterOpen(false);
                }}
              >
                <Text style={styles.filterApplyText}>Apply filters</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
