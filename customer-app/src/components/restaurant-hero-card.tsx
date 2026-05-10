import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from "react-native";

import { formatDistanceValue } from "@/src/lib/distance";
import { palette } from "@/src/theme/palette";

type Props = {
  name: string;
  subtitle?: string;
  imageUrl?: string | null;
  isOpen?: boolean;
  offerLabel?: string | null;
  distanceKm?: number | null;
  avgRating?: number | null;
  reviewCount?: number;
  preparationTimeMinutes?: number | null;
  lowestMenuPrice?: number | null;
  isFavorite?: boolean;
  favoriteDisabled?: boolean;
  onToggleFavorite?: () => void;
  onPress?: () => void;
  compact?: boolean;
};

export function RestaurantHeroCard({
  name,
  subtitle,
  imageUrl,
  isOpen = true,
  offerLabel,
  distanceKm,
  avgRating,
  reviewCount,
  preparationTimeMinutes,
  lowestMenuPrice,
  isFavorite = false,
  favoriteDisabled = false,
  onToggleFavorite,
  onPress,
  compact = false,
}: Props) {
  const hasRating =
    typeof avgRating === "number" &&
    Number.isFinite(avgRating) &&
    (reviewCount ?? 0) > 0;
  const hasPreparationTime =
    typeof preparationTimeMinutes === "number" && preparationTimeMinutes > 0;
  const hasDistance =
    typeof distanceKm === "number" && Number.isFinite(distanceKm);
  const distanceLabel = formatDistanceValue(distanceKm);
  const hasOffer = Boolean(offerLabel?.trim());
  const hasLowestPrice =
    typeof lowestMenuPrice === "number" && Number.isFinite(lowestMenuPrice);

  const handleFavoritePress = (event: GestureResponderEvent) => {
    event.stopPropagation();

    if (favoriteDisabled || !onToggleFavorite) {
      return;
    }

    void Haptics.selectionAsync().catch(() => undefined);
    onToggleFavorite();
  };

  return (
    <Pressable
      style={[styles.card, compact ? styles.cardCompact : null, !isOpen ? styles.closedCard : null]}
      onPress={onPress}
    >
      <View style={[styles.imageWrap, compact ? styles.imageWrapCompact : null]}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.coverImage} />
        ) : (
          <View style={styles.coverFallback}>
            <Ionicons name="restaurant-outline" size={28} color={palette.primary} />
          </View>
        )}

        <View style={[styles.imageOverlay, !isOpen ? styles.closedImageOverlay : null]} />

        {!isOpen ? (
          <View style={styles.closedOverlayContent}>
            <View style={styles.closedOverlayBadge}>
              <Ionicons name="time-outline" size={15} color={palette.surface} />
              <Text style={styles.closedOverlayText}>Temporarily unavailable</Text>
            </View>
          </View>
        ) : null}

        <View style={[styles.topRow, compact ? styles.topRowCompact : null]}>
          <View
            style={[
              styles.statusPill,
              compact ? styles.statusPillCompact : null,
              !isOpen ? styles.statusPillClosed : null,
            ]}
          >
            <View
              style={[
                styles.statusDot,
                !isOpen ? styles.statusDotClosed : null,
              ]}
            />
            <Text
              style={[
                styles.statusText,
                compact ? styles.statusTextCompact : null,
                !isOpen ? styles.statusTextClosed : null,
              ]}
            >
              {isOpen ? "Open now" : "Closed now"}
            </Text>
          </View>

          <Pressable
            style={[
              styles.favoriteButton,
              isFavorite ? styles.favoriteButtonActive : null,
            ]}
            onPress={handleFavoritePress}
            disabled={favoriteDisabled}
            hitSlop={8}
          >
            <Ionicons
              name={isFavorite ? "heart" : "heart-outline"}
              size={15}
              color={isFavorite ? "#fff" : palette.foreground}
            />
          </Pressable>
        </View>

        {hasOffer ? (
          <View style={styles.offerBadge}>
            <Ionicons name="pricetag" size={12} color="#fff" />
            <Text numberOfLines={1} style={styles.offerBadgeText}>
              {offerLabel}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={[styles.content, compact ? styles.contentCompact : null]}>
        <View style={styles.titleRow}>
          <View style={styles.titleBlock}>
            <Text
              numberOfLines={1}
              style={[styles.title, compact ? styles.titleCompact : null, !isOpen ? styles.titleClosed : null]}
            >
              {name}
            </Text>
            {subtitle ? (
              <Text
                numberOfLines={2}
                style={[
                  styles.description,
                  compact ? styles.descriptionCompact : null,
                  !isOpen ? styles.descriptionClosed : null,
                ]}
              >
                {subtitle}
              </Text>
            ) : null}
          </View>

          <View style={styles.priceBlock}>
            <Text style={styles.priceLabel}>Starts from</Text>
            <Text style={styles.priceValue}>
              {hasLowestPrice ? `Tk ${lowestMenuPrice?.toFixed(0)}` : "View menu"}
            </Text>
          </View>
        </View>

        <View style={[styles.metricsRow, compact ? styles.metricsRowCompact : null]}>
          {hasRating ? (
            <Metric icon="star" value={`${avgRating} (${reviewCount})`} compact={compact} />
          ) : null}
          {hasPreparationTime ? (
            <Metric icon="time-outline" value={`${preparationTimeMinutes} min`} compact={compact} />
          ) : null}
          {hasDistance ? <Metric icon="navigate-outline" value={distanceLabel} compact={compact} /> : null}
        </View>
        {!isOpen ? <View style={styles.closedContentVeil} /> : null}
      </View>
    </Pressable>
  );
}

function Metric({
  icon,
  value,
  compact = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  compact?: boolean;
}) {
  return (
    <View style={styles.metric}>
      <Ionicons name={icon} size={14} color={palette.mutedForeground} />
      <Text style={[styles.metricText, compact ? styles.metricTextCompact : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: "hidden",
    borderRadius: 28,
    backgroundColor: palette.surface,
    shadowColor: palette.shadow,
    shadowOpacity: 1,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 7,
  },
  cardCompact: {
    borderRadius: 24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },
  closedCard: {
    backgroundColor: "#FFF9F5",
  },
  imageWrap: {
    position: "relative",
    height: 148,
    backgroundColor: palette.surfaceMuted,
  },
  imageWrapCompact: {
    height: 132,
  },
  coverImage: {
    width: "100%",
    height: "100%",
  },
  coverFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceMuted,
  },
  imageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(31, 36, 48, 0.18)",
  },
  closedImageOverlay: {
    backgroundColor: "rgba(20, 24, 35, 0.68)",
  },
  closedOverlayContent: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  closedOverlayBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(20, 24, 35, 0.72)",
  },
  closedOverlayText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    letterSpacing: 0.2,
    color: palette.surface,
  },
  topRow: {
    position: "absolute",
    top: 10,
    left: 10,
    right: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  topRowCompact: {
    top: 9,
    left: 9,
    right: 9,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.92)",
  },
  statusPillCompact: {
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: palette.mint,
  },
  statusPillClosed: {
    backgroundColor: palette.warningText,
  },
  statusDotClosed: {
    backgroundColor: palette.surface,
  },
  statusText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
    color: palette.foreground,
  },
  statusTextCompact: {
    fontSize: 10,
    lineHeight: 14,
  },
  statusTextClosed: {
    color: palette.surface,
  },
  favoriteButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.94)",
  },
  favoriteButtonActive: {
    backgroundColor: palette.secondary,
  },
  offerBadge: {
    position: "absolute",
    right: 10,
    bottom: 10,
    maxWidth: "74%",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(255,99,146,0.94)",
  },
  offerBadgeText: {
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    color: "#fff",
  },
  content: {
    paddingHorizontal: 14,
    paddingTop: 11,
    paddingBottom: 12,
    gap: 8,
  },
  contentCompact: {
    paddingHorizontal: 13,
    paddingTop: 10,
    paddingBottom: 11,
    gap: 7,
  },
  titleRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
  },
  titleBlock: {
    flex: 1,
    gap: 3,
  },
  title: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "800",
    color: palette.foreground,
  },
  titleCompact: {
    fontSize: 16,
    lineHeight: 21,
  },
  titleClosed: {
    color: "#6D5747",
  },
  description: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
    color: palette.mutedForeground,
  },
  descriptionCompact: {
    fontSize: 12,
    lineHeight: 16,
  },
  descriptionClosed: {
    color: "#8E7B6C",
  },
  priceBlock: {
    minWidth: 86,
    alignItems: "flex-end",
    gap: 2,
  },
  priceLabel: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "700",
    color: palette.mutedForeground,
  },
  priceValue: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    color: palette.foreground,
    textAlign: "right",
  },
  metricsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metricsRowCompact: {
    gap: 7,
  },
  metric: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  metricText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    color: palette.mutedForeground,
  },
  metricTextCompact: {
    fontSize: 11,
    lineHeight: 15,
  },
  closedContentVeil: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255, 249, 245, 0.38)",
  },
});
