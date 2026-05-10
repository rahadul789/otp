import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { memo, startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  FlatList,
  GestureResponderEvent,
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
import { Screen } from "@/src/components/screen";
import { useCustomerRestaurantDetailsQuery } from "@/src/hooks/use-customer-api";
import { useLocationStore } from "@/src/store/location-store";
import { useCartStore } from "@/src/store/cart-store";
import { palette } from "@/src/theme/palette";
import type {
  CustomerMenuAddOnGroup,
  CustomerVoucherOffer,
  CustomerMenuVariantGroup,
  CustomerRestaurantMenuItem,
} from "@/src/types/restaurant";

const AnimatedFlatList = Animated.createAnimatedComponent(FlatList as any) as unknown as typeof FlatList;
const EMPTY_CART_ITEMS: {
  itemId: string;
  quantity: number;
}[] = [];

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

function pickPreferredOption<
  TOption extends { label: string; price?: number; priceDelta?: number }
>(options: TOption[] | undefined, priceKey: "price" | "priceDelta") {
  const availableOptions = options ?? [];
  if (!availableOptions.length) {
    return null;
  }

  return (
    availableOptions.find((option) => (option[priceKey] ?? 0) <= 0) ??
    availableOptions[0]
  );
}

function buildDefaultSelections(item: CustomerRestaurantMenuItem) {
  const defaultVariants: Record<string, string[]> = {};
  const defaultAddOns: Record<string, string[]> = {};

  for (const group of item.variants ?? []) {
    if ((group.minSelect ?? 0) > 0) {
      const preferred = pickPreferredOption(group.options, "priceDelta");
      if (preferred) {
        defaultVariants[group.name] = [preferred.label];
      }
    }
  }

  for (const group of item.addOnGroups ?? []) {
    if ((group.minSelect ?? 0) > 0) {
      const preferred = pickPreferredOption(group.options, "price");
      if (preferred) {
        defaultAddOns[group.name] = [preferred.label];
      }
    }
  }

  return { defaultVariants, defaultAddOns };
}

function formatCurrency(amount: number) {
  return `Tk ${amount.toFixed(0)}`;
}

function buildStartingPrice(item: CustomerRestaurantMenuItem) {
  const lowestVariantDelta =
    item.variants?.flatMap((group) => group.options ?? []).reduce((lowest, option) => {
      if (typeof lowest !== "number") return option.priceDelta;
      return Math.min(lowest, option.priceDelta);
    }, undefined as number | undefined) ?? 0;

  return item.basePrice + Math.max(lowestVariantDelta, 0);
}

function hasCustomizations(item: CustomerRestaurantMenuItem) {
  return Boolean((item.variants?.length ?? 0) || (item.addOnGroups?.length ?? 0));
}

function isSelectionValid(
  selectedCount: number,
  group: { minSelect?: number; maxSelect?: number }
) {
  const minSelect = group.minSelect ?? 0;
  const maxSelect = group.maxSelect ?? 99;
  return selectedCount >= minSelect && selectedCount <= maxSelect;
}

function stopPress(event: { stopPropagation?: () => void }) {
  event.stopPropagation?.();
}

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

  const categories = useMemo(() => detailsQuery.data?.categories ?? [], [detailsQuery.data?.categories]);
  const allMenuItems = useMemo(() => detailsQuery.data?.menuItems ?? [], [detailsQuery.data?.menuItems]);
  const restaurant = detailsQuery.data?.restaurant;
  const detailsData = detailsQuery.data;
  const recentReviews = useMemo(() => detailsData?.recentReviews ?? [], [detailsData?.recentReviews]);
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
            ? `${restaurant.preparationTimeMinutes} min`
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
    const defaults = buildDefaultSelections(item);
    setSelectedItem(item);
    setQuantity(1);
    setSelectedVariants(defaults.defaultVariants);
    setSelectedAddOns(defaults.defaultAddOns);
  }, []);

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
    if (!restaurant) return;

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
      return;
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
  }, [addItem, restaurant]);

  function handleConfirmReplaceCart() {
    if (!cartConflictItem || !restaurant) return;

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

    setCartConflictItem(null);
  }

  const handleIncrease = useCallback((item: CustomerRestaurantMenuItem) => {
    if (item.availability === "unavailable" || restaurant?.isOpen === false) return;

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
  }, [restaurant?.isOpen, openCustomizer, attemptAddToCart]);

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

    attemptAddToCart({
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

    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    closeCustomizer();
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

    setTimeout(() => {
      stickySearchInputRef.current?.focus();
    }, 220);
  }, []);

  const closeSearchMode = useCallback(() => {
    Keyboard.dismiss();
    setMenuSearch("");
    setIsSearchMode(false);
  }, []);

  const handleMenuSearchChange = useCallback((value: string) => {
    startTransition(() => {
      setMenuSearch(value);
    });
  }, []);

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
          setTimeout(() => {
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
                      isRestaurantOpen={restaurant.isOpen !== false}
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
                isRestaurantOpen={restaurant.isOpen !== false}
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
              <Ionicons name="search-outline" size={20} color={palette.secondary} />
            </View>
            <Text style={styles.emptyTitle}>No items found</Text>
            <Text style={styles.emptySubtitle}>
              Try another search or another category.
            </Text>
          </View>
        }
      />

      {isSearchMode ? (
        <SearchResultsOverlay
          topInset={insets.top}
          restaurantId={restaurant._id}
          isRestaurantOpen={restaurant.isOpen !== false}
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
                      ? `${restaurant.preparationTimeMinutes} minutes`
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
                value={[restaurant.address?.address, restaurant.address?.city].filter(Boolean).join(", ")}
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
                    style={styles.submitButton}
                    onPress={() => {
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      handleAddToCart();
                    }}
                  >
                    <Text style={styles.submitButtonText}>
                      Add {formatCurrency(selectedItemTotal)}
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

function CategoryRail({
  categories,
  activeCategoryId,
  onPressCategory,
}: {
  categories: { id: string; label: string }[];
  activeCategoryId: string;
  onPressCategory: (categoryId: string) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
      {categories.map((tab) => {
        const isActive = tab.id === activeCategoryId;
        return (
          <Pressable
            key={tab.id}
            onPress={() => onPressCategory(tab.id)}
            style={[styles.categoryChip, isActive ? styles.categoryChipActive : null]}
          >
            <View
              style={[
                styles.categoryChipIndicator,
                isActive ? styles.categoryChipIndicatorActive : null,
              ]}
            />
            <Text
              style={[styles.categoryChipText, isActive ? styles.categoryChipTextActive : null]}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function MenuSearchBar({
  inputRef,
  value,
  onChangeText,
  onFocus,
  onBlur,
  showSoftInputOnFocus,
  flush = false,
}: {
  inputRef?: { current: TextInput | null };
  value: string;
  onChangeText: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  showSoftInputOnFocus?: boolean;
  flush?: boolean;
}) {
  return (
    <View style={[styles.menuSearchWrap, flush ? styles.menuSearchWrapFlush : null]}>
      <Ionicons name="search-outline" size={16} color={palette.mutedForeground} />
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        onFocus={onFocus}
        onBlur={onBlur}
        showSoftInputOnFocus={showSoftInputOnFocus}
        placeholder="Search menu items"
        placeholderTextColor={palette.placeholder}
        style={styles.menuSearchInput}
      />
      {value ? (
        <Pressable style={styles.menuSearchClear} onPress={() => onChangeText("")}>
          <Ionicons name="close" size={14} color={palette.mutedForeground} />
        </Pressable>
      ) : null}
    </View>
  );
}

const SearchResultsOverlay = memo(function SearchResultsOverlay({
  topInset,
  restaurantId,
  isRestaurantOpen,
  inputRef,
  value,
  onChangeText,
  onBack,
  searchResults,
  categoryNameById,
  onPressCard,
  onPressIncrease,
  onPressDecrease,
}: {
  topInset: number;
  restaurantId: string;
  isRestaurantOpen: boolean;
  inputRef: { current: TextInput | null };
  value: string;
  onChangeText: (value: string) => void;
  onBack: () => void;
  searchResults: CustomerRestaurantMenuItem[];
  categoryNameById: Record<string, string>;
  onPressCard: (item: CustomerRestaurantMenuItem) => void;
  onPressIncrease: (item: CustomerRestaurantMenuItem) => void;
  onPressDecrease: (item: CustomerRestaurantMenuItem) => void;
}) {
  const searchCartItems = useCartStore(
    useCallback((state) => {
      if (state.restaurant?.restaurantId !== restaurantId) {
        return EMPTY_CART_ITEMS;
      }
      return state.items;
    }, [restaurantId])
  );

  const searchCartQuantities = useMemo(
    () =>
      searchCartItems.reduce<Record<string, number>>((acc, item) => {
        acc[item.itemId] = (acc[item.itemId] ?? 0) + item.quantity;
        return acc;
      }, {}),
    [searchCartItems]
  );

  return (
    <View style={[styles.searchOverlayWrap, { top: topInset }]}>
      <View style={styles.searchOverlaySurface}>
        <View style={styles.searchOverlayHeader}>
          <View style={styles.searchHeaderRow}>
            <Pressable style={styles.searchBackButton} onPress={onBack}>
              <Ionicons name="chevron-back" size={18} color={palette.foreground} />
            </Pressable>
            <View style={styles.searchHeaderField}>
              <MenuSearchBar
                inputRef={inputRef}
                value={value}
                onChangeText={onChangeText}
                flush
              />
            </View>
          </View>
        </View>

        <ScrollView
          keyboardShouldPersistTaps="always"
          keyboardDismissMode="on-drag"
          onScrollBeginDrag={() => Keyboard.dismiss()}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.searchResultsContent,
            searchResults.length ? null : styles.searchResultsContentEmpty,
          ]}
        >
          {searchResults.length ? (
            searchResults.map((item) => (
              <SearchResultCard
                key={item._id}
                item={item}
                categoryName={categoryNameById[item.categoryId]}
                quantity={searchCartQuantities[item._id] ?? 0}
                isRestaurantOpen={isRestaurantOpen}
                onPressCard={onPressCard}
                onPressIncrease={onPressIncrease}
                onPressDecrease={onPressDecrease}
              />
            ))
          ) : (
            <View style={styles.searchEmptyCard}>
              <View style={styles.searchEmptyIconWrap}>
                <Ionicons name="search-outline" size={20} color={palette.secondary} />
              </View>
              <Text style={styles.searchEmptyTitle}>No matching items yet</Text>
              <Text style={styles.searchEmptySubtitle}>
                Try another menu name, flavour, or addon.
              </Text>
            </View>
          )}
        </ScrollView>
      </View>
    </View>
  );
});

const SearchResultCard = memo(function SearchResultCard({
  item,
  categoryName,
  quantity,
  isRestaurantOpen,
  onPressCard,
  onPressIncrease,
  onPressDecrease,
}: {
  item: CustomerRestaurantMenuItem;
  categoryName?: string;
  quantity: number;
  isRestaurantOpen: boolean;
  onPressCard: (item: CustomerRestaurantMenuItem) => void;
  onPressIncrease: (item: CustomerRestaurantMenuItem) => void;
  onPressDecrease: (item: CustomerRestaurantMenuItem) => void;
}) {
  const imageUrl = item.images?.[0]?.url ?? null;
  const isUnavailable = item.availability === "unavailable" || !isRestaurantOpen;
  const priceLabel = hasCustomizations(item)
    ? `Starts from ${formatCurrency(buildStartingPrice(item))}`
    : formatCurrency(item.basePrice);

  return (
    <Pressable
      onPress={() => onPressCard(item)}
      style={[styles.searchResultCard, isUnavailable ? styles.searchResultCardMuted : null]}
    >
      <View style={styles.searchResultMedia}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.searchResultImage} />
        ) : (
          <View style={styles.searchResultImageFallback}>
            <Ionicons name="restaurant-outline" size={18} color={palette.mutedForeground} />
          </View>
        )}
      </View>
      <View style={styles.searchResultCopy}>
        <View style={styles.searchResultTitleRow}>
          <Text style={styles.searchResultTitle} numberOfLines={1}>
            {item.name}
          </Text>
          {item.isPopular ? (
            <View style={styles.searchPopularBadge}>
              <Ionicons name="flame" size={11} color={palette.secondary} />
              <Text style={styles.searchPopularBadgeText}>Popular</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.searchResultMeta} numberOfLines={1}>
          {categoryName ?? "Menu item"}
        </Text>
          <Text style={styles.searchResultPrice}>{priceLabel}</Text>
        </View>
        <InlineMenuQuantityControl
          quantity={quantity}
          isDisabled={isUnavailable}
          onPressIncrease={(event) => {
            stopPress(event);
            if (isUnavailable) return;
            onPressIncrease(item);
          }}
          onPressDecrease={(event) => {
            stopPress(event);
            onPressDecrease(item);
          }}
        />
      </Pressable>
    );
  }
);

const InlineMenuQuantityControl = memo(function InlineMenuQuantityControl({
  quantity,
  isDisabled,
  onPressIncrease,
  onPressDecrease,
}: {
  quantity: number;
  isDisabled: boolean;
  onPressIncrease: (event: GestureResponderEvent) => void;
  onPressDecrease: (event: GestureResponderEvent) => void;
}) {
  if (quantity > 0) {
    return (
      <View style={styles.quantityControl}>
        <Pressable
          style={[styles.iconButton, isDisabled ? styles.iconButtonDisabled : null]}
          onPressIn={onPressDecrease}
        >
          <Ionicons
            name={quantity === 1 ? "trash-outline" : "remove"}
            size={15}
            color={isDisabled ? palette.mutedForeground : palette.foreground}
          />
        </Pressable>
        <Text style={styles.quantityText}>{quantity}</Text>
        <Pressable
          style={[
            styles.iconButton,
            styles.iconButtonPrimary,
            isDisabled ? styles.iconButtonDisabled : null,
          ]}
          onPressIn={onPressIncrease}
        >
          <Ionicons
            name="add"
            size={15}
            color={isDisabled ? palette.mutedForeground : palette.surface}
          />
        </Pressable>
      </View>
    );
  }

  return (
    <Pressable
      disabled={isDisabled}
      style={[styles.singleAddButton, isDisabled ? styles.singleAddButtonDisabled : null]}
      onPressIn={onPressIncrease}
    >
      <Ionicons
        name="add"
        size={16}
        color={isDisabled ? palette.mutedForeground : palette.surface}
      />
    </Pressable>
  );
});

const ConnectedRestaurantCartFooter = memo(function ConnectedRestaurantCartFooter({
  restaurantId,
  restaurantName,
  autoAppliedOffer,
  bottomInset,
}: {
  restaurantId: string;
  restaurantName: string;
  autoAppliedOffer: CustomerVoucherOffer | null;
  bottomInset: number;
}) {
  const router = useRouter();
  const offerUnlockAnim = useRef(new Animated.Value(1)).current;
  const itemCount = useCartStore(
    useCallback((state) => {
      if (state.restaurant?.restaurantId !== restaurantId) {
        return 0;
      }
      return state.items.reduce((total, item) => total + item.quantity, 0);
    }, [restaurantId])
  );
  const subtotal = useCartStore(
    useCallback((state) => {
      if (state.restaurant?.restaurantId !== restaurantId) {
        return 0;
      }
      return state.items.reduce((total, item) => total + item.unitPrice * item.quantity, 0);
    }, [restaurantId])
  );
  const hasCart = itemCount > 0;

  const offerProgress = useMemo(() => {
    if (!autoAppliedOffer || !autoAppliedOffer.minimumOrderAmount || !hasCart) {
      return null;
    }

    const target = Math.max(autoAppliedOffer.minimumOrderAmount, 1);
    const remaining = Math.max(0, target - subtotal);
    const ratio = Math.max(0, Math.min(1, subtotal / target));
    const unlocked = remaining <= 0;

    return { target, remaining, ratio, unlocked };
  }, [autoAppliedOffer, hasCart, subtotal]);

  useEffect(() => {
    if (!offerProgress?.unlocked) {
      offerUnlockAnim.setValue(1);
      return;
    }

    Animated.sequence([
      Animated.timing(offerUnlockAnim, {
        toValue: 1.03,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(offerUnlockAnim, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();
  }, [offerProgress?.unlocked, offerUnlockAnim]);

  if (!hasCart) {
    return null;
  }

  return (
    <View style={[styles.cartBarWrap, { paddingBottom: bottomInset }]}>
      {offerProgress ? (
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
                {offerProgress.unlocked ? "Applied automatically" : autoAppliedOffer?.name}
              </Text>
            </View>
            <Text style={styles.offerProgressValue}>
              {formatCurrency(subtotal)} / {formatCurrency(offerProgress.target)}
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
            {restaurantName} • {formatCurrency(subtotal)}
          </Text>
        </View>
        <View style={styles.cartBarAction}>
          <Text style={styles.cartBarActionText}>View cart</Text>
          <Ionicons name="arrow-forward" size={16} color={palette.surface} />
        </View>
      </Pressable>
    </View>
  );
});

function InfoSheetRow({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.infoSheetRow}>
      <View style={styles.infoSheetRowIcon}>
        <Ionicons name={icon} size={16} color={palette.primary} />
      </View>
      <View style={styles.infoSheetRowCopy}>
        <Text style={styles.infoSheetRowLabel}>{label}</Text>
        <Text style={styles.infoSheetRowValue}>{value}</Text>
      </View>
    </View>
  );
}

function InfoMiniCard({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.infoMiniCard}>
      <View style={styles.infoMiniCardIcon}>
        <Ionicons name={icon} size={15} color={palette.secondary} />
      </View>
      <Text style={styles.infoMiniCardLabel}>{label}</Text>
      <Text style={styles.infoMiniCardValue}>{value}</Text>
    </View>
  );
}

function FactChip({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  const tone =
    label === "Rating"
      ? {
          card: "#FFF8E8",
          iconWrap: "#FFF1C4",
          icon: "#D49700",
        }
      : label === "Prep time"
        ? {
            card: "#F7F1FF",
            iconWrap: "#EBDDFF",
            icon: "#7C4DCC",
          }
        : label === "From"
          ? {
              card: "#FFF0F6",
              iconWrap: "#FFD9E8",
              icon: palette.secondary,
            }
          : {
              card: "#EEF8FF",
              iconWrap: "#D7EEFF",
              icon: palette.sky,
            };

  return (
    <View style={[styles.factChip, { backgroundColor: tone.card }]}>
      <View style={[styles.factChipIconWrap, { backgroundColor: tone.iconWrap }]}>
        <Ionicons name={icon} size={14} color={tone.icon} />
      </View>
      <View style={styles.factChipCopy}>
        <Text style={styles.factChipLabel}>{label}</Text>
        <Text style={styles.factChipValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function useMenuItemQuantity(itemId: string, restaurantId: string) {
  return useCartStore(
    useCallback((state) => {
      if (state.restaurant?.restaurantId !== restaurantId) {
        return 0;
      }

      return state.items.reduce((total, item) => {
        if (item.itemId !== itemId) {
          return total;
        }
        return total + item.quantity;
      }, 0);
    }, [itemId, restaurantId])
  );
}

const ConnectedPopularItemCard = memo(function ConnectedPopularItemCard({
  item,
  restaurantId,
  isRestaurantOpen,
  onPressIncrease,
  onPressDecrease,
  onPressCard,
}: {
  item: CustomerRestaurantMenuItem;
  restaurantId: string;
  isRestaurantOpen: boolean;
  onPressIncrease: (item: CustomerRestaurantMenuItem) => void;
  onPressDecrease: (item: CustomerRestaurantMenuItem) => void;
  onPressCard: (item: CustomerRestaurantMenuItem) => void;
}) {
  const quantity = useMenuItemQuantity(item._id, restaurantId);
  const isDisabled = !isRestaurantOpen || item.availability === "unavailable";
  const customizable = hasCustomizations(item);

  return (
    <Pressable
      style={[styles.popularCard, isDisabled ? styles.popularCardMuted : null]}
      onPress={() => {
        if (!isDisabled) onPressCard(item);
      }}
    >
      {item.images?.[0]?.url ? (
        <Image source={{ uri: item.images[0].url }} style={styles.popularImage} />
      ) : (
        <View style={styles.popularImageFallback} />
      )}
      <View style={styles.popularMetaBadge}>
        <Ionicons name="flame" size={12} color={palette.primary} />
        <Text style={styles.popularMetaBadgeText}>Popular</Text>
      </View>
      <Text numberOfLines={1} style={styles.popularTitle}>
        {item.name}
      </Text>
      <Text numberOfLines={2} style={styles.popularDescription}>
        {item.description}
      </Text>
      <View style={styles.popularFooter}>
        <View style={styles.popularPriceBlock}>
          <Text style={styles.popularPrice}>
            {customizable
              ? `From ${formatCurrency(buildStartingPrice(item))}`
              : formatCurrency(item.basePrice)}
          </Text>
        </View>
        {quantity > 0 ? (
          <View style={styles.popularQuantityControl}>
            <Pressable
              style={styles.popularIconButton}
              onPressIn={(event) => {
                stopPress(event);
                onPressDecrease(item);
              }}
            >
              <Ionicons
                name={quantity === 1 ? "trash-outline" : "remove"}
                size={15}
                color={palette.foreground}
              />
            </Pressable>
            <Text style={styles.popularQuantityText}>{quantity}</Text>
            <Pressable
              style={[styles.popularIconButton, styles.popularIconButtonPrimary]}
              onPressIn={(event) => {
                stopPress(event);
                onPressIncrease(item);
              }}
            >
              <Ionicons name="add" size={15} color={palette.surface} />
            </Pressable>
          </View>
        ) : (
          <Pressable
            disabled={isDisabled}
            style={[styles.popularAddButton, isDisabled ? styles.iconButtonDisabled : null]}
            onPressIn={(event) => {
              stopPress(event);
              onPressIncrease(item);
            }}
          >
            <Ionicons name="add" size={15} color={isDisabled ? palette.mutedForeground : palette.surface} />
          </Pressable>
        )}
      </View>
    </Pressable>
  );
});

const MenuCard = memo(function MenuCard({
  item,
  restaurantId,
  isRestaurantOpen,
  onPressIncrease,
  onPressDecrease,
  onPressCard,
}: {
  item: CustomerRestaurantMenuItem;
  restaurantId: string;
  isRestaurantOpen: boolean;
  onPressIncrease: (item: CustomerRestaurantMenuItem) => void;
  onPressDecrease: (item: CustomerRestaurantMenuItem) => void;
  onPressCard: (item: CustomerRestaurantMenuItem) => void;
}) {
  const quantity = useMenuItemQuantity(item._id, restaurantId);
  const isDisabled = !isRestaurantOpen || item.availability === "unavailable";
  const customizable = hasCustomizations(item);
  const shouldAllowCardPress = !isDisabled;

  return (
    <Pressable
      disabled={!shouldAllowCardPress}
      onPress={() => onPressCard(item)}
      style={[styles.menuCard, isDisabled ? styles.menuCardMuted : null]}
    >
      <View style={styles.menuCardCopy}>
        <View style={styles.menuMetaRow}>
          {item.isPopular ? (
            <View style={[styles.metaBadge, styles.metaBadgePopular]}>
              <Ionicons name="flame" size={12} color={palette.primary} />
              <Text style={[styles.metaBadgeText, styles.metaBadgeTextPopular]}>Popular</Text>
            </View>
          ) : null}
          {customizable ? (
            <View style={styles.metaBadge}>
              <Text style={styles.metaBadgeText}>Customizable</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.titleBlock}>
          <Text numberOfLines={1} style={styles.menuItemTitle}>
            {item.name}
          </Text>
          <Text numberOfLines={2} style={styles.menuDescription}>
            {item.description}
          </Text>
        </View>

        <View style={styles.menuPriceRow}>
          <Text style={styles.menuPrice}>
            {customizable
              ? `Starts from ${formatCurrency(buildStartingPrice(item))}`
              : formatCurrency(item.basePrice)}
          </Text>
        </View>
      </View>

      <View style={styles.mediaColumn}>
        {item.images?.[0]?.url ? (
          <Image source={{ uri: item.images[0].url }} style={styles.menuImage} />
        ) : (
          <View style={styles.menuImageFallback} />
        )}

          <InlineMenuQuantityControl
            quantity={quantity}
            isDisabled={isDisabled}
            onPressIncrease={(event) => {
              stopPress(event);
              onPressIncrease(item);
            }}
            onPressDecrease={(event) => {
              stopPress(event);
              onPressDecrease(item);
            }}
          />
        </View>
      </Pressable>
    );
});

const styles = StyleSheet.create({
  centerState: { flex: 1, justifyContent: "center", paddingHorizontal: 20 },
  centerStateText: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    color: palette.mutedForeground,
    textAlign: "center",
  },
  listContent: { paddingBottom: 44 },
  listContentWithCart: { paddingBottom: 210 },
  hero: {
    height: 188,
    marginHorizontal: 20,
    marginTop: 8,
    borderRadius: 34,
    overflow: "hidden",
    backgroundColor: palette.surfaceMuted,
  },
  heroImageWrap: { ...StyleSheet.absoluteFillObject },
  heroImage: { width: "100%", height: "100%" },
  heroFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceMuted,
  },
  heroShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(19, 24, 38, 0.18)",
  },
  heroTopRow: {
    position: "absolute",
    top: 14,
    left: 14,
    right: 14,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  heroActionGroup: { flexDirection: "row", gap: 10 },
  heroButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.92)",
  },
  heroBottomRow: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  statePill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.94)",
  },
  statePillClosed: { backgroundColor: "rgba(231, 139, 39, 0.92)" },
  statePillText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    color: palette.foreground,
  },
  statePillTextClosed: { color: palette.surface },
  offerPill: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    color: palette.surface,
    backgroundColor: "rgba(255,99,146,0.88)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  infoCard: {
    marginHorizontal: 20,
    marginTop: -18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 30,
    backgroundColor: palette.surface,
    gap: 10,
    shadowColor: palette.shadow,
    shadowOpacity: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  infoTopRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  restaurantLogo: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: palette.surfaceMuted,
  },
  restaurantLogoFallback: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceMuted,
  },
  infoCopy: { flex: 1, gap: 4 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: "800", color: palette.foreground },
  inlineOfferRow: {
    paddingRight: 8,
    gap: 8,
  },
  inlineOfferChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#FFEAF1",
  },
  inlineOfferText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    color: palette.secondary,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
    color: palette.mutedForeground,
  },
  infoBadgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  factChip: {
    minWidth: "47%",
    flex: 1,
    minHeight: 56,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: palette.surfaceMuted,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  factChipIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFEAF3",
  },
  factChipCopy: {
    flex: 1,
    gap: 2,
  },
  factChipLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    color: palette.mutedForeground,
    textTransform: "uppercase",
  },
  factChipValue: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "800",
    color: palette.foreground,
  },
  reviewPreviewSection: {
    paddingHorizontal: 20,
    paddingTop: 8,
    gap: 10,
  },
  reviewEntryCard: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 22,
    backgroundColor: palette.surface,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    shadowColor: palette.shadow,
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  reviewEntryIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFEAF3",
  },
  reviewEntryCopy: {
    flex: 1,
    gap: 3,
  },
  reviewEntryTitle: {
    fontSize: 15,
    lineHeight: 19,
    fontWeight: "800",
    color: palette.foreground,
  },
  reviewEntrySubtitle: {
    fontSize: 12,
    lineHeight: 18,
    color: palette.mutedForeground,
  },
  offerProgressCard: {
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: palette.surface,
    gap: 8,
    shadowColor: palette.shadow,
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  offerProgressCardUnlocked: { backgroundColor: "#EFFAF5" },
  offerProgressHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  offerProgressBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  offerProgressBadgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    color: palette.secondary,
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  offerProgressBadgeTextUnlocked: {
    color: palette.successText,
  },
  offerProgressValue: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    color: palette.foreground,
  },
  offerProgressTitle: { fontSize: 14, lineHeight: 18, fontWeight: "800", color: palette.foreground },
  offerProgressSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    color: palette.mutedForeground,
  },
  offerTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: "#F5E1D6",
    overflow: "hidden",
    marginTop: 2,
  },
  offerFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: palette.secondary,
  },
  offerFillUnlocked: {
    backgroundColor: palette.successText,
  },
  menuIntro: { paddingHorizontal: 20, paddingTop: 22, gap: 2 },
  menuKicker: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    letterSpacing: 0.9,
    textTransform: "uppercase",
    color: palette.secondary,
  },
  menuSectionTitle: { fontSize: 24, lineHeight: 30, fontWeight: "800", color: palette.foreground },
  menuSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500",
    color: palette.mutedForeground,
  },
  controlsWrap: {
    marginTop: 8,
    paddingTop: 8,
    paddingBottom: 4,
  },
  overlayWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 40,
  },
  overlayBar: {
    paddingTop: 8,
    paddingBottom: 8,
    backgroundColor: "rgba(255,250,247,0.98)",
    borderBottomWidth: 1,
    borderBottomColor: "#F0E2D8",
    shadowColor: palette.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  searchOverlayWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 45,
  },
  searchOverlaySurface: {
    flex: 1,
    backgroundColor: "rgba(255,250,247,0.98)",
  },
  searchOverlayHeader: {
    paddingTop: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#F0E2D8",
    backgroundColor: "rgba(255,250,247,0.98)",
  },
  searchHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 20,
  },
  searchBackButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: "#F0E2D8",
  },
  searchHeaderField: {
    flex: 1,
  },
  searchResultsContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 32,
    gap: 12,
  },
  searchResultsContentEmpty: {
    paddingTop: 10,
  },
  searchResultCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 22,
    backgroundColor: palette.surface,
    shadowColor: palette.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  searchResultCardMuted: {
    opacity: 0.72,
  },
  searchResultMedia: {
    width: 58,
    height: 58,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: palette.surfaceMuted,
  },
  searchResultImage: {
    width: "100%",
    height: "100%",
  },
  searchResultImageFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceMuted,
  },
  searchResultCopy: {
    flex: 1,
    gap: 4,
  },
  searchResultTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchResultTitle: {
    flex: 1,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: "800",
    color: palette.foreground,
  },
  searchPopularBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    minHeight: 22,
    borderRadius: 999,
    backgroundColor: "#FFF1E2",
  },
  searchPopularBadgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    color: palette.secondary,
  },
  searchResultMeta: {
    fontSize: 12,
    lineHeight: 16,
    color: palette.mutedForeground,
  },
  searchResultPrice: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "700",
    color: palette.secondary,
  },
  searchResultAction: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.secondary,
  },
  searchResultActionDisabled: {
    backgroundColor: palette.surfaceMuted,
  },
  searchResultQuantityWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchResultStepButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceMuted,
  },
  searchResultStepButtonPrimary: {
    backgroundColor: palette.secondary,
  },
  searchResultQuantityText: {
    minWidth: 18,
    textAlign: "center",
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "800",
    color: palette.foreground,
  },
  searchEmptyCard: {
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 24,
    paddingVertical: 28,
    borderRadius: 28,
    backgroundColor: palette.surface,
  },
  searchEmptyIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF1F6",
  },
  searchEmptyTitle: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "800",
    color: palette.foreground,
  },
  searchEmptySubtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: palette.mutedForeground,
    textAlign: "center",
  },
  controlsStack: {
    gap: 10,
  },
  emptyIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF1F6",
    marginBottom: 10,
  },
  menuSearchWrap: {
    marginHorizontal: 20,
    minHeight: 44,
    borderRadius: 18,
    paddingHorizontal: 14,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: "#F0E2D8",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    shadowColor: palette.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  menuSearchWrapFlush: {
    marginHorizontal: 0,
  },
  menuSearchInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    color: palette.foreground,
  },
  menuSearchClear: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceMuted,
  },
  categoryRow: { paddingHorizontal: 20, paddingRight: 32, gap: 12 },
  categoryChip: {
    minHeight: 38,
    paddingHorizontal: 15,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: "#FFFBF8",
    borderWidth: 1,
    borderColor: "#F3E3D8",
    shadowColor: palette.shadow,
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  categoryChipIndicator: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: "#E4D0C5",
  },
  categoryChipIndicatorActive: {
    backgroundColor: "#FFD86B",
  },
  categoryChipActive: {
    backgroundColor: "#1E1B24",
    borderColor: "#1E1B24",
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  categoryChipText: { fontSize: 13, lineHeight: 17, fontWeight: "800", color: "#7A6B62" },
  categoryChipTextActive: { color: palette.surface },
  sectionWrap: { paddingTop: 0, gap: 6 },
  sectionHeader: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, gap: 4 },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  sectionHeaderTitle: { fontSize: 20, lineHeight: 25, fontWeight: "800", color: palette.foreground },
  sectionHeaderSubtitle: { fontSize: 13, lineHeight: 18, color: palette.mutedForeground },
  popularRow: { paddingHorizontal: 20, gap: 14, paddingRight: 28 },
  popularCard: {
    width: 184,
    padding: 12,
    borderRadius: 24,
    backgroundColor: palette.surface,
    gap: 10,
    shadowColor: palette.shadow,
    shadowOpacity: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  popularCardMuted: { opacity: 0.72 },
  popularImage: { width: "100%", height: 110, borderRadius: 18, backgroundColor: palette.surfaceMuted },
  popularImageFallback: { width: "100%", height: 110, borderRadius: 18, backgroundColor: palette.surfaceMuted },
  popularMetaBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#FFF0E5",
  },
  popularMetaBadgeText: { fontSize: 11, lineHeight: 14, fontWeight: "700", color: palette.primary },
  popularTitle: { fontSize: 15, lineHeight: 19, fontWeight: "800", color: palette.foreground },
  popularDescription: { fontSize: 12, lineHeight: 16, color: palette.mutedForeground },
  popularFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  popularPriceBlock: { flex: 1, gap: 2 },
  popularPrice: { fontSize: 13, lineHeight: 17, fontWeight: "700", color: palette.foreground },
  popularAddButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.secondary,
  },
  popularQuantityControl: {
    minWidth: 96,
    height: 36,
    paddingHorizontal: 4,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFEAF3",
  },
  popularIconButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surface,
  },
  popularIconButtonPrimary: { backgroundColor: palette.secondary },
  popularQuantityText: { minWidth: 20, textAlign: "center", fontSize: 13, lineHeight: 17, fontWeight: "700", color: palette.foreground },
  menuItemWrap: { paddingHorizontal: 20, paddingBottom: 12 },
  menuCard: {
    flexDirection: "row",
    gap: 14,
    padding: 14,
    borderRadius: 24,
    backgroundColor: palette.surface,
    shadowColor: palette.shadow,
    shadowOpacity: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  menuCardMuted: { opacity: 0.72 },
  menuCardCopy: { flex: 1, gap: 8 },
  menuMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metaBadge: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 999, backgroundColor: palette.surfaceMuted },
  metaBadgePopular: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#FFF0E5" },
  metaBadgeText: { fontSize: 11, lineHeight: 14, fontWeight: "700", color: palette.foreground },
  metaBadgeTextPopular: { color: palette.primary },
  titleBlock: { gap: 4 },
  menuItemTitle: { fontSize: 17, lineHeight: 22, fontWeight: "800", color: palette.foreground },
  menuDescription: { fontSize: 13, lineHeight: 18, fontWeight: "500", color: palette.mutedForeground },
  menuPriceRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  menuPrice: { fontSize: 14, lineHeight: 18, fontWeight: "700", color: palette.foreground },
  mediaColumn: { width: 96, alignItems: "flex-end", justifyContent: "flex-start", gap: 12 },
  menuImage: { width: 96, height: 88, borderRadius: 18, backgroundColor: palette.surfaceMuted },
  menuImageFallback: { width: 96, height: 88, borderRadius: 18, backgroundColor: palette.surfaceMuted },
  singleAddButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.secondary,
  },
  singleAddButtonDisabled: { backgroundColor: palette.surfaceMuted },
  quantityControl: {
    minWidth: 96,
    height: 36,
    borderRadius: 999,
    paddingHorizontal: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFEAF3",
  },
  iconButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surface,
  },
  iconButtonPrimary: { backgroundColor: palette.secondary },
  iconButtonDisabled: { backgroundColor: palette.surfaceMuted },
  quantityText: { minWidth: 20, textAlign: "center", fontSize: 13, lineHeight: 17, fontWeight: "700", color: palette.foreground },
  emptyCard: {
    marginHorizontal: 20,
    marginTop: 18,
    paddingHorizontal: 20,
    paddingVertical: 24,
    borderRadius: 28,
    alignItems: "center",
    gap: 8,
    backgroundColor: palette.surface,
  },
  emptyTitle: { fontSize: 14, lineHeight: 18, fontWeight: "700", color: palette.foreground },
  emptySubtitle: { fontSize: 14, lineHeight: 20, color: palette.mutedForeground, textAlign: "center" },
  cartBarWrap: { position: "absolute", left: 20, right: 20, bottom: 0 },
  cartBar: {
    overflow: "hidden",
    borderRadius: 28,
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: palette.secondary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: palette.shadow,
    shadowOpacity: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  cartBarGlow: {
    position: "absolute",
    top: -28,
    right: -20,
    width: 118,
    height: 118,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  cartBarCopy: { flex: 1, gap: 2 },
  cartBarTitle: { fontSize: 14, lineHeight: 18, fontWeight: "700", color: palette.surface },
  cartBarSubtitle: { fontSize: 12, lineHeight: 16, color: "rgba(255,255,255,0.84)" },
  cartBarAction: { flexDirection: "row", alignItems: "center", gap: 6 },
  cartBarActionText: { fontSize: 14, lineHeight: 18, fontWeight: "700", color: palette.surface },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 60,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(22, 27, 38, 0.38)",
    paddingHorizontal: 20,
  },
  modalCard: {
    width: "100%",
    maxWidth: 360,
    padding: 20,
    borderRadius: 28,
    backgroundColor: palette.surface,
    gap: 14,
    overflow: "hidden",
  },
  modalGlow: {
    position: "absolute",
    top: -42,
    right: -26,
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: "rgba(255, 99, 146, 0.16)",
  },
  modalBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#FFE8F0",
  },
  modalBadgeText: { fontSize: 11, lineHeight: 14, fontWeight: "700", color: palette.secondary },
  modalTitle: { fontSize: 22, lineHeight: 28, fontWeight: "800", color: palette.foreground },
  modalText: { fontSize: 14, lineHeight: 21, color: palette.mutedForeground },
  modalPreviewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 10,
    borderRadius: 18,
    backgroundColor: palette.surfaceMuted,
  },
  modalPreviewImage: { width: 54, height: 54, borderRadius: 14, backgroundColor: palette.surface },
  modalPreviewImageFallback: { width: 54, height: 54, borderRadius: 14, backgroundColor: palette.surface },
  modalPreviewCopy: { flex: 1, gap: 2 },
  modalPreviewTitle: { fontSize: 14, lineHeight: 18, fontWeight: "700", color: palette.foreground },
  modalPreviewSubtitle: { fontSize: 12, lineHeight: 16, color: palette.mutedForeground },
  modalActions: { gap: 10 },
  modalSecondaryButton: {
    minHeight: 48,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceMuted,
  },
  modalSecondaryButtonText: { fontSize: 14, lineHeight: 18, fontWeight: "700", color: palette.foreground },
  modalPrimaryButton: {
    minHeight: 50,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.secondary,
  },
  modalPrimaryButtonText: { fontSize: 14, lineHeight: 18, fontWeight: "700", color: palette.surface },
  sheetBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(18, 24, 35, 0.34)" },
  infoSheet: {
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    backgroundColor: "#FFF8F4",
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 14,
  },
  infoSheetHandle: {
    alignSelf: "center",
    width: 56,
    height: 5,
    borderRadius: 999,
    backgroundColor: "#FFD6E4",
  },
  infoSheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  infoSheetTitle: { fontSize: 24, lineHeight: 30, fontWeight: "800", color: palette.foreground },
  infoSheetClose: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFE8F0",
  },
  infoSheetCard: {
    padding: 16,
    borderRadius: 26,
    backgroundColor: palette.surface,
    gap: 12,
  },
  infoSheetSectionTitle: { fontSize: 14, lineHeight: 18, fontWeight: "700", color: palette.foreground },
  infoSheetRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  infoSheetRowIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFEAF3",
  },
  infoSheetRowCopy: { flex: 1, gap: 2 },
  infoSheetRowLabel: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "700",
    color: palette.primary,
    textTransform: "uppercase",
  },
  infoSheetRowValue: { fontSize: 14, lineHeight: 20, color: palette.foreground },
  infoSheetMetricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  infoMiniCard: {
    minWidth: "47%",
    flex: 1,
    minHeight: 92,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: palette.surfaceMuted,
    gap: 8,
  },
  infoMiniCardIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFEAF3",
  },
  infoMiniCardLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    color: palette.mutedForeground,
    textTransform: "uppercase",
  },
  infoMiniCardValue: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    color: palette.foreground,
  },
  infoSheetChipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  infoSheetChip: {
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceMuted,
  },
  infoSheetChipText: { fontSize: 12, lineHeight: 16, color: palette.foreground },
  infoSheetReviewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  infoSheetReviewLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  infoSheetReviewLinkText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    color: palette.secondary,
  },
  customSheet: {
    maxHeight: "86%",
    paddingTop: 10,
    paddingHorizontal: 20,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    backgroundColor: palette.background,
    gap: 14,
  },
  customHandle: {
    alignSelf: "center",
    width: 56,
    height: 5,
    borderRadius: 999,
    backgroundColor: "#F0D6C7",
  },
  customHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  customHeaderCopy: { flex: 1, gap: 2 },
  customKicker: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "700",
    color: palette.secondary,
    textTransform: "uppercase",
  },
  customTitle: { fontSize: 20, lineHeight: 25, fontWeight: "800", color: palette.foreground },
  customCloseButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surface,
  },
  customHeroCard: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    borderRadius: 24,
    backgroundColor: palette.surface,
  },
  customHeroImage: { width: 86, height: 86, borderRadius: 18, backgroundColor: palette.surfaceMuted },
  customHeroImageFallback: { width: 86, height: 86, borderRadius: 18, backgroundColor: palette.surfaceMuted },
  customHeroCopy: { flex: 1, gap: 4 },
  customHeroTitle: { fontSize: 14, lineHeight: 18, fontWeight: "700", color: palette.foreground },
  customHeroDescription: { fontSize: 12, lineHeight: 16, color: palette.mutedForeground },
  customHeroPrice: { fontSize: 14, lineHeight: 18, fontWeight: "700", color: palette.primary },
  customContent: { gap: 12, paddingBottom: 4 },
  simpleItemCard: {
    padding: 16,
    borderRadius: 22,
    backgroundColor: palette.surface,
    gap: 10,
    shadowColor: palette.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  simpleItemBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#FFF0F6",
  },
  simpleItemBadgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    color: palette.secondary,
  },
  simpleItemBody: {
    fontSize: 14,
    lineHeight: 20,
    color: palette.mutedForeground,
  },
  groupCard: {
    padding: 14,
    borderRadius: 22,
    backgroundColor: palette.surface,
    gap: 10,
  },
  groupCardWarning: { borderWidth: 1, borderColor: "#FFD4C4" },
  groupHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  groupTitleWrap: { flex: 1, gap: 2 },
  groupTitle: { fontSize: 14, lineHeight: 18, fontWeight: "700", color: palette.foreground },
  groupMeta: { fontSize: 12, lineHeight: 16, color: palette.mutedForeground },
  optionsList: { gap: 10 },
  optionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 18,
    backgroundColor: palette.background,
  },
  optionCardSelected: { backgroundColor: "#FFF0E8" },
  optionIndicator: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surface,
  },
  optionIndicatorSelected: { backgroundColor: palette.secondary },
  optionCopy: { flex: 1, gap: 2 },
  optionTitle: { fontSize: 14, lineHeight: 18, fontWeight: "700", color: palette.foreground },
  optionSubtitle: { fontSize: 12, lineHeight: 16, color: palette.mutedForeground },
  customFooter: { flexDirection: "row", alignItems: "center", gap: 14, paddingBottom: 4 },
  quantityWrap: {
    width: 116,
    height: 48,
    paddingHorizontal: 6,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: palette.surface,
  },
  quantityButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceMuted,
  },
  quantityButtonPrimary: { backgroundColor: palette.secondary },
  submitButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.secondary,
  },
  submitButtonText: { fontSize: 14, lineHeight: 18, fontWeight: "700", color: palette.surface },
});
