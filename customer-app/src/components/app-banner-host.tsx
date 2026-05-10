import { useEffect, useRef } from "react";
import { useRouter } from "expo-router";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppBannerStore } from "@/src/store/app-banner-store";
import { palette } from "@/src/theme/palette";

const toneStyles = {
  info: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    titleColor: palette.foreground,
    descriptionColor: palette.mutedForeground,
  },
  success: {
    backgroundColor: palette.successSurface,
    borderColor: "#CBE9D7",
    titleColor: palette.successText,
    descriptionColor: palette.successText,
  },
  warning: {
    backgroundColor: palette.warningSurface,
    borderColor: "#F6D6A5",
    titleColor: palette.warningText,
    descriptionColor: palette.warningText,
  },
} as const;

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
    const nextPath = banner?.path;
    dismissBanner();

    if (nextPath) {
      router.push(nextPath as never);
    }
  };

  if (!banner) return null;

  const tone = toneStyles[banner.tone];

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
          <View style={styles.dot} />
          <View style={styles.copy}>
            <Text style={[styles.title, { color: tone.titleColor }]}>{banner.title}</Text>
            <Text style={[styles.description, { color: tone.descriptionColor }]}>
              {banner.description}
            </Text>
          </View>
          <Text style={[styles.dismiss, { color: tone.descriptionColor }]}>
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
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 6,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: palette.primary,
    marginTop: 5,
  },
  copy: {
    flex: 1,
    gap: 3,
  },
  title: {
    fontSize: 14,
    fontWeight: "800",
  },
  description: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
  },
  dismiss: {
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },
});
