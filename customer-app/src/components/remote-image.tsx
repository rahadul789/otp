import { Ionicons } from "@expo/vector-icons";
import { Image, type ImageContentFit } from "expo-image";
import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import {
  StyleSheet,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { ShimmerBlock } from "@/src/components/loading-skeleton";
import { palette } from "@/src/theme/palette";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

type Props = {
  uri?: string | null;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  contentFit?: ImageContentFit;
  fallbackIcon?: IoniconName;
  fallbackIconSize?: number;
  fallbackTint?: string;
  showSkeleton?: boolean;
  transition?: number;
  accessibilityLabel?: string;
  children?: ReactNode;
};

export function RemoteImage({
  uri,
  style,
  imageStyle,
  contentFit = "cover",
  fallbackIcon = "image-outline",
  fallbackIconSize = 24,
  fallbackTint = palette.secondary,
  showSkeleton = true,
  transition = 180,
  accessibilityLabel,
  children,
}: Props) {
  const normalizedUri = typeof uri === "string" && uri.trim() ? uri.trim() : null;
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasFailed, setHasFailed] = useState(!normalizedUri);

  useEffect(() => {
    setIsLoaded(false);
    setHasFailed(!normalizedUri);
  }, [normalizedUri]);

  const shouldShowImage = Boolean(normalizedUri && !hasFailed);
  const shouldShowSkeleton = showSkeleton && shouldShowImage && !isLoaded;
  const shouldShowFallback = !shouldShowImage;

  return (
    <View style={[styles.container, style]}>
      {normalizedUri && !hasFailed ? (
        <Image
          accessibilityLabel={accessibilityLabel}
          source={{ uri: normalizedUri }}
          style={[StyleSheet.absoluteFill, imageStyle]}
          contentFit={contentFit}
          cachePolicy="memory-disk"
          transition={transition}
          onLoad={() => {
            setIsLoaded(true);
          }}
          onError={() => {
            setHasFailed(true);
          }}
        />
      ) : null}

      {shouldShowSkeleton ? (
        <ShimmerBlock style={styles.fill} />
      ) : null}

      {shouldShowFallback ? (
        <View style={styles.fallback}>
          <Ionicons name={fallbackIcon} size={fallbackIconSize} color={fallbackTint} />
        </View>
      ) : null}

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
    backgroundColor: "#FFF4F8",
  },
  fill: {
    ...StyleSheet.absoluteFillObject,
  },
  fallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF4F8",
  },
});
