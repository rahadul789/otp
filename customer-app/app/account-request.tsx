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

import { OfflineNoticeCard } from "@/src/components/offline-notice-card";
import { Screen } from "@/src/components/screen";
import {
  useCustomerAccountRequestMutation,
  useCustomerCancelAccountRequestMutation,
  useCustomerProfileQuery,
} from "@/src/hooks/use-customer-api";
import { useIsOnline } from "@/src/hooks/use-network-status";
import { getCustomerAuthErrorMessage } from "@/src/lib/auth-error-message";
import { formatDateTimeAmPm } from "@/src/lib/date-time";
import { useCustomerAuthStore } from "@/src/store/auth-store";
import { palette } from "@/src/theme/palette";

type AccountRequestHistoryEntry = {
  action?: string;
  note?: string;
  actorId?: string;
  actorName?: string;
  createdAt?: string | null;
};

type RequestType = "deactivate" | "delete";

const requestCopy: Record<
  RequestType,
  {
    title: string;
    description: string;
    icon: keyof typeof Ionicons.glyphMap;
    tint: string;
  }
> = {
  deactivate: {
    title: "Pause account access",
    description:
      "Temporarily disable your customer account. Your request can be reviewed and reversed.",
    icon: "pause-circle-outline",
    tint: "#FFF1E8",
  },
  delete: {
    title: "Request deletion",
    description:
      "Ask Foodbela to review permanent account deletion. Choose this only when you are sure.",
    icon: "trash-outline",
    tint: "#FFE7F1",
  },
};

function formatRequestType(type?: string | null) {
  return type === "delete" ? "Delete" : "Deactivate";
}

function formatStatus(status?: string | null) {
  if (!status) return "Pending";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatHistoryAction(action?: string) {
  return (action ?? "updated")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function AccountRequestScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const customer = useCustomerAuthStore((state) => state.customer);
  const isOnline = useIsOnline();
  useCustomerProfileQuery();
  const requestMutation = useCustomerAccountRequestMutation();
  const cancelRequestMutation = useCustomerCancelAccountRequestMutation();
  const [requestType, setRequestType] = useState<RequestType>("deactivate");
  const [reason, setReason] = useState("");
  const [errorText, setErrorText] = useState("");
  const selectedCopy = requestCopy[requestType];
  const hasPendingRequest =
    Boolean(customer?.accountRequest?.type) &&
    customer?.accountRequest?.status === "pending";

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
      setErrorText(
        getCustomerAuthErrorMessage(error, "Could not submit your request."),
      );
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
      setErrorText(
        getCustomerAuthErrorMessage(error, "Could not cancel your request."),
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
            { paddingTop: 8, paddingBottom: Math.max(insets.bottom, 16) + 64 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.topBar}>
            <Pressable onPress={() => router.back()} style={styles.iconButton}>
              <Ionicons
                name="chevron-back"
                size={20}
                color={palette.foreground}
              />
            </Pressable>
            <Text style={styles.topTitle}>Account requests</Text>
            <View style={styles.iconButtonGhost} />
          </View>

          {!isOnline ? (
            <OfflineNoticeCard description="You can review request details here. Reconnect to submit or cancel requests." />
          ) : null}

          <View style={styles.headerPanel}>
            <View style={styles.headerIcon}>
              <Ionicons
                name="shield-half-outline"
                size={24}
                color={palette.secondary}
              />
            </View>
            <Text style={styles.headerTitle}>Manage account status</Text>
            <Text style={styles.headerText}>
              Send a request to deactivate your account or ask for permanent
              deletion review.
            </Text>
            {hasPendingRequest ? (
              <View style={styles.pendingPill}>
                <Ionicons name="time-outline" size={14} color={palette.primary} />
                <Text style={styles.pendingPillText}>Request pending</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.requestPanel}>
            <Text style={styles.sectionTitle}>Request type</Text>
            <View style={styles.segmentedControl}>
              <Pressable
                style={[
                  styles.segmentButton,
                  requestType === "deactivate"
                    ? styles.segmentButtonActive
                    : null,
                ]}
                onPress={() => setRequestType("deactivate")}
              >
                <Ionicons
                  name="pause-circle-outline"
                  size={17}
                  color={
                    requestType === "deactivate"
                      ? palette.foreground
                      : palette.mutedForeground
                  }
                />
                <Text
                  style={[
                    styles.segmentText,
                    requestType === "deactivate"
                      ? styles.segmentTextActive
                      : null,
                  ]}
                >
                  Deactivate
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.segmentButton,
                  requestType === "delete" ? styles.segmentButtonActive : null,
                ]}
                onPress={() => setRequestType("delete")}
              >
                <Ionicons
                  name="trash-outline"
                  size={17}
                  color={
                    requestType === "delete"
                      ? palette.foreground
                      : palette.mutedForeground
                  }
                />
                <Text
                  style={[
                    styles.segmentText,
                    requestType === "delete" ? styles.segmentTextActive : null,
                  ]}
                >
                  Delete
                </Text>
              </Pressable>
            </View>

            <View style={styles.selectedRequestCard}>
              <View
                style={[
                  styles.selectedRequestIcon,
                  { backgroundColor: selectedCopy.tint },
                ]}
              >
                <Ionicons
                  name={selectedCopy.icon}
                  size={19}
                  color={palette.foreground}
                />
              </View>
              <View style={styles.selectedRequestCopy}>
                <Text style={styles.selectedRequestTitle}>
                  {selectedCopy.title}
                </Text>
                <Text style={styles.selectedRequestText}>
                  {selectedCopy.description}
                </Text>
              </View>
            </View>
          </View>

          {customer?.accountRequest?.type ? (
            <View style={styles.currentPanel}>
              <View style={styles.currentHeader}>
                <Text style={styles.sectionTitle}>Current request</Text>
                <View style={styles.statusBadge}>
                  <Text style={styles.statusBadgeText}>
                    {formatStatus(customer.accountRequest.status)}
                  </Text>
                </View>
              </View>

              <View style={styles.currentSummary}>
                <Text style={styles.currentType}>
                  {formatRequestType(customer.accountRequest.type)}
                </Text>
                {customer.accountRequest.requestedAt ? (
                  <Text style={styles.currentMeta}>
                    Submitted{" "}
                    {formatDateTimeAmPm(customer.accountRequest.requestedAt)}
                  </Text>
                ) : null}
                {customer.accountRequest.reason ? (
                  <Text style={styles.currentNote}>
                    {customer.accountRequest.reason}
                  </Text>
                ) : null}
                {customer.accountRequest.reviewNote ? (
                  <Text style={styles.currentReviewNote}>
                    Admin note: {customer.accountRequest.reviewNote}
                  </Text>
                ) : null}
                {customer.accountRequest.reviewedAt ? (
                  <Text style={styles.currentMeta}>
                    Reviewed{" "}
                    {formatDateTimeAmPm(customer.accountRequest.reviewedAt)}
                  </Text>
                ) : null}
              </View>

              {(customer.accountRequest.history?.length ?? 0) > 0 ? (
                <View style={styles.historyList}>
                  {customer.accountRequest.history
                    ?.slice()
                    .reverse()
                    .map((entry: AccountRequestHistoryEntry, index: number) => (
                      <View
                        key={`${entry.action}-${entry.createdAt}-${index}`}
                        style={styles.historyItem}
                      >
                        <View style={styles.historyDot} />
                        <View style={styles.historyCopy}>
                          <Text style={styles.historyTitle}>
                            {formatHistoryAction(entry.action)}
                          </Text>
                          <Text style={styles.historyMeta}>
                            {entry.actorName || "System"}
                            {entry.createdAt
                              ? ` - ${formatDateTimeAmPm(entry.createdAt)}`
                              : ""}
                          </Text>
                          {entry.note ? (
                            <Text style={styles.historyNote}>{entry.note}</Text>
                          ) : null}
                        </View>
                      </View>
                    ))}
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={styles.formPanel}>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Reason</Text>
              <TextInput
                value={reason}
                onChangeText={setReason}
                placeholder="Optional note for the review team"
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
                    <ActivityIndicator
                      size="small"
                      color={palette.foreground}
                    />
                  ) : (
                    <Text style={styles.secondaryButtonText}>Cancel request</Text>
                  )}
                </Pressable>
              ) : null}

              <Pressable
                style={[
                  styles.primaryButton,
                  requestMutation.isPending || !isOnline
                    ? styles.primaryButtonDisabled
                    : null,
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
    justifyContent: "space-between",
  },
  topTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
    color: palette.foreground,
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonGhost: {
    width: 42,
    height: 42,
  },
  headerPanel: {
    borderRadius: 28,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    padding: 20,
    gap: 12,
    shadowColor: palette.shadow,
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  headerIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFE7F1",
  },
  headerTitle: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "900",
    color: palette.foreground,
  },
  headerText: {
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "500",
    color: palette.mutedForeground,
  },
  pendingPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    backgroundColor: "#FFF1E8",
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  pendingPillText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    color: palette.foreground,
  },
  requestPanel: {
    borderRadius: 26,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    padding: 16,
    gap: 13,
  },
  sectionTitle: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "900",
    color: palette.foreground,
  },
  segmentedControl: {
    flexDirection: "row",
    gap: 8,
    borderRadius: 22,
    backgroundColor: palette.background,
    padding: 5,
  },
  segmentButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  segmentButtonActive: {
    backgroundColor: palette.surface,
    shadowColor: palette.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  segmentText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    color: palette.mutedForeground,
  },
  segmentTextActive: {
    color: palette.foreground,
  },
  selectedRequestCard: {
    flexDirection: "row",
    gap: 12,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.background,
    padding: 14,
  },
  selectedRequestIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  selectedRequestCopy: {
    flex: 1,
    gap: 4,
  },
  selectedRequestTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "900",
    color: palette.foreground,
  },
  selectedRequestText: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "500",
    color: palette.mutedForeground,
  },
  currentPanel: {
    borderRadius: 26,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    padding: 16,
    gap: 13,
  },
  currentHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  statusBadge: {
    borderRadius: 999,
    backgroundColor: "#EEF8F2",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusBadgeText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
    color: palette.foreground,
  },
  currentSummary: {
    borderRadius: 20,
    backgroundColor: palette.background,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 13,
    gap: 5,
  },
  currentType: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
    color: palette.foreground,
  },
  currentMeta: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
    color: palette.mutedForeground,
  },
  currentNote: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "500",
    color: palette.foreground,
  },
  currentReviewNote: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "700",
    color: palette.foreground,
  },
  historyList: {
    gap: 10,
  },
  historyItem: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
  },
  historyDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    backgroundColor: palette.secondary,
    marginTop: 6,
  },
  historyCopy: {
    flex: 1,
    gap: 2,
  },
  historyTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    color: palette.foreground,
  },
  historyMeta: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "600",
    color: palette.mutedForeground,
  },
  historyNote: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "500",
    color: palette.foreground,
  },
  formPanel: {
    borderRadius: 26,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    padding: 16,
    gap: 14,
  },
  fieldGroup: { gap: 8 },
  label: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    color: palette.foreground,
  },
  input: {
    minHeight: 112,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.background,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 15,
    lineHeight: 22,
    color: palette.foreground,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    color: "#C62828",
  },
  actionRow: {
    gap: 10,
  },
  secondaryButton: {
    minHeight: 50,
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
    fontWeight: "800",
    color: palette.foreground,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: 19,
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
    fontWeight: "900",
    color: "#fff",
  },
});
