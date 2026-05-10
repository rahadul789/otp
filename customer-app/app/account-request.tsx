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
import {
  useCustomerAccountRequestMutation,
  useCustomerCancelAccountRequestMutation,
  useCustomerProfileQuery,
} from "@/src/hooks/use-customer-api";
import { getCustomerAuthErrorMessage } from "@/src/lib/auth-error-message";
import { formatDateTimeAmPm } from "@/src/lib/date-time";
import { useIsOnline } from "@/src/hooks/use-network-status";
import { useCustomerAuthStore } from "@/src/store/auth-store";
import { palette } from "@/src/theme/palette";

type AccountRequestHistoryEntry = {
  action?: string;
  note?: string;
  actorId?: string;
  actorName?: string;
  createdAt?: string | null;
};

export default function AccountRequestScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const customer = useCustomerAuthStore((state) => state.customer);
  const isOnline = useIsOnline();
  useCustomerProfileQuery();
  const requestMutation = useCustomerAccountRequestMutation();
  const cancelRequestMutation = useCustomerCancelAccountRequestMutation();
  const [requestType, setRequestType] = useState<"deactivate" | "delete">("deactivate");
  const [reason, setReason] = useState("");
  const [errorText, setErrorText] = useState("");
  const hasPendingRequest =
    Boolean(customer?.accountRequest?.type) && customer?.accountRequest?.status === "pending";

  async function handleSubmit() {
    if (!isOnline) {
      setErrorText("Reconnect to submit this request.");
      return;
    }
    try {
      await requestMutation.mutateAsync({
        type: requestType,
        reason: reason.trim() || undefined,
      });
      setErrorText("");
      router.replace("/(tabs)/profile");
    } catch (error) {
      setErrorText(getCustomerAuthErrorMessage(error, "Could not submit your request."));
    }
  }

  async function handleCancel() {
    if (!isOnline) {
      setErrorText("Reconnect to cancel this request.");
      return;
    }
    try {
      await cancelRequestMutation.mutateAsync();
      setErrorText("");
      router.replace("/(tabs)/profile");
    } catch (error) {
      setErrorText(getCustomerAuthErrorMessage(error, "Could not cancel your request."));
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
            { paddingTop: 8, paddingBottom: Math.max(insets.bottom, 16) + 64 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.topBar}>
            <Pressable onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="chevron-back" size={20} color={palette.foreground} />
            </Pressable>
          </View>

          {!isOnline ? (
            <OfflineNoticeCard description="You can review your request details here. Reconnect to submit or cancel account requests." />
          ) : null}

          <View style={styles.heroCard}>
            <View style={styles.heroGlowPrimary} />
            <View style={styles.heroGlowSecondary} />

            <View style={styles.heroIconWrap}>
              <Ionicons name="shield-half-outline" size={22} color={palette.secondary} />
            </View>

            <Text style={styles.heroTitle}>Account request</Text>
            <Text style={styles.heroSubtitle}>
              Choose whether you want to temporarily deactivate your account or request permanent deletion.
            </Text>

            {hasPendingRequest ? (
              <View style={styles.pendingNotice}>
                <Text style={styles.pendingNoticeTitle}>A request is already pending</Text>
                <Text style={styles.pendingNoticeText}>
                  You can cancel it if your plans changed, or submit a fresh one to replace it.
                </Text>
              </View>
            ) : null}
          </View>

          <View style={styles.formCard}>
            <View style={styles.optionRow}>
              <Pressable
                style={[
                  styles.optionCard,
                  requestType === "deactivate" ? styles.optionCardActive : null,
                ]}
                onPress={() => setRequestType("deactivate")}
              >
                <View style={styles.optionHeader}>
                  <View style={[styles.optionIconWrap, { backgroundColor: "#FFF0C8" }]}>
                    <Ionicons name="pause-circle-outline" size={18} color={palette.primary} />
                  </View>
                  <Text
                    style={[
                      styles.optionTitle,
                      requestType === "deactivate" ? styles.optionTitleActive : null,
                    ]}
                  >
                    Deactivate
                  </Text>
                </View>
                <Text style={styles.optionText}>
                  Temporarily disable the account without requesting permanent removal.
                </Text>
              </Pressable>

              <Pressable
                style={[
                  styles.optionCard,
                  requestType === "delete" ? styles.optionCardActive : null,
                ]}
                onPress={() => setRequestType("delete")}
              >
                <View style={styles.optionHeader}>
                  <View style={[styles.optionIconWrap, { backgroundColor: "#FFE7F1" }]}>
                    <Ionicons name="trash-outline" size={18} color={palette.secondary} />
                  </View>
                  <Text
                    style={[
                      styles.optionTitle,
                      requestType === "delete" ? styles.optionTitleActive : null,
                    ]}
                  >
                    Delete
                  </Text>
                </View>
                <Text style={styles.optionText}>
                  Request permanent account deletion only if you are sure you no longer need it.
                </Text>
              </Pressable>
            </View>

            {customer?.accountRequest?.type ? (
              <View style={styles.currentRequestCard}>
                <Text style={styles.currentRequestTitle}>Current request</Text>
                <Text style={styles.currentRequestText}>
                  {customer.accountRequest.type === "delete" ? "Delete" : "Deactivate"} •{" "}
                  {customer.accountRequest.status ?? "pending"}
                </Text>
                {customer.accountRequest.requestedAt ? (
                  <Text style={styles.currentRequestMeta}>
                    Submitted {formatDateTimeAmPm(customer.accountRequest.requestedAt)}
                  </Text>
                ) : null}
                {customer.accountRequest.reason ? (
                  <Text style={styles.currentRequestReason}>{customer.accountRequest.reason}</Text>
                ) : null}
                {customer.accountRequest.reviewNote ? (
                  <Text style={styles.currentRequestReviewNote}>
                    Admin note: {customer.accountRequest.reviewNote}
                  </Text>
                ) : null}
                {customer.accountRequest.reviewedAt ? (
                  <Text style={styles.currentRequestMeta}>
                    Reviewed {formatDateTimeAmPm(customer.accountRequest.reviewedAt)}
                  </Text>
                ) : null}
                {(customer.accountRequest.history?.length ?? 0) > 0 ? (
                  <View style={styles.historyWrap}>
                    {customer.accountRequest.history
                      ?.slice()
                      .reverse()
                      .map((entry: AccountRequestHistoryEntry, index: number) => (
                        <View key={`${entry.action}-${entry.createdAt}-${index}`} style={styles.historyItem}>
                          <Text style={styles.historyTitle}>
                            {(entry.action ?? "updated").replace(/\b\w/g, (value: string) => value.toUpperCase())}
                          </Text>
                          <Text style={styles.historyMeta}>
                            {entry.actorName || "System"}
                            {entry.createdAt ? ` • ${formatDateTimeAmPm(entry.createdAt)}` : ""}
                          </Text>
                          {entry.note ? <Text style={styles.historyNote}>{entry.note}</Text> : null}
                        </View>
                      ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Reason (Optional)</Text>
              <TextInput
                value={reason}
                onChangeText={setReason}
                placeholder="Tell us anything helpful for this request"
                placeholderTextColor={palette.placeholder}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                style={styles.input}
              />
            </View>

            {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}

            <View style={styles.actionRow}>
              {hasPendingRequest ? (
                <Pressable
                  style={styles.secondaryButton}
                  onPress={handleCancel}
                  disabled={cancelRequestMutation.isPending || !isOnline}
                >
                  {cancelRequestMutation.isPending ? (
                    <ActivityIndicator size="small" color={palette.foreground} />
                  ) : (
                    <Text style={styles.secondaryButtonText}>Cancel pending request</Text>
                  )}
                </Pressable>
              ) : null}

              <Pressable
                style={[
                  styles.primaryButton,
                  requestMutation.isPending || !isOnline ? styles.primaryButtonDisabled : null,
                ]}
                onPress={handleSubmit}
                disabled={requestMutation.isPending || !isOnline}
              >
                {requestMutation.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    {hasPendingRequest ? "Replace request" : "Submit request"}
                  </Text>
                )}
              </Pressable>
            </View>
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
  heroCard: {
    overflow: "hidden",
    borderRadius: 30,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    padding: 22,
    gap: 14,
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
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "800",
    color: palette.foreground,
  },
  heroSubtitle: {
    fontSize: 14,
    lineHeight: 22,
    color: palette.mutedForeground,
  },
  pendingNotice: {
    borderRadius: 18,
    padding: 14,
    gap: 4,
    backgroundColor: palette.background,
    borderWidth: 1,
    borderColor: palette.border,
  },
  pendingNoticeTitle: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "800",
    color: palette.foreground,
  },
  pendingNoticeText: {
    fontSize: 13,
    lineHeight: 19,
    color: palette.mutedForeground,
  },
  formCard: {
    borderRadius: 28,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    padding: 20,
    gap: 16,
  },
  optionRow: {
    gap: 10,
  },
  optionCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.background,
    padding: 14,
    gap: 8,
  },
  optionCardActive: {
    borderColor: "#F2C2D5",
    backgroundColor: "#FFF8FB",
  },
  optionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  optionIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  optionTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    color: palette.foreground,
  },
  optionTitleActive: {
    color: palette.secondary,
  },
  optionText: {
    fontSize: 13,
    lineHeight: 19,
    color: palette.mutedForeground,
  },
  currentRequestCard: {
    borderRadius: 22,
    padding: 14,
    gap: 5,
    backgroundColor: "#FFF9FC",
    borderWidth: 1,
    borderColor: "#F4D3E1",
  },
  currentRequestTitle: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "800",
    color: palette.secondary,
  },
  currentRequestText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.foreground,
  },
  currentRequestMeta: {
    fontSize: 12,
    lineHeight: 16,
    color: palette.mutedForeground,
  },
  currentRequestReason: {
    fontSize: 12,
    lineHeight: 18,
    color: palette.foreground,
  },
  currentRequestReviewNote: {
    fontSize: 12,
    lineHeight: 18,
    color: palette.foreground,
    fontWeight: "700",
  },
  historyWrap: {
    marginTop: 6,
    gap: 8,
  },
  historyItem: {
    borderRadius: 16,
    padding: 10,
    gap: 2,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#F2E5EC",
  },
  historyTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    color: palette.foreground,
  },
  historyMeta: {
    fontSize: 11,
    lineHeight: 15,
    color: palette.mutedForeground,
  },
  historyNote: {
    fontSize: 12,
    lineHeight: 18,
    color: palette.foreground,
  },
  fieldGroup: { gap: 8 },
  label: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.foreground,
  },
  input: {
    minHeight: 110,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.background,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    lineHeight: 22,
    color: palette.foreground,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 18,
    color: "#C62828",
  },
  actionRow: {
    gap: 10,
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.background,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.foreground,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: 20,
    backgroundColor: palette.secondary,
    alignItems: "center",
    justifyContent: "center",
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
