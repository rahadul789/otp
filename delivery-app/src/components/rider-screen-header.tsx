import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { palette } from "@/src/theme/palette";

type RiderScreenHeaderProps = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  statusTone?: "online" | "offline" | "paused";
  statusLabel?: string;
  rightSlot?: ReactNode;
};

export function RiderScreenHeader({
  icon,
  title,
  subtitle,
  statusTone = "online",
  statusLabel = statusTone === "online" ? "Online" : statusTone === "paused" ? "Paused" : "Offline",
  rightSlot,
}: RiderScreenHeaderProps) {
  return (
    <View style={styles.container}>
      <View style={styles.left}>
        <View style={styles.iconShell}>
          <Ionicons name={icon} size={18} color={palette.primaryStrong} />
        </View>
        <View style={styles.copyWrap}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
      </View>

      <View style={styles.right}>
        {rightSlot}
        <View
          style={[
            styles.statusPill,
            statusTone === "online"
              ? styles.statusPillOnline
              : statusTone === "paused"
                ? styles.statusPillPaused
                : styles.statusPillOffline,
          ]}
        >
          <Text
            style={[
              styles.statusText,
              statusTone === "online"
                ? styles.statusTextOnline
                : statusTone === "paused"
                  ? styles.statusTextPaused
                  : styles.statusTextOffline,
            ]}
          >
            {statusLabel}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 74,
    borderRadius: 24,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  left: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconShell: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF0F5",
    borderWidth: 1,
    borderColor: "#FFD2E2",
  },
  copyWrap: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    color: palette.foreground,
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 18,
    color: palette.mutedForeground,
  },
  right: {
    alignItems: "flex-end",
    gap: 8,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
  },
  statusPillOnline: {
    backgroundColor: palette.successSurface,
    borderColor: "#B7E8D1",
  },
  statusPillOffline: {
    backgroundColor: "#F4EDE6",
    borderColor: palette.border,
  },
  statusPillPaused: {
    backgroundColor: "#FFF4E2",
    borderColor: "#F1D4A7",
  },
  statusText: {
    fontSize: 11,
    fontWeight: "800",
  },
  statusTextOnline: {
    color: palette.successText,
  },
  statusTextOffline: {
    color: palette.mutedForeground,
  },
  statusTextPaused: {
    color: "#9A5A00",
  },
});
