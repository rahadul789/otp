import { useEffect, useRef } from "react";
import { useRouter } from "expo-router";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { resolveCustomerRoute } from "@/src/lib/customer-routes";
import { useAppBannerStore } from "@/src/store/app-banner-store";
import { palette } from "@/src/theme/palette";

const toneStyles = {
  info: {
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    borderColor: "rgba(255, 124, 168, 0.18)",
    emojiBackground: "rgba(255, 232, 240, 0.9)",
    actionBackground: "rgba(255, 232, 240, 0.8)",
    accentColor: palette.secondary,
    titleColor: palette.foreground,
    descriptionColor: palette.mutedForeground,
  },
  success: {
    backgroundColor: "rgba(246, 255, 249, 0.9)",
    borderColor: "rgba(34, 197, 94, 0.18)",
    emojiBackground: "rgba(234, 247, 238, 0.95)",
    actionBackground: "rgba(234, 247, 238, 0.86)",
    accentColor: palette.successText,
    titleColor: palette.successText,
    descriptionColor: palette.successText,
  },
  warning: {
    backgroundColor: "rgba(255, 252, 247, 0.92)",
    borderColor: "rgba(245, 158, 11, 0.24)",
    emojiBackground: "rgba(255, 247, 232, 0.95)",
    actionBackground: "rgba(255, 247, 232, 0.86)",
    accentColor: palette.warningText,
    titleColor: palette.warningText,
    descriptionColor: palette.warningText,
  },
} as const;

function getBannerEmoji(banner: {
  emoji?: string;
  tone: keyof typeof toneStyles;
  title: string;
  description: string;
}) {
  if (banner.emoji) return banner.emoji;

  const text = `${banner.title} ${banner.description}`.toLowerCase();

  if (text.includes("delivered")) return "🎉";
  if (text.includes("rider") || text.includes("way")) return "🛵";
  if (text.includes("prepar")) return "👨‍🍳";
  if (text.includes("pickup") || text.includes("packed")) return "🛍️";
  if (text.includes("accepted") || text.includes("confirmed")) return "✅";
  if (text.includes("review") || text.includes("feedback")) return "⭐";
  if (text.includes("cart") || text.includes("added") || text.includes("reorder")) return "🛒";
  if (text.includes("profile") || text.includes("account")) return "👤";
  if (text.includes("sign out") || text.includes("failed") || text.includes("cancel")) return "⚠️";
  if (banner.tone === "success") return "✨";
  if (banner.tone === "warning") return "⚠️";
  return "🍽️";
}

export function AppBannerHost() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const banner = useAppBannerStore((state) => state.banner);
  const dismissBanner = useAppBannerStore((state) => state.dismissBanner);
  const translateY = useRef(new Animated.Value(-140)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!banner) {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: -140,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
      return;
    }

    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 18,
        stiffness: 180,
        mass: 0.9,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();

    const timeout = setTimeout(() => {
      dismissBanner();
    }, 3200);

    return () => clearTimeout(timeout);
  }, [banner, dismissBanner, opacity, translateY]);

  const handlePress = () => {
    const nextPath = resolveCustomerRoute(banner?.path, null);
    dismissBanner();

    if (nextPath) {
      router.push(nextPath as never);
    }
  };

  if (!banner) return null;

  const tone = toneStyles[banner.tone];
  const emoji = getBannerEmoji(banner);

  return (
    <View
      pointerEvents="box-none"
      style={[styles.portal, { top: Math.max(insets.top, 12) + 6 }]}
    >
      <Animated.View
        style={[
          styles.bannerWrap,
          {
            opacity,
            transform: [{ translateY }],
          },
        ]}
      >
        <Pressable
          style={[
            styles.banner,
            {
              backgroundColor: tone.backgroundColor,
              borderColor: tone.borderColor,
            },
          ]}
          onPress={handlePress}
        >
          <View
            style={[
              styles.emojiWrap,
              { backgroundColor: tone.emojiBackground },
            ]}
          >
            <Text style={styles.emoji}>{emoji}</Text>
          </View>
          <View style={styles.copy}>
            <Text style={[styles.title, { color: tone.titleColor }]}>{banner.title}</Text>
            <Text
              numberOfLines={1}
              style={[styles.description, { color: tone.descriptionColor }]}
            >
              {banner.description}
            </Text>
          </View>
          <Text
            numberOfLines={1}
            style={[
              styles.dismiss,
              {
                color: tone.accentColor,
                backgroundColor: tone.actionBackground,
              },
            ]}
          >
            {banner.actionLabel ?? "Dismiss"}
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  portal: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 50,
  },
  bannerWrap: {
    width: "100%",
  },
  banner: {
    minHeight: 62,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 6,
  },
  emojiWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  emoji: {
    fontSize: 20,
    lineHeight: 24,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  title: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
  },
  description: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
  },
  dismiss: {
    maxWidth: 88,
    overflow: "hidden",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
  },
});
