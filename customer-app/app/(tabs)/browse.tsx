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
import { LocationSelectorSheet } from "@/src/components/location-selector-sheet";
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
import { useLocationSheet } from "@/src/hooks/use-location-sheet";
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
  const { isOpen, openSheet, closeSheet } = useLocationSheet();
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
              actionLabel="Choose location"
              onPress={openSheet}
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
              onPress={isOnline ? openSheet : undefined}
            />
          )
        }
      />

      <LocationSelectorSheet visible={isOpen} onClose={closeSheet} />

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

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  headerWrap: {
    paddingTop: 12,
    paddingBottom: 16,
  },
  headerCard: {
    borderRadius: 30,
    backgroundColor: palette.surface,
    padding: 14,
    gap: 10,
    shadowColor: palette.shadow,
    shadowOpacity: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  filterButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: palette.secondary,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    flexShrink: 0,
    shadowColor: palette.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  filterBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.foreground,
  },
  filterBadgeText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "800",
    color: palette.surface,
  },
  searchBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 13,
    borderRadius: 18,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: "#ECEEF5",
    shadowColor: palette.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "600",
    color: palette.foreground,
    paddingVertical: 0,
  },
  clearButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F6F0F4",
  },
  filterChip: {
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#F7F2F6",
    borderWidth: 1,
    borderColor: "#F0E5EC",
  },
  filterChipActive: {
    backgroundColor: palette.secondary,
    borderColor: palette.secondary,
  },
  filterChipText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    color: palette.foreground,
  },
  filterChipTextActive: {
    color: palette.surface,
  },
  sortRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  sortSummary: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    color: palette.mutedForeground,
  },
  clearFiltersBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#F5EFF4",
  },
  clearFiltersBadgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    color: palette.foreground,
  },
  historyBlock: {
    gap: 10,
  },
  historyLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    color: palette.foreground,
  },
  recentSearchRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  recentSearchChip: {
    flexDirection: "row",
    alignItems: "center",
    maxWidth: "100%",
    borderRadius: 999,
    backgroundColor: "#F6F2F8",
  },
  recentSearchMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 9,
  },
  recentSearchText: {
    maxWidth: 150,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    color: palette.foreground,
  },
  recentSearchRemove: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 4,
  },
  recentVisitedRow: {
    paddingRight: 8,
    gap: 12,
  },
  recentVisitedCardWrap: {
    width: 232,
  },
  recentVisitedCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 22,
    backgroundColor: palette.surface,
    padding: 10,
    shadowColor: palette.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  recentVisitedThumb: {
    width: 64,
    height: 64,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#F7F1F7",
  },
  recentVisitedImage: {
    width: "100%",
    height: "100%",
  },
  recentVisitedImageFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F7F1F7",
  },
  recentVisitedCopy: {
    flex: 1,
    gap: 3,
  },
  recentVisitedTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    color: palette.foreground,
  },
  recentVisitedSubtitle: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "600",
    color: palette.mutedForeground,
  },
  recentVisitedMeta: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    color: "#AA6A87",
  },
  recentVisitedHeart: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F6F1F5",
  },
  recentVisitedHeartActive: {
    backgroundColor: palette.secondary,
  },
  feedbackCard: {
    minHeight: 56,
    paddingHorizontal: 16,
    borderRadius: 24,
    backgroundColor: palette.surface,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  feedbackText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "600",
    color: palette.foreground,
  },
  filterModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(20, 24, 35, 0.32)",
    justifyContent: "center",
    padding: 18,
  },
  filterModalCard: {
    borderRadius: 30,
    backgroundColor: palette.surface,
    padding: 22,
    gap: 18,
    shadowColor: palette.shadow,
    shadowOpacity: 0.18,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
    elevation: 12,
    borderWidth: 1,
    borderColor: "#E8EDF5",
    overflow: "hidden",
    position: "relative",
  },
  filterAccentOrb: {
    position: "absolute",
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: "#FCE2EC",
    top: -34,
    right: -26,
  },
  filterModalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    zIndex: 1,
  },
  filterPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#FFF1F6",
    marginBottom: 12,
  },
  filterPillText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    color: "#D85A8A",
  },
  filterModalTitle: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: "800",
    color: palette.foreground,
  },
  filterModalSubtitle: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "500",
    color: palette.mutedForeground,
    maxWidth: 220,
  },
  filterModalClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F3F5FA",
    alignItems: "center",
    justifyContent: "center",
  },
  filterSection: {
    gap: 12,
    padding: 15,
    borderRadius: 24,
    backgroundColor: "#FFFBFD",
    borderWidth: 1,
    borderColor: "#F4E7EE",
    shadowColor: palette.shadow,
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  filterSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  filterSectionIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF1F6",
  },
  filterSectionLabel: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    color: palette.foreground,
  },
  filterOptionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  filterFooter: {
    flexDirection: "row",
    gap: 10,
  },
  filterResetButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 18,
    backgroundColor: "#FFF5EF",
    alignItems: "center",
    justifyContent: "center",
  },
  filterResetText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    color: palette.foreground,
  },
  filterApplyButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 20,
    backgroundColor: "#FF5A92",
    alignItems: "center",
    justifyContent: "center",
  },
  filterApplyText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    color: palette.surface,
  },
});
