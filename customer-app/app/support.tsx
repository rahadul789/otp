import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Screen } from "@/src/components/screen";
import { palette } from "@/src/theme/palette";

const faqItems = [
  {
    id: "refund",
    question: "How do refunds work for cancelled orders?",
    answer:
      "If an online payment already went through, the refund usually returns to the same wallet after processing. Cash on delivery orders do not need a refund step.",
  },
  {
    id: "late",
    question: "What if my order is running late?",
    answer:
      "Open the latest order first and check the status. If the rider is delayed for too long, you can continue from support chat with the order details.",
  },
  {
    id: "wrong-item",
    question: "I received a wrong or missing item",
    answer:
      "Take a quick photo if possible and send it in chat. This helps support review the issue faster and guide the next step clearly.",
  },
];

export default function SupportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: 8, paddingBottom: Math.max(insets.bottom, 36) + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Ionicons
              name="chevron-back"
              size={20}
              color={palette.foreground}
            />
          </Pressable>
        </View>

        <View style={styles.hero}>
          <View style={styles.heroGlowPrimary} />
          <View style={styles.heroGlowSecondary} />
          <Text style={styles.kicker}>Support</Text>
          <Text style={styles.title}>Help that feels clear and quick</Text>
          <Text style={styles.subtitle}>
            Delivery issues, payment questions, refunds, and order help stay in
            one calmer place.
          </Text>
        </View>

        <View style={styles.cardStack}>
          <Pressable
            style={styles.actionCard}
            onPress={() => router.push("/support-chat")}
          >
            <View
              style={[styles.actionIconWrap, { backgroundColor: "#FFE7F1" }]}
            >
              <Ionicons
                name="chatbubble-ellipses-outline"
                size={18}
                color={palette.secondary}
              />
            </View>
            <View style={styles.actionCopy}>
              <Text style={styles.actionTitle}>Live chat</Text>
              <Text style={styles.actionSubtitle}>
                Fastest for delivery, payment, and order questions
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={palette.mutedForeground}
            />
          </Pressable>

          <Pressable
            style={styles.actionCard}
            onPress={() => {
              const subject = encodeURIComponent("Customer support request");
              const body = encodeURIComponent(
                "Hi support team,\n\nI need help with an order / delivery / payment issue.\n\nOrder details:\nIssue summary:\n",
              );
              void Linking.openURL(
                `mailto:support@foodbela.app?subject=${subject}&body=${body}`,
              );
            }}
          >
            <View
              style={[styles.actionIconWrap, { backgroundColor: "#EAF2FF" }]}
            >
              <Ionicons name="mail-outline" size={18} color={palette.sky} />
            </View>
            <View style={styles.actionCopy}>
              <Text style={styles.actionTitle}>Email support</Text>
              <Text style={styles.actionSubtitle}>
                Best when you want a written trail with your details
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={palette.mutedForeground}
            />
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Popular help topics</Text>
          <Text style={styles.sectionSubtitle}>
            Answers people usually look for first.
          </Text>
          <View style={styles.faqStack}>
            <Pressable
              style={styles.topicCard}
              onPress={() => router.push("/order-help")}
            >
              <Ionicons
                name="receipt-outline"
                size={18}
                color={palette.foreground}
              />
              <View style={styles.topicCopy}>
                <Text style={styles.topicTitle}>Order help</Text>
                <Text style={styles.topicSubtitle}>
                  Delays, missing items, tracking, and refund basics
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={palette.mutedForeground}
              />
            </Pressable>
            <Pressable
              style={styles.topicCard}
              onPress={() => router.push("/payment-refunds")}
            >
              <Ionicons
                name="wallet-outline"
                size={18}
                color={palette.foreground}
              />
              <View style={styles.topicCopy}>
                <Text style={styles.topicTitle}>Payment & refunds</Text>
                <Text style={styles.topicSubtitle}>
                  bKash, COD, failed charge, and refund timing
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={palette.mutedForeground}
              />
            </Pressable>
            <Pressable
              style={styles.topicCard}
              onPress={() => router.push("/voucher-help")}
            >
              <Ionicons
                name="pricetag-outline"
                size={18}
                color={palette.foreground}
              />
              <View style={styles.topicCopy}>
                <Text style={styles.topicTitle}>Offers & vouchers</Text>
                <Text style={styles.topicSubtitle}>
                  Why a deal applied or why it did not
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={palette.mutedForeground}
              />
            </Pressable>
            {faqItems.map((item) => (
              <View key={item.id} style={styles.faqCard}>
                <Text style={styles.faqQuestion}>{item.question}</Text>
                <Text style={styles.faqAnswer}>{item.answer}</Text>
              </View>
            ))}
          </View>
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
  cardStack: {
    gap: 12,
  },
  actionCard: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    padding: 14,
  },
  actionIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  actionCopy: {
    flex: 1,
    gap: 3,
  },
  actionTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    color: palette.foreground,
  },
  actionSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: palette.mutedForeground,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "800",
    color: palette.foreground,
  },
  sectionSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: palette.mutedForeground,
  },
  faqStack: {
    gap: 10,
  },
  topicCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    padding: 14,
  },
  topicCopy: {
    flex: 1,
    gap: 3,
  },
  topicTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
    color: palette.foreground,
  },
  topicSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: palette.mutedForeground,
  },
  faqCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    padding: 14,
    gap: 6,
  },
  faqQuestion: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
    color: palette.foreground,
  },
  faqAnswer: {
    fontSize: 13,
    lineHeight: 19,
    color: palette.mutedForeground,
  },
});
