import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Screen } from "@/src/components/screen";
import { palette } from "@/src/theme/palette";

const policyItems = [
  {
    id: "location",
    title: "Location access",
    subtitle: "We use your delivery location to show nearby restaurants, calculate delivery distance, and help riders reach you correctly.",
    icon: "location-outline" as const,
    tint: "#FFE8F0",
    iconColor: palette.secondary,
  },
  {
    id: "orders",
    title: "Order details",
    subtitle: "Your order items, delivery notes, and payment choice are used to complete orders, support tracking, and order history.",
    icon: "receipt-outline" as const,
    tint: "#FFF2D8",
    iconColor: palette.primary,
  },
  {
    id: "account",
    title: "Account information",
    subtitle: "Your phone, name, email, and saved locations help with sign in, receipts, support, and faster checkout.",
    icon: "person-outline" as const,
    tint: "#EAF2FF",
    iconColor: palette.sky,
  },
];

export default function PrivacyPolicyScreen() {
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
          <Text style={styles.kicker}>Privacy</Text>
          <Text style={styles.title}>Privacy policy</Text>
          <Text style={styles.subtitle}>
            A simple overview of how location, order, and account details are used inside the app.
          </Text>
        </View>

        <View style={styles.section}>
          {policyItems.map((item) => (
            <View key={item.id} style={styles.policyCard}>
              <View style={[styles.policyIconWrap, { backgroundColor: item.tint }]}>
                <Ionicons name={item.icon} size={18} color={item.iconColor} />
              </View>
              <View style={styles.policyCopy}>
                <Text style={styles.policyTitle}>{item.title}</Text>
                <Text style={styles.policySubtitle}>{item.subtitle}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.noteCard}>
          <Text style={styles.noteTitle}>Need help with account privacy?</Text>
          <Text style={styles.noteText}>
            You can open support anytime if you want help with account changes, receipts, saved locations, or data-related questions.
          </Text>
          <Pressable style={styles.linkButton} onPress={() => router.push("/support")}>
            <Text style={styles.linkButtonText}>Open support</Text>
            <Ionicons name="arrow-forward" size={15} color={palette.foreground} />
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 18,
    gap: 18,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
  },
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
    top: -26,
    right: -16,
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: "#FFE7F1",
  },
  heroGlowSecondary: {
    position: "absolute",
    bottom: -28,
    left: -18,
    width: 100,
    height: 100,
    borderRadius: 50,
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
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "800",
    color: palette.foreground,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 22,
    color: palette.mutedForeground,
  },
  section: {
    gap: 12,
  },
  policyCard: {
    flexDirection: "row",
    gap: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    padding: 14,
  },
  policyIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  policyCopy: {
    flex: 1,
    gap: 4,
  },
  policyTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    color: palette.foreground,
  },
  policySubtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: palette.mutedForeground,
  },
  noteCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    padding: 16,
    gap: 8,
  },
  noteTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    color: palette.foreground,
  },
  noteText: {
    fontSize: 13,
    lineHeight: 20,
    color: palette.mutedForeground,
  },
  linkButton: {
    marginTop: 2,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    backgroundColor: palette.background,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  linkButtonText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.foreground,
  },
});
