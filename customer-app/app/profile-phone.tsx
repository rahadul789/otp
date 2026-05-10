import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Screen } from "@/src/components/screen";
import { OfflineNoticeCard } from "@/src/components/offline-notice-card";
import { useIsOnline } from "@/src/hooks/use-network-status";
import { useCustomerPhoneChangeStartMutation } from "@/src/hooks/use-customer-api";
import { getCustomerAuthErrorMessage } from "@/src/lib/auth-error-message";
import { useCustomerAuthStore } from "@/src/store/auth-store";
import { palette } from "@/src/theme/palette";

export default function ProfilePhoneScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const customer = useCustomerAuthStore((state) => state.customer);
  const isOnline = useIsOnline();
  const startMutation = useCustomerPhoneChangeStartMutation();
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [errorText, setErrorText] = useState("");

  async function handleContinue() {
    if (!isOnline) {
      setErrorText("Reconnect to send the OTP.");
      return;
    }
    if (!/^01\d{9}$/.test(phone)) {
      setErrorText("Enter a valid 11-digit Bangladeshi phone number.");
      return;
    }

    try {
      const data = await startMutation.mutateAsync({ phone });
      setErrorText("");
      router.push({
        pathname: "/profile-phone-verify",
        params: {
          phone,
          verificationSessionId: data.verificationSessionId,
        },
      });
    } catch (error) {
      setErrorText(
        getCustomerAuthErrorMessage(error, "Could not start phone verification.")
      );
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={insets.top + 12}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: 8, paddingBottom: Math.max(insets.bottom, 16) + 48 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.topBar}>
            <Pressable onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="chevron-back" size={20} color={palette.foreground} />
            </Pressable>
            <Text style={styles.topBarTitle}>Phone number</Text>
            <View style={styles.topBarSpacer} />
          </View>

          {!isOnline ? (
            <OfflineNoticeCard description="You can review your number here. Reconnect to send an OTP to the new phone." />
          ) : null}

          <View style={styles.heroCard}>
            <View style={styles.heroGlowPrimary} />
            <View style={styles.heroGlowSecondary} />

            <View style={styles.heroIconWrap}>
              <Ionicons name="call-outline" size={22} color={palette.secondary} />
            </View>

            <Text style={styles.heroTitle}>Update phone number</Text>
            <Text style={styles.heroSubtitle}>Verify a new number before updating your account.</Text>

            <View style={styles.currentNumberCard}>
              <Text style={styles.currentNumberLabel}>Current number</Text>
              <Text style={styles.currentNumberValue}>{customer?.phone ?? "Not added yet"}</Text>
            </View>
          </View>

          <View style={styles.formCard}>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>New phone number</Text>
              <TextInput
                value={phone}
                onChangeText={(value) => setPhone(value.replace(/\D/g, "").slice(0, 11))}
                placeholder="01XXXXXXXXX"
                placeholderTextColor={palette.placeholder}
                keyboardType="phone-pad"
                style={styles.input}
              />
              <Text style={styles.fieldHint}>
                Your old number will stay unchanged until the OTP is verified.
              </Text>
            </View>

            {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}

            <Pressable
              style={[
                styles.primaryButton,
                startMutation.isPending || !isOnline ? styles.primaryButtonDisabled : null,
              ]}
              onPress={handleContinue}
              disabled={startMutation.isPending || !isOnline}
            >
              {startMutation.isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Text style={styles.primaryButtonText}>Send OTP</Text>
                  <Ionicons name="arrow-forward" size={16} color="#fff" />
                </>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: {
    padding: 18,
    gap: 18,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
  topBarTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "800",
    color: palette.foreground,
  },
  topBarSpacer: {
    width: 42,
    height: 42,
  },
  heroCard: {
    overflow: "hidden",
    borderRadius: 30,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    padding: 22,
    gap: 12,
  },
  heroGlowPrimary: {
    position: "absolute",
    top: -26,
    right: -14,
    width: 122,
    height: 122,
    borderRadius: 61,
    backgroundColor: "#FFE7F1",
  },
  heroGlowSecondary: {
    position: "absolute",
    bottom: -28,
    left: -16,
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "#FFF0C8",
  },
  heroIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFE7F1",
  },
  heroTitle: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "800",
    color: palette.foreground,
  },
  heroSubtitle: {
    fontSize: 14,
    lineHeight: 22,
    color: palette.mutedForeground,
  },
  currentNumberCard: {
    borderRadius: 18,
    padding: 14,
    gap: 4,
    backgroundColor: palette.background,
    borderWidth: 1,
    borderColor: palette.border,
  },
  currentNumberLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    color: palette.mutedForeground,
  },
  currentNumberValue: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "800",
    color: palette.foreground,
  },
  formCard: {
    borderRadius: 28,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    padding: 20,
    gap: 16,
  },
  fieldGroup: { gap: 8 },
  label: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.foreground,
  },
  input: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.background,
    paddingHorizontal: 16,
    paddingVertical: 15,
    fontSize: 16,
    color: palette.foreground,
  },
  fieldHint: {
    fontSize: 13,
    lineHeight: 19,
    color: palette.mutedForeground,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 18,
    color: "#C62828",
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: 20,
    backgroundColor: palette.secondary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryButtonDisabled: {
    opacity: 0.7,
  },
  primaryButtonText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    color: "#fff",
  },
});
