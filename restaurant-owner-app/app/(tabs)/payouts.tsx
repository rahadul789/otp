import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { OwnerStatusBadge } from "@/src/components/owner-status-badge";
import { Screen } from "@/src/components/screen";
import { StatusPill } from "@/src/components/status-pill";
import { useOwnerPayoutSummaryQuery } from "@/src/hooks/use-owner-api";
import { formatCurrency } from "@/src/lib/format";
import { palette } from "@/src/theme/palette";

export default function PayoutsScreen() {
  const payoutQuery = useOwnerPayoutSummaryQuery();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const summary = payoutQuery.data;

  async function refreshPayouts() {
    setIsRefreshing(true);
    try {
      await payoutQuery.refetch();
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={refreshPayouts}
            tintColor={palette.primary}
          />
        }
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Payouts</Text>
            <Text style={styles.subtitle}>Track owner balance and settlement status.</Text>
          </View>
          <OwnerStatusBadge />
        </View>

        {payoutQuery.isLoading ? (
          <View style={styles.feedbackCard}>
            <ActivityIndicator size="small" color={palette.primary} />
            <Text style={styles.feedbackText}>Loading payout summary</Text>
          </View>
        ) : (
          <>
            <View style={styles.balanceCard}>
              <Text style={styles.balanceLabel}>Available balance</Text>
              <Text style={styles.balanceValue}>
                {formatCurrency(summary?.availableBalance)}
              </Text>
              <Text style={styles.balanceHint}>
                Pending balance clears after the settlement window.
              </Text>
            </View>

            <View style={styles.grid}>
              <SummaryTile
                label="Pending"
                value={formatCurrency(summary?.pendingBalance)}
                icon="time-outline"
              />
              <SummaryTile
                label="Requested"
                value={formatCurrency(summary?.requestedPayoutBalance)}
                icon="hourglass-outline"
              />
              <SummaryTile
                label="Paid out"
                value={formatCurrency(summary?.paidOutBalance)}
                icon="checkmark-done-outline"
              />
              <SummaryTile
                label="Lifetime"
                value={formatCurrency(summary?.lifetimeNetEarnings)}
                icon="trending-up-outline"
              />
            </View>

            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Payout method</Text>
                {summary?.payoutMethod?.isVerified ? (
                  <StatusPill label="Verified" tone="success" />
                ) : (
                  <StatusPill label="Web setup" tone="warning" />
                )}
              </View>
              {summary?.payoutMethod ? (
                <View style={styles.methodBody}>
                  <Text style={styles.methodTitle}>
                    {summary.payoutMethod.type === "bkash" ? "bKash" : "Bank"} -{" "}
                    {summary.payoutMethod.accountName}
                  </Text>
                  <Text style={styles.methodText}>
                    {summary.payoutMethod.accountNumber}
                    {summary.payoutMethod.bankName
                      ? ` - ${summary.payoutMethod.bankName}`
                      : ""}
                  </Text>
                </View>
              ) : (
                <Text style={styles.methodText}>
                  Add or edit payout details from the web dashboard.
                </Text>
              )}
            </View>

            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Last payout</Text>
                {summary?.lastPayout?.status ? (
                  <StatusPill label={summary.lastPayout.status} tone="info" />
                ) : null}
              </View>
              <Text style={styles.methodTitle}>
                {summary?.lastPayout
                  ? formatCurrency(summary.lastPayout.amount)
                  : "No payout yet"}
              </Text>
              <Text style={styles.methodText}>
                {summary?.lastPayout?.requestedAt
                  ? `Requested ${new Date(
                      summary.lastPayout.requestedAt,
                    ).toLocaleDateString()}`
                  : "Completed payouts will appear here."}
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function SummaryTile({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <View style={styles.tile}>
      <Ionicons name={icon} size={18} color={palette.primary} />
      <Text numberOfLines={1} style={styles.tileValue}>
        {value}
      </Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 18,
    gap: 14,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "900",
    color: palette.foreground,
  },
  subtitle: {
    marginTop: 3,
    maxWidth: 260,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
    color: palette.mutedForeground,
  },
  feedbackCard: {
    minHeight: 260,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: palette.surface,
  },
  feedbackText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.mutedForeground,
  },
  balanceCard: {
    borderRadius: 24,
    backgroundColor: palette.foreground,
    padding: 20,
    gap: 8,
    shadowColor: palette.shadow,
    shadowOpacity: 1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },
  balanceLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    color: "#F7D9CF",
    textTransform: "uppercase",
  },
  balanceValue: {
    fontSize: 31,
    lineHeight: 38,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  balanceHint: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
    color: "#F7D9CF",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  tile: {
    width: "48.5%",
    minHeight: 96,
    borderRadius: 18,
    backgroundColor: palette.surface,
    padding: 13,
    justifyContent: "center",
    gap: 5,
  },
  tileValue: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "900",
    color: palette.foreground,
  },
  tileLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
    color: palette.mutedForeground,
  },
  sectionCard: {
    borderRadius: 20,
    backgroundColor: palette.surface,
    padding: 15,
    gap: 10,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  sectionTitle: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "900",
    color: palette.foreground,
  },
  methodBody: {
    gap: 4,
  },
  methodTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "900",
    color: palette.foreground,
  },
  methodText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
    color: palette.mutedForeground,
  },
});
