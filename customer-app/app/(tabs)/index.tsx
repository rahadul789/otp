import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  type StyleProp,
  Text,
  View,
  type ViewStyle,
} from "react-native";

import { EmptyStateCard } from "@/src/components/empty-state-card";
import {
  getBannerToneStyle,
  HomeCmsPromoBlock,
  HowToOrderGuideBlock,
  recordHomeCmsEvent,
} from "@/src/components/home/home-cms-blocks";
import { styles } from "@/src/components/home/home-screen.styles";
import { RemoteImage } from "@/src/components/remote-image";
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
  CustomerHomeCms,
  CustomerVoucherOffer,
  DiscoverableRestaurant,
} from "@/src/types/restaurant";

function isExternalHttpUrl(value?: string | null) {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

function getOfferLabel(offer: CustomerVoucherOffer) {
  let value = "Offer available";

  if (offer.type === "free_delivery") {
    value = "Free delivery";
  } else if (
    offer.type === "percentage" &&
    typeof offer.discountValue === "number"
  ) {
    value = `${offer.discountValue}% off`;
  } else if (typeof offer.discountValue === "number") {
    value = `Tk ${offer.discountValue} off`;
  }

  return offer.code ? `${offer.code} - ${value}` : value;
}

function buildRestaurantOfferMap(offers: CustomerVoucherOffer[]) {
  const next = new Map<string, string>();

  for (const offer of offers) {
    const restaurantIds = [
      ...(offer.restaurantIds ?? []),
      offer.restaurantId ?? "",
    ].filter(Boolean);

    for (const restaurantId of restaurantIds) {
      if (!next.has(restaurantId)) {
        next.set(restaurantId, getOfferLabel(offer));
      }
    }
  }

  return next;
}

function hasRenderableHomePromoBlock(homeCms?: CustomerHomeCms | null) {
  const block = homeCms?.offerStrip;
  if (!block?.isActive || block.mode !== "promo_block") return false;
  if (block.variant === "carousel") {
    return Boolean(
      block.carouselImages?.some((image) => image.url.trim()) ||
        block.carouselImageUrls?.some((url) => url.trim()),
    );
  }
  if (block.variant === "image") return Boolean(block.imageUrl.trim());
  return Boolean(
    block.title.trim() ||
      block.subtitle.trim() ||
      (block.variant === "image_text" && block.imageUrl.trim()),
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
      <ShimmerBlock
        translateX={translateX}
        style={styles.restaurantSkeletonImage}
      />
      <View style={styles.restaurantSkeletonCopy}>
        <View style={styles.restaurantSkeletonTitleRow}>
          <View style={styles.restaurantSkeletonTitleBlock}>
            <ShimmerBlock
              translateX={translateX}
              style={styles.restaurantSkeletonTitle}
            />
            <ShimmerBlock
              translateX={translateX}
              style={styles.restaurantSkeletonSubtitle}
            />
          </View>
          <ShimmerBlock
            translateX={translateX}
            style={styles.restaurantSkeletonPrice}
          />
        </View>
        <View style={styles.restaurantSkeletonMetricRow}>
          <ShimmerBlock
            translateX={translateX}
            style={styles.restaurantSkeletonMetric}
          />
          <ShimmerBlock
            translateX={translateX}
            style={styles.restaurantSkeletonMetric}
          />
          <ShimmerBlock
            translateX={translateX}
            style={styles.restaurantSkeletonMetricSmall}
          />
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
  const searchQuery = "";
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
    (state) => state.addRecentVisitedRestaurant,
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
  const orderPresenceQuery = useCustomerOrderPresenceQuery(
    isAuthenticated && !isSearching,
  );
  const toggleFavoriteMutation = useCustomerToggleFavoriteRestaurantMutation();

  const nearbyRestaurants = useMemo(
    () => nearbyRestaurantsQuery.data ?? [],
    [nearbyRestaurantsQuery.data],
  );
  const homeFeed = homeQuery.data;
  const homeBanner = !isSearching ? (homeFeed?.homeBanner ?? null) : null;
  const homeCms = !isSearching ? (homeFeed?.homeCms ?? null) : null;
  const homeOfferStrip = homeCms?.offerStrip;
  const activeOffers = useMemo(
    () => (!isSearching ? (homeFeed?.activeOffers ?? []) : []),
    [homeFeed?.activeOffers, isSearching],
  );
  const homeCategoryItems = useMemo(
    () =>
      (homeCms?.homeCategories?.items ?? [])
        .filter((item) => item.isActive !== false && item.label.trim())
        .sort((left, right) => (left.position ?? 0) - (right.position ?? 0))
        .slice(0, 10),
    [homeCms?.homeCategories?.items],
  );
  const shouldShowVoucherStrip =
    !isSearching &&
    Boolean(homeOfferStrip && homeOfferStrip.showVoucherStrip !== false);
  const shouldShowHomePromoBlock =
    !isSearching && hasRenderableHomePromoBlock(homeCms);
  const shouldShowRestaurantOfferSection =
    !isSearching &&
    Boolean(
      homeOfferStrip && homeOfferStrip.showRestaurantOfferSection !== false,
    );
  const stripOffers = useMemo(
    () => (shouldShowVoucherStrip ? activeOffers : []),
    [
      activeOffers,
      shouldShowVoucherStrip,
    ],
  );
  const offerLabelByRestaurantId = useMemo(
    () => buildRestaurantOfferMap(activeOffers),
    [activeOffers],
  );
  const favoriteRestaurantIdsSet = useMemo(
    () => new Set(favoriteRestaurantIdsQuery.data ?? []),
    [favoriteRestaurantIdsQuery.data],
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
  const selectedDeliveryAddressTop =
    selectedLocation?.addressDetails?.trim() || "";
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
    if (!shouldShowRestaurantOfferSection) return [];
    return (homeFeed?.restaurantsWithOffers ?? []).slice(0, 8);
  }, [homeFeed?.restaurantsWithOffers, shouldShowRestaurantOfferSection]);
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

  const shouldShowHomeFeedSkeleton =
    !isSearching && homeQuery.isLoading && !homeFeed;
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
    shouldShowHomeFeedSkeleton ||
      shouldShowSearchSkeleton ||
      shouldShowNearbySkeleton,
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
    if (!homeOfferStrip) return;
    if (shouldShowVoucherStrip && stripOffers.length > 0) {
      recordHomeCmsEvent("strip_impression");
    }
    if (shouldShowHomePromoBlock) {
      recordHomeCmsEvent("block_impression");
    }
  }, [
    homeOfferStrip,
    shouldShowHomePromoBlock,
    shouldShowVoucherStrip,
    stripOffers.length,
  ]);

  useEffect(() => {
    if (!homeCms?.modal.isActive || isSearching) return;
    if (homeCms.modal.frequency === "once_per_session" && homeCmsModalShown)
      return;
    const timer = setTimeout(
      () => {
        setShowHomeCmsModal(true);
        setHomeCmsModalShown(true);
        recordHomeCmsEvent("modal_impression");
      },
      Math.max(homeCms.modal.delaySeconds ?? 0, 0) * 1000,
    );

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
        ...(isAuthenticated && !isSearching
          ? [orderPresenceQuery.refetch()]
          : []),
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

  const openSearchScreen = (query?: string) => {
    router.push({
      pathname: "/search",
      params: query?.trim()
        ? { query: query.trim() }
        : { focus: "1" },
    });
  };

  const handleMissingLocationPress = () => {
    if (permissionGranted === false) {
      void openLocationPermissionSettings();
      return;
    }

    openLocationPicker();
  };

  const canOpenCustomerTarget = (target?: string | null) =>
    Boolean(
      resolveCustomerRoute(target, null) ||
        (target?.trim() ? isExternalHttpUrl(target) : false),
    );

  const openCustomerTarget = async (target?: string | null) => {
    const safeRoute = resolveCustomerRoute(target, null);
    if (safeRoute) {
      router.push(safeRoute as never);
      return;
    }

    const externalUrl = target?.trim() ?? "";
    if (isExternalHttpUrl(externalUrl)) {
      await Linking.openURL(externalUrl);
    }
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
                <Ionicons name="bag-handle-outline" size={18} color="#fff" />
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
                  <RemoteImage
                    uri={customer.profileImage.url}
                    style={styles.profileImage}
                    fallbackIcon="person-outline"
                    fallbackIconSize={18}
                    accessibilityLabel="Profile photo"
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

          <View style={styles.searchCategoryPanel}>
            <Pressable style={styles.searchBar} onPress={() => openSearchScreen()}>
              <View style={styles.searchIconBubble}>
                <Ionicons name="search" size={17} color={palette.secondary} />
              </View>
              <Text style={styles.searchInput}>
                Search food or restaurant
              </Text>
              <Ionicons name="arrow-forward" size={15} color={palette.placeholder} />
            </Pressable>

            {!isSearching &&
            homeCms?.homeCategories?.isActive !== false &&
            homeCategoryItems.length > 0 ? (
              <View style={styles.homeCategoryBlock}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.homeCategoryRow}
                >
                  {homeCategoryItems.map((item, index) => (
                    <Pressable
                      key={item.id || `${item.label}-${index}`}
                      style={[
                        styles.homeCategoryChip,
                        { backgroundColor: item.color || "#FFF0F6" },
                      ]}
                      onPress={() => openSearchScreen(item.searchQuery || item.label)}
                    >
                      <View style={styles.homeCategoryIconWrap}>
                        <Ionicons
                          name={(item.icon || "restaurant-outline") as keyof typeof Ionicons.glyphMap}
                          size={14}
                          color={palette.foreground}
                        />
                      </View>
                      <Text style={styles.homeCategoryChipText} numberOfLines={1}>
                        {item.label}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ) : shouldShowHomeFeedSkeleton ? (
              <View style={styles.skeletonChipRow}>
                <ShimmerBlock translateX={shimmerTranslateX} style={styles.skeletonChipWide} />
                <ShimmerBlock translateX={shimmerTranslateX} style={styles.skeletonChip} />
                <ShimmerBlock
                  translateX={shimmerTranslateX}
                  style={styles.skeletonChipSmall}
                />
              </View>
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

          {!isSearching &&
          shouldShowHomePromoBlock &&
          homeCms ? (
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
                  <Ionicons name="pricetag-outline" size={14} color="#FF5C93" />
                  <Text numberOfLines={1} style={styles.offerChipText}>
                    {getOfferLabel(offer)}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
        </View>

        {shouldShowHowToOrderGuide &&
        homeCms &&
        homeCms.howToOrderGuide?.placement !== "before_restaurants" ? (
          <HowToOrderGuideBlock cms={homeCms} />
        ) : null}

        {isSearching ? (
          <View style={styles.section}>
            <View style={styles.sectionHeaderWrap}>
              <SectionHeader
                title="Search results"
                subtitle={
                  selectedLocation
                    ? `${nearbyRestaurants.length} places found for "${searchQuery.trim()}"`
                    : "Set your delivery point first, then search nearby places"
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
                description="Set your delivery point so we can show places that deliver to you."
                actionLabel={
                  permissionGranted === false
                    ? "Allow location"
                    : "Choose location"
                }
                onPress={handleMissingLocationPress}
              />
            ) : shouldShowSearchSkeleton ? (
              <RestaurantListSkeleton
                translateX={shimmerTranslateX}
                count={3}
              />
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
                title="No food or restaurant found"
                description="Try another food name, cuisine, or restaurant spelling. You can also clear the search and browse nearby places."
              />
            )}
          </View>
        ) : (
          <>
            {shouldShowHowToOrderGuide &&
            homeCms &&
            homeCms.howToOrderGuide?.placement === "before_restaurants" ? (
              <HowToOrderGuideBlock cms={homeCms} />
            ) : null}

            {featuredRestaurants.length > 0 || shouldShowHomeFeedSkeleton ? (
              <View style={styles.section}>
                <View style={styles.sectionHeaderWrap}>
                  <SectionHeader
                    title="Featured restaurants"
                    subtitle="Popular places picked for quick ordering."
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
                      <View
                        key={restaurant._id}
                        style={styles.featuredCardWrap}
                      >
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
                          offerLabel={offerLabelByRestaurantId.get(
                            restaurant._id,
                          )}
                          lowestMenuPrice={restaurant.lowestMenuPrice}
                          preparationTimeMinutes={
                            restaurant.preparationTimeMinutes
                          }
                          isFavorite={favoriteRestaurantIdsSet.has(
                            restaurant._id,
                          )}
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
                    subtitle="Places with deals you can use today."
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
                        offerLabel={offerLabelByRestaurantId.get(
                          restaurant._id,
                        )}
                        lowestMenuPrice={restaurant.lowestMenuPrice}
                        preparationTimeMinutes={
                          restaurant.preparationTimeMinutes
                        }
                        isFavorite={favoriteRestaurantIdsSet.has(
                          restaurant._id,
                        )}
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
                        ? `${nearbyRestaurants.length} places deliver near your selected pin`
                        : "Set your location to see places near you"
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
                  description="Set your delivery point so we can show places that deliver to you."
                  actionLabel={
                    permissionGranted === false
                      ? "Allow location"
                      : "Choose location"
                  }
                  onPress={handleMissingLocationPress}
                />
              ) : shouldShowNearbySkeleton ? (
                <RestaurantListSkeleton
                  translateX={shimmerTranslateX}
                  count={3}
                />
              ) : nearbyRestaurantsQuery.isError ? (
                isOnline ? (
                  <EmptyStateCard
                    title="We could not load nearby restaurants"
                    description="Please try again in a moment. Your saved location is still ready."
                    actionLabel="Try again"
                    onPress={() => nearbyRestaurantsQuery.refetch()}
                  />
                ) : (
                  <EmptyStateCard
                    title="Nearby restaurants are unavailable offline"
                    description="Connect to the internet to refresh places near your delivery point."
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
                        offerLabel={offerLabelByRestaurantId.get(
                          restaurant._id,
                        )}
                        lowestMenuPrice={restaurant.lowestMenuPrice}
                        preparationTimeMinutes={
                          restaurant.preparationTimeMinutes
                        }
                        isFavorite={favoriteRestaurantIdsSet.has(
                          restaurant._id,
                        )}
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
              ) : isUpdatingLocationResults ? null : (
                <EmptyStateCard
                  title={
                    isOnline
                      ? "No nearby restaurants yet"
                      : "Nearby restaurants are unavailable offline"
                  }
                  description={
                    isOnline
                      ? "No active place is delivering to your selected point right now."
                      : "Connect to the internet to load places near your delivery point."
                  }
                  actionLabel={isOnline ? "Change location" : undefined}
                  onPress={isOnline ? openLocationPicker : undefined}
                />
              )}
            </View>
          </>
        )}
      </ScrollView>
      <Modal
        visible={Boolean(showHomeCmsModal && homeCms?.modal.isActive)}
        transparent
        animationType="fade"
        onRequestClose={() => setShowHomeCmsModal(false)}
      >
        {homeCms?.modal.isActive ? (
          <View style={styles.campaignModalOverlay}>
            <Pressable
              style={styles.campaignModalBackdrop}
              onPress={() => setShowHomeCmsModal(false)}
            />
            <View
              style={[
                styles.homeModalCard,
                {
                  backgroundColor:
                    homeCms.modal.backgroundColor || palette.surface,
                },
              ]}
            >
              <Pressable
                style={styles.campaignModalClose}
                onPress={() => setShowHomeCmsModal(false)}
              >
                <Ionicons name="close" size={18} color={palette.foreground} />
              </Pressable>

              {homeCms.modal.imageUrl ? (
                <RemoteImage
                  uri={homeCms.modal.imageUrl}
                  style={[
                    styles.homeModalImage,
                    !homeCms.modal.title.trim() &&
                    !homeCms.modal.subtitle.trim()
                      ? styles.homeModalImageOnly
                      : null,
                  ]}
                  fallbackIcon="image-outline"
                  accessibilityLabel={homeCms.modal.title || "Foodbela announcement"}
                />
              ) : null}

              {homeCms.modal.title.trim() ? (
                <Text
                  style={[
                    styles.campaignModalTitle,
                    { color: homeCms.modal.textColor || palette.foreground },
                  ]}
                >
                  {homeCms.modal.title.trim()}
                </Text>
              ) : null}
              {homeCms.modal.subtitle.trim() ? (
                <Text
                  style={[
                    styles.campaignModalSubtitle,
                    {
                      color:
                        homeCms.modal.textColor || palette.mutedForeground,
                    },
                  ]}
                >
                  {homeCms.modal.subtitle.trim()}
                </Text>
              ) : null}

              {canOpenCustomerTarget(homeCms.modal.ctaPath) ? (
                <Pressable
                  style={[
                    styles.campaignModalAction,
                    {
                      backgroundColor:
                        homeCms.modal.accentColor || palette.primary,
                    },
                  ]}
                  onPress={() => {
                    recordHomeCmsEvent("modal_click");
                    setShowHomeCmsModal(false);
                    void openCustomerTarget(homeCms.modal.ctaPath);
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
      </Modal>
    </Screen>
  );
}
