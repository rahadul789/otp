import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
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
  useCustomerPhoneOtpVerifyMutation,
  useCustomerPhoneStartMutation,
  useCustomerPhoneVerifyMutation,
} from "@/src/hooks/use-customer-api";
import {
  getCustomerAuthErrorMessage,
  isCustomerRateLimitMessage,
} from "@/src/lib/auth-error-message";
import { trackCustomerEvent } from "@/src/lib/analytics";
import { resolvePostAuthRedirect } from "@/src/lib/auth-navigation";
import { useCustomerAuthStore } from "@/src/store/auth-store";
import { palette } from "@/src/theme/palette";

function isValidEmail(email: string) {
  if (!email.trim()) {
    return true;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export default function VerifyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const customer = useCustomerAuthStore((state) => state.customer);
  const pendingPhoneAuth = useCustomerAuthStore((state) => state.pendingPhoneAuth);
  const setPendingPhoneAuth = useCustomerAuthStore((state) => state.setPendingPhoneAuth);
  const verifyOtpMutation = useCustomerPhoneOtpVerifyMutation();
  const resendMutation = useCustomerPhoneStartMutation();
  const registerMutation = useCustomerPhoneVerifyMutation();
  const [otpCode, setOtpCode] = useState("");
  const [fullName, setFullName] = useState(pendingPhoneAuth?.fullName ?? "");
  const [email, setEmail] = useState(pendingPhoneAuth?.email ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorText, setErrorText] = useState("");
  const [resendCountdown, setResendCountdown] = useState(30);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const scrollViewRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    if (!pendingPhoneAuth) {
      router.replace("/sign-in");
    }
  }, [pendingPhoneAuth, router]);

  useEffect(() => {
    if (customer) {
      router.replace(
        resolvePostAuthRedirect(pendingPhoneAuth?.redirectTo) as never
      );
    }
  }, [customer, pendingPhoneAuth?.redirectTo, router]);

  useEffect(() => {
    if (!pendingPhoneAuth) {
      return;
    }

    setFullName(pendingPhoneAuth.fullName ?? "");
    setEmail(pendingPhoneAuth.email ?? "");
  }, [pendingPhoneAuth]);

  useEffect(() => {
    if (resendCountdown <= 0) {
      return;
    }

    const timer = setInterval(() => {
      setResendCountdown((current) => (current <= 1 ? 0 : current - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [resendCountdown]);

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

  const isOtpStep = useMemo(
    () => Boolean(pendingPhoneAuth && !pendingPhoneAuth.otpVerified),
    [pendingPhoneAuth]
  );

  useEffect(() => {
    if (isOtpStep) {
      return;
    }

    const subscription = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => subscription.remove();
  }, [isOtpStep]);

  if (!pendingPhoneAuth) {
    return null;
  }

  const currentPendingAuth = pendingPhoneAuth;

  async function handleVerifyOtp() {
    if (!/^\d{6}$/.test(otpCode)) {
      setErrorText("Enter the 6-digit OTP we sent to this phone number.");
      return;
    }

    setErrorText("");

    try {
      const data = await verifyOtpMutation.mutateAsync({
        verificationSessionId: currentPendingAuth.verificationSessionId,
        otpCode,
      });

      setPendingPhoneAuth({
        ...currentPendingAuth,
        verificationSessionId: data.verificationSessionId,
        otpVerified: true,
        phone: data.phone,
        expiresInSeconds: data.expiresInSeconds,
      });
      setOtpCode("");
      setErrorText("");
    } catch (error) {
      setErrorText(getCustomerAuthErrorMessage(error, "Could not verify the OTP right now."));
    }
  }

  async function handleResend() {
    if (resendCountdown > 0) {
      return;
    }

    try {
      const data = await resendMutation.mutateAsync({
        phone: currentPendingAuth.phone,
      });

      if (data.flow !== "otp" || !data.verificationSessionId) {
        setErrorText("This number is ready for password sign-in. Please go back and sign in.");
        return;
      }

      setPendingPhoneAuth({
        ...currentPendingAuth,
        verificationSessionId: data.verificationSessionId,
        fullName: data.customer?.fullName?.trim() || currentPendingAuth.fullName,
        email: data.customer?.email?.trim() || currentPendingAuth.email,
        otpVerified: false,
        expiresInSeconds: data.expiresInSeconds,
      });
      setResendCountdown(30);
      setErrorText("");
    } catch (error) {
      const message = getCustomerAuthErrorMessage(
        error,
        "Could not resend the OTP right now."
      );
      setErrorText(message);
      if (isCustomerRateLimitMessage(message)) {
        setResendCountdown((current) => Math.max(current, 60));
      }
    }
  }

  async function handleCreateAccount() {
    if (!fullName.trim()) {
      setErrorText("Enter your name to finish creating the account.");
      return;
    }

    if (!isValidEmail(email)) {
      setErrorText("Enter a valid email address or leave it blank.");
      return;
    }

    if (password.trim().length < 8) {
      setErrorText("Use at least 8 characters for your password.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorText("Passwords do not match yet. Please recheck them.");
      return;
    }

    setErrorText("");

    try {
      await registerMutation.mutateAsync({
        verificationSessionId: currentPendingAuth.verificationSessionId,
        fullName: fullName.trim(),
        email: email.trim(),
        password: password.trim(),
      });
      void trackCustomerEvent({
        eventType: "signup_completed",
        path: "/verify",
        screenName: "verify",
        metadata: {
          redirectTo: currentPendingAuth.redirectTo ?? "",
        },
      });
      const redirectTo = resolvePostAuthRedirect(
        currentPendingAuth.redirectTo
      );
      setPendingPhoneAuth(null);
      router.replace(redirectTo as never);
    } catch (error) {
      setErrorText(getCustomerAuthErrorMessage(error, "Could not finish creating the account."));
    }
  }

  function scrollToLowerFields() {
    requestAnimationFrame(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    });
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={insets.top + 12}
      >
        <View style={[styles.floatingTopBar, { top: 6 }]}>
          <Pressable
            onPress={() => {
              if (!isOtpStep) {
                return;
              }

              router.back();
            }}
            style={[styles.backButton, !isOtpStep ? styles.backButtonDisabled : null]}
            disabled={!isOtpStep}
          >
            <Ionicons name="chevron-back" size={20} color={palette.foreground} />
          </Pressable>
        </View>
        <ScrollView
          ref={scrollViewRef}
          keyboardShouldPersistTaps="always"
          bounces={false}
          scrollEnabled={isKeyboardVisible}
          contentContainerStyle={[
            styles.container,
            {
              paddingBottom: isKeyboardVisible
                ? Math.max(insets.bottom, 16) + 120
                : Math.max(insets.bottom, 16),
            },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            <View style={styles.primaryOrb} />
            <View style={styles.secondaryOrb} />

            <View style={styles.badge}>
              <Ionicons
                name={isOtpStep ? "keypad-outline" : "person-circle-outline"}
                size={14}
                color={palette.primary}
              />
              <Text style={styles.badgeText}>
                {isOtpStep ? "Verify your phone" : "Complete your account"}
              </Text>
            </View>

            <Text style={styles.title}>
              {isOtpStep ? "Enter the OTP code" : "Finish setting up your profile"}
            </Text>
            <Text style={styles.description}>
              {isOtpStep
                ? "We sent a 6-digit code to your phone."
                : "Add the last details to finish your account."}
            </Text>

            <View style={styles.phonePill}>
              <Ionicons name="call-outline" size={16} color={palette.secondary} />
              <Text style={styles.phonePillText}>{currentPendingAuth.phone}</Text>
              {isOtpStep ? (
                <Pressable
                  onPress={() => router.back()}
                  style={styles.phonePillEditButton}
                >
                  <Ionicons name="create-outline" size={14} color={palette.foreground} />
                  <Text style={styles.phonePillEditText}>Edit</Text>
                </Pressable>
              ) : null}
            </View>

            {isOtpStep ? (
              <>
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>OTP code</Text>
                  <TextInput
                    value={otpCode}
                    onChangeText={(value) => setOtpCode(value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="123456"
                    placeholderTextColor={palette.placeholder}
                  keyboardType="number-pad"
                  style={styles.otpInput}
                />
                  <Text style={styles.helperText}>
                    You can request a new OTP after the timer ends.
                  </Text>
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

                <Pressable style={styles.primaryButton} onPress={handleVerifyOtp}>
                  {verifyOtpMutation.isPending ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Verify OTP</Text>
                  )}
                </Pressable>

                <Pressable
                  style={[
                    styles.secondaryButton,
                    resendCountdown > 0 || resendMutation.isPending ? styles.secondaryButtonDisabled : null,
                  ]}
                  onPress={handleResend}
                  disabled={resendCountdown > 0 || resendMutation.isPending}
                >
                  {resendMutation.isPending ? (
                    <ActivityIndicator size="small" color={palette.foreground} />
                  ) : (
                    <Text style={styles.secondaryButtonText}>
                      {resendCountdown > 0 ? `Resend OTP in ${resendCountdown}s` : "Resend OTP"}
                    </Text>
                  )}
                </Pressable>
              </>
            ) : (
              <>
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Name</Text>
                  <TextInput
                    value={fullName}
                    onChangeText={setFullName}
                    placeholder="Your full name"
                    placeholderTextColor={palette.placeholder}
                    style={styles.input}
                  />
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Email (Optional)</Text>
                  <TextInput
                    value={email}
                    onChangeText={setEmail}
                    placeholder="name@email.com"
                    placeholderTextColor={palette.placeholder}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    onFocus={scrollToLowerFields}
                    style={styles.input}
                  />
                  <Text style={styles.helperText}>
                    Add your email and we can send order receipts there. We may also use it later for important account or delivery updates.
                  </Text>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Password</Text>
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Create a password"
                    placeholderTextColor={palette.placeholder}
                    secureTextEntry
                    onFocus={scrollToLowerFields}
                    style={styles.input}
                  />
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Confirm password</Text>
                  <TextInput
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    placeholder="Confirm your password"
                    placeholderTextColor={palette.placeholder}
                    secureTextEntry
                    onFocus={scrollToLowerFields}
                    style={styles.input}
                  />
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

                <Pressable style={styles.primaryButton} onPress={handleCreateAccount}>
                  {registerMutation.isPending ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Create account</Text>
                  )}
                </Pressable>
              </>
            )}
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
  backButtonDisabled: {
    opacity: 0.35,
  },
  card: {
    overflow: "hidden",
    borderRadius: 32,
    borderWidth: 1,
    borderColor: "#F4DEE8",
    backgroundColor: "#FFFDFE",
    padding: 24,
    gap: 16,
  },
  primaryOrb: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "#FFE1EE",
    top: -30,
    right: -24,
  },
  secondaryOrb: {
    position: "absolute",
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: "#FFF1C9",
    bottom: -18,
    left: -18,
  },
  badge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    backgroundColor: "#FFF3F8",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: palette.primary,
  },
  title: {
    fontSize: 30,
    fontWeight: "800",
    lineHeight: 36,
    color: palette.foreground,
  },
  description: {
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
    backgroundColor: "#FFF7FA",
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  phonePillText: {
    fontSize: 14,
    fontWeight: "700",
    color: palette.foreground,
  },
  phonePillEditButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginLeft: 4,
    borderRadius: 999,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  phonePillEditText: {
    fontSize: 12,
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
  otpInput: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#F2DDE6",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 24,
    letterSpacing: 8,
    color: palette.foreground,
    textAlign: "center",
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
  warningText: {
    color: palette.warningText,
  },
  primaryButton: {
    borderRadius: 20,
    backgroundColor: palette.secondary,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#fff",
  },
  secondaryButton: {
    borderRadius: 20,
    backgroundColor: "#FFF4F7",
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonDisabled: {
    opacity: 0.72,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: palette.foreground,
  },
});
