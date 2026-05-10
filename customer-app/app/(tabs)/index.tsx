import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { EmptyStateCard } from "@/src/components/empty-state-card";
import { LocationSelectorSheet } from "@/src/components/location-selector-sheet";
import { RestaurantHeroCard } from "@/src/components/restaurant-hero-card";
import { Screen } from "@/src/components/screen";
import { SectionHeader } from "@/src/components/section-header";
import { DELIVERY_RADIUS_KM } from "@/src/config/service-area";
import {
  useCustomerDiscoveryHomeQuery,
  useCustomerFavoriteRestaurantIdsQuery,
  useNearbyRestaurantsQuery,
  useCustomerToggleFavoriteRestaurantMutation,
} from "@/src/hooks/use-customer-api";
import { useCustomerAuthStore } from "@/src/store/auth-store";
import { useBrowseHistoryStore } from "@/src/store/browse-history-store";
import { getCartItemCount, useCartStore } from "@/src/store/cart-store";
import { useIsOnline } from "@/src/hooks/use-network-status";
import { useLocationSheet } from "@/src/hooks/use-location-sheet";
import { useLocationStore } from "@/src/store/location-store";
import { palette } from "@/src/theme/palette";
import { apiPost } from "@/src/lib/api";
import type {
  CustomerCampaignPlacement,
  CustomerHomeCms,
  CustomerVoucherOffer,
  DiscoverableRestaurant,
} from "@/src/types/restaurant";

function formatHomeAddress(address?: string | null) {
  if (!address) return "Select your exact delivery point";

  return address
    .split(",")
    .map((part) => part.trim())
    .filter(
      (part) => part.length > 0 && part.toLowerCase() !== "mymensingh division",
    )
    .slice(0, 3)
    .join(", ");
}

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

function CampaignPlacementCard({
  campaign,
  onOpenModal,
}: {
  campaign: CustomerCampaignPlacement;
  onOpenModal: (campaign: CustomerCampaignPlacement) => void;
}) {
  const display = campaign.display ?? {};
  const title = display.title || campaign.name;
  const subtitle = display.subtitle || (campaign.code ? `Use code ${campaign.code}` : "Limited time offer");
  const ctaPath = display.ctaPath || "/(tabs)/browse";
  const backgroundColor = display.backgroundColor || "#FFF0F6";
  const textColor = display.textColor || "#3F2432";
  const accentColor = display.accentColor || "#FF5C93";
  const router = useRouter();

  const handlePress = () => {
    void recordCampaignEvent(campaign.voucherId, display.openInModal ? "modal_open" : "click");
    if (display.openInModal) {
      onOpenModal(campaign);
      return;
    }
    router.push(ctaPath as never);
  };

  return (
    <Pressable
      style={[styles.campaignCard, { backgroundColor }]}
      onPress={handlePress}
    >
      {display.variant === "image" && display.imageUrl ? (
        <Image source={{ uri: display.imageUrl }} style={styles.campaignImage} />
      ) : null}
      {display.variant === "carousel" && display.carouselImageUrls?.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.campaignCarousel}>
          {display.carouselImageUrls.slice(0, 4).map((imageUrl) => (
            <Image key={imageUrl} source={{ uri: imageUrl }} style={styles.campaignCarouselImage} />
          ))}
        </ScrollView>
      ) : null}
      <View style={styles.campaignCopy}>
        <View style={[styles.campaignBadge, { backgroundColor: `${accentColor}22` }]}>
          <Ionicons name="sparkles-outline" size={13} color={accentColor} />
          <Text style={[styles.campaignBadgeText, { color: accentColor }]}>Campaign</Text>
        </View>
        <Text style={[styles.campaignTitle, { color: textColor }]} numberOfLines={2}>
          {title}
        </Text>
        <Text style={[styles.campaignSubtitle, { color: textColor }]} numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
      <View style={[styles.campaignAction, { backgroundColor: accentColor }]}>
        <Text style={styles.campaignActionText}>{display.ctaLabel || "Order now"}</Text>
      </View>
    </Pressable>
  );
}

function recordCampaignEvent(
  voucherId: string | undefined,
  eventType: "impression" | "click" | "modal_open" | "strip_click"
) {
  if (!voucherId) return;
  void apiPost("/customer/vouchers/display-event", { voucherId, eventType }).catch(() => undefined);
}

function recordHomeCmsEvent(
  eventType:
    | "strip_impression"
    | "strip_click"
    | "block_impression"
    | "block_click"
    | "modal_impression"
    | "modal_click"
    | "guide_impression"
    | "guide_video_click"
    | "guide_image_click",
) {
  void apiPost("/public/content/customer-home-event", { eventType }).catch(() => undefined);
}

function HomeCmsPromoBlock({
  cms,
  onOpenModal,
}: {
  cms: CustomerHomeCms;
  onOpenModal: () => void;
}) {
  const block = cms.offerStrip;
  const router = useRouter();
  const [activeSlide, setActiveSlide] = useState(0);
  const carouselImages: { url: string; ctaPath?: string }[] =
    block.carouselImages?.filter((item) => item.url) ??
    block.carouselImageUrls.map((url) => ({ url })) ??
    [];
  const buttonStyle = block.buttonStyle ?? "pill";
  const handlePress = () => {
    recordHomeCmsEvent("block_click");
    if (cms.modal.isActive) {
      onOpenModal();
      return;
    }
    router.push((block.ctaPath || "/(tabs)/browse") as never);
  };

  if (block.variant === "carousel") {
    return (
      <View style={styles.cmsCarouselOnly}>
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={(event) => {
            const width = event.nativeEvent.layoutMeasurement.width || 1;
            setActiveSlide(Math.round(event.nativeEvent.contentOffset.x / width));
          }}
          scrollEventThrottle={16}
        >
          {carouselImages.slice(0, 5).map((imageUrl) => (
            <Pressable
              key={imageUrl.url}
              style={styles.cmsCarouselOnlySlide}
              onPress={() => {
                recordHomeCmsEvent("block_click");
                router.push((imageUrl.ctaPath || block.ctaPath || "/(tabs)/browse") as never);
              }}
            >
              <Image source={{ uri: imageUrl.url }} style={styles.cmsCarouselOnlyImage} />
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.cmsCarouselDots}>
          {carouselImages.slice(0, 5).map((imageUrl, index) => (
            <View
              key={`${imageUrl.url}-dot`}
              style={[styles.cmsCarouselDot, index === activeSlide ? styles.cmsCarouselDotActive : null]}
            />
          ))}
        </View>
      </View>
    );
  }

  return (
    <Pressable
      style={[
        styles.cmsBlock,
        block.variant === "image" ? styles.cmsBlockImageOnlyShell : null,
        { backgroundColor: block.backgroundColor || "#FFF0F6" },
      ]}
      onPress={handlePress}
    >
      {block.variant === "image" && block.imageUrl ? (
        <Image source={{ uri: block.imageUrl }} style={styles.cmsImageOnly} />
      ) : null}
      {block.variant === "image_text" && block.imageUrl ? (
        <Image source={{ uri: block.imageUrl }} style={styles.cmsBlockImage} />
      ) : null}
      {block.variant !== "image" ? <View style={styles.cmsBlockCopy}>
        <View style={[styles.cmsBlockBadge, { backgroundColor: `${block.accentColor || "#FF5C93"}22` }]}>
          <Ionicons name="sparkles-outline" size={13} color={block.accentColor || "#FF5C93"} />
          <Text style={[styles.cmsBlockBadgeText, { color: block.accentColor || "#FF5C93" }]}>
            Promo
          </Text>
        </View>
        <Text style={[styles.cmsBlockTitle, { color: block.textColor || "#3F2432" }]} numberOfLines={2}>
          {block.title || "Fresh offers near you"}
        </Text>
        <Text style={[styles.cmsBlockSubtitle, { color: block.textColor || "#3F2432" }]} numberOfLines={2}>
          {block.subtitle || "Limited-time savings from restaurants around you."}
        </Text>
        <View
          style={[
            styles.cmsInlineButton,
            buttonStyle === "soft" ? styles.cmsInlineButtonSoft : null,
            buttonStyle === "outline" ? styles.cmsInlineButtonOutline : null,
            buttonStyle === "dark" ? styles.cmsInlineButtonDark : null,
            { borderColor: block.accentColor || "#FF5C93", backgroundColor: buttonStyle === "pill" ? block.accentColor || "#FF5C93" : undefined },
          ]}
        >
          <Text
            style={[
              styles.cmsInlineButtonText,
              buttonStyle === "outline" ? { color: block.accentColor || "#FF5C93" } : null,
            ]}
          >
            {block.ctaLabel || "Explore"}
          </Text>
        </View>
      </View> : null}
    </Pressable>
  );
}

function HowToOrderGuideBlock({ cms }: { cms: CustomerHomeCms }) {
  const guide = cms.howToOrderGuide;

  const openGuide = () => {
    if (guide?.youtubeUrl) {
      recordHomeCmsEvent("guide_video_click");
      void Linking.openURL(guide.youtubeUrl).catch(() => undefined);
    }
  };

  useEffect(() => {
    if (guide?.isActive) recordHomeCmsEvent("guide_impression");
  }, [guide?.isActive]);

  if (!guide?.isActive) return null;

  return (
    <View style={styles.guideSection}>
      <Pressable
        style={[styles.guideCard, { backgroundColor: guide.backgroundColor || "#EDF4FF" }]}
        onPress={openGuide}
      >
        <View style={styles.guideIcon}>
          <Ionicons name="play-circle" size={24} color={guide.accentColor || "#5D8BFF"} />
        </View>
        <View style={styles.guideCopy}>
          <Text style={[styles.guideTitle, { color: guide.textColor || "#24406F" }]} numberOfLines={2}>
            {guide.title || "How to order on Foodbela"}
          </Text>
          <Text style={[styles.guideSubtitle, { color: guide.textColor || "#24406F" }]} numberOfLines={2}>
            {guide.subtitle || "Watch a quick guide or follow the image steps."}
          </Text>
        </View>
        {guide.youtubeUrl ? (
          <View style={[styles.guideButton, { backgroundColor: guide.accentColor || "#5D8BFF" }]}>
            <Text style={styles.guideButtonText}>{guide.ctaLabel || "Watch"}</Text>
          </View>
        ) : null}
      </Pressable>
      {guide.guideImages.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.guideImageRow}>
          {guide.guideImages.slice(0, 6).map((image, index) => (
            <View key={`${image.url}-${index}`} style={styles.guideImageCard}>
              <Pressable onPress={() => recordHomeCmsEvent("guide_image_click")}>
                <Image source={{ uri: image.url }} style={styles.guideImage} />
              </Pressable>
              <Text style={styles.guideImageTitle} numberOfLines={1}>
                {image.title || `Step ${index + 1}`}
              </Text>
            </View>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

function getBannerToneStyle(tone?: "sky" | "mint" | "amber" | "rose" | null) {
  switch (tone) {
    case "mint":
      return {
        shell: "#EAF9F4",
        chip: "#D7F2E8",
        title: "#156C53",
        subtitle: "#3A6A5E",
        button: "#1E7F62",
      };
    case "amber":
      return {
        shell: "#FFEAF3",
        chip: "#FFD9E8",
        title: "#A73D69",
        subtitle: "#8A5E72",
        button: "#D45487",
      };
    case "rose":
      return {
        shell: "#FFEAF1",
        chip: "#FFD7E4",
        title: "#A73D69",
        subtitle: "#8A5E72",
        button: "#D45487",
      };
    case "sky":
    default:
      return {
        shell: "#EDF4FF",
        chip: "#DDEAFF",
        title: "#355EAD",
        subtitle: "#607394",
        button: "#5D8BFF",
      };
  }
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
  const { isOpen, openSheet, closeSheet } = useLocationSheet();
  const customer = useCustomerAuthStore((state) => state.customer);
  const isAuthenticated = useCustomerAuthStore((state) =>
    Boolean(state.accessToken),
  );
  const selectedLocation = useLocationStore((state) => state.selectedLocation);
  const isOnline = useIsOnline();
  const addRecentVisitedRestaurant = useBrowseHistoryStore(
    (state) => state.addRecentVisitedRestaurant
  );
  const permissionGranted = useLocationStore(
    (state) => state.permissionGranted,
  );
  const cartItemCount = useCartStore((state) => getCartItemCount(state.items));

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
  const toggleFavoriteMutation = useCustomerToggleFavoriteRestaurantMutation();

  const isSearching = searchQuery.trim().length > 0;
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

  const featuredRestaurants = useMemo(() => {
    if (isSearching) return [];
    return (homeFeed?.featuredRestaurants ?? []).slice(0, 6);
  }, [homeFeed?.featuredRestaurants, isSearching]);

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

  const bannerTone = getBannerToneStyle(homeBanner?.tone ?? null);

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

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        homeQuery.refetch(),
        nearbyRestaurantsQuery.refetch(),
        favoriteRestaurantIdsQuery.refetch(),
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
            <Pressable onPress={openSheet} style={styles.addressBlock}>
              <Text style={styles.addressLabel}>DELIVERY ADDRESS</Text>
              <View style={styles.addressRow}>
                <Ionicons name="location" size={16} color={palette.secondary} />
                <Text numberOfLines={1} style={styles.addressValue}>
                  {selectedLocation?.label ?? "Choose your location"}
                </Text>
                <Ionicons
                  name="chevron-down"
                  size={16}
                  color={palette.foreground}
                />
              </View>
              <Text numberOfLines={1} style={styles.addressSubtext}>
                {formatHomeAddress(selectedLocation?.address)}
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

          {homeBanner ? (
            <Pressable
              style={[styles.bannerCard, { backgroundColor: bannerTone.shell }]}
              onPress={() => router.push(homeBanner.ctaPath as never)}
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
            <HomeCmsPromoBlock
              cms={homeCms}
              onOpenModal={() => {
                setShowHomeCmsModal(true);
                recordHomeCmsEvent("modal_impression");
              }}
            />
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

          {homeQuery.isLoading && !homeFeed ? (
            <View style={styles.genZLoaderCard}>
              <View style={styles.genZLoaderIcon}>
                <Ionicons name="sparkles" size={18} color="#FF5C93" />
              </View>
              <View style={styles.genZLoaderCopy}>
                <Text style={styles.genZLoaderTitle}>Cooking up your feed</Text>
                <Text style={styles.genZLoaderSubtitle}>Fresh picks, hot deals, tiny sparkle check.</Text>
              </View>
              <ActivityIndicator size="small" color="#FF5C93" />
            </View>
          ) : null}
        </View>

        {!isSearching && homeCms && homeCms.howToOrderGuide?.placement !== "before_restaurants" ? (
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
                actionLabel="Choose location"
                onPress={openSheet}
              />
            ) : nearbyRestaurantsQuery.isLoading ? (
              <View style={styles.feedbackCard}>
                <ActivityIndicator size="small" color={palette.primary} />
                <Text style={styles.feedbackText}>
                  Searching restaurants...
                </Text>
              </View>
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
                onPress={openSheet}
              />
            )}
          </View>
        ) : (
          <>
            {homeCms && homeCms.howToOrderGuide?.placement === "before_restaurants" ? (
              <HowToOrderGuideBlock cms={homeCms} />
            ) : null}

            {featuredRestaurants.length > 0 ? (
              <View style={styles.section}>
                <View style={styles.sectionHeaderWrap}>
                  <SectionHeader
                    title="Featured restaurants"
                    subtitle="Featured restaurants worth checking first."
                  />
                </View>
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
              <View style={styles.sectionHeaderWrap}>
                <SectionHeader
                  title="Nearby"
                  subtitle={
                    selectedLocation
                      ? `${nearbyRestaurants.length} restaurants around your selected pin`
                      : "Choose a location to unlock restaurants near you"
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
                  description="Pick your delivery point to unlock restaurants that really serve your area."
                  actionLabel="Choose location"
                  onPress={openSheet}
                />
              ) : nearbyRestaurantsQuery.isLoading ? (
                <View style={styles.feedbackCard}>
                  <ActivityIndicator size="small" color={palette.primary} />
                  <Text style={styles.feedbackText}>
                    Loading nearby restaurants...
                  </Text>
                </View>
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
                  onPress={isOnline ? openSheet : undefined}
                />
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
            <Pressable
              style={styles.campaignModalAction}
              onPress={() => {
                recordCampaignEvent(modalCampaign.voucherId, "click");
                const path = modalCampaign.display.ctaPath || "/(tabs)/browse";
                setModalCampaign(null);
                router.push(path as never);
              }}
            >
              <Text style={styles.campaignModalActionText}>
                {modalCampaign.display.ctaLabel || "Order now"}
              </Text>
            </Pressable>
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
            <Text style={[styles.campaignModalTitle, { color: homeCms.modal.textColor || palette.foreground }]}>
              {homeCms.modal.title}
            </Text>
            <Text style={[styles.campaignModalSubtitle, { color: homeCms.modal.textColor || palette.mutedForeground }]}>
              {homeCms.modal.subtitle}
            </Text>
            <Pressable
              style={[styles.campaignModalAction, { backgroundColor: homeCms.modal.accentColor || palette.primary }]}
              onPress={() => {
                recordHomeCmsEvent("modal_click");
                const path = homeCms.modal.ctaPath || "/(tabs)/browse";
                setShowHomeCmsModal(false);
                router.push(path as never);
              }}
            >
              <Text style={styles.campaignModalActionText}>
                {homeCms.modal.ctaLabel || "Explore now"}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <LocationSelectorSheet visible={isOpen} onClose={closeSheet} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 52,
  },
  hero: {
    overflow: "hidden",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 18,
    backgroundColor: palette.heroBackground,
    borderBottomLeftRadius: 34,
    borderBottomRightRadius: 34,
    gap: 10,
  },
  heroOrbPrimary: {
    position: "absolute",
    top: -90,
    right: -20,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: palette.heroOrbPrimary,
  },
  heroOrbSecondary: {
    position: "absolute",
    bottom: -80,
    left: -50,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: palette.heroOrbSecondary,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  addressBlock: {
    flex: 1,
    gap: 2,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: "rgba(255,250,244,0.82)",
  },
  addressLabel: {
    fontSize: 8,
    lineHeight: 13,
    fontWeight: "700",
    color: palette.heroAccentText,
  },
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  addressValue: {
    flex: 1,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "700",
    color: palette.foreground,
  },
  addressSubtext: {
    paddingLeft: 22,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "600",
    color: palette.mutedForeground,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  cartBubble: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: palette.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  cartCounter: {
    position: "absolute",
    top: 2,
    right: 2,
    minWidth: 18,
    height: 18,
    borderRadius: 999,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.foreground,
  },
  cartCounterText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "800",
    color: palette.surface,
  },
  profileBubble: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FFF2D9",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#F3D797",
  },
  profileBubbleSignedIn: {
    backgroundColor: "#EAF2FF",
    borderColor: "#CFE0FF",
  },
  profileBubbleText: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "800",
    color: palette.sky,
  },
  profileImage: {
    width: "100%",
    height: "100%",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 46,
    paddingHorizontal: 14,
    borderRadius: 19,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#F1E4DA",
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    lineHeight: 18,
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
    backgroundColor: "#FFF1D9",
  },
  bannerCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 24,
  },
  bannerCopy: {
    flex: 1,
    gap: 6,
  },
  bannerChip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
  },
  bannerChipText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
  },
  bannerTitle: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "800",
  },
  bannerSubtitle: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
  },
  bannerButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: 999,
  },
  bannerButtonText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    color: "#fff",
  },
  campaignCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 22,
    overflow: "hidden",
  },
  campaignImage: {
    width: 84,
    height: 84,
    borderRadius: 18,
    backgroundColor: "#FFFFFF80",
  },
  campaignCarousel: {
    maxWidth: 118,
  },
  campaignCarouselImage: {
    width: 76,
    height: 76,
    marginRight: 8,
    borderRadius: 16,
    backgroundColor: "#FFFFFF80",
  },
  campaignCopy: {
    flex: 1,
    gap: 6,
  },
  campaignBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
  },
  campaignBadgeText: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "800",
  },
  campaignTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "900",
  },
  campaignSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    opacity: 0.78,
  },
  campaignAction: {
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 999,
  },
  campaignActionText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "900",
    color: "#fff",
  },
  campaignModalOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    justifyContent: "center",
    padding: 22,
  },
  campaignModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(35, 24, 30, 0.45)",
  },
  campaignModalCard: {
    borderRadius: 26,
    backgroundColor: palette.surface,
    padding: 18,
    gap: 12,
  },
  campaignModalClose: {
    position: "absolute",
    top: 12,
    right: 12,
    zIndex: 2,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.82)",
  },
  campaignModalImage: {
    width: "100%",
    height: 160,
    borderRadius: 20,
    backgroundColor: "#FFF1F6",
  },
  campaignModalTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "900",
    color: palette.foreground,
  },
  campaignModalSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    color: palette.mutedForeground,
  },
  campaignModalAction: {
    alignItems: "center",
    borderRadius: 999,
    backgroundColor: palette.primary,
    paddingVertical: 13,
  },
  campaignModalActionText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "900",
    color: "#fff",
  },
  offerChipRow: {
    paddingRight: 10,
    gap: 8,
  },
  offerChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#FFF1F6",
  },
  offerChipText: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: "800",
    color: "#B23B70",
  },
  cmsBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 22,
    overflow: "hidden",
  },
  cmsBlockImageOnlyShell: {
    padding: 0,
    gap: 0,
  },
  cmsBlockImage: {
    width: 82,
    height: 82,
    borderRadius: 18,
    backgroundColor: "#FFFFFF80",
  },
  cmsImageOnly: {
    width: "100%",
    height: 112,
    borderRadius: 0,
    backgroundColor: "#FFFFFF80",
  },
  cmsCarouselOnly: {
    position: "relative",
  },
  cmsCarouselOnlySlide: {
    width: 330,
    marginRight: 10,
    borderRadius: 14,
    overflow: "hidden",
  },
  cmsCarouselOnlyImage: {
    width: "100%",
    height: 112,
    borderRadius: 14,
    backgroundColor: "#FFF1F6",
  },
  cmsBlockCarousel: {
    width: 92,
  },
  cmsCarouselWrap: {
    width: 92,
    gap: 7,
  },
  cmsCarouselImage: {
    width: 92,
    height: 74,
    borderRadius: 16,
    backgroundColor: "#FFFFFF80",
  },
  cmsCarouselDots: {
    position: "absolute",
    bottom: 9,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 4,
  },
  cmsCarouselDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    backgroundColor: "rgba(63,36,50,0.22)",
  },
  cmsCarouselDotActive: {
    width: 14,
    backgroundColor: "#FF5C93",
  },
  cmsBlockCopy: {
    flex: 1,
    gap: 6,
  },
  cmsBlockBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
  },
  cmsBlockBadgeText: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "900",
  },
  cmsBlockTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "900",
  },
  cmsBlockSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    opacity: 0.78,
  },
  cmsInlineButton: {
    alignSelf: "flex-start",
    marginTop: 2,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  cmsInlineButtonSoft: {
    backgroundColor: "rgba(255,255,255,0.62)",
  },
  cmsInlineButtonOutline: {
    backgroundColor: "transparent",
  },
  cmsInlineButtonDark: {
    backgroundColor: "#2B1D24",
    borderColor: "#2B1D24",
  },
  cmsInlineButtonText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "900",
    color: "#fff",
  },
  genZLoaderCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.78)",
    borderWidth: 1,
    borderColor: "#FFE0EC",
  },
  genZLoaderIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF0F6",
  },
  genZLoaderCopy: {
    flex: 1,
    gap: 2,
  },
  genZLoaderTitle: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "900",
    color: palette.foreground,
  },
  genZLoaderSubtitle: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
    color: palette.mutedForeground,
  },
  guideSection: {
    paddingTop: 18,
    gap: 10,
  },
  guideCard: {
    marginHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 22,
  },
  guideIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.7)",
  },
  guideCopy: {
    flex: 1,
    gap: 3,
  },
  guideTitle: {
    fontSize: 15,
    lineHeight: 19,
    fontWeight: "900",
  },
  guideSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    opacity: 0.72,
  },
  guideButton: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
  },
  guideButtonText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "900",
    color: "#fff",
  },
  guideImageRow: {
    paddingLeft: 20,
    paddingRight: 10,
    gap: 10,
  },
  guideImageCard: {
    width: 116,
    gap: 6,
  },
  guideImage: {
    width: 116,
    height: 86,
    borderRadius: 16,
    backgroundColor: "#EDF4FF",
  },
  guideImageTitle: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    color: palette.foreground,
  },
  section: {
    paddingTop: 22,
    gap: 14,
  },
  sectionHeaderWrap: {
    paddingHorizontal: 20,
  },
  horizontalRow: {
    paddingLeft: 20,
    paddingRight: 10,
    gap: 14,
  },
  featuredCardWrap: {
    width: 286,
  },
  verticalList: {
    paddingHorizontal: 20,
    gap: 16,
  },
  feedbackCard: {
    marginHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 22,
    backgroundColor: palette.surface,
  },
  feedbackText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    color: palette.mutedForeground,
  },
  browseAllButton: {
    marginHorizontal: 20,
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 15,
    borderRadius: 20,
    backgroundColor: palette.surface,
  },
  browseAllButtonText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
    color: palette.foreground,
  },
});
