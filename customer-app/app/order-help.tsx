import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Screen } from "@/src/components/screen";
import { palette } from "@/src/theme/palette";

const issueCards = [
  {
    id: "delay",
    icon: "time-outline" as const,
    tint: "#FFF0D8",
    title: "Running late",
    body:
      "Check the latest order status first. If progress has not changed for a while, open support with the order details.",
  },
  {
    id: "missing",
    icon: "restaurant-outline" as const,
    tint: "#FFE7EE",
    title: "Wrong or missing item",
    body:
      "Keep the item names ready and take a quick photo if possible. This helps support review the issue faster.",
  },
  {
    id: "dropoff",
    icon: "navigate-outline" as const,
    tint: "#E9F1FF",
    title: "Drop-off issue",
    body:
      "Share a landmark or gate note if the place is hard to find and keep your phone reachable for the rider.",
  },
  {
    id: "refund",
    icon: "wallet-outline" as const,
    tint: "#EAFBF4",
    title: "Cancellation and refund",
    body:
      "If an order is cancelled before handoff, the refund usually returns to the original payment method after processing.",
  },
];

const supportChecklist = [
  "Your order ID or restaurant name",
  "A one-line summary of the issue",
  "Photo or screenshot if an item is wrong or missing",
  "Any delivery landmark that helps the rider find you",
];

export default function OrderHelpScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: 8, paddingBottom: Math.max(insets.bottom, 16) + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={20} color={palette.foreground} />
          </Pressable>
        </View>

        <View style={styles.hero}>
          <View style={styles.heroGlowPrimary} />
          <View style={styles.heroGlowSecondary} />
          <Text style={styles.kicker}>Order Help</Text>
          <Text style={styles.title}>Order help that keeps things simple</Text>
          <Text style={styles.subtitle}>
            Delays, missing items, rider issues, and refund basics all start from one clean path.
          </Text>

          <Pressable style={styles.primaryAction} onPress={() => router.push("/(tabs)/orders")}>
            <View style={styles.primaryActionIcon}>
              <Ionicons name="open-outline" size={18} color="#fff" />
            </View>
            <View style={styles.primaryActionCopy}>
              <Text style={styles.primaryActionTitle}>Open your orders</Text>
              <Text style={styles.primaryActionSubtitle}>Start from the related order for faster help.</Text>
            </View>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Common order issues</Text>
          <Text style={styles.sectionSubtitle}>The most useful guidance people usually need first.</Text>
          <View style={styles.stack}>
            {issueCards.map((item) => (
              <View key={item.id} style={styles.card}>
                <View style={[styles.cardIconWrap, { backgroundColor: item.tint }]}>
                  <Ionicons name={item.icon} size={18} color={palette.foreground} />
                </View>
                <View style={styles.cardCopy}>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <Text style={styles.cardText}>{item.body}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Keep these ready</Text>
          <Text style={styles.sectionSubtitle}>Small details make support much faster.</Text>
          <View style={styles.tipCard}>
            {supportChecklist.map((item) => (
              <View key={item} style={styles.tipRow}>
                <View style={styles.tipDot} />
                <Text style={styles.tipText}>{item}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 18, gap: 18 },
  topBar: { flexDirection: "row", alignItems: "center" },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  hero: {
    overflow: "hidden",
    borderRadius: 30,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    padding: 22,
    gap: 10,
  },
  heroGlowPrimary: {
    position: "absolute",
    top: -50,
    right: -18,
    width: 138,
    height: 138,
    borderRadius: 69,
    backgroundColor: "#FFE7F1",
  },
  heroGlowSecondary: {
    position: "absolute",
    bottom: -52,
    left: -36,
    width: 122,
    height: 122,
    borderRadius: 61,
    backgroundColor: "#FFF0C8",
  },
  kicker: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: palette.secondary,
  },
  title: { fontSize: 28, lineHeight: 34, fontWeight: "800", color: palette.foreground },
  subtitle: { fontSize: 14, lineHeight: 22, color: palette.mutedForeground },
  primaryAction: {
    marginTop: 4,
    padding: 14,
    borderRadius: 24,
    backgroundColor: palette.foreground,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  primaryActionIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  primaryActionCopy: { flex: 1, gap: 2 },
  primaryActionTitle: { fontSize: 14, lineHeight: 18, fontWeight: "800", color: "#fff" },
  primaryActionSubtitle: { fontSize: 12, lineHeight: 17, color: "rgba(255,255,255,0.78)" },
  section: { gap: 8 },
  sectionTitle: { fontSize: 18, lineHeight: 24, fontWeight: "800", color: palette.foreground },
  sectionSubtitle: { fontSize: 13, lineHeight: 19, color: palette.mutedForeground },
  stack: { gap: 10 },
  card: {
    padding: 14,
    borderRadius: 24,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    flexDirection: "row",
    gap: 12,
  },
  cardIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  cardCopy: { flex: 1, gap: 4 },
  cardTitle: { fontSize: 14, lineHeight: 19, fontWeight: "800", color: palette.foreground },
  cardText: { fontSize: 13, lineHeight: 19, color: palette.mutedForeground },
  tipCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    padding: 14,
    gap: 10,
  },
  tipRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  tipDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.secondary, marginTop: 6 },
  tipText: { flex: 1, fontSize: 13, lineHeight: 19, color: palette.foreground },
});
