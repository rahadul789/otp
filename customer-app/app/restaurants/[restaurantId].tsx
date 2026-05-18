import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  FlatList,
  Image,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyStateCard } from "@/src/components/empty-state-card";
import { styles } from "@/src/components/restaurant-details/restaurant-details.styles";
import {
  CategoryRail,
  ConnectedPopularItemCard,
  ConnectedRestaurantCartFooter,
  FactChip,
  InfoMiniCard,
  InfoSheetRow,
  MenuCard,
  MenuSearchBar,
  SearchResultsOverlay,
} from "@/src/components/restaurant-details/restaurant-menu-components";
import { Screen } from "@/src/components/screen";
import { DELIVERY_RADIUS_KM } from "@/src/config/service-area";
import { useCustomerRestaurantDetailsQuery } from "@/src/hooks/use-customer-api";
import { useSafeTimeout } from "@/src/hooks/use-safe-timeout";
import { trackCustomerEvent } from "@/src/lib/analytics";
import { applyCurrentLocation } from "@/src/lib/current-location";
import { formatCurrency } from "@/src/lib/currency";
import { formatDurationMinutes } from "@/src/lib/date-time";
import { formatCustomerAddressLine } from "@/src/lib/location-address";
import {
  buildDefaultSelections,
  buildStartingPrice,
  hasCustomizations,
  isSelectionValid,
} from "@/src/lib/restaurant-menu";
import { useLocationStore } from "@/src/store/location-store";
import { useCartStore } from "@/src/store/cart-store";
import { palette } from "@/src/theme/palette";
import type {
  CustomerMenuAddOnGroup,
  CustomerMenuVariantGroup,
  CustomerRestaurantMenuItem,
} from "@/src/types/restaurant";

const AnimatedFlatList = Animated.createAnimatedComponent(FlatList as any) as unknown as typeof FlatList;

type PendingCartAdd = {
  item: CustomerRestaurantMenuItem;
  quantity: number;
  selectedAddOns: { groupName: string; optionLabel: string }[];
  selectedVariants: { groupName: string; optionLabel: string }[];
  unitPrice: number;
};

type Row =
  | {
      id: "popular";
      kind: "popular";
      items: CustomerRestaurantMenuItem[];
    }
  | {
      id: string;
      kind: "section";
      categoryId: string;
      title: string;
      description?: string;
    }
  | {
      id: string;
      kind: "item";
      categoryId: string;
      item: CustomerRestaurantMenuItem;
    };

export default function RestaurantDetailsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scrollY = useRef(new Animated.Value(0)).current;
  const { restaurantId } = useLocalSearchParams<{ restaurantId: string }>();
  const selectedLocation = useLocationStore((state) => state.selectedLocation);
  const addItem = useCartStore((state) => state.addItem);
  const replaceCart = useCartStore((state) => state.replaceCart);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const conflictingRestaurantName = useCartStore(
    (state) => state.restaurant?.restaurantName ?? "another restaurant"
  );

  const detailsQuery = useCustomerRestaurantDetailsQuery({
    restaurantId,
    latitude: selectedLocation?.latitude,
    longitude: selectedLocation?.longitude,
  });

  const [selectedItem, setSelectedItem] = useState<CustomerRestaurantMenuItem | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string[]>>({});
  const [selectedAddOns, setSelectedAddOns] = useState<Record<string, string[]>>({});
  const [activeCategoryId, setActiveCategoryId] = useState("");
  const [menuSearch, setMenuSearch] = useState("");
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [showStickyControls, setShowStickyControls] = useState(false);
  const [isInfoSheetVisible, setInfoSheetVisible] = useState(false);
  const [cartConflictItem, setCartConflictItem] = useState<PendingCartAdd | null>(null);
  const [isFavorite, setIsFavorite] = useState(false);

  const listRef = useRef<FlatList<Row>>(null);
  const stickySearchInputRef = useRef<TextInput | null>(null);
  const controlsYRef = useRef(0);
  const controlsHeightRef = useRef(106);
  const scrollOffsetYRef = useRef(0);
  const activeCategoryRef = useRef("");
  const ignoreAutoSyncUntilRef = useRef(0);
  const lastTrackedMenuSearchRef = useRef("");
  const scheduleTimeout = useSafeTimeout();

  const categories = useMemo(() => detailsQuery.data?.categories ?? [], [detailsQuery.data?.categories]);
  const allMenuItems = useMemo(() => detailsQuery.data?.menuItems ?? [], [detailsQuery.data?.menuItems]);
  const restaurant = detailsQuery.data?.restaurant;
  const detailsData = detailsQuery.data;
  const deliveryRadiusKm = restaurant?.deliveryRadiusKm ?? DELIVERY_RADIUS_KM;
  const serviceabilityNotice = useMemo(() => {
    if (!restaurant) {
      return null;
    }

    if (!selectedLocation) {
      return {
        title: "Choose your delivery point",
        body: "Select your location first so Foodbela can show restaurants that can deliver to you.",
      };
    }

    const isOutsideDeliveryArea =
      restaurant.isServiceableForSelectedLocation === false ||
      (typeof restaurant.distanceKm === "number" &&
        Number.isFinite(restaurant.distanceKm) &&
        restaurant.distanceKm > deliveryRadiusKm);

    if (!isOutsideDeliveryArea) {
      return null;
    }

    return {
      title: "Outside delivery area",
      body: `${restaurant.name} does not deliver to your selected location. Change your delivery point or browse restaurants nearby.`,
    };
  }, [
    deliveryRadiusKm,
    restaurant,
    selectedLocation,
  ]);
  const canAddFromRestaurant = !serviceabilityNotice;
  const recentReviews = useMemo(() => detailsData?.recentReviews ?? [], [detailsData?.recentReviews]);
  const isMenuLoading =
    Boolean(restaurant) &&
    detailsQuery.isFetching &&
    categories.length === 0 &&
    allMenuItems.length === 0;
  const deferredMenuSearch = useDeferredValue(menuSearch);
  const normalizedMenuSearch = deferredMenuSearch.trim().toLowerCase();
  const searchableMenuItems = useMemo(
    () =>
      allMenuItems.map((item) => ({
        item,
        searchText: [
          item.name,
          item.description,
          ...(item.variants?.map((group) => group.name) ?? []),
          ...(item.variants?.flatMap((group) => group.options.map((option) => option.label)) ?? []),
          ...(item.addOnGroups?.map((group) => group.name) ?? []),
          ...(item.addOnGroups?.flatMap((group) => group.options.map((option) => option.label)) ?? []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      })),
    [allMenuItems]
  );
  const menuItemsByCategory = useMemo(
    () =>
      allMenuItems.reduce<Record<string, CustomerRestaurantMenuItem[]>>((acc, item) => {
        if (!acc[item.categoryId]) {
          acc[item.categoryId] = [];
        }
        acc[item.categoryId].push(item);
        return acc;
      }, {}),
    [allMenuItems]
  );
  const categoryNameById = useMemo(
    () =>
      categories.reduce<Record<string, string>>((acc, category) => {
        acc[category._id] = category.name;
        return acc;
      }, {}),
    [categories]
  );
  const searchResults = useMemo(() => {
    if (!normalizedMenuSearch) {
      return allMenuItems;
    }

    return searchableMenuItems
      .filter((entry) => entry.searchText.includes(normalizedMenuSearch))
      .map((entry) => entry.item);
  }, [allMenuItems, normalizedMenuSearch, searchableMenuItems]);
  const importantFacts = useMemo(
    () => [
      {
        key: "rating",
        icon: "star-outline" as const,
        label: "Rating",
        value:
          typeof restaurant?.avgRating === "number" && (restaurant.reviewCount ?? 0) > 0
            ? `${restaurant.avgRating} (${restaurant.reviewCount})`
            : "No reviews yet",
      },
      {
        key: "time",
        icon: "time-outline" as const,
        label: "Prep time",
        value:
          typeof restaurant?.preparationTimeMinutes === "number"
            ? formatDurationMinutes(restaurant.preparationTimeMinutes)
            : "Kitchen updates soon",
      },
      {
        key: "price",
        icon: "pricetag-outline" as const,
        label: "From",
        value:
          typeof restaurant?.lowestMenuPrice === "number"
            ? formatCurrency(restaurant.lowestMenuPrice)
            : "Checking price",
      },
      {
        key: "distance",
        icon: "navigate-outline" as const,
        label: "Distance",
        value:
          typeof restaurant?.distanceKm === "number"
            ? `${restaurant.distanceKm.toFixed(1)} km`
            : restaurant?.isOpen === false
              ? "Currently closed"
              : "Delivery ready",
      },
    ],
    [
      restaurant?.avgRating,
      restaurant?.distanceKm,
      restaurant?.isOpen,
      restaurant?.lowestMenuPrice,
      restaurant?.preparationTimeMinutes,
      restaurant?.reviewCount,
    ]
  );

  const popularItems = useMemo(
    () => allMenuItems.filter((item) => item.isPopular),
    [allMenuItems]
  );

  const rows = useMemo<Row[]>(() => {
    const next: Row[] = [];

    if (popularItems.length) {
      next.push({ id: "popular", kind: "popular", items: popularItems });
    }

    categories.forEach((category) => {
      const categoryItems = menuItemsByCategory[category._id] ?? [];
      if (!categoryItems.length) return;

      next.push({
        id: `section-${category._id}`,
        kind: "section",
        categoryId: category._id,
        title: category.name,
        description: category.description,
      });

      categoryItems.forEach((item) => {
        next.push({
          id: `item-${item._id}`,
          kind: "item",
          categoryId: category._id,
          item,
        });
      });
    });

    return next;
  }, [categories, menuItemsByCategory, popularItems]);

  const tabItems = useMemo(
    () => [
      ...(popularItems.length ? [{ id: "popular", label: "Popular" }] : []),
      ...categories
        .filter((category) => (menuItemsByCategory[category._id]?.length ?? 0) > 0)
        .map((category) => ({ id: category._id, label: category.name })),
    ],
    [categories, menuItemsByCategory, popularItems.length]
  );

  useEffect(() => {
    const nextId = tabItems[0]?.id ?? "";
    if (nextId && !activeCategoryRef.current) {
      activeCategoryRef.current = nextId;
      setActiveCategoryId(nextId);
    }
  }, [tabItems]);

  useEffect(() => {
    if (!isSearchMode) {
      return;
    }

    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      Keyboard.dismiss();
      setMenuSearch("");
      setIsSearchMode(false);
      return true;
    });

    return () => subscription.remove();
  }, [isSearchMode]);

  const rowIndexByCategory = useMemo(
    () =>
      rows.reduce<Record<string, number>>((acc, row, index) => {
        if (row.kind === "popular") acc.popular = index;
        if (row.kind === "section") acc[row.categoryId] = index;
        return acc;
      }, {}),
    [rows]
  );

  const selectedItemTotal = useMemo(() => {
    if (!selectedItem) return 0;
    let total = selectedItem.basePrice;

    for (const group of selectedItem.variants ?? []) {
      const labels = selectedVariants[group.name] ?? [];
      for (const option of group.options ?? []) {
        if (labels.includes(option.label)) total += option.priceDelta ?? 0;
      }
    }

    for (const group of selectedItem.addOnGroups ?? []) {
      const labels = selectedAddOns[group.name] ?? [];
      for (const option of group.options ?? []) {
        if (labels.includes(option.label)) total += option.price ?? 0;
      }
    }

    return total * quantity;
  }, [quantity, selectedAddOns, selectedItem, selectedVariants]);
  const selectedItemHasCustomizations = useMemo(
    () => (selectedItem ? hasCustomizations(selectedItem) : false),
    [selectedItem]
  );

  const autoAppliedOffer = useMemo(
    () =>
      detailsData?.activeOffers.find(
        (offer) =>
          offer.mode === "auto" && typeof offer.minimumOrderAmount === "number"
      ) ?? null,
    [detailsData?.activeOffers]
  );
  const openCustomizer = useCallback((item: CustomerRestaurantMenuItem) => {
    if (restaurant?._id) {
      void trackCustomerEvent({
        eventType: "menu_item_view",
        path: `/restaurants/${restaurant._id}`,
        screenName: "restaurant-details",
        entityType: "menu_item",
        entityId: item._id,
        metadata: {
          restaurantId: restaurant._id,
          itemName: item.name,
          categoryId: item.categoryId,
          price: item.basePrice,
          isPopular: Boolean(item.isPopular),
        },
      });
    }

    const defaults = buildDefaultSelections(item);
    setSelectedItem(item);
    setQuantity(1);
    setSelectedVariants(defaults.defaultVariants);
    setSelectedAddOns(defaults.defaultAddOns);
  }, [restaurant?._id]);

  function closeCustomizer() {
    setSelectedItem(null);
    setQuantity(1);
    setSelectedVariants({});
    setSelectedAddOns({});
  }

  function toggleSelection(
    groupName: string,
    optionLabel: string,
    group: CustomerMenuVariantGroup | CustomerMenuAddOnGroup,
    type: "variant" | "addon"
  ) {
    const setState = type === "variant" ? setSelectedVariants : setSelectedAddOns;
    setState((current) => {
      const selected = current[groupName] ?? [];
      const isSelected = selected.includes(optionLabel);
      const maxSelect = group.maxSelect ?? (type === "variant" ? 1 : 99);

      if (isSelected) {
        return { ...current, [groupName]: selected.filter((label) => label !== optionLabel) };
      }

      if (maxSelect <= 1) {
        return { ...current, [groupName]: [optionLabel] };
      }

      if (selected.length >= maxSelect) return current;
      return { ...current, [groupName]: [...selected, optionLabel] };
    });
  }

  const attemptAddToCart = useCallback((payload: PendingCartAdd) => {
    if (!restaurant) return false;
    if (!canAddFromRestaurant) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return false;
    }

    const restaurantIdentity = {
      restaurantId: restaurant._id,
      restaurantName: restaurant.name,
    };
    const currentCart = useCartStore.getState();

    if (
      currentCart.restaurant &&
      currentCart.restaurant.restaurantId !== restaurantIdentity.restaurantId &&
      currentCart.items.length > 0
    ) {
      setCartConflictItem(payload);
      return true;
    }

    addItem({
      restaurant: restaurantIdentity,
      item: {
        itemId: payload.item._id,
        name: payload.item.name,
        imageUrl: payload.item.images?.[0]?.url ?? null,
        quantity: payload.quantity,
        unitPrice: payload.unitPrice,
        selectedVariantOptions: payload.selectedVariants,
        selectedAddOnOptions: payload.selectedAddOns,
      },
    });

    void trackCustomerEvent({
      eventType: "cart_add",
      path: `/restaurants/${restaurant._id}`,
      screenName: "restaurant-details",
      entityType: "menu_item",
      entityId: payload.item._id,
      metadata: {
        restaurantId: restaurant._id,
        itemName: payload.item.name,
        categoryId: payload.item.categoryId,
        quantity: payload.quantity,
        unitPrice: payload.unitPrice,
        hasCustomizations: Boolean(
          payload.selectedAddOns.length || payload.selectedVariants.length,
        ),
      },
    });
    return true;
  }, [addItem, canAddFromRestaurant, restaurant]);

  function handleConfirmReplaceCart() {
    if (!cartConflictItem || !restaurant) return;
    if (!canAddFromRestaurant) {
      setCartConflictItem(null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }

    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    replaceCart({
      restaurant: {
        restaurantId: restaurant._id,
        restaurantName: restaurant.name,
      },
      item: {
        itemId: cartConflictItem.item._id,
        name: cartConflictItem.item.name,
        imageUrl: cartConflictItem.item.images?.[0]?.url ?? null,
        quantity: cartConflictItem.quantity,
        unitPrice: cartConflictItem.unitPrice,
        selectedVariantOptions: cartConflictItem.selectedVariants,
        selectedAddOnOptions: cartConflictItem.selectedAddOns,
      },
    });

    void trackCustomerEvent({
      eventType: "cart_add",
      path: `/restaurants/${restaurant._id}`,
      screenName: "restaurant-details",
      entityType: "menu_item",
      entityId: cartConflictItem.item._id,
      metadata: {
        restaurantId: restaurant._id,
        itemName: cartConflictItem.item.name,
        categoryId: cartConflictItem.item.categoryId,
        quantity: cartConflictItem.quantity,
        unitPrice: cartConflictItem.unitPrice,
        cartReplaced: true,
      },
    });

    setCartConflictItem(null);
  }

  const handleIncrease = useCallback((item: CustomerRestaurantMenuItem) => {
    if (
      item.availability === "unavailable" ||
      restaurant?.isOpen === false ||
      !canAddFromRestaurant
    ) return;

    if (hasCustomizations(item)) {
      void Haptics.selectionAsync();
      openCustomizer(item);
      return;
    }

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    attemptAddToCart({
      item,
      quantity: 1,
      unitPrice: item.basePrice,
      selectedAddOns: [],
      selectedVariants: [],
    });
  }, [canAddFromRestaurant, restaurant?.isOpen, openCustomizer, attemptAddToCart]);

  const handleDecrease = useCallback((item: CustomerRestaurantMenuItem) => {
    const state = useCartStore.getState();
    if (state.restaurant?.restaurantId !== restaurant?._id) {
      return;
    }

    const current = state.items.find((entry) => entry.itemId === item._id);
    if (!current) return;
    void Haptics.selectionAsync();
    updateQuantity(current.key, current.quantity - 1);
  }, [restaurant?._id, updateQuantity]);

  function handleAddToCart() {
    if (!selectedItem) return;

    const invalidVariantGroup = (selectedItem.variants ?? []).find(
      (group) => !isSelectionValid((selectedVariants[group.name] ?? []).length, group)
    );
    if (invalidVariantGroup) return;

    const invalidAddOnGroup = (selectedItem.addOnGroups ?? []).find(
      (group) => !isSelectionValid((selectedAddOns[group.name] ?? []).length, group)
    );
    if (invalidAddOnGroup) return;

    const didStartAdd = attemptAddToCart({
      item: selectedItem,
      quantity,
      unitPrice: selectedItemTotal / quantity,
      selectedVariants: Object.entries(selectedVariants).flatMap(([groupName, labels]) =>
        labels.map((optionLabel) => ({ groupName, optionLabel }))
      ),
      selectedAddOns: Object.entries(selectedAddOns).flatMap(([groupName, labels]) =>
        labels.map((optionLabel) => ({ groupName, optionLabel }))
      ),
    });

    if (!didStartAdd) {
      return;
    }

    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    closeCustomizer();
  }

  async function handleUseCurrentLocation() {
    try {
      await applyCurrentLocation();
    } catch {
      router.push("/location-picker");
    }
  }

  function handlePressCategory(categoryId: string) {
    const index = rowIndexByCategory[categoryId];
    if (typeof index !== "number") return;

    ignoreAutoSyncUntilRef.current = Date.now() + 700;
    activeCategoryRef.current = categoryId;
    setActiveCategoryId(categoryId);
    void Haptics.selectionAsync();
    listRef.current?.scrollToIndex({
      index,
      animated: true,
      viewOffset: insets.top + controlsHeightRef.current + 12,
    });
  }

  const openSearchMode = useCallback(() => {
    setIsSearchMode(true);
    listRef.current?.scrollToOffset({ offset: 0, animated: true });

    scheduleTimeout(() => {
      stickySearchInputRef.current?.focus();
    }, 220);
  }, [scheduleTimeout]);

  const closeSearchMode = useCallback(() => {
    Keyboard.dismiss();
    setMenuSearch("");
    setIsSearchMode(false);
  }, []);

  const handleMenuSearchChange = useCallback((value: string) => {
    setMenuSearch(value);
  }, []);

  useEffect(() => {
    const query = menuSearch.trim();
    if (!restaurant?._id || query.length < 2) return;

    const timer = setTimeout(() => {
      const trackingKey = `${restaurant._id}|${query.toLowerCase()}|${searchResults.length}`;
      if (lastTrackedMenuSearchRef.current === trackingKey) return;
      lastTrackedMenuSearchRef.current = trackingKey;

      void trackCustomerEvent({
        eventType: "search",
        path: `/restaurants/${restaurant._id}`,
        screenName: "restaurant-details",
        entityType: "restaurant",
        entityId: restaurant._id,
        metadata: {
          query: query.slice(0, 80),
          scope: "restaurant_menu",
          restaurantId: restaurant._id,
          resultCount: searchResults.length,
          hasResults: searchResults.length > 0,
        },
      });
    }, 700);

    return () => clearTimeout(timer);
  }, [menuSearch, restaurant?._id, searchResults.length]);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken<Row>[] }) => {
      if (Date.now() < ignoreAutoSyncUntilRef.current) return;
      const first = viewableItems.find((token) => token.isViewable && token.item)?.item;
      if (!first) return;

      const nextId =
        first.kind === "popular"
          ? "popular"
          : first.kind === "section" || first.kind === "item"
            ? first.categoryId
            : tabItems[0]?.id;

      if (nextId && nextId !== activeCategoryRef.current) {
        activeCategoryRef.current = nextId;
        setActiveCategoryId(nextId);
      }
    }
  );

  if (detailsQuery.isLoading) {
    return (
      <Screen>
        <View style={styles.centerState}>
          <ActivityIndicator size="small" color={palette.primary} />
          <Text style={styles.centerStateText}>Loading restaurant details...</Text>
        </View>
      </Screen>
    );
  }

  if (!restaurant || detailsQuery.isError) {
    return (
      <Screen>
        <View style={styles.centerState}>
          <EmptyStateCard
            title="We could not load this restaurant"
            description="Please go back and try again."
            actionLabel="Retry"
            onPress={() => detailsQuery.refetch()}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <AnimatedFlatList
        ref={listRef}
        data={rows.length ? rows : []}
        keyExtractor={(item: Row) => item.id}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={8}
        removeClippedSubviews
        contentContainerStyle={[
          styles.listContent,
          styles.listContentWithCart,
        ]}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="none"
        showsVerticalScrollIndicator={false}
        viewabilityConfig={{ itemVisiblePercentThreshold: 40 }}
        onViewableItemsChanged={onViewableItemsChanged.current}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          {
            useNativeDriver: true,
            listener: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
              const offsetY = event.nativeEvent.contentOffset.y;
              scrollOffsetYRef.current = offsetY;
              const threshold = Math.max(
                0,
                controlsYRef.current + controlsHeightRef.current - insets.top - 12
              );
              setShowStickyControls(offsetY >= threshold);
            },
          }
        )}
        onScrollToIndexFailed={(info: { averageItemLength: number; index: number }) => {
          listRef.current?.scrollToOffset({
            offset: Math.max(
              0,
              info.averageItemLength * info.index - (insets.top + controlsHeightRef.current),
            ),
            animated: true,
          });
          scheduleTimeout(() => {
            listRef.current?.scrollToIndex({
              index: info.index,
              animated: true,
              viewOffset: insets.top + controlsHeightRef.current + 12,
            });
          }, 140);
        }}
        ListHeaderComponent={
          <View>
            <View style={styles.hero}>
              <Animated.View
                style={[
                  styles.heroImageWrap,
                  {
                    transform: [
                      {
                        translateY: scrollY.interpolate({
                          inputRange: [-180, 0, 220],
                          outputRange: [-48, 0, 72],
                          extrapolate: "clamp",
                        }),
                      },
                      {
                        scale: scrollY.interpolate({
                          inputRange: [-180, 0],
                          outputRange: [1.14, 1],
                          extrapolateLeft: "extend",
                          extrapolateRight: "clamp",
                        }),
                      },
                    ],
                  },
                ]}
              >
                {restaurant.coverImage?.url ? (
                  <Image source={{ uri: restaurant.coverImage.url }} style={styles.heroImage} />
                ) : (
                  <View style={styles.heroFallback}>
                    <Ionicons name="restaurant-outline" size={28} color={palette.primary} />
                  </View>
                )}
              </Animated.View>
              <View style={styles.heroShade} />
              <View style={styles.heroTopRow}>
                <Pressable style={styles.heroButton} onPress={() => router.back()}>
                  <Ionicons name="chevron-back" size={20} color={palette.foreground} />
                </Pressable>
                <View style={styles.heroActionGroup}>
                  <Pressable
                    style={styles.heroButton}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      setIsFavorite((current) => !current);
                    }}
                  >
                    <Ionicons
                      name={isFavorite ? "heart" : "heart-outline"}
                      size={18}
                      color={isFavorite ? palette.secondary : palette.foreground}
                    />
                  </Pressable>
                  <Pressable
                    style={styles.heroButton}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      setInfoSheetVisible(true);
                    }}
                  >
                    <Ionicons
                      name="information-circle-outline"
                      size={18}
                      color={palette.foreground}
                    />
                  </Pressable>
                </View>
              </View>
              <View style={styles.heroBottomRow}>
                <View
                  style={[
                    styles.statePill,
                    restaurant.isOpen === false ? styles.statePillClosed : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.statePillText,
                      restaurant.isOpen === false ? styles.statePillTextClosed : null,
                    ]}
                  >
                    {restaurant.isOpen === false ? "Closed now" : "Open now"}
                  </Text>
                </View>
                {detailsData?.activeOffers[0] ? (
                  <Text style={styles.offerPill}>
                    {detailsData.activeOffers[0].name}
                  </Text>
                ) : null}
              </View>
            </View>

            <Animated.View
              style={[
                styles.infoCard,
                {
                  transform: [
                    {
                      translateY: scrollY.interpolate({
                        inputRange: [-60, 0, 160],
                        outputRange: [-6, 0, 18],
                        extrapolate: "clamp",
                      }),
                    },
                  ],
                },
              ]}
            >
              <View style={styles.infoTopRow}>
                {restaurant.logo?.url ? (
                  <Image source={{ uri: restaurant.logo.url }} style={styles.restaurantLogo} />
                ) : (
                  <View style={styles.restaurantLogoFallback}>
                    <Ionicons name="restaurant-outline" size={18} color={palette.primary} />
                  </View>
                )}
                <View style={styles.infoCopy}>
                  <Text style={styles.title}>{restaurant.name}</Text>
                  {detailsData?.activeOffers.length ? (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.inlineOfferRow}
                    >
                      {detailsData.activeOffers.map((offer) => (
                        <View key={offer._id} style={styles.inlineOfferChip}>
                          <Ionicons
                            name={offer.mode === "auto" ? "flash-outline" : "pricetag-outline"}
                            size={12}
                            color={palette.secondary}
                          />
                          <Text style={styles.inlineOfferText}>
                            {offer.mode === "coupon" && offer.code ? offer.code : offer.name}
                          </Text>
                        </View>
                      ))}
                    </ScrollView>
                  ) : null}
                </View>
              </View>

              <View style={styles.infoBadgeRow}>
                {importantFacts.map((fact) => (
                  <FactChip
                    key={fact.key}
                    icon={fact.icon}
                    label={fact.label}
                    value={fact.value}
                  />
                ))}
              </View>

            </Animated.View>

            {serviceabilityNotice ? (
              <View style={styles.serviceabilityCard}>
                <View style={styles.serviceabilityIconWrap}>
                  <Ionicons name="location-outline" size={18} color={palette.secondary} />
                </View>
                <View style={styles.serviceabilityCopy}>
                  <Text style={styles.serviceabilityTitle}>
                    {serviceabilityNotice.title}
                  </Text>
                  <Text style={styles.serviceabilityBody}>
                    {serviceabilityNotice.body}
                  </Text>
                  <View style={styles.serviceabilityActions}>
                    <Pressable
                      style={[
                        styles.serviceabilityAction,
                        styles.serviceabilityActionPrimary,
                      ]}
                      onPress={() => router.push("/location-picker")}
                    >
                      <Text style={styles.serviceabilityActionPrimaryText}>
                        Change location
                      </Text>
                    </Pressable>
                    <Pressable
                      style={styles.serviceabilityAction}
                      onPress={() => {
                        void handleUseCurrentLocation();
                      }}
                    >
                      <Text style={styles.serviceabilityActionText}>
                        My location
                      </Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            ) : null}

            {recentReviews.length || typeof restaurant.avgRating === "number" ? (
              <View style={styles.reviewPreviewSection}>
                <Pressable
                  style={styles.reviewEntryCard}
                  onPress={() =>
                    router.push({
                      pathname: "/restaurants/[restaurantId]/reviews",
                      params: { restaurantId: restaurant._id },
                    })
                  }
                >
                  <View style={styles.reviewEntryIconWrap}>
                    <Ionicons name="chatbubbles-outline" size={18} color={palette.secondary} />
                  </View>
                  <View style={styles.reviewEntryCopy}>
                    <Text style={styles.reviewEntryTitle}>Guest reviews</Text>
                    <Text style={styles.reviewEntrySubtitle}>
                      {typeof restaurant.avgRating === "number" && (restaurant.reviewCount ?? 0) > 0
                        ? `${restaurant.avgRating} average from ${restaurant.reviewCount} review${(restaurant.reviewCount ?? 0) === 1 ? "" : "s"}`
                        : "Open the review screen to see customer feedback."}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={palette.mutedForeground} />
                </Pressable>
              </View>
            ) : null}

            <View
              style={styles.controlsWrap}
              onLayout={(event) => {
                controlsYRef.current = event.nativeEvent.layout.y;
                controlsHeightRef.current = event.nativeEvent.layout.height;
              }}
            >
              <View style={styles.controlsStack}>
                  <MenuSearchBar
                    value={menuSearch}
                    onChangeText={handleMenuSearchChange}
                    onFocus={openSearchMode}
                    showSoftInputOnFocus={false}
                  />
                <CategoryRail
                  categories={tabItems}
                  activeCategoryId={activeCategoryId}
                  onPressCategory={handlePressCategory}
                />
              </View>
            </View>
          </View>
        }
        renderItem={({ item }: { item: Row }) => {
          if (item.kind === "popular") {
            return (
              <View style={styles.sectionWrap}>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionTitleRow}>
                    <Ionicons name="flame" size={15} color={palette.primary} />
                    <Text style={styles.sectionHeaderTitle}>Popular</Text>
                  </View>
                  <Text style={styles.sectionHeaderSubtitle}>Most ordered right now</Text>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.popularRow}
                >
                  {item.items.map((popularItem: CustomerRestaurantMenuItem) => (
                    <ConnectedPopularItemCard
                      key={popularItem._id}
                      item={popularItem}
                      restaurantId={restaurant._id}
                      isRestaurantOpen={restaurant.isOpen !== false && canAddFromRestaurant}
                      onPressIncrease={handleIncrease}
                      onPressDecrease={handleDecrease}
                      onPressCard={openCustomizer}
                    />
                  ))}
                </ScrollView>
              </View>
            );
          }

          if (item.kind === "section") {
            return (
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionHeaderTitle}>{item.title}</Text>
                {item.description ? (
                  <Text style={styles.sectionHeaderSubtitle}>{item.description}</Text>
                ) : null}
              </View>
            );
          }

          return (
            <View style={styles.menuItemWrap}>
              <MenuCard
                item={item.item}
                restaurantId={restaurant._id}
                isRestaurantOpen={restaurant.isOpen !== false && canAddFromRestaurant}
                onPressIncrease={handleIncrease}
                onPressDecrease={handleDecrease}
                onPressCard={openCustomizer}
              />
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconWrap}>
              {isMenuLoading ? (
                <ActivityIndicator size="small" color={palette.secondary} />
              ) : (
                <Ionicons name="search-outline" size={20} color={palette.secondary} />
              )}
            </View>
            <Text style={styles.emptyTitle}>
              {isMenuLoading ? "Loading menu" : "No items found"}
            </Text>
            <Text style={styles.emptySubtitle}>
              {isMenuLoading
                ? "Fresh items are coming up."
                : "Try another search or another category."}
            </Text>
          </View>
        }
      />

      {isSearchMode ? (
        <SearchResultsOverlay
          topInset={insets.top}
          restaurantId={restaurant._id}
          isRestaurantOpen={restaurant.isOpen !== false && canAddFromRestaurant}
          inputRef={stickySearchInputRef}
          value={menuSearch}
          onChangeText={handleMenuSearchChange}
          onBack={closeSearchMode}
          searchResults={searchResults}
          categoryNameById={categoryNameById}
          onPressCard={openCustomizer}
          onPressIncrease={handleIncrease}
          onPressDecrease={handleDecrease}
        />
      ) : showStickyControls ? (
        <View style={[styles.overlayWrap, { top: insets.top }]}>
          <View style={styles.overlayBar}>
            <View style={styles.controlsStack}>
              <MenuSearchBar
                value={menuSearch}
                onChangeText={handleMenuSearchChange}
                onFocus={openSearchMode}
                showSoftInputOnFocus={false}
              />
              <CategoryRail
                categories={tabItems}
                activeCategoryId={activeCategoryId}
                onPressCategory={handlePressCategory}
              />
            </View>
          </View>
        </View>
      ) : null}

      {/*
        <View
          style={[
            styles.cartBarWrap,
            { paddingBottom: Math.max(insets.bottom, 12) },
          ]}
        >
          {autoAppliedOffer && offerProgress ? (
            <Animated.View
              style={[
                styles.offerProgressCard,
                offerProgress.unlocked ? styles.offerProgressCardUnlocked : null,
                { transform: [{ scale: offerUnlockAnim }] },
              ]}
            >
              <View style={styles.offerProgressHeader}>
                <View style={styles.offerProgressBadge}>
                  <Ionicons
                    name={offerProgress.unlocked ? "checkmark-circle" : "sparkles-outline"}
                    size={15}
                    color={offerProgress.unlocked ? palette.successText : palette.secondary}
                  />
                  <Text
                    style={[
                      styles.offerProgressBadgeText,
                      offerProgress.unlocked ? styles.offerProgressBadgeTextUnlocked : null,
                    ]}
                  >
                    {offerProgress.unlocked ? "Applied automatically" : autoAppliedOffer.name}
                  </Text>
                </View>
                <Text style={styles.offerProgressValue}>
                  {formatCurrency(cartSubtotal)} / {formatCurrency(offerProgress.target)}
                </Text>
              </View>

              <Text style={styles.offerProgressSubtitle}>
                {offerProgress.unlocked
                  ? "Discount will be used at checkout."
                  : `${formatCurrency(offerProgress.remaining)} more to unlock this offer.`}
              </Text>

              <View style={styles.offerTrack}>
                <Animated.View
                  style={[
                    styles.offerFill,
                    offerProgress.unlocked ? styles.offerFillUnlocked : null,
                    { width: `${offerProgress.ratio * 100}%` },
                  ]}
                />
              </View>
            </Animated.View>
          ) : null}
          <Pressable style={styles.cartBar} onPress={() => router.push("/(tabs)/cart")}>
            <View style={styles.cartBarGlow} />
            <View style={styles.cartBarCopy}>
              <Text style={styles.cartBarTitle}>{itemCount} items in cart</Text>
              <Text style={styles.cartBarSubtitle}>
                {restaurant.name} •{" "}
                {formatCurrency(
                  cartItems.reduce((total, item) => total + item.unitPrice * item.quantity, 0),
                )}
              </Text>
            </View>
            <View style={styles.cartBarAction}>
              <Text style={styles.cartBarActionText}>View cart</Text>
              <Ionicons name="arrow-forward" size={16} color={palette.surface} />
            </View>
          </Pressable>
        </View>
      */}
      <ConnectedRestaurantCartFooter
        restaurantId={restaurant._id}
        restaurantName={restaurant.name}
        autoAppliedOffer={autoAppliedOffer}
        bottomInset={Math.max(insets.bottom, 12)}
      />

      {cartConflictItem ? (
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={() => setCartConflictItem(null)}
          />
          <View style={styles.modalCard}>
            <View style={styles.modalGlow} />
            <View style={styles.modalBadge}>
              <Ionicons name="sparkles" size={14} color={palette.secondary} />
              <Text style={styles.modalBadgeText}>Cart switch</Text>
            </View>
            <Text style={styles.modalTitle}>Start a fresh cart?</Text>
            <Text style={styles.modalText}>
              Your cart already has items from {conflictingRestaurantName}.
              Add this item to start a new cart for {restaurant.name}.
            </Text>
            <View style={styles.modalPreviewRow}>
              {cartConflictItem.item.images?.[0]?.url ? (
                <Image
                  source={{ uri: cartConflictItem.item.images[0].url }}
                  style={styles.modalPreviewImage}
                />
              ) : (
                <View style={styles.modalPreviewImageFallback} />
              )}
              <View style={styles.modalPreviewCopy}>
                <Text style={styles.modalPreviewTitle}>{cartConflictItem.item.name}</Text>
                <Text style={styles.modalPreviewSubtitle}>
                  {formatCurrency(cartConflictItem.unitPrice)}
                </Text>
              </View>
            </View>
            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalSecondaryButton}
                onPress={() => setCartConflictItem(null)}
              >
                <Text style={styles.modalSecondaryButtonText}>Keep current cart</Text>
              </Pressable>
              <Pressable style={styles.modalPrimaryButton} onPress={handleConfirmReplaceCart}>
                <Text style={styles.modalPrimaryButtonText}>Replace and add</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}

      <Modal
        visible={isInfoSheetVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setInfoSheetVisible(false)}
      >
        <View style={styles.sheetBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={() => setInfoSheetVisible(false)}
          />
          <View style={[styles.infoSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.infoSheetHandle} />
            <View style={styles.infoSheetHeader}>
              <Text style={styles.infoSheetTitle}>Restaurant info</Text>
              <Pressable
                style={styles.infoSheetClose}
                onPress={() => setInfoSheetVisible(false)}
              >
                <Ionicons name="close" size={18} color={palette.foreground} />
              </Pressable>
            </View>

            <View style={styles.infoSheetCard}>
              <Text style={styles.infoSheetSectionTitle}>Quick facts</Text>
              <View style={styles.infoSheetMetricsGrid}>
                <InfoMiniCard
                  icon="star-outline"
                  label="Rating"
                  value={
                    typeof restaurant.avgRating === "number" && (restaurant.reviewCount ?? 0) > 0
                      ? `${restaurant.avgRating} / 5`
                      : "No ratings yet"
                  }
                />
                <InfoMiniCard
                  icon="time-outline"
                  label="Preparation"
                  value={
                    typeof restaurant.preparationTimeMinutes === "number"
                      ? formatDurationMinutes(restaurant.preparationTimeMinutes)
                      : "Kitchen updates soon"
                  }
                />
                <InfoMiniCard
                  icon="pricetag-outline"
                  label="Starts from"
                  value={
                    typeof restaurant.lowestMenuPrice === "number"
                      ? formatCurrency(restaurant.lowestMenuPrice)
                      : "Checking price"
                  }
                />
                <InfoMiniCard
                  icon="navigate-outline"
                  label="Distance"
                  value={
                    typeof restaurant.distanceKm === "number"
                      ? `${restaurant.distanceKm.toFixed(1)} km away`
                      : "Delivery area"
                  }
                />
              </View>
            </View>

            <View style={styles.infoSheetCard}>
              <Text style={styles.infoSheetSectionTitle}>Delivery & location</Text>
              <InfoSheetRow
                icon="location-outline"
                label="Address"
                value={formatCustomerAddressLine(
                  [restaurant.address?.address, restaurant.address?.city]
                    .filter(Boolean)
                    .join(", "),
                  "Address unavailable",
                )}
              />
              <InfoSheetRow
                icon="bag-handle-outline"
                label="Offers live"
                value={
                  detailsData?.activeOffers.length
                    ? `${detailsData.activeOffers.length} offer${detailsData.activeOffers.length === 1 ? "" : "s"} available now`
                    : "No active offers right now"
                }
              />
              <InfoSheetRow
                icon={restaurant.isOpen === false ? "moon-outline" : "checkmark-circle-outline"}
                label="Store status"
                value={restaurant.isOpen === false ? "Currently closed" : "Open and taking orders"}
              />
            </View>

            <View style={styles.infoSheetCard}>
              <Text style={styles.infoSheetSectionTitle}>Cuisine & tags</Text>
              <View style={styles.infoSheetChipWrap}>
                {[...(restaurant.cuisineTypes ?? []), ...(restaurant.tags ?? [])].map((entry) => (
                  <View key={entry} style={styles.infoSheetChip}>
                    <Text style={styles.infoSheetChipText}>{entry}</Text>
                  </View>
                ))}
              </View>
            </View>

            {recentReviews.length ? (
              <View style={styles.infoSheetCard}>
                <View style={styles.infoSheetReviewHeader}>
                  <Text style={styles.infoSheetSectionTitle}>Guest reviews</Text>
                  <Pressable
                    style={styles.infoSheetReviewLink}
                    onPress={() => {
                      setInfoSheetVisible(false);
                      router.push({
                        pathname: "/restaurants/[restaurantId]/reviews",
                        params: { restaurantId: restaurant._id },
                      });
                    }}
                  >
                    <Text style={styles.infoSheetReviewLinkText}>Open all</Text>
                    <Ionicons name="chevron-forward" size={14} color={palette.secondary} />
                  </Pressable>
                </View>
                <InfoSheetRow
                  icon="chatbubbles-outline"
                  label="Reviews"
                  value={
                    typeof restaurant.avgRating === "number" && (restaurant.reviewCount ?? 0) > 0
                      ? `${restaurant.avgRating} average from ${restaurant.reviewCount} reviews`
                      : "Open the dedicated review screen for customer feedback"
                  }
                />
              </View>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal
        visible={Boolean(selectedItem)}
        animationType="slide"
        transparent
        onRequestClose={closeCustomizer}
      >
        <View style={styles.sheetBackdrop}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={closeCustomizer} />
          <View style={[styles.customSheet, { paddingBottom: Math.max(insets.bottom, 18) }]}>
            <View style={styles.customHandle} />
            {selectedItem ? (
              <>
                <View style={styles.customHeaderRow}>
                  <View style={styles.customHeaderCopy}>
                    <Text style={styles.customKicker}>
                      {selectedItemHasCustomizations ? "Customize" : "Item details"}
                    </Text>
                    <Text style={styles.customTitle}>{selectedItem.name}</Text>
                  </View>
                  <Pressable style={styles.customCloseButton} onPress={closeCustomizer}>
                    <Ionicons name="close" size={18} color={palette.foreground} />
                  </Pressable>
                </View>

                <View style={styles.customHeroCard}>
                  {selectedItem.images?.[0]?.url ? (
                    <Image
                      source={{ uri: selectedItem.images[0].url }}
                      style={styles.customHeroImage}
                    />
                  ) : (
                    <View style={styles.customHeroImageFallback} />
                  )}
                  <View style={styles.customHeroCopy}>
                    <Text style={styles.customHeroTitle}>{selectedItem.name}</Text>
                    {selectedItem.description ? (
                      <Text style={styles.customHeroDescription}>{selectedItem.description}</Text>
                    ) : null}
                    <Text style={styles.customHeroPrice}>
                      {selectedItemHasCustomizations
                        ? `Starts from ${formatCurrency(buildStartingPrice(selectedItem))}`
                        : formatCurrency(selectedItem.basePrice)}
                    </Text>
                  </View>
                </View>

                <ScrollView
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.customContent}
                >
                  {!selectedItemHasCustomizations ? (
                    <View style={styles.simpleItemCard}>
                      <View style={styles.simpleItemBadge}>
                        <Ionicons name="sparkles-outline" size={14} color={palette.secondary} />
                        <Text style={styles.simpleItemBadgeText}>Quick add item</Text>
                      </View>
                      <Text style={styles.simpleItemBody}>
                        {selectedItem.description?.trim()
                          ? selectedItem.description
                          : "This item is ready to add to your cart as-is."}
                      </Text>
                    </View>
                  ) : null}

                  {(selectedItem.addOnGroups ?? []).map((group) => {
                    const selected = selectedAddOns[group.name] ?? [];
                    const isMissingRequired =
                      (group.minSelect ?? 0) > 0 &&
                      selected.length < Math.max(group.minSelect ?? 0, 1);

                    return (
                      <View
                        key={group.name}
                        style={[
                          styles.groupCard,
                          isMissingRequired ? styles.groupCardWarning : null,
                        ]}
                      >
                        <View style={styles.groupHeader}>
                          <View style={styles.groupTitleWrap}>
                            <Text style={styles.groupTitle}>{group.name}</Text>
                            <Text style={styles.groupMeta}>
                              {(group.minSelect ?? 0) > 0 ? "Required" : "Optional"} • Up to{" "}
                              {group.maxSelect ?? 10}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.optionsList}>
                          {group.options.map((option) => {
                            const isSelected = selected.includes(option.label);
                            return (
                              <Pressable
                                key={option.label}
                                onPress={() => {
                                  void Haptics.selectionAsync();
                                  toggleSelection(group.name, option.label, group, "addon");
                                }}
                                style={[
                                  styles.optionCard,
                                  isSelected ? styles.optionCardSelected : null,
                                ]}
                              >
                                <View
                                  style={[
                                    styles.optionIndicator,
                                    isSelected ? styles.optionIndicatorSelected : null,
                                  ]}
                                >
                                  <Ionicons
                                    name={isSelected ? "checkmark" : "add"}
                                    size={13}
                                    color={isSelected ? palette.surface : palette.mutedForeground}
                                  />
                                </View>
                                <View style={styles.optionCopy}>
                                  <Text style={styles.optionTitle}>{option.label}</Text>
                                  <Text style={styles.optionSubtitle}>
                                    {option.price > 0 ? `+ ${formatCurrency(option.price)}` : "Included"}
                                  </Text>
                                </View>
                              </Pressable>
                            );
                          })}
                        </View>
                      </View>
                    );
                  })}

                  {(selectedItem.variants ?? []).map((group) => {
                    const selected = selectedVariants[group.name] ?? [];
                    const isMissingRequired =
                      (group.minSelect ?? 0) > 0 &&
                      selected.length < Math.max(group.minSelect ?? 0, 1);

                    return (
                      <View
                        key={group.name}
                        style={[
                          styles.groupCard,
                          isMissingRequired ? styles.groupCardWarning : null,
                        ]}
                      >
                        <View style={styles.groupHeader}>
                          <View style={styles.groupTitleWrap}>
                            <Text style={styles.groupTitle}>{group.name}</Text>
                            <Text style={styles.groupMeta}>Required • Pick 1</Text>
                          </View>
                        </View>
                        <View style={styles.optionsList}>
                          {group.options.map((option) => {
                            const isSelected = selected.includes(option.label);
                            return (
                              <Pressable
                                key={option.label}
                                onPress={() => {
                                  void Haptics.selectionAsync();
                                  toggleSelection(group.name, option.label, group, "variant");
                                }}
                                style={[
                                  styles.optionCard,
                                  isSelected ? styles.optionCardSelected : null,
                                ]}
                              >
                                <View
                                  style={[
                                    styles.optionIndicator,
                                    isSelected ? styles.optionIndicatorSelected : null,
                                  ]}
                                >
                                  <Ionicons
                                    name={isSelected ? "radio-button-on" : "radio-button-off-outline"}
                                    size={13}
                                    color={isSelected ? palette.surface : palette.mutedForeground}
                                  />
                                </View>
                                <View style={styles.optionCopy}>
                                  <Text style={styles.optionTitle}>{option.label}</Text>
                                  <Text style={styles.optionSubtitle}>
                                    {option.priceDelta > 0
                                      ? `+ ${formatCurrency(option.priceDelta)}`
                                      : "Included"}
                                  </Text>
                                </View>
                              </Pressable>
                            );
                          })}
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>

                <View style={styles.customFooter}>
                  <View style={styles.quantityWrap}>
                    <Pressable
                      style={styles.quantityButton}
                      onPress={() => {
                        void Haptics.selectionAsync();
                        setQuantity((current) => Math.max(1, current - 1));
                      }}
                    >
                      <Ionicons name="remove" size={16} color={palette.foreground} />
                    </Pressable>
                    <Text style={styles.quantityText}>{quantity}</Text>
                    <Pressable
                      style={[styles.quantityButton, styles.quantityButtonPrimary]}
                      onPress={() => {
                        void Haptics.selectionAsync();
                        setQuantity((current) => current + 1);
                      }}
                    >
                      <Ionicons name="add" size={16} color={palette.surface} />
                    </Pressable>
                  </View>

                  <Pressable
                    style={[
                      styles.submitButton,
                      !canAddFromRestaurant ? styles.submitButtonDisabled : null,
                    ]}
                    onPress={() => {
                      if (!canAddFromRestaurant) {
                        router.push("/location-picker");
                        return;
                      }
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      handleAddToCart();
                    }}
                  >
                    <Text style={styles.submitButtonText}>
                      {canAddFromRestaurant
                        ? `Add ${formatCurrency(selectedItemTotal)}`
                        : "Change location"}
                    </Text>
                  </Pressable>
                </View>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
