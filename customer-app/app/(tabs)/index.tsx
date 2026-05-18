import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  type StyleProp,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from "react-native";

import { EmptyStateCard } from "@/src/components/empty-state-card";
import {
  CampaignPlacementCard,
  getBannerToneStyle,
  HomeCmsPromoBlock,
  HowToOrderGuideBlock,
  recordCampaignEvent,
  recordHomeCmsEvent,
} from "@/src/components/home/home-cms-blocks";
import { styles } from "@/src/components/home/home-screen.styles";
import { RestaurantHeroCard } from "@/src/components/restaurant-hero-card";
import { Screen } from "@/src/components/screen";
import { SectionHeader } from "@/src/components/section-header";
import { DELIVERY_RADIUS_KM } from "@/src/config/service-area";
import {
  useCustomerDiscoveryHomeQuery,
  useCustomerFavoriteRestaurantIdsQuery,
  useCustomerOrderPresenceQuery,
  useNearbyRestaurantsQuery,
  useCustomerToggleFavoriteRestaurantMutation,
} from "@/src/hooks/use-customer-api";
import { useCustomerAuthStore } from "@/src/store/auth-store";
import { useBrowseHistoryStore } from "@/src/store/browse-history-store";
import { getCartItemCount, useCartStore } from "@/src/store/cart-store";
import { useIsOnline } from "@/src/hooks/use-network-status";
import { useLocationStore } from "@/src/store/location-store";
import { palette } from "@/src/theme/palette";
import { trackCustomerEvent } from "@/src/lib/analytics";
import { resolveCustomerRoute } from "@/src/lib/customer-routes";
import { formatCustomerAddressLine } from "@/src/lib/location-address";
import { openLocationPermissionSettings } from "@/src/lib/location-permissions";
import type {
  CustomerCampaignPlacement,
  CustomerVoucherOffer,
  DiscoverableRestaurant,
} from "@/src/types/restaurant";

function getOfferLabel(offer: CustomerVoucherOffer) {
  if (offer.type === "free_delivery") {
    return "Free delivery";
  }

  if (offer.type === "percentage" && typeof offer.discountValue === "number") {
    return `${offer.discountValue}% off`;
  }

  if (typeof offer.discountValue === "number") {
    return `Tk ${offer.discountValue} off`;
  }

  return "Offer available";
}

function buildRestaurantOfferMap(offers: CustomerVoucherOffer[]) {
  return new Map(
    offers
      .filter((offer) => offer.restaurantId)
      .map((offer) => [offer.restaurantId as string, getOfferLabel(offer)])
  );
}

function NearbyHeaderSpinner({ visible }: { visible: boolean }) {
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      rotateAnim.stopAnimation();
      return;
    }

    const rotateLoop = Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 880,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );

    rotateAnim.setValue(0);
    rotateLoop.start();

    return () => {
      rotateLoop.stop();
    };
  }, [rotateAnim, visible]);

  if (!visible) {
    return null;
  }

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <View style={styles.nearbySpinnerShell}>
      <Animated.View
        style={[styles.nearbySpinnerRing, { transform: [{ rotate: spin }] }]}
      />
      <View style={styles.nearbySpinnerCore}>
        <Ionicons name="location" size={11} color={palette.secondary} />
      </View>
    </View>
  );
}

function useHomeShimmer(active: boolean) {
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      shimmerAnim.stopAnimation();
      return;
    }

    const shimmerLoop = Animated.loop(
      Animated.timing(shimmerAnim, {
        toValue: 1,
        duration: 1250,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    );

    shimmerAnim.setValue(0);
    shimmerLoop.start();

    return () => {
      shimmerLoop.stop();
    };
  }, [active, shimmerAnim]);

  return shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-220, 220],
  });
}

function ShimmerBlock({
  style,
  translateX,
}: {
  style?: StyleProp<ViewStyle>;
  translateX: Animated.AnimatedInterpolation<number>;
}) {
  return (
    <View style={[styles.shimmerBlock, style]}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.shimmerHighlight,
          { transform: [{ translateX }, { rotate: "10deg" }] },
        ]}
      />
    </View>
  );
}

function HomeHeroSkeleton({
  translateX,
}: {
  translateX: Animated.AnimatedInterpolation<number>;
}) {
  return (
    <View style={styles.homeHeroSkeleton}>
      <ShimmerBlock translateX={translateX} style={styles.homeBannerSkeleton} />
      <View style={styles.skeletonChipRow}>
        <ShimmerBlock translateX={translateX} style={styles.skeletonChipWide} />
        <ShimmerBlock translateX={translateX} style={styles.skeletonChip} />
        <ShimmerBlock translateX={translateX} style={styles.skeletonChipSmall} />
      </View>
    </View>
  );
}

function RestaurantCardSkeleton({
  translateX,
}: {
  translateX: Animated.AnimatedInterpolation<number>;
}) {
  return (
    <View style={styles.restaurantSkeletonCard}>
      <ShimmerBlock translateX={translateX} style={styles.restaurantSkeletonImage} />
      <View style={styles.restaurantSkeletonCopy}>
        <View style={styles.restaurantSkeletonTitleRow}>
          <View style={styles.restaurantSkeletonTitleBlock}>
            <ShimmerBlock translateX={translateX} style={styles.restaurantSkeletonTitle} />
            <ShimmerBlock translateX={translateX} style={styles.restaurantSkeletonSubtitle} />
          </View>
          <ShimmerBlock translateX={translateX} style={styles.restaurantSkeletonPrice} />
        </View>
        <View style={styles.restaurantSkeletonMetricRow}>
          <ShimmerBlock translateX={translateX} style={styles.restaurantSkeletonMetric} />
          <ShimmerBlock translateX={translateX} style={styles.restaurantSkeletonMetric} />
          <ShimmerBlock translateX={translateX} style={styles.restaurantSkeletonMetricSmall} />
        </View>
      </View>
    </View>
  );
}

function RestaurantListSkeleton({
  translateX,
  horizontal = false,
  count = 3,
}: {
  translateX: Animated.AnimatedInterpolation<number>;
  horizontal?: boolean;
  count?: number;
}) {
  const skeletons = Array.from({ length: count }, (_, index) => index);

  if (horizontal) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalRow}
      >
        {skeletons.map((item) => (
          <View key={item} style={styles.featuredCardWrap}>
            <RestaurantCardSkeleton translateX={translateX} />
          </View>
        ))}
      </ScrollView>
    );
  }

  return (
    <View style={styles.verticalList}>
      {skeletons.map((item) => (
        <RestaurantCardSkeleton key={item} translateX={translateX} />
      ))}
    </View>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function mapRestaurantSubtitle(restaurant: DiscoverableRestaurant) {
  return [
    restaurant.cuisineTypes?.slice(0, 2).join(" • "),
    restaurant.address?.city,
  ]
    .filter(Boolean)
    .join(" • ");
}

function mapRestaurantCardSubtitle(restaurant: DiscoverableRestaurant) {
  return restaurant.cuisineTypes?.slice(0, 2).join(" • ") ?? "";
}

export default function HomeScreen() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [modalCampaign, setModalCampaign] = useState<CustomerCampaignPlacement | null>(null);
  const [showHomeCmsModal, setShowHomeCmsModal] = useState(false);
  const [homeCmsModalShown, setHomeCmsModalShown] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const lastTrackedSearchRef = useRef("");
  const customer = useCustomerAuthStore((state) => state.customer);
  const isAuthenticated = useCustomerAuthStore((state) =>
    Boolean(state.accessToken),
  );
  const selectedLocation = useLocationStore((state) => state.selectedLocation);
  const locationKey = selectedLocation
    ? `${selectedLocation.id}:${selectedLocation.latitude}:${selectedLocation.longitude}`
    : "";
  const previousLocationKeyRef = useRef(locationKey);
  const [pendingLocationUpdateKey, setPendingLocationUpdateKey] = useState("");
  const isOnline = useIsOnline();
  const addRecentVisitedRestaurant = useBrowseHistoryStore(
    (state) => state.addRecentVisitedRestaurant
  );
  const permissionGranted = useLocationStore(
    (state) => state.permissionGranted,
  );
  const cartItemCount = useCartStore((state) => getCartItemCount(state.items));
  const isSearching = searchQuery.trim().length > 0;

  const nearbyRestaurantsQuery = useNearbyRestaurantsQuery({
    latitude: selectedLocation?.latitude,
    longitude: selectedLocation?.longitude,
    radiusKm: DELIVERY_RADIUS_KM,
    search: searchQuery,
  });

  const homeQuery = useCustomerDiscoveryHomeQuery({
    latitude: selectedLocation?.latitude,
    longitude: selectedLocation?.longitude,
    radiusKm: DELIVERY_RADIUS_KM,
  });
  const favoriteRestaurantIdsQuery = useCustomerFavoriteRestaurantIdsQuery();
  const orderPresenceQuery = useCustomerOrderPresenceQuery(isAuthenticated && !isSearching);
  const toggleFavoriteMutation = useCustomerToggleFavoriteRestaurantMutation();

  const nearbyRestaurants = useMemo(
    () => nearbyRestaurantsQuery.data ?? [],
    [nearbyRestaurantsQuery.data],
  );
  const homeFeed = homeQuery.data;
  const homeBanner = !isSearching ? (homeFeed?.homeBanner ?? null) : null;
  const homeCms = !isSearching ? (homeFeed?.homeCms ?? null) : null;
  const activeOffers = useMemo(
    () => (!isSearching ? (homeFeed?.activeOffers ?? []) : []),
    [homeFeed?.activeOffers, isSearching]
  );
  const campaignPlacements = useMemo(
    () => (!isSearching ? (homeFeed?.campaignPlacements ?? []) : []),
    [homeFeed?.campaignPlacements, isSearching]
  );
  const stripOffers = useMemo(
    () =>
      homeCms?.offerStrip.isActive && homeCms.offerStrip.mode === "voucher_strip"
        ? activeOffers
        : homeCms?.offerStrip.showVoucherStrip
        ? activeOffers
        : [],
    [activeOffers, homeCms?.offerStrip.isActive, homeCms?.offerStrip.mode, homeCms?.offerStrip.showVoucherStrip]
  );
  const offerLabelByRestaurantId = useMemo(
    () => buildRestaurantOfferMap(activeOffers),
    [activeOffers]
  );
  const favoriteRestaurantIdsSet = useMemo(
    () => new Set(favoriteRestaurantIdsQuery.data ?? []),
    [favoriteRestaurantIdsQuery.data]
  );
  const favoritePendingRestaurantId = toggleFavoriteMutation.isPending
    ? toggleFavoriteMutation.variables
    : null;

  const profileInitials = useMemo(() => {
    const name = customer?.fullName?.trim() ?? "";
    const initials = name
      .split(" ")
      .filter(Boolean)
      .map((part) => part.charAt(0))
      .join("")
      .slice(0, 2)
      .toUpperCase();

    return initials || "CU";
  }, [customer?.fullName]);
  const selectedDeliveryAddressTop = selectedLocation?.addressDetails?.trim() || "";
  const selectedDeliveryAddressBottom = formatCustomerAddressLine(
    selectedLocation?.address,
    "Select your exact delivery point",
  );

  const featuredRestaurants = useMemo(() => {
    if (isSearching) return [];
    const homeFeatured = homeFeed?.featuredRestaurants ?? [];
    const nearbyFeatured = nearbyRestaurants.filter(
      (restaurant) =>
        restaurant.discovery?.isFeatured === true ||
        typeof restaurant.discovery?.featuredSortOrder === "number",
    );

    return (homeFeatured.length ? homeFeatured : nearbyFeatured).slice(0, 6);
  }, [homeFeed?.featuredRestaurants, isSearching, nearbyRestaurants]);

  const offerRestaurants = useMemo(() => {
    if (isSearching) return [];
    return (homeFeed?.restaurantsWithOffers ?? []).slice(0, 8);
  }, [homeFeed?.restaurantsWithOffers, isSearching]);
  const nearbyRestaurantsForSection = useMemo(() => {
    const featuredIds = new Set(
      featuredRestaurants.map((restaurant) => restaurant._id),
    );
    const offerIds = new Set(
      offerRestaurants.map((restaurant) => restaurant._id),
    );
    const filtered = nearbyRestaurants.filter(
      (restaurant) =>
        !featuredIds.has(restaurant._id) && !offerIds.has(restaurant._id),
    );

    return (filtered.length ? filtered : nearbyRestaurants).slice(0, 8);
  }, [featuredRestaurants, nearbyRestaurants, offerRestaurants]);

  const shouldShowHomeFeedSkeleton = !isSearching && homeQuery.isLoading && !homeFeed;
  const shouldShowSearchSkeleton =
    isSearching &&
    Boolean(selectedLocation) &&
    nearbyRestaurantsQuery.isLoading &&
    nearbyRestaurants.length === 0;
  const shouldShowNearbySkeleton =
    !isSearching &&
    Boolean(selectedLocation) &&
    nearbyRestaurantsQuery.isLoading &&
    nearbyRestaurants.length === 0;
  const shimmerTranslateX = useHomeShimmer(
    shouldShowHomeFeedSkeleton || shouldShowSearchSkeleton || shouldShowNearbySkeleton,
  );

  const bannerTone = getBannerToneStyle(homeBanner?.tone ?? null);
  const shouldShowHowToOrderGuide =
    Boolean(homeCms) &&
    !isSearching &&
    (!isAuthenticated ||
      (orderPresenceQuery.isSuccess &&
        !orderPresenceQuery.data.hasCompletedOrders));
  const isUpdatingLocationResults = Boolean(
    pendingLocationUpdateKey &&
      selectedLocation &&
      isOnline &&
      !isRefreshing &&
      !isSearching &&
      (nearbyRestaurantsQuery.isFetching || homeQuery.isFetching),
  );

  useEffect(() => {
    if (!locationKey) {
      previousLocationKeyRef.current = "";
      setPendingLocationUpdateKey("");
      return;
    }

    const previousLocationKey = previousLocationKeyRef.current;
    if (previousLocationKey && previousLocationKey !== locationKey) {
      setPendingLocationUpdateKey(locationKey);
    }
    previousLocationKeyRef.current = locationKey;
  }, [locationKey]);

  useEffect(() => {
    if (!pendingLocationUpdateKey) {
      return;
    }

    if (!isOnline) {
      setPendingLocationUpdateKey("");
      return;
    }

    if (!nearbyRestaurantsQuery.isFetching && !homeQuery.isFetching) {
      setPendingLocationUpdateKey("");
    }
  }, [
    homeQuery.isFetching,
    isOnline,
    nearbyRestaurantsQuery.isFetching,
    pendingLocationUpdateKey,
  ]);

  useEffect(() => {
    campaignPlacements.forEach((campaign) => {
      recordCampaignEvent(campaign.voucherId, "impression");
    });
  }, [campaignPlacements]);

  useEffect(() => {
    if (!homeCms?.offerStrip.isActive) return;
    if (homeCms.offerStrip.mode === "voucher_strip") {
      recordHomeCmsEvent("strip_impression");
    } else if (homeCms.offerStrip.mode === "promo_block") {
      recordHomeCmsEvent("block_impression");
    }
  }, [homeCms?.offerStrip.isActive, homeCms?.offerStrip.mode]);

  useEffect(() => {
    if (!homeCms?.modal.isActive || isSearching) return;
    if (homeCms.modal.frequency === "once_per_session" && homeCmsModalShown) return;
    const timer = setTimeout(() => {
      setShowHomeCmsModal(true);
      setHomeCmsModalShown(true);
      recordHomeCmsEvent("modal_impression");
    }, Math.max(homeCms.modal.delaySeconds ?? 0, 0) * 1000);

    return () => clearTimeout(timer);
  }, [
    homeCms?.modal.delaySeconds,
    homeCms?.modal.frequency,
    homeCms?.modal.isActive,
    homeCmsModalShown,
    isSearching,
  ]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 2) return;

    const timer = setTimeout(() => {
      const resultCount = nearbyRestaurants.length;
      const trackingKey = `${query.toLowerCase()}|${resultCount}`;
      if (lastTrackedSearchRef.current === trackingKey) return;
      lastTrackedSearchRef.current = trackingKey;

      void trackCustomerEvent({
        eventType: "search",
        path: "/(tabs)",
        screenName: "home",
        metadata: {
          query: query.slice(0, 80),
          scope: "restaurant_discovery",
          resultCount,
          hasResults: resultCount > 0,
        },
      });
    }, 700);

    return () => clearTimeout(timer);
  }, [nearbyRestaurants.length, searchQuery]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        homeQuery.refetch(),
        nearbyRestaurantsQuery.refetch(),
        favoriteRestaurantIdsQuery.refetch(),
        ...(isAuthenticated && !isSearching ? [orderPresenceQuery.refetch()] : []),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  };

  const goToRestaurant = (restaurant: DiscoverableRestaurant) => {
    addRecentVisitedRestaurant({
      id: restaurant._id,
      name: restaurant.name,
      subtitle: mapRestaurantCardSubtitle(restaurant),
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

  const handleToggleFavorite = async (restaurantId: string) => {
    if (!isAuthenticated) {
      router.push({
        pathname: "/sign-in",
        params: { redirectTo: "/(tabs)" },
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

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={palette.primary}
            colors={[palette.primary, palette.secondary, "#FF5C93"]}
          />
        }
      >
        <View style={styles.hero}>
          <View style={styles.heroOrbPrimary} />
          <View style={styles.heroOrbSecondary} />

          <View style={styles.heroTopRow}>
            <Pressable onPress={openLocationPicker} style={styles.addressBlock}>
              <Text style={styles.addressLabel}>DELIVERY ADDRESS</Text>
              <View style={styles.addressRow}>
                <Ionicons name="location" size={16} color={palette.secondary} />
                <Text numberOfLines={1} style={styles.addressValue}>
                  {selectedDeliveryAddressTop ||
                    selectedLocation?.label ||
                    "Choose your location"}
                </Text>
                <Ionicons
                  name="chevron-down"
                  size={16}
                  color={palette.foreground}
                />
              </View>
              <Text numberOfLines={1} style={styles.addressSubtext}>
                {selectedDeliveryAddressTop
                  ? selectedDeliveryAddressBottom
                  : selectedLocation?.address
                    ? formatCustomerAddressLine(selectedLocation.address)
                    : "Select your exact delivery point"}
              </Text>
            </Pressable>

            <View style={styles.actions}>
              <Pressable
                onPress={() => router.push("/(tabs)/cart")}
                style={styles.cartBubble}
              >
                <Ionicons
                  name="bag-handle-outline"
                  size={18}
                  color="#fff"
                />
                {cartItemCount > 0 ? (
                  <View style={styles.cartCounter}>
                    <Text style={styles.cartCounterText}>{cartItemCount}</Text>
                  </View>
                ) : null}
              </Pressable>

              <Pressable
                onPress={() => router.push("/(tabs)/profile")}
                style={[
                  styles.profileBubble,
                  customer && !customer.profileImage?.url
                    ? styles.profileBubbleSignedIn
                    : null,
                ]}
              >
                {customer?.profileImage?.url ? (
                  <Image
                    source={{ uri: customer.profileImage.url }}
                    style={styles.profileImage}
                  />
                ) : customer ? (
                  <Text style={styles.profileBubbleText}>
                    {profileInitials}
                  </Text>
                ) : (
                  <Ionicons
                    name="person-outline"
                    size={18}
                    color={palette.secondary}
                  />
                )}
              </Pressable>
            </View>
          </View>

          <View style={styles.searchBar}>
            <Ionicons name="search" size={18} color={palette.mutedForeground} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search restaurants, burgers, desserts..."
              placeholderTextColor="rgba(95, 76, 86, 0.52)"
              style={styles.searchInput}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
            />
            {searchQuery.trim().length > 0 ? (
              <Pressable
                onPress={() => setSearchQuery("")}
                style={styles.clearButton}
              >
                <Ionicons
                  name="close"
                  size={16}
                  color={palette.mutedForeground}
                />
              </Pressable>
            ) : null}
          </View>

          {shouldShowHomeFeedSkeleton ? (
            <HomeHeroSkeleton translateX={shimmerTranslateX} />
          ) : null}

          {homeBanner ? (
            <Pressable
              style={[styles.bannerCard, { backgroundColor: bannerTone.shell }]}
              disabled={!resolveCustomerRoute(homeBanner.ctaPath, null)}
              onPress={() => {
                const path = resolveCustomerRoute(homeBanner.ctaPath, null);
                if (path) router.push(path as never);
              }}
            >
              <View style={styles.bannerCopy}>
                <View
                  style={[
                    styles.bannerChip,
                    { backgroundColor: bannerTone.chip },
                  ]}
                >
                  <Ionicons
                    name="sparkles-outline"
                    size={14}
                    color={bannerTone.title}
                  />
                  <Text
                    style={[styles.bannerChipText, { color: bannerTone.title }]}
                  >
                    Featured update
                  </Text>
                </View>
                <Text style={[styles.bannerTitle, { color: bannerTone.title }]}>
                  {homeBanner.title}
                </Text>
                <Text
                  style={[
                    styles.bannerSubtitle,
                    { color: bannerTone.subtitle },
                  ]}
                >
                  {homeBanner.subtitle}
                </Text>
              </View>

              {resolveCustomerRoute(homeBanner.ctaPath, null) ? (
                <View
                  style={[
                    styles.bannerButton,
                    { backgroundColor: bannerTone.button },
                  ]}
                >
                  <Text style={styles.bannerButtonText}>
                    {homeBanner.ctaLabel}
                  </Text>
                  <Ionicons name="arrow-forward" size={15} color="#fff" />
                </View>
              ) : null}
            </Pressable>
          ) : null}

          {campaignPlacements
            .filter((campaign) => campaign.display?.placement !== "offers_row")
            .slice(0, 3)
            .map((campaign) => (
              <CampaignPlacementCard
                key={campaign._id}
                campaign={campaign}
                onOpenModal={setModalCampaign}
              />
            ))}

          {!isSearching && homeCms?.offerStrip.isActive && homeCms.offerStrip.mode === "promo_block" ? (
            <HomeCmsPromoBlock cms={homeCms} />
          ) : null}

          {!isSearching && stripOffers.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.offerChipRow}
            >
              {stripOffers.slice(0, 8).map((offer) => (
                <Pressable
                  key={offer._id}
                  style={styles.offerChip}
                  onPress={() => recordHomeCmsEvent("strip_click")}
                >
                  <Ionicons
                    name="pricetag-outline"
                    size={14}
                    color="#FF5C93"
                  />
                  <Text numberOfLines={1} style={styles.offerChipText}>
                    {getOfferLabel(offer)}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

        </View>

        {shouldShowHowToOrderGuide && homeCms && homeCms.howToOrderGuide?.placement !== "before_restaurants" ? (
          <HowToOrderGuideBlock cms={homeCms} />
        ) : null}

        {isSearching ? (
          <View style={styles.section}>
            <View style={styles.sectionHeaderWrap}>
              <SectionHeader
                title="Search results"
                subtitle={
                  selectedLocation
                    ? `${nearbyRestaurants.length} restaurants found for "${searchQuery.trim()}"`
                    : "Choose a location first to search nearby restaurants"
                }
              />
            </View>

            {!selectedLocation ? (
              <EmptyStateCard
                title={
                  permissionGranted === false
                    ? "Location permission is needed"
                    : "Choose your location first"
                }
                description="Pick your delivery point to search restaurants that really serve your area."
                actionLabel={
                  permissionGranted === false ? "Allow location" : "Choose location"
                }
                onPress={handleMissingLocationPress}
              />
            ) : shouldShowSearchSkeleton ? (
              <RestaurantListSkeleton translateX={shimmerTranslateX} count={3} />
            ) : nearbyRestaurants.length > 0 ? (
              <View style={styles.verticalList}>
                {nearbyRestaurants.map((restaurant) => (
                  <RestaurantHeroCard
                    key={restaurant._id}
                    name={restaurant.name}
                    subtitle={mapRestaurantCardSubtitle(restaurant)}
                    imageUrl={
                      restaurant.coverImage?.url || restaurant.logo?.url || null
                    }
                    isOpen={restaurant.isOpen !== false}
                    distanceKm={restaurant.distanceKm}
                    avgRating={restaurant.avgRating}
                    reviewCount={restaurant.reviewCount}
                    offerLabel={offerLabelByRestaurantId.get(restaurant._id)}
                    lowestMenuPrice={restaurant.lowestMenuPrice}
                    preparationTimeMinutes={restaurant.preparationTimeMinutes}
                    isFavorite={favoriteRestaurantIdsSet.has(restaurant._id)}
                    favoriteDisabled={
                      favoritePendingRestaurantId === restaurant._id
                    }
                    onToggleFavorite={() =>
                      handleToggleFavorite(restaurant._id)
                    }
                    onPress={() => goToRestaurant(restaurant)}
                  />
                ))}
              </View>
            ) : (
              <EmptyStateCard
                title="No matching restaurants found"
                description="Try a different search or change your delivery point."
                actionLabel="Change location"
                onPress={openLocationPicker}
              />
            )}
          </View>
        ) : (
          <>
            {shouldShowHowToOrderGuide && homeCms && homeCms.howToOrderGuide?.placement === "before_restaurants" ? (
              <HowToOrderGuideBlock cms={homeCms} />
            ) : null}

            {featuredRestaurants.length > 0 || shouldShowHomeFeedSkeleton ? (
              <View style={styles.section}>
                <View style={styles.sectionHeaderWrap}>
                  <SectionHeader
                    title="Featured restaurants"
                    subtitle="Featured restaurants worth checking first."
                  />
                </View>
                {shouldShowHomeFeedSkeleton ? (
                  <RestaurantListSkeleton
                    translateX={shimmerTranslateX}
                    horizontal
                    count={2}
                  />
                ) : (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.horizontalRow}
                  >
                    {featuredRestaurants.map((restaurant) => (
                      <View key={restaurant._id} style={styles.featuredCardWrap}>
                        <RestaurantHeroCard
                          name={restaurant.name}
                          subtitle={mapRestaurantCardSubtitle(restaurant)}
                          imageUrl={
                            restaurant.coverImage?.url ||
                            restaurant.logo?.url ||
                            null
                          }
                          isOpen={restaurant.isOpen !== false}
                          distanceKm={restaurant.distanceKm}
                          avgRating={restaurant.avgRating}
                          reviewCount={restaurant.reviewCount}
                          offerLabel={offerLabelByRestaurantId.get(restaurant._id)}
                          lowestMenuPrice={restaurant.lowestMenuPrice}
                          preparationTimeMinutes={
                            restaurant.preparationTimeMinutes
                          }
                          isFavorite={favoriteRestaurantIdsSet.has(restaurant._id)}
                          favoriteDisabled={
                            favoritePendingRestaurantId === restaurant._id
                          }
                          onToggleFavorite={() =>
                            handleToggleFavorite(restaurant._id)
                          }
                          onPress={() => goToRestaurant(restaurant)}
                        />
                      </View>
                    ))}
                  </ScrollView>
                )}
              </View>
            ) : null}

            {offerRestaurants.length > 0 ? (
              <View style={styles.section}>
                <View style={styles.sectionHeaderWrap}>
                  <SectionHeader
                    title="Offers for you"
                    subtitle="Restaurants with active savings right now."
                  />
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.horizontalRow}
                >
                  {offerRestaurants.map((restaurant) => (
                    <View key={restaurant._id} style={styles.featuredCardWrap}>
                      <RestaurantHeroCard
                        name={restaurant.name}
                        subtitle={mapRestaurantCardSubtitle(restaurant)}
                        imageUrl={
                          restaurant.coverImage?.url ||
                          restaurant.logo?.url ||
                          null
                        }
                        isOpen={restaurant.isOpen !== false}
                        distanceKm={restaurant.distanceKm}
                        avgRating={restaurant.avgRating}
                        reviewCount={restaurant.reviewCount}
                        offerLabel={offerLabelByRestaurantId.get(restaurant._id)}
                        lowestMenuPrice={restaurant.lowestMenuPrice}
                        preparationTimeMinutes={
                          restaurant.preparationTimeMinutes
                        }
                        isFavorite={favoriteRestaurantIdsSet.has(restaurant._id)}
                        favoriteDisabled={
                          favoritePendingRestaurantId === restaurant._id
                        }
                        onToggleFavorite={() =>
                          handleToggleFavorite(restaurant._id)
                        }
                        onPress={() => goToRestaurant(restaurant)}
                      />
                    </View>
                  ))}
                </ScrollView>
              </View>
            ) : null}

            <View style={styles.section}>
              <View style={styles.nearbySectionHeaderRow}>
                <View style={styles.nearbySectionHeaderCopy}>
                  <SectionHeader
                    title="Nearby"
                    subtitle={
                      selectedLocation
                        ? `${nearbyRestaurants.length} restaurants around your selected pin`
                        : "Choose a location to unlock restaurants near you"
                    }
                  />
                </View>
                <NearbyHeaderSpinner visible={isUpdatingLocationResults} />
              </View>

              {!selectedLocation ? (
                <EmptyStateCard
                  title={
                    permissionGranted === false
                      ? "Location permission is needed"
                      : "Choose your location first"
                  }
                  description="Pick your delivery point to unlock restaurants that really serve your area."
                  actionLabel={
                    permissionGranted === false ? "Allow location" : "Choose location"
                  }
                  onPress={handleMissingLocationPress}
                />
              ) : shouldShowNearbySkeleton ? (
                <RestaurantListSkeleton translateX={shimmerTranslateX} count={3} />
              ) : nearbyRestaurantsQuery.isError ? (
                isOnline ? (
                  <EmptyStateCard
                    title="We could not load nearby restaurants"
                    description="Please try again after a moment. Your selected location is still saved."
                    actionLabel="Try again"
                    onPress={() => nearbyRestaurantsQuery.refetch()}
                  />
                ) : (
                  <EmptyStateCard
                    title="Nearby restaurants are unavailable offline"
                    description="Check your internet connection to refresh restaurants that serve your selected area."
                  />
                )
            ) : nearbyRestaurantsForSection.length > 0 ? (
                <>
                  <View style={styles.verticalList}>
                    {nearbyRestaurantsForSection.map((restaurant) => (
                      <RestaurantHeroCard
                        key={restaurant._id}
                        name={restaurant.name}
                        subtitle={mapRestaurantCardSubtitle(restaurant)}
                        imageUrl={
                          restaurant.coverImage?.url ||
                          restaurant.logo?.url ||
                          null
                        }
                        isOpen={restaurant.isOpen !== false}
                        distanceKm={restaurant.distanceKm}
                        avgRating={restaurant.avgRating}
                        reviewCount={restaurant.reviewCount}
                        offerLabel={offerLabelByRestaurantId.get(restaurant._id)}
                        lowestMenuPrice={restaurant.lowestMenuPrice}
                        preparationTimeMinutes={
                          restaurant.preparationTimeMinutes
                        }
                        isFavorite={favoriteRestaurantIdsSet.has(restaurant._id)}
                        favoriteDisabled={
                          favoritePendingRestaurantId === restaurant._id
                        }
                        onToggleFavorite={() =>
                          handleToggleFavorite(restaurant._id)
                        }
                        onPress={() => goToRestaurant(restaurant)}
                      />
                    ))}
                  </View>

                  <Pressable
                    style={styles.browseAllButton}
                    onPress={() => router.push("/(tabs)/browse")}
                  >
                    <Text style={styles.browseAllButtonText}>
                      Browse all restaurants
                    </Text>
                    <Ionicons
                      name="arrow-forward"
                      size={16}
                      color={palette.foreground}
                    />
                  </Pressable>
                </>
              ) : (
                isUpdatingLocationResults ? null : (
                  <EmptyStateCard
                    title={
                      isOnline
                        ? "No nearby restaurants yet"
                        : "Nearby restaurants are unavailable offline"
                    }
                    description={
                      isOnline
                        ? "We could not find any active restaurant inside your delivery area right now."
                        : "Check your internet connection to load restaurants for your selected delivery area."
                    }
                    actionLabel={isOnline ? "Change location" : undefined}
                    onPress={isOnline ? openLocationPicker : undefined}
                  />
                )
              )}
            </View>
          </>
        )}
      </ScrollView>
      {modalCampaign ? (
        <View style={styles.campaignModalOverlay}>
          <Pressable style={styles.campaignModalBackdrop} onPress={() => setModalCampaign(null)} />
          <View style={styles.campaignModalCard}>
            {modalCampaign.display.imageUrl ? (
              <Image source={{ uri: modalCampaign.display.imageUrl }} style={styles.campaignModalImage} />
            ) : null}
            <Text style={styles.campaignModalTitle}>
              {modalCampaign.display.title || modalCampaign.name}
            </Text>
            <Text style={styles.campaignModalSubtitle}>
              {modalCampaign.display.subtitle || "Limited time campaign"}
            </Text>
            {resolveCustomerRoute(modalCampaign.display.ctaPath, null) ? (
              <Pressable
                style={styles.campaignModalAction}
                onPress={() => {
                  recordCampaignEvent(modalCampaign.voucherId, "click");
                  const path = resolveCustomerRoute(
                    modalCampaign.display.ctaPath,
                    null,
                  );
                  setModalCampaign(null);
                  if (path) router.push(path as never);
                }}
              >
                <Text style={styles.campaignModalActionText}>
                  {modalCampaign.display.ctaLabel || "Order now"}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {showHomeCmsModal && homeCms?.modal.isActive ? (
        <View style={styles.campaignModalOverlay}>
          <Pressable
            style={styles.campaignModalBackdrop}
            onPress={() => setShowHomeCmsModal(false)}
          />
          <View
            style={[
              styles.campaignModalCard,
              { backgroundColor: homeCms.modal.backgroundColor || palette.surface },
            ]}
          >
            <Pressable
              style={styles.campaignModalClose}
              onPress={() => setShowHomeCmsModal(false)}
            >
              <Ionicons name="close" size={18} color={homeCms.modal.textColor || palette.foreground} />
            </Pressable>
            {homeCms.modal.imageUrl ? (
              <Image source={{ uri: homeCms.modal.imageUrl }} style={styles.campaignModalImage} />
            ) : null}
            {homeCms.modal.title.trim() ? (
              <Text style={[styles.campaignModalTitle, { color: homeCms.modal.textColor || palette.foreground }]}>
                {homeCms.modal.title}
              </Text>
            ) : null}
            {homeCms.modal.subtitle.trim() ? (
              <Text style={[styles.campaignModalSubtitle, { color: homeCms.modal.textColor || palette.mutedForeground }]}>
                {homeCms.modal.subtitle}
              </Text>
            ) : null}
            {resolveCustomerRoute(homeCms.modal.ctaPath, null) ? (
              <Pressable
                style={[styles.campaignModalAction, { backgroundColor: homeCms.modal.accentColor || palette.primary }]}
                onPress={() => {
                  recordHomeCmsEvent("modal_click");
                  const path = resolveCustomerRoute(homeCms.modal.ctaPath, null);
                  setShowHomeCmsModal(false);
                  if (path) router.push(path as never);
                }}
              >
                <Text style={styles.campaignModalActionText}>
                  {homeCms.modal.ctaLabel || "Explore now"}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </Screen>
  );
}
