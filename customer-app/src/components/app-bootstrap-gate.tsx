import { Ionicons } from "@expo/vector-icons";
import { PropsWithChildren } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { useAppStartup } from "@/src/hooks/use-app-startup";
import { useCustomerAuthStore } from "@/src/store/auth-store";
import { useLocationStore } from "@/src/store/location-store";
import { palette } from "@/src/theme/palette";

export function AppBootstrapGate({ children }: PropsWithChildren) {
  useAppStartup();
  const startupStatus = useLocationStore((state) => state.startupStatus);
  const isAuthHydrated = useCustomerAuthStore((state) => state.isHydrated);

  if (startupStatus === "loading_location" || !isAuthHydrated) {
    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <View style={styles.glowPrimary} />
          <View style={styles.glowSecondary} />

          <View style={styles.iconRow}>
            <View style={[styles.iconBubble, { backgroundColor: "#FFE8F0" }]}>
              <Ionicons name="location-outline" size={20} color={palette.secondary} />
            </View>
            <View style={[styles.iconBubble, { backgroundColor: "#FFF2D5" }]}>
              <Ionicons name="restaurant-outline" size={20} color={palette.primary} />
            </View>
            <View style={[styles.iconBubble, { backgroundColor: "#EAF2FF" }]}>
              <Ionicons name="sparkles-outline" size={20} color={palette.sky} />
            </View>
          </View>

          <Text style={styles.title}>Preparing your nearby restaurants</Text>
          <Text style={styles.text}>
            Checking your location and restoring your account so nearby menus, offers, and delivery details open correctly.
          </Text>
          <View style={styles.loaderRow}>
            <ActivityIndicator size="small" color={palette.secondary} />
            <Text style={styles.loaderText}>Getting everything ready</Text>
          </View>
        </View>
      </View>
    );
  }

  return children;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.background,
    padding: 24,
  },
  card: {
    overflow: "hidden",
    width: "100%",
    borderRadius: 28,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    padding: 24,
    alignItems: "center",
    gap: 12,
  },
  glowPrimary: {
    position: "absolute",
    top: -30,
    right: -20,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "#FFE7F1",
  },
  glowSecondary: {
    position: "absolute",
    bottom: -24,
    left: -16,
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: "#FFF0C8",
  },
  iconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 4,
  },
  iconBubble: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: palette.foreground,
    textAlign: "center",
  },
  text: {
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
    color: palette.mutedForeground,
  },
  loaderRow: {
    marginTop: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: palette.background,
  },
  loaderText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.foreground,
  },
});
