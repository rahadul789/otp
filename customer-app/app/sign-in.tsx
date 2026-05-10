import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
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
import {
  useCustomerPasswordSigninMutation,
  useCustomerPhoneStartMutation,
} from "@/src/hooks/use-customer-api";
import { getCustomerAuthErrorMessage } from "@/src/lib/auth-error-message";
import { trackCustomerEvent } from "@/src/lib/analytics";
import { resolvePostAuthRedirect } from "@/src/lib/auth-navigation";
import { useCustomerAuthStore } from "@/src/store/auth-store";
import { palette } from "@/src/theme/palette";

function sanitizePhone(phone: string) {
  return phone.replace(/\D/g, "").slice(0, 11);
}

export default function SignInScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ redirectTo?: string }>();
  const customer = useCustomerAuthStore((state) => state.customer);
  const setPendingPhoneAuth = useCustomerAuthStore(
    (state) => state.setPendingPhoneAuth,
  );
  const startPhoneMutation = useCustomerPhoneStartMutation();
  const passwordSigninMutation = useCustomerPasswordSigninMutation();
  const [step, setStep] = useState<"phone" | "password">("phone");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [errorText, setErrorText] = useState("");
  const [existingCustomerName, setExistingCustomerName] = useState("");
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  const isBusy =
    startPhoneMutation.isPending || passwordSigninMutation.isPending;
  const phoneIsValid = useMemo(() => /^01\d{9}$/.test(phone), [phone]);

  useEffect(() => {
    if (customer) {
      router.replace(resolvePostAuthRedirect(params.redirectTo) as never);
    }
  }, [customer, params.redirectTo, router]);

  useEffect(() => {
    const showSubscription = Keyboard.addListener("keyboardDidShow", () => {
      setIsKeyboardVisible(true);
    });
    const hideSubscription = Keyboard.addListener("keyboardDidHide", () => {
      setIsKeyboardVisible(false);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  async function handleContinue() {
    const cleanPhone = sanitizePhone(phone);

    if (!/^01\d{9}$/.test(cleanPhone)) {
      setErrorText("Enter a valid 11-digit phone number starting with 01.");
      return;
    }

    setErrorText("");

    try {
      const data = await startPhoneMutation.mutateAsync({ phone: cleanPhone });

      if (data.flow === "password") {
        setPhone(cleanPhone);
        setStep("password");
        setExistingCustomerName(data.customer?.fullName?.trim() || "");
        setPassword("");
        return;
      }

      if (!data.verificationSessionId) {
        setErrorText(
          "We could not start verification right now. Please try again.",
        );
        return;
      }

      setPendingPhoneAuth({
        phone: cleanPhone,
        verificationSessionId: data.verificationSessionId,
        redirectTo: params.redirectTo,
        fullName: data.customer?.fullName?.trim() || "",
        email: data.customer?.email?.trim() || "",
        otpVerified: false,
        expiresInSeconds: data.expiresInSeconds,
      });
      void trackCustomerEvent({
        eventType: "signup_started",
        path: "/sign-in",
        screenName: "sign-in",
        metadata: {
          redirectTo: params.redirectTo ?? "",
        },
      });
      router.push("/verify");
    } catch (error) {
      setErrorText(
        getCustomerAuthErrorMessage(error, "Could not continue right now."),
      );
    }
  }

  async function handlePasswordLogin() {
    if (!password.trim()) {
      setErrorText("Enter your password to sign in.");
      return;
    }

    setErrorText("");

    try {
      await passwordSigninMutation.mutateAsync({
        phone,
        password: password.trim(),
      });
      router.replace(resolvePostAuthRedirect(params.redirectTo) as never);
    } catch (error) {
      setErrorText(
        getCustomerAuthErrorMessage(error, "Could not sign you in right now."),
      );
    }
  }

  function handleBack() {
    if (step === "password") {
      setStep("phone");
      setPassword("");
      setExistingCustomerName("");
      setErrorText("");
      return;
    }

    router.back();
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={insets.top + 12}
      >
        <View style={[styles.floatingTopBar, { top: 6 }]}>
          <Pressable onPress={handleBack} style={styles.backButton}>
            <Ionicons
              name="chevron-back"
              size={20}
              color={palette.foreground}
            />
          </Pressable>
        </View>
        <ScrollView
          keyboardShouldPersistTaps="always"
          bounces={false}
          scrollEnabled={isKeyboardVisible}
          contentContainerStyle={[
            styles.container,
            {
              paddingBottom: isKeyboardVisible
                ? Math.max(insets.bottom, 16) + 36
                : Math.max(insets.bottom, 16),
            },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.heroCard}>
            <View style={styles.heroOrbPrimary} />
            <View style={styles.heroOrbSecondary} />
            <View style={styles.heroBadge}>
              <Ionicons
                name={
                  step === "password" ? "lock-closed-outline" : "call-outline"
                }
                size={14}
                color={palette.primary}
              />
              <Text style={styles.heroBadgeText}>
                {step === "password" ? "Welcome back" : " Sign in"}
              </Text>
            </View>
            <Text style={styles.title}>
              {step === "password"
                ? "Enter your password"
                : "Continue with your phone"}
            </Text>
            {step === "password" && (
              <Text style={styles.description}>
                {step === "password"
                  ? "This number is already registered."
                  : ""}
              </Text>
            )}

            {step === "password" ? (
              <View style={styles.accountPreview}>
                <View style={styles.accountPreviewIcon}>
                  <Ionicons
                    name="call-outline"
                    size={16}
                    color={palette.secondary}
                  />
                </View>
                <View style={styles.accountPreviewCopy}>
                  <Text style={styles.accountPreviewLabel}>
                    Signing in with
                  </Text>
                  <Text style={styles.accountPreviewValue}>{phone}</Text>
                  {existingCustomerName ? (
                    <Text style={styles.accountPreviewMeta}>
                      {existingCustomerName}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => {
                    setStep("phone");
                    setPassword("");
                    setErrorText("");
                  }}
                  style={styles.changeNumberButton}
                >
                  <Text style={styles.changeNumberButtonText}>Change</Text>
                </Pressable>
              </View>
            ) : null}

            {step === "phone" ? (
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Phone number</Text>
                <TextInput
                  value={phone}
                  onChangeText={(value) => setPhone(sanitizePhone(value))}
                  placeholder="01XXXXXXXXX"
                  placeholderTextColor={palette.placeholder}
                  keyboardType="number-pad"
                  style={styles.input}
                />
                <Text style={styles.helperText}>
                  Use the same number you want to receive order updates on.
                </Text>
              </View>
            ) : (
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Password</Text>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Enter your password"
                  placeholderTextColor={palette.placeholder}
                  secureTextEntry
                  style={styles.input}
                />
              </View>
            )}

            {errorText ? (
              <Text style={styles.errorText}>{errorText}</Text>
            ) : null}

            <Pressable
              style={[
                styles.primaryButton,
                step === "phone" && !phoneIsValid
                  ? styles.primaryButtonMuted
                  : null,
              ]}
              onPress={step === "phone" ? handleContinue : handlePasswordLogin}
              disabled={isBusy}
            >
              {isBusy ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {step === "phone" ? "Continue" : "Sign in"}
                </Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 84,
    paddingBottom: 28,
    justifyContent: "flex-start",
    gap: 18,
  },
  floatingTopBar: {
    position: "absolute",
    left: 20,
    zIndex: 10,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: "#F1DDE7",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  heroCard: {
    overflow: "hidden",
    borderRadius: 32,
    borderWidth: 1,
    borderColor: "#F4DEE8",
    backgroundColor: "#FFFDFE",
    padding: 24,
    gap: 16,
  },
  heroOrbPrimary: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "#FFE1EE",
    top: -30,
    right: -24,
  },
  heroOrbSecondary: {
    position: "absolute",
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "#FFF1C9",
    bottom: -20,
    left: -20,
  },
  heroBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    backgroundColor: "#FFF3F8",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  heroBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: palette.primary,
  },
  title: {
    fontSize: 30,
    fontWeight: "800",
    color: palette.foreground,
    lineHeight: 36,
  },
  description: {
    fontSize: 14,
    lineHeight: 22,
    color: palette.mutedForeground,
  },
  accountPreview: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 24,
    backgroundColor: "#FFF7FA",
    padding: 14,
  },
  accountPreviewIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFE7F1",
    alignItems: "center",
    justifyContent: "center",
  },
  accountPreviewCopy: {
    flex: 1,
    gap: 2,
  },
  accountPreviewLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: palette.mutedForeground,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  accountPreviewValue: {
    fontSize: 16,
    fontWeight: "800",
    color: palette.foreground,
  },
  accountPreviewMeta: {
    fontSize: 13,
    color: palette.mutedForeground,
  },
  changeNumberButton: {
    borderRadius: 999,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  changeNumberButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: palette.foreground,
  },
  fieldGroup: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: "700",
    color: palette.foreground,
  },
  input: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#F2DDE6",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 16,
    paddingVertical: 15,
    fontSize: 15,
    color: palette.foreground,
  },
  helperText: {
    fontSize: 12.5,
    lineHeight: 18,
    color: palette.mutedForeground,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 19,
    color: "#C93C5F",
  },
  primaryButton: {
    borderRadius: 20,
    backgroundColor: palette.secondary,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonMuted: {
    opacity: 0.94,
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#fff",
  },
});
