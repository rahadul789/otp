import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
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
import {
  useCustomerPhoneChangeStartMutation,
  useCustomerPhoneChangeVerifyMutation,
} from "@/src/hooks/use-customer-api";
import {
  getCustomerAuthErrorMessage,
  isCustomerRateLimitMessage,
} from "@/src/lib/auth-error-message";
import { palette } from "@/src/theme/palette";

export default function ProfilePhoneVerifyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    phone?: string;
    verificationSessionId?: string;
  }>();
  const phone = typeof params.phone === "string" ? params.phone : "";
  const verificationSessionId =
    typeof params.verificationSessionId === "string" ? params.verificationSessionId : "";
  const verifyMutation = useCustomerPhoneChangeVerifyMutation();
  const resendMutation = useCustomerPhoneChangeStartMutation();
  const isOnline = useIsOnline();
  const [otpCode, setOtpCode] = useState("");
  const [localSessionId, setLocalSessionId] = useState(verificationSessionId);
  const [errorText, setErrorText] = useState("");
  const [resendCountdown, setResendCountdown] = useState(30);

  useEffect(() => {
    if (resendCountdown <= 0) {
      return;
    }

    const timeout = setTimeout(() => {
      setResendCountdown((current) => (current > 0 ? current - 1 : current));
    }, 1000);

    return () => clearTimeout(timeout);
  }, [resendCountdown]);

  async function handleVerify() {
    if (!isOnline) {
      setErrorText("Reconnect to verify this OTP.");
      return;
    }
    if (!/^\d{6}$/.test(otpCode)) {
      setErrorText("Enter the 6-digit OTP code.");
      return;
    }

    try {
      await verifyMutation.mutateAsync({
        verificationSessionId: localSessionId,
        otpCode,
      });
      setErrorText("");
      router.replace("/(tabs)/profile");
    } catch (error) {
      setErrorText(getCustomerAuthErrorMessage(error, "Could not verify OTP."));
    }
  }

  async function handleResend() {
    if (!isOnline) {
      setErrorText("Reconnect to request a new OTP.");
      return;
    }
    if (resendCountdown > 0) {
      return;
    }

    try {
      const data = await resendMutation.mutateAsync({ phone });
      setLocalSessionId(data.verificationSessionId);
      setResendCountdown(30);
      setErrorText("");
    } catch (error) {
      const message = getCustomerAuthErrorMessage(error, "Could not resend OTP.");
      setErrorText(message);
      if (isCustomerRateLimitMessage(message)) {
        setResendCountdown((current) => Math.max(current, 60));
      }
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
            <Text style={styles.topBarTitle}>Verify phone</Text>
            <View style={styles.topBarSpacer} />
          </View>

          {!isOnline ? (
            <OfflineNoticeCard description="You can keep the code ready here. Reconnect to verify or resend the OTP." />
          ) : null}

          <View style={styles.heroCard}>
            <Text style={styles.heroTitle}>Verify new phone</Text>
            <Text style={styles.heroSubtitle}>Enter the OTP sent to your new number.</Text>

            <View style={styles.phonePill}>
              <Ionicons name="call-outline" size={14} color={palette.foreground} />
              <Text style={styles.phonePillText}>{phone}</Text>
            </View>
          </View>

          <View style={styles.formCard}>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>OTP code</Text>
              <TextInput
                value={otpCode}
                onChangeText={(value) => setOtpCode(value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                placeholderTextColor={palette.placeholder}
                keyboardType="number-pad"
                style={styles.input}
              />
            </View>

            <View style={styles.resendRow}>
              <Text style={styles.resendHint}>
                {resendCountdown > 0 ? "You can request a new OTP soon." : "Did not receive the OTP?"}
              </Text>
              <Pressable onPress={handleResend} disabled={resendCountdown > 0 || resendMutation.isPending || !isOnline}>
                {resendMutation.isPending ? (
                  <ActivityIndicator size="small" color={palette.foreground} />
                ) : (
                  <Text
                    style={[
                      styles.resendLink,
                      (resendCountdown > 0 || resendMutation.isPending || !isOnline) && styles.resendLinkDisabled,
                    ]}
                  >
                    {resendCountdown > 0 ? `Resend in ${resendCountdown}s` : "Resend OTP"}
                  </Text>
                )}
              </Pressable>
            </View>

            {errorText ? (
              <Text
                style={[
                  styles.errorText,
                  isCustomerRateLimitMessage(errorText) ? styles.warningText : null,
                ]}
              >
                {errorText}
              </Text>
            ) : null}

            <Pressable
              style={[
                styles.primaryButton,
                verifyMutation.isPending || !isOnline ? styles.primaryButtonDisabled : null,
              ]}
              onPress={handleVerify}
              disabled={verifyMutation.isPending || !isOnline}
            >
              {verifyMutation.isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Text style={styles.primaryButtonText}>Verify and update</Text>
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
    borderRadius: 26,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    padding: 18,
    gap: 10,
  },
  heroTitle: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "800",
    color: palette.foreground,
  },
  heroSubtitle: {
    fontSize: 14,
    lineHeight: 22,
    color: palette.mutedForeground,
  },
  phonePill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: palette.background,
    borderWidth: 1,
    borderColor: palette.border,
  },
  phonePillText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
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
    fontSize: 20,
    letterSpacing: 8,
    textAlign: "center",
    color: palette.foreground,
  },
  resendRow: {
    gap: 6,
    alignItems: "flex-start",
  },
  resendHint: {
    fontSize: 13,
    lineHeight: 19,
    color: palette.mutedForeground,
  },
  resendLink: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.secondary,
  },
  resendLinkDisabled: {
    color: palette.mutedForeground,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 18,
    color: "#C62828",
  },
  warningText: {
    color: palette.warningText,
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
