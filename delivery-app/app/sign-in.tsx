import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
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

import { useStartRiderPhoneAuthMutation } from "@/src/hooks/use-rider-api";
import {
  getDeliveryAuthErrorMessage,
  isDeliveryRateLimitMessage,
} from "@/src/lib/auth-error-message";
import { useDeliveryCopy } from "@/src/lib/copy";
import { useRiderAuthStore } from "@/src/store/auth-store";
import { palette } from "@/src/theme/palette";

export default function SignInScreen() {
  const [phone, setPhone] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState("");
  const { copy } = useDeliveryCopy();
  const rider = useRiderAuthStore((state) => state.rider);
  const setPendingPhoneAuth = useRiderAuthStore(
    (state: {
      setPendingPhoneAuth: (value: {
        phone: string;
        fullName: string;
        verificationSessionId: string;
      }) => void;
    }) => state.setPendingPhoneAuth
  );
  const startAuthMutation = useStartRiderPhoneAuthMutation();

  if (rider) {
    return <Redirect href="/(app)/available" />;
  }

  const handleContinue = async () => {
    setError("");

    try {
      const result = await startAuthMutation.mutateAsync({ phone: phone.trim() });
      setPendingPhoneAuth({
        phone: phone.trim(),
        fullName: fullName.trim(),
        verificationSessionId: result.verificationSessionId,
      });
      router.push("/verify");
    } catch (mutationError) {
      setError(getDeliveryAuthErrorMessage(mutationError, copy.signIn.sendOtpError));
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.heroCard}>
          <View style={styles.heroOrbPrimary} />
          <View style={styles.heroOrbSecondary} />
          <View style={styles.heroIcon}>
            <Ionicons name="bicycle" size={28} color={palette.primaryStrong} />
          </View>
          <Text style={styles.kicker}>{copy.signIn.kicker}</Text>
          <Text style={styles.title}>{copy.signIn.title}</Text>
          <Text style={styles.subtitle}>{copy.signIn.subtitle}</Text>
        </View>

        <View style={styles.formCard}>
          <View style={styles.field}>
            <Text style={styles.label}>{copy.signIn.phoneLabel}</Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder={copy.signIn.phonePlaceholder}
              keyboardType="phone-pad"
              style={styles.input}
              autoCapitalize="none"
              placeholderTextColor={palette.placeholder}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{copy.signIn.nameLabel}</Text>
            <TextInput
              value={fullName}
              onChangeText={setFullName}
              placeholder={copy.signIn.namePlaceholder}
              style={styles.input}
              placeholderTextColor={palette.placeholder}
            />
          </View>

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
            onPress={handleContinue}
            disabled={startAuthMutation.isPending}
            style={[styles.button, startAuthMutation.isPending && styles.buttonDisabled]}
          >
            {startAuthMutation.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="arrow-forward" size={18} color="#fff" />
                <Text style={styles.buttonText}>{copy.signIn.sendOtp}</Text>
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
    overflow: "hidden",
    borderRadius: 28,
    backgroundColor: palette.heroBackground,
    paddingHorizontal: 22,
    paddingVertical: 24,
    gap: 10,
  },
  heroOrbPrimary: {
    position: "absolute",
    right: -16,
    top: -10,
    width: 92,
    height: 92,
    borderRadius: 999,
    backgroundColor: palette.heroOrbPrimary,
    opacity: 0.85,
  },
  heroOrbSecondary: {
    position: "absolute",
    right: 44,
    bottom: -34,
    width: 86,
    height: 86,
    borderRadius: 999,
    backgroundColor: palette.heroOrbSecondary,
    opacity: 0.18,
  },
  heroIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.72)",
  },
  kicker: {
    fontSize: 13,
    fontWeight: "800",
    color: palette.heroAccentText,
    letterSpacing: 1.2,
    textTransform: "uppercase",
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
  field: {
    gap: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: "700",
    color: palette.foreground,
  },
  input: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 15,
    fontSize: 16,
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
