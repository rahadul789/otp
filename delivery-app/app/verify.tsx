import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { Redirect, router } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useVerifyRiderPhoneAuthMutation } from "@/src/hooks/use-rider-api";
import {
  getDeliveryAuthErrorMessage,
  isDeliveryRateLimitMessage,
} from "@/src/lib/auth-error-message";
import { useDeliveryCopy } from "@/src/lib/copy";
import { useRiderAuthStore } from "@/src/store/auth-store";
import { palette } from "@/src/theme/palette";

export default function VerifyScreen() {
  const [otpCode, setOtpCode] = useState("");
  const [error, setError] = useState("");
  const { copy } = useDeliveryCopy();
  const rider = useRiderAuthStore((state) => state.rider);
  const pendingPhoneAuth = useRiderAuthStore(
    (state: {
      pendingPhoneAuth: { phone: string; fullName: string; verificationSessionId: string } | null;
    }) => state.pendingPhoneAuth
  );

  const verifyMutation = useVerifyRiderPhoneAuthMutation();
  const displayPhone = useMemo(() => pendingPhoneAuth?.phone ?? "", [pendingPhoneAuth]);

  if (rider) {
    return <Redirect href="/(app)/available" />;
  }

  if (!pendingPhoneAuth) {
    return <Redirect href="/sign-in" />;
  }

  const handleVerify = async () => {
    setError("");

    try {
      await verifyMutation.mutateAsync({
        verificationSessionId: pendingPhoneAuth.verificationSessionId,
        otpCode: otpCode.trim(),
        fullName: pendingPhoneAuth.fullName,
      });

      router.replace("/(app)/available");
    } catch (mutationError) {
      setError(getDeliveryAuthErrorMessage(mutationError, copy.verify.error));
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.heroCard}>
          <View style={styles.heroIcon}>
            <Ionicons name="chatbubble-ellipses-outline" size={28} color={palette.primaryStrong} />
          </View>
          <Text style={styles.title}>{copy.verify.title}</Text>
          <Text style={styles.subtitle}>{copy.verify.subtitle(displayPhone)}</Text>
        </View>

        <View style={styles.formCard}>
          <TextInput
            value={otpCode}
            onChangeText={setOtpCode}
            placeholder={copy.verify.placeholder}
            keyboardType="number-pad"
            maxLength={6}
            style={styles.input}
            placeholderTextColor={palette.placeholder}
          />

          {error ? (
            <Text
              style={[
                styles.error,
                isDeliveryRateLimitMessage(error) ? styles.warningText : null,
              ]}
            >
              {error}
            </Text>
          ) : null}

          <Pressable
            onPress={handleVerify}
            disabled={verifyMutation.isPending}
            style={[styles.button, verifyMutation.isPending && styles.buttonDisabled]}
          >
            {verifyMutation.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="shield-checkmark" size={18} color="#fff" />
                <Text style={styles.buttonText}>{copy.verify.action}</Text>
              </>
            )}
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.background,
  },
  container: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
    gap: 18,
  },
  heroCard: {
    borderRadius: 28,
    backgroundColor: palette.heroBackground,
    paddingHorizontal: 22,
    paddingVertical: 24,
    gap: 10,
  },
  heroIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.72)",
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: palette.foreground,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: palette.mutedForeground,
  },
  formCard: {
    borderRadius: 28,
    backgroundColor: palette.surface,
    padding: 20,
    gap: 16,
    borderWidth: 1,
    borderColor: palette.border,
  },
  input: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 15,
    fontSize: 18,
    letterSpacing: 8,
    textAlign: "center",
    color: palette.foreground,
    backgroundColor: palette.surfaceMuted,
  },
  button: {
    minHeight: 56,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: palette.primaryStrong,
  },
  buttonDisabled: {
    opacity: 0.72,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "800",
    color: "#fff",
  },
  error: {
    fontSize: 13,
    color: "#dc2626",
  },
  warningText: {
    color: palette.warningText,
  },
});
