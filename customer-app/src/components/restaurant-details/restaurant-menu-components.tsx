import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import {
  Animated,
  Image,
  Keyboard,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
} from "react-native";

import { formatCurrency } from "@/src/lib/currency";
import { buildStartingPrice, hasCustomizations } from "@/src/lib/restaurant-menu";
import { useCartStore } from "@/src/store/cart-store";
import { palette } from "@/src/theme/palette";
import type {
  CustomerRestaurantMenuItem,
  CustomerVoucherOffer,
} from "@/src/types/restaurant";

import { styles } from "./restaurant-details.styles";

const EMPTY_CART_ITEMS: {
  itemId: string;
  quantity: number;
}[] = [];

function stopPress(event: { stopPropagation?: () => void }) {
  event.stopPropagation?.();
}
export function CategoryRail({
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

export function MenuSearchBar({
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
        autoCorrect={false}
        autoCapitalize="none"
        autoComplete="off"
        returnKeyType="search"
        selectionColor={palette.secondary}
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

export const SearchResultsOverlay = memo(function SearchResultsOverlay({
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

export const ConnectedRestaurantCartFooter = memo(function ConnectedRestaurantCartFooter({
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

      <Pressable style={styles.cartBarLift} onPress={() => router.push("/(tabs)/cart")}>
        <View style={styles.cartBar}>
          <View style={styles.cartBarGlow} />
          <View style={styles.cartBarSheen} />
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
        </View>
      </Pressable>
    </View>
  );
});

export function InfoSheetRow({
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

export function InfoMiniCard({
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

export function FactChip({
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

export const ConnectedPopularItemCard = memo(function ConnectedPopularItemCard({
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

export const MenuCard = memo(function MenuCard({
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

