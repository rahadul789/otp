import { Ionicons } from "@expo/vector-icons";
import LottieView from "lottie-react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { memo, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import { EmptyStateCard } from "@/src/components/empty-state-card";
import { LiveOrderMap } from "@/src/components/orders/live-order-map";
import { OfflineNoticeCard } from "@/src/components/offline-notice-card";
import {
  useCustomerOrderDetailsQuery,
  useCustomerRestaurantDetailsQuery,
} from "@/src/hooks/use-customer-api";
import { formatDateTimeAmPm, formatTimeAmPm } from "@/src/lib/date-time";
import { formatDistanceValue } from "@/src/lib/distance";
import { useIsOnline } from "@/src/hooks/use-network-status";
import { palette } from "@/src/theme/palette";

type CustomerOrderDetails = NonNullable<
  ReturnType<typeof useCustomerOrderDetailsQuery>["data"]
>;

type PreparationEstimate = {
  state: "countdown" | "almost_ready" | "delayed" | "ready";
  rangeLabel: string;
  supportingText: string;
  targetTimeLabel: string;
  lateByMinutes: number;
  averagePrepMinutes: number;
};

const PREPARATION_LIVE_STATUSES = new Set(["Accepted", "Preparing"]);
const PREPARATION_EARLY_FACTOR = 0.92;
const PREPARATION_LATE_FACTOR = 1.08;
const PREPARATION_TICK_MS = 15000;

function getPreparationAnchor(order: CustomerOrderDetails) {
  return (
    order.timestamps?.acceptedAt ??
    order.timestamps?.preparingAt ??
    order.timestamps?.placedAt ??
    order.createdAt
  );
}

function getPreparationEstimate(
  order: CustomerOrderDetails,
  preparationTimeMinutes: number | null | undefined,
  now: number,
): PreparationEstimate | null {
  if (!PREPARATION_LIVE_STATUSES.has(order.status)) {
    return null;
  }

  if (
    typeof preparationTimeMinutes !== "number" ||
    !Number.isFinite(preparationTimeMinutes) ||
    preparationTimeMinutes <= 0
  ) {
    return null;
  }

  const anchor = new Date(getPreparationAnchor(order)).getTime();
  if (Number.isNaN(anchor)) {
    return null;
  }

  const earliestMinutes = Math.max(
    3,
    Math.round(preparationTimeMinutes * PREPARATION_EARLY_FACTOR),
  );
  const latestMinutes = Math.max(
    earliestMinutes + 2,
    Math.round(preparationTimeMinutes * PREPARATION_LATE_FACTOR),
  );

  const earliestReadyAt = anchor + earliestMinutes * 60_000;
  const latestReadyAt = anchor + latestMinutes * 60_000;
  const minRemaining = Math.ceil((earliestReadyAt - now) / 60_000);
  const maxRemaining = Math.ceil((latestReadyAt - now) / 60_000);

  if (maxRemaining > 1) {
    return {
      state: "countdown",
      rangeLabel: `${Math.max(1, minRemaining)}-${Math.max(
        Math.max(1, minRemaining),
        maxRemaining,
      )} min left`,
      supportingText: "",
      targetTimeLabel: formatTimeAmPm(new Date(latestReadyAt)),
      lateByMinutes: 0,
      averagePrepMinutes: preparationTimeMinutes,
    };
  }

  if (latestReadyAt >= now) {
    return {
      state: "almost_ready",
      rangeLabel: "Almost ready",
      supportingText:
        "The kitchen is finishing your order now. Pickup should start shortly.",
      targetTimeLabel: formatTimeAmPm(new Date(latestReadyAt)),
      lateByMinutes: 0,
      averagePrepMinutes: preparationTimeMinutes,
    };
  }

  const lateByMinutes = Math.max(1, Math.ceil((now - latestReadyAt) / 60_000));

  return {
    state: "delayed",
    rangeLabel: `Running ${lateByMinutes} min late`,
    supportingText:
      lateByMinutes >= 10
        ? "This order is taking longer than the restaurant's usual prep window. Support can help if you need an update."
        : "The kitchen is taking a little longer than usual, but your order is still being finished.",
    targetTimeLabel: formatTimeAmPm(new Date(latestReadyAt)),
    lateByMinutes,
    averagePrepMinutes: preparationTimeMinutes,
  };
}

const PreparationRuntime = memo(function PreparationRuntime({
  order,
  preparationTimeMinutes,
  children,
}: {
  order: CustomerOrderDetails;
  preparationTimeMinutes?: number | null;
  children: (estimate: PreparationEstimate | null) => React.ReactNode;
}) {
  const shouldTrack = PREPARATION_LIVE_STATUSES.has(order.status);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!shouldTrack) {
      return;
    }

    const timer = setInterval(() => {
      setNow(Date.now());
    }, PREPARATION_TICK_MS);

    return () => {
      clearInterval(timer);
    };
  }, [shouldTrack]);

  const estimate = useMemo(
    () => getPreparationEstimate(order, preparationTimeMinutes, now),
    [now, order, preparationTimeMinutes],
  );

  return <>{children(estimate)}</>;
});

function getProgress(status: string) {
  switch (status) {
    case "New":
      return 0.12;
    case "Accepted":
      return 0.28;
    case "Preparing":
      return 0.52;
    case "ReadyForPickup":
      return 0.68;
    case "PickedUp":
      return 0.88;
    case "Delivered":
      return 1;
    default:
      return 0.1;
  }
}

const JOURNEY_STEPS = [
  { key: "New", label: "Order placed" },
  { key: "Accepted", label: "Accepted" },
  { key: "Preparing", label: "Preparing" },
  { key: "ReadyForPickup", label: "Ready for pickup" },
  { key: "PickedUp", label: "On the way" },
  { key: "Delivered", label: "Delivered" },
] as const;

function getJourneyIndex(status: string) {
  switch (status) {
    case "New":
      return 0;
    case "Accepted":
      return 1;
    case "Preparing":
      return 2;
    case "ReadyForPickup":
      return 3;
    case "PickedUp":
      return 4;
    case "Delivered":
      return 5;
    case "Cancelled":
    case "Rejected":
      return -1;
    default:
      return 0;
  }
}

function getTrackingState(order: CustomerOrderDetails) {
  const terminalReason = order.terminalReason ?? "";

  switch (order.status) {
    case "New":
      return {
        title: "Order placed",
        subtitle: "Waiting for restaurant confirmation.",
        icon: "receipt-outline" as const,
        tint: "#F3F7FF",
        accent: palette.sky,
      };
    case "Accepted":
      return {
        title: "Restaurant confirmed",
        subtitle: "Cooking will begin shortly.",
        icon: "checkmark-done-circle-outline" as const,
        tint: "#EEF4FF",
        accent: palette.sky,
      };
    case "Preparing":
      return {
        title: "Preparing your food",
        subtitle: "Live rider updates start after pickup.",
        icon: "restaurant-outline" as const,
        tint: "#FFF0F7",
        accent: palette.amber,
      };
    case "ReadyForPickup":
      return {
        title: "Ready for pickup",
        subtitle: "Waiting for rider pickup.",
        icon: "bag-handle-outline" as const,
        tint: "#FFF0F7",
        accent: palette.amber,
      };
    case "Delivered":
      return {
        title: "Delivered successfully",
        subtitle: "Delivered to your address.",
        icon: "checkmark-circle" as const,
        tint: palette.successSurface,
        accent: palette.successText,
      };
    case "Cancelled":
      if (order.cancelledBy === "customer") {
        return {
          title: "You cancelled this order",
          subtitle: "This order was cancelled before the restaurant accepted it.",
          icon: "close-circle-outline" as const,
          tint: "#F7F0EA",
          accent: palette.foreground,
        };
      }
      if (
        order.cancelledBy === "system" ||
        terminalReason === "system_auto_cancel_unaccepted" ||
        terminalReason.toLowerCase().includes("auto-cancel")
      ) {
        return {
          title: "Order auto-cancelled",
          subtitle: "The restaurant did not accept this order in time.",
          icon: "timer-outline" as const,
          tint: "#FFF7E8",
          accent: palette.amber,
        };
      }
      if (order.cancelledBy === "owner" || order.cancelledBy === "restaurant") {
        return {
          title: "Restaurant cancelled this order",
          subtitle: "The restaurant could not continue with this order.",
          icon: "storefront-outline" as const,
          tint: "#FFF0F6",
          accent: palette.primary,
        };
      }
      return {
        title: "This order was cancelled",
        subtitle: "This order is no longer active.",
        icon: "close-circle-outline" as const,
        tint: "#F7F0EA",
        accent: palette.foreground,
      };
    case "Rejected":
      return {
        title: "Restaurant could not accept this order",
        subtitle: terminalReason || "This order was not accepted.",
        icon: "storefront-outline" as const,
        tint: "#FFF0F6",
        accent: palette.primary,
      };
    default:
      return null;
  }
}

export default function OrderTrackingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ orderId?: string }>();
  const orderId =
    typeof params.orderId === "string" ? params.orderId : undefined;
  const orderQuery = useCustomerOrderDetailsQuery(orderId);
  const isOnline = useIsOnline();
  const order = orderQuery.data;
  const restaurantId = order?.restaurantId;
  const restaurantQuery = useCustomerRestaurantDetailsQuery({
    restaurantId: restaurantId ?? undefined,
  });
  const restaurant = restaurantQuery.data?.restaurant;
  const customerLocation =
    typeof order?.customerSnapshot?.deliveryAddress?.latitude === "number" &&
    typeof order?.customerSnapshot?.deliveryAddress?.longitude === "number"
      ? {
          latitude: order.customerSnapshot.deliveryAddress.latitude,
          longitude: order.customerSnapshot.deliveryAddress.longitude,
        }
      : null;
  const restaurantLocation =
    typeof restaurant?.location?.latitude === "number" &&
    typeof restaurant?.location?.longitude === "number"
      ? {
          latitude: restaurant.location.latitude,
          longitude: restaurant.location.longitude,
        }
      : null;
  const riderLocation =
    typeof order?.riderTracking?.currentLocation?.latitude === "number" &&
    typeof order?.riderTracking?.currentLocation?.longitude === "number"
      ? {
          latitude: order.riderTracking.currentLocation.latitude,
          longitude: order.riderTracking.currentLocation.longitude,
        }
      : null;

  const trackingDistance = useMemo(
    () =>
      formatDistanceValue(order?.riderTracking?.remainingDistanceKm ?? null),
    [order?.riderTracking?.remainingDistanceKm],
  );

  if (orderQuery.isLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.loadingWrap}>
          <View style={styles.loadingCard}>
            <ActivityIndicator size="small" color={palette.primary} />
            <Text style={styles.loadingTitle}>Loading live tracking</Text>
            <Text style={styles.loadingText}>
              Pulling your latest rider and delivery updates.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (orderQuery.isError || !order) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.emptyWrap}>
          <EmptyStateCard
            title="Tracking is unavailable"
            description="We could not load the live tracking screen right now."
            actionLabel="Back to orders"
            onPress={() => router.replace("/(tabs)/orders")}
          />
        </View>
      </SafeAreaView>
    );
  }

  const isTrackingStale = Boolean(order.riderTracking?.freshness?.isStale);
  const trackingState = getTrackingState(order);
  const remainingMinutes =
    order.riderTracking?.remainingDurationMinutes ?? null;
  const progress = getProgress(order.status);
  const statusTone =
    order.status === "Delivered"
      ? styles.statusPillSuccess
      : order.status === "PickedUp"
        ? styles.statusPillLive
        : styles.statusPillDefault;
  const statusTextTone =
    order.status === "Delivered"
      ? styles.statusPillTextSuccess
      : order.status === "PickedUp"
        ? styles.statusPillTextLive
        : null;
  const latestSignalTime = formatTimeAmPm(
    order.riderTracking?.lastUpdatedAt ?? order.createdAt,
  );
  const hasLiveRiderLocation = Boolean(riderLocation);
  const canShowLiveMap = order.status === "PickedUp" && hasLiveRiderLocation;
  const hasAssignedRider = Boolean(
    order.riderSnapshot?.name || order.riderSnapshot?.phone,
  );
  const journeyIndex = getJourneyIndex(order.status);
  const restaurantPreparationTimeMinutes =
    typeof restaurant?.preparationTimeMinutes === "number"
      ? restaurant.preparationTimeMinutes
      : null;
  const riderTitle =
    order.riderSnapshot?.name ||
    (order.status === "PickedUp"
      ? "Rider on the way"
      : "Waiting for assignment");
  const riderPhone = order.riderSnapshot?.phone?.trim() || "";
  const riderSubtitle =
    riderPhone ||
    (order.status === "PickedUp"
      ? hasLiveRiderLocation
        ? "Live updates are on."
        : "Waiting for the first location signal."
      : "Details appear after pickup.");
  const restaurantAddressText =
    typeof restaurant?.address === "string"
      ? restaurant.address
      : [restaurant?.address?.address, restaurant?.address?.city]
          .filter(Boolean)
          .join(", ") || "Restaurant pickup details will appear here.";
  const handleCallRider = () => {
    if (!riderPhone) {
      return;
    }

    void Linking.openURL(`tel:${riderPhone}`);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: 32 + Math.max(insets.bottom, 16) },
        ]}
      >
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Ionicons
              name="chevron-back"
              size={20}
              color={palette.foreground}
            />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.kicker}>Live tracking</Text>
            <Text style={styles.title}>{order.orderNumber}</Text>
            <Text style={styles.subtitle}>
              {order.customerSnapshot?.deliveryAddress?.label ||
                "Your delivery address"}
            </Text>
          </View>
        </View>

        {!isOnline ? (
          <View style={styles.offlineNoticeWrap}>
            <OfflineNoticeCard description="You're offline. Live rider movement is paused until your connection returns." />
          </View>
        ) : null}

        {order.status === "PickedUp" ? (
          <View
            style={[
              styles.networkHint,
              isTrackingStale
                ? styles.networkHintStale
                : styles.networkHintLive,
            ]}
          >
            <Ionicons
              name={
                hasLiveRiderLocation
                  ? isTrackingStale
                    ? "cloud-offline-outline"
                    : "radio-outline"
                  : "locate-outline"
              }
              size={18}
              color={
                hasLiveRiderLocation
                  ? isTrackingStale
                    ? "#B45309"
                    : palette.secondary
                  : palette.primary
              }
            />
            <View style={styles.networkHintCopy}>
              <Text style={styles.networkHintTitle}>
                {hasLiveRiderLocation
                  ? isTrackingStale
                    ? "Tracking paused"
                    : "Tracking live"
                  : "Waiting for rider location"}
              </Text>
              <Text style={styles.networkHintSubtitle}>
                {hasLiveRiderLocation
                  ? isTrackingStale
                    ? `Last rider signal ${latestSignalTime}. Updates will resume automatically.`
                    : `Last rider signal ${latestSignalTime}.`
                  : "Pickup completed. Waiting for the rider's first location signal."}
              </Text>
            </View>
          </View>
        ) : null}

        <View style={styles.trackingCard}>
          {canShowLiveMap ? (
            customerLocation ? (
              <LiveOrderMap
                customerLocation={customerLocation}
                restaurantLocation={restaurantLocation}
                riderLocation={riderLocation}
                status={order.status}
                riderAccentColor="#DDF6EE"
                riderName={order.riderSnapshot?.name || "Rider"}
                riderVehicleIcon="bicycle-outline"
              />
            ) : (
              <View style={[styles.stateCard, { backgroundColor: "#F3F7FF" }]}>
                <View
                  style={[
                    styles.stateIconWrap,
                    { backgroundColor: "#FFFFFFA8" },
                  ]}
                >
                  <Ionicons name="map-outline" size={20} color={palette.sky} />
                </View>
                <Text style={styles.stateTitle}>Live tracking unavailable</Text>
                <Text style={styles.stateSubtitle}>
                  Customer location is unavailable for this order.
                </Text>
              </View>
            )
          ) : order.status === "PickedUp" ? (
            <View style={styles.pickupWaitingCard}>
              <View style={styles.pickupWaitingPill}>
                <Ionicons
                  name="locate-outline"
                  size={14}
                  color={palette.primary}
                />
                <Text style={styles.pickupWaitingPillText}>
                  Waiting for live tracking
                </Text>
              </View>
              <LottieView
                autoPlay
                loop
                source={require("../../../assets/animations/delivery-boy.json")}
                style={styles.pickupWaitingAnimation}
              />
              <Text style={styles.pickupWaitingTitle}>
                The rider already picked up your order
              </Text>
              {/* <Text style={styles.pickupWaitingSubtitle}>
                We will show the map as soon as the rider starts sharing a real
                location signal.
              </Text> */}
            </View>
          ) : order.status === "New" ? (
            <View style={styles.waitingCard}>
              <View style={styles.waitingPill}>
                <Ionicons name="time-outline" size={14} color={palette.sky} />
                <Text style={styles.waitingPillText}>
                  Waiting for restaurant confirmation
                </Text>
              </View>
              <Text style={styles.waitingSubtitle}>
                The restaurant is reviewing your order.
              </Text>
              <LottieView
                autoPlay
                loop
                source={require("../../../assets/animations/waiting.json")}
                style={styles.waitingAnimation}
              />
            </View>
          ) : order.status === "Accepted" ? (
            <View style={styles.confirmedCard}>
              <View style={styles.confirmedPill}>
                <Ionicons
                  name="checkmark-done-circle-outline"
                  size={14}
                  color={palette.sky}
                />
                <Text style={styles.confirmedPillText}>
                  Restaurant confirmed your order
                </Text>
              </View>
              <Text style={styles.confirmedSubtitle}>
                The kitchen has queued your order.
              </Text>
              <PreparationRuntime
                order={order}
                preparationTimeMinutes={restaurantPreparationTimeMinutes}
              >
                {(estimate) =>
                  estimate ? (
                    <View style={styles.prepEtaCallout}>
                      <Text style={styles.prepEtaTitle}>
                        {estimate.rangeLabel}
                      </Text>
                      <Text style={styles.prepEtaSubtitle}>
                        Ready around {estimate.targetTimeLabel}
                      </Text>
                    </View>
                  ) : null
                }
              </PreparationRuntime>
              <View style={styles.confirmedBadge}>
                <Ionicons
                  name="restaurant-outline"
                  size={28}
                  color={palette.sky}
                />
              </View>
            </View>
          ) : order.status === "Preparing" ? (
            <View style={styles.preparingCard}>
              <View style={styles.preparingPill}>
                <Ionicons
                  name="sparkles-outline"
                  size={14}
                  color={palette.amber}
                />
                <Text style={styles.preparingPillText}>
                  Your food is preparing
                </Text>
              </View>
              <LottieView
                autoPlay
                loop
                source={require("../../../assets/animations/Preparing_food.json")}
                style={styles.preparingAnimation}
              />
              <PreparationRuntime
                order={order}
                preparationTimeMinutes={restaurantPreparationTimeMinutes}
              >
                {(estimate) => (
                  <>
                    <Text style={styles.preparingRange}>
                      {estimate?.rangeLabel ??
                        (remainingMinutes !== null
                          ? `${Math.max(remainingMinutes, 1)} min left`
                          : "Preparing now")}
                    </Text>
                    <Text style={styles.preparingRangeMeta}>
                      {estimate?.supportingText ??
                        "Live rider updates start after pickup."}
                    </Text>
                    {estimate?.state === "delayed" &&
                    estimate.lateByMinutes >= 10 ? (
                      <Pressable
                        style={styles.supportButton}
                        onPress={() => router.push("/support-chat")}
                      >
                        <Ionicons
                          name="chatbubble-ellipses-outline"
                          size={14}
                          color={palette.foreground}
                        />
                        <Text style={styles.supportButtonText}>
                          Contact support
                        </Text>
                      </Pressable>
                    ) : null}
                  </>
                )}
              </PreparationRuntime>
            </View>
          ) : order.status === "ReadyForPickup" ? (
            <View style={styles.readyPickupCard}>
              <View style={styles.readyPickupPill}>
                <Ionicons
                  name="bicycle-outline"
                  size={14}
                  color={palette.primary}
                />
                <Text style={styles.readyPickupPillText}>
                  {hasAssignedRider
                    ? "Rider assigned for pickup"
                    : "Waiting for rider assignment"}
                </Text>
              </View>
              {hasAssignedRider ? (
                <View style={styles.readyPickupAssignedChip}>
                  <View style={styles.readyPickupAssignedAvatar}>
                    <Ionicons
                      name="person-outline"
                      size={14}
                      color={palette.foreground}
                    />
                  </View>
                  <View style={styles.readyPickupAssignedCopy}>
                    <Text style={styles.readyPickupAssignedLabel}>
                      Assigned rider
                    </Text>
                    <View style={styles.readyPickupAssignedMetaRow}>
                      <Text style={styles.readyPickupAssignedValue}>
                        {order.riderSnapshot?.name || "Rider assigned"}
                        {riderPhone ? ` • ${riderPhone}` : ""}
                      </Text>
                      {riderPhone ? (
                        <Pressable
                          style={styles.callButton}
                          onPress={handleCallRider}
                        >
                          <Ionicons
                            name="call-outline"
                            size={14}
                            color={palette.foreground}
                          />
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                </View>
              ) : null}
              <LottieView
                autoPlay
                loop
                source={require("../../../assets/animations/delivery-boy.json")}
                style={styles.readyPickupAnimation}
              />
              <Text style={styles.readyPickupMeta}>
                {hasAssignedRider
                  ? `${riderTitle} will start moving after pickup`
                  : "Pickup is being coordinated"}
              </Text>
            </View>
          ) : trackingState ? (
            <View
              style={[
                styles.stateCard,
                { backgroundColor: trackingState.tint },
              ]}
            >
              <View
                style={[styles.stateIconWrap, { backgroundColor: "#FFFFFFA8" }]}
              >
                <Ionicons
                  name={trackingState.icon}
                  size={20}
                  color={trackingState.accent}
                />
              </View>
              <Text style={styles.stateTitle}>{trackingState.title}</Text>
              <Text style={styles.stateSubtitle}>{trackingState.subtitle}</Text>
            </View>
          ) : null}
        </View>

        {journeyIndex >= 0 ? (
          <View style={styles.journeyCard}>
            <Text style={styles.journeyTitle}>Order journey</Text>

            <View style={styles.journeyRow}>
              {JOURNEY_STEPS.map((step, index) => {
                const isCompleted = index < journeyIndex;
                const isCurrent = index === journeyIndex;

                return (
                  <View key={step.key} style={styles.journeyStep}>
                    <View style={styles.journeyMarkerRow}>
                      <View
                        style={[
                          styles.journeyMarker,
                          isCompleted ? styles.journeyMarkerDone : null,
                          isCurrent ? styles.journeyMarkerCurrent : null,
                        ]}
                      >
                        <Text
                          style={[
                            styles.journeyMarkerText,
                            isCompleted
                              ? styles.journeyMarkerTextOnSolid
                              : null,
                            isCurrent ? styles.journeyMarkerTextCurrent : null,
                          ]}
                        >
                          {index + 1}
                        </Text>
                      </View>
                      {index < JOURNEY_STEPS.length - 1 ? (
                        <View
                          style={[
                            styles.journeyLine,
                            index < journeyIndex
                              ? styles.journeyLineDone
                              : null,
                          ]}
                        />
                      ) : null}
                    </View>
                    <Text
                      style={[
                        styles.journeyStepLabel,
                        isCompleted || isCurrent
                          ? styles.journeyStepLabelActive
                          : null,
                      ]}
                    >
                      {step.label}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        <View style={styles.summaryCard}>
          <View style={styles.summaryTopRow}>
            <View style={styles.summaryBadge}>
              <Ionicons
                name="receipt-outline"
                size={18}
                color={palette.primary}
              />
            </View>
            <View style={styles.summaryCopy}>
              <View style={[styles.statusPill, statusTone]}>
                <Text style={[styles.statusPillText, statusTextTone]}>
                  {order.status}
                </Text>
              </View>
              <Text style={styles.summaryMeta}>
                Placed {formatDateTimeAmPm(order.createdAt)}
              </Text>
            </View>
          </View>

          <View style={styles.metricRow}>
            <PreparationRuntime
              order={order}
              preparationTimeMinutes={restaurantPreparationTimeMinutes}
            >
              {(estimate) => (
                <View style={styles.metricPill}>
                  <Text style={styles.metricValue}>
                    {order.status === "Delivered"
                      ? "Delivered"
                      : order.status === "PickedUp"
                        ? remainingMinutes !== null
                          ? `${Math.max(remainingMinutes, 1)} min`
                          : "Updating"
                        : (estimate?.rangeLabel ??
                          (remainingMinutes !== null
                            ? `${Math.max(remainingMinutes, 1)} min`
                            : "Updating"))}
                  </Text>
                  <Text style={styles.metricLabel}>
                    {order.status === "Delivered"
                      ? "Status"
                      : order.status === "PickedUp"
                        ? "Arrival estimate"
                        : estimate?.state === "delayed"
                          ? "Kitchen delay"
                          : "Kitchen estimate"}
                  </Text>
                </View>
              )}
            </PreparationRuntime>
            <View style={styles.metricPill}>
              <Text style={styles.metricValue}>
                {order.status === "PickedUp"
                  ? trackingDistance ||
                    formatTimeAmPm(
                      order.riderTracking?.lastUpdatedAt ?? order.createdAt,
                    )
                  : restaurantPreparationTimeMinutes !== null
                    ? `${restaurantPreparationTimeMinutes} min`
                    : formatTimeAmPm(
                        order.riderTracking?.lastUpdatedAt ?? order.createdAt,
                      )}
              </Text>
              <Text style={styles.metricLabel}>
                {order.status === "PickedUp"
                  ? trackingDistance
                    ? "Remaining distance"
                    : "Latest signal"
                  : "Avg prep time"}
              </Text>
            </View>
          </View>

          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${Math.max(10, Math.round(progress * 100))}%`,
                  backgroundColor:
                    order.status === "Delivered"
                      ? palette.successText
                      : palette.secondary,
                },
              ]}
            />
          </View>

          <PreparationRuntime
            order={order}
            preparationTimeMinutes={restaurantPreparationTimeMinutes}
          >
            {(estimate) => (
              <View style={styles.summaryFooter}>
                <View
                  style={[
                    styles.summaryFooterChip,
                    estimate?.state === "delayed"
                      ? styles.summaryFooterChipWarning
                      : null,
                  ]}
                >
                  <Ionicons
                    name={
                      order.status === "PickedUp"
                        ? "time-outline"
                        : estimate?.state === "delayed"
                          ? "alert-circle-outline"
                          : "restaurant-outline"
                    }
                    size={14}
                    color={
                      estimate?.state === "delayed"
                        ? "#B45309"
                        : palette.mutedForeground
                    }
                  />
                  <Text
                    style={[
                      styles.summaryFooterText,
                      estimate?.state === "delayed"
                        ? styles.summaryFooterTextWarning
                        : null,
                    ]}
                  >
                    {order.status === "PickedUp"
                      ? `Last update ${latestSignalTime}`
                      : estimate?.state === "delayed"
                        ? "Prep is taking longer than usual."
                        : estimate
                          ? `Ready around ${estimate.targetTimeLabel}`
                          : `Last update ${latestSignalTime}`}
                  </Text>
                </View>
                <Pressable
                  style={styles.summaryFooterButton}
                  onPress={() =>
                    router.push({
                      pathname: "/orders/[orderId]",
                      params: { orderId: order._id },
                    })
                  }
                >
                  <Text style={styles.summaryFooterButtonText}>
                    Open details
                  </Text>
                  <Ionicons
                    name="arrow-forward"
                    size={14}
                    color={palette.foreground}
                  />
                </Pressable>
              </View>
            )}
          </PreparationRuntime>
        </View>

        <View style={styles.routeCard}>
          <View style={styles.routeHeader}>
            <Text style={styles.routeTitle}>Delivery route</Text>
          </View>

          <View style={styles.routeSteps}>
            <View style={styles.routeRail}>
              <View style={styles.routeDotPrimary} />
              <View style={styles.routeLine} />
              <View style={styles.routeDotSecondary} />
            </View>

            <View style={styles.routeStops}>
              <View style={styles.routeStop}>
                <Text style={styles.routeStopLabel}>Pickup from</Text>
                <Text style={styles.routeStopTitle}>
                  {restaurant?.name || "Restaurant"}
                </Text>
                <Text style={styles.routeStopMeta}>
                  {restaurantAddressText}
                </Text>
              </View>

              <View style={styles.routeStop}>
                <Text style={styles.routeStopLabel}>Deliver to</Text>
                <Text style={styles.routeStopTitle}>
                  {order.customerSnapshot?.deliveryAddress?.label ||
                    "Selected location"}
                </Text>
                <Text style={styles.routeStopMeta}>
                  {order.customerSnapshot?.deliveryAddress?.addressLine ||
                    "Delivery address unavailable"}
                </Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.infoGrid}>
          <View style={[styles.infoCard, styles.infoCardHalf]}>
            <View style={styles.infoRow}>
              <Ionicons
                name={
                  order.status === "PickedUp"
                    ? "bicycle-outline"
                    : "restaurant-outline"
                }
                size={16}
                color={palette.foreground}
              />
              <View style={styles.infoCopy}>
                {order.status === "PickedUp" ? (
                  <>
                    <Text style={styles.infoLabel}>Rider</Text>
                    <Text style={styles.infoValue}>{riderTitle}</Text>
                    <View style={styles.infoMetaRow}>
                      <Text style={[styles.infoMeta, styles.infoMetaFlexible]}>
                        {riderSubtitle}
                      </Text>
                      {riderPhone ? (
                        <Pressable
                          style={styles.callButton}
                          onPress={handleCallRider}
                        >
                          <Ionicons
                            name="call-outline"
                            size={14}
                            color={palette.foreground}
                          />
                        </Pressable>
                      ) : null}
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={styles.infoLabel}>Kitchen timing</Text>
                    <Text style={styles.infoValue}>
                      {restaurantPreparationTimeMinutes !== null
                        ? `${restaurantPreparationTimeMinutes} min average`
                        : "Average prep time unavailable"}
                    </Text>
                    <PreparationRuntime
                      order={order}
                      preparationTimeMinutes={restaurantPreparationTimeMinutes}
                    >
                      {(estimate) => (
                        <Text style={styles.infoMeta}>
                          {estimate?.state === "delayed"
                            ? "Running behind usual prep time."
                            : estimate?.state === "almost_ready"
                              ? "Finishing up now."
                              : estimate?.state === "countdown"
                                ? `Expected ready around ${estimate.targetTimeLabel}.`
                                : "Timing updates will appear here."}
                        </Text>
                      )}
                    </PreparationRuntime>
                  </>
                )}
              </View>
            </View>
          </View>

          <View style={[styles.infoCard, styles.infoCardHalf]}>
            <View style={styles.infoRow}>
              <Ionicons
                name="card-outline"
                size={16}
                color={palette.secondary}
              />
              <View style={styles.infoCopy}>
                <Text style={styles.infoLabel}>Payment</Text>
                <Text style={styles.infoValue}>{order.paymentMethod}</Text>
                <Text style={styles.infoMeta}>
                  {typeof order.pricing?.total === "number"
                    ? `BDT ${order.pricing.total.toFixed(2)} total`
                    : "Payment summary available in order details"}
                </Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.actionsCard}>
          <Pressable
            style={styles.primaryButton}
            onPress={() =>
              router.push({
                pathname: "/orders/[orderId]",
                params: { orderId: order._id },
              })
            }
          >
            <Ionicons
              name="receipt-outline"
              size={18}
              color={palette.background}
            />
            <Text style={styles.primaryButtonText}>Open order details</Text>
          </Pressable>

          <Pressable
            style={styles.secondaryButton}
            onPress={() => router.replace("/(tabs)/orders")}
          >
            <Ionicons
              name="albums-outline"
              size={16}
              color={palette.foreground}
            />
            <Text style={styles.secondaryButtonText}>See all orders</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.background,
  },
  content: {
    gap: 14,
    paddingBottom: 32,
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 8,
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  liveBadge: {
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  liveBadgeText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    color: palette.primary,
  },
  liveBadgeTextLive: {
    color: palette.secondary,
  },
  kicker: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: palette.primary,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "800",
    color: palette.foreground,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    color: palette.mutedForeground,
  },
  summaryCard: {
    marginHorizontal: 18,
    padding: 16,
    borderRadius: 26,
    backgroundColor: palette.surface,
    gap: 12,
    shadowColor: palette.shadow,
    shadowOpacity: 0.9,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },
  summaryTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  summaryBadge: {
    width: 58,
    height: 58,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.primarySoft,
  },
  summaryCopy: {
    flex: 1,
    gap: 6,
  },
  statusPill: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  statusPillDefault: {
    backgroundColor: palette.primarySoft,
  },
  statusPillLive: {
    backgroundColor: "#EEF4FF",
  },
  statusPillSuccess: {
    backgroundColor: palette.successSurface,
  },
  statusPillText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
    color: palette.primary,
  },
  statusPillTextLive: {
    color: palette.sky,
  },
  statusPillTextSuccess: {
    color: palette.successText,
  },
  summaryMeta: {
    fontSize: 13,
    lineHeight: 18,
    color: palette.mutedForeground,
  },
  metricRow: {
    flexDirection: "row",
    gap: 8,
  },
  metricPill: {
    flex: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: palette.surfaceMuted,
    gap: 2,
  },
  metricValue: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
    color: palette.foreground,
  },
  metricLabel: {
    fontSize: 12,
    lineHeight: 16,
    color: palette.mutedForeground,
    fontWeight: "600",
  },
  progressTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: palette.surfaceMuted,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
  },
  summaryFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  summaryFooterChip: {
    flex: 1,
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: palette.surfaceMuted,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  summaryFooterChipWarning: {
    backgroundColor: "#FFF7ED",
  },
  summaryFooterText: {
    fontSize: 12,
    lineHeight: 16,
    color: palette.mutedForeground,
    fontWeight: "600",
  },
  summaryFooterTextWarning: {
    color: "#92400E",
  },
  summaryFooterButton: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "#F8F1FF",
    borderWidth: 1,
    borderColor: "#EBD9FF",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  summaryFooterButtonText: {
    fontSize: 12,
    lineHeight: 16,
    color: palette.foreground,
    fontWeight: "700",
  },
  networkHint: {
    marginHorizontal: 18,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: "row",
    gap: 10,
  },
  networkHintLive: {
    backgroundColor: "#F8F1FF",
    borderColor: "#EBD9FF",
  },
  networkHintStale: {
    backgroundColor: "#FFF7ED",
    borderColor: "#F6D6A5",
  },
  networkHintCopy: {
    flex: 1,
    gap: 2,
  },
  networkHintTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    color: palette.foreground,
  },
  networkHintSubtitle: {
    fontSize: 12,
    lineHeight: 18,
    color: palette.mutedForeground,
  },
  offlineNoticeWrap: {
    marginHorizontal: 18,
  },
  trackingCard: {
    marginHorizontal: 18,
    borderRadius: 28,
    overflow: "hidden",
  },
  journeyCard: {
    marginHorizontal: 18,
    borderRadius: 22,
    backgroundColor: palette.surface,
    paddingHorizontal: 15,
    paddingVertical: 14,
    gap: 12,
    shadowColor: palette.shadow,
    shadowOpacity: 0.72,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  journeyTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "800",
    color: palette.foreground,
  },
  journeyHint: {
    fontSize: 12,
    lineHeight: 16,
    color: palette.mutedForeground,
  },
  journeyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  journeyStep: {
    flex: 1,
    gap: 8,
  },
  journeyMarkerRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  journeyMarker: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceMuted,
    borderWidth: 1,
    borderColor: "#E7DAD3",
  },
  journeyMarkerDone: {
    backgroundColor: palette.secondary,
    borderColor: palette.secondary,
  },
  journeyMarkerCurrent: {
    backgroundColor: "#FFF7FA",
    borderColor: palette.secondary,
  },
  journeyMarkerText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    color: palette.mutedForeground,
  },
  journeyMarkerTextOnSolid: {
    color: "#fff",
  },
  journeyMarkerTextCurrent: {
    color: palette.secondary,
  },
  journeyLine: {
    flex: 1,
    height: 2,
    marginHorizontal: 6,
    backgroundColor: "#EADFD9",
  },
  journeyLineDone: {
    backgroundColor: palette.secondary,
  },
  journeyStepLabel: {
    fontSize: 11,
    lineHeight: 15,
    color: palette.mutedForeground,
    fontWeight: "700",
    maxWidth: 58,
  },
  journeyStepLabelActive: {
    color: palette.foreground,
  },
  waitingCard: {
    minHeight: 300,
    borderRadius: 28,
    backgroundColor: "#F3F7FF",
    paddingHorizontal: 20,
    paddingVertical: 18,
    alignItems: "center",
    gap: 10,
  },
  waitingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#FFFFFFCC",
  },
  waitingPillText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
    color: palette.sky,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  waitingSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: palette.mutedForeground,
    textAlign: "center",
    maxWidth: 280,
  },
  waitingAnimation: {
    width: "100%",
    height: 200,
  },
  confirmedCard: {
    minHeight: 288,
    borderRadius: 28,
    backgroundColor: "#EEF4FF",
    paddingHorizontal: 20,
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  confirmedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#FFFFFFCC",
  },
  confirmedPillText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
    color: palette.sky,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  confirmedSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: palette.mutedForeground,
    textAlign: "center",
    maxWidth: 280,
  },
  prepEtaCallout: {
    minWidth: 156,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFFCC",
    gap: 2,
  },
  prepEtaTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "800",
    color: palette.foreground,
  },
  prepEtaSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    color: palette.mutedForeground,
  },
  confirmedBadge: {
    width: 86,
    height: 86,
    borderRadius: 43,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFFB8",
  },
  preparingCard: {
    minHeight: 304,
    borderRadius: 28,
    backgroundColor: "#FFF0F7",
    paddingHorizontal: 20,
    paddingVertical: 18,
    alignItems: "center",
    gap: 10,
  },
  preparingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#FFFFFFCC",
  },
  preparingPillText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
    color: "#D97706",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  preparingAnimation: {
    width: "100%",
    height: 190,
  },
  preparingRange: {
    fontSize: 28,
    lineHeight: 30,
    fontWeight: "800",
    color: palette.primary,
  },
  preparingRangeMeta: {
    maxWidth: 280,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
    color: palette.mutedForeground,
    textAlign: "center",
  },
  supportButton: {
    minHeight: 38,
    marginTop: 4,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: "#FFFFFFD9",
    borderWidth: 1,
    borderColor: "#F3D2E0",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  supportButtonText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.foreground,
  },
  readyPickupCard: {
    minHeight: 304,
    borderRadius: 28,
    backgroundColor: "#FFF6F1",
    paddingHorizontal: 20,
    paddingVertical: 18,
    alignItems: "center",
    gap: 10,
  },
  readyPickupPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#FFFFFFCC",
  },
  readyPickupPillText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
    color: palette.primary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  readyPickupSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: palette.mutedForeground,
    textAlign: "center",
    maxWidth: 290,
  },
  readyPickupAssignedChip: {
    width: "100%",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#FFFFFFD6",
    borderWidth: 1,
    borderColor: "#F2D7C8",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  readyPickupAssignedAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F7E6DC",
  },
  readyPickupAssignedCopy: {
    flex: 1,
    gap: 2,
  },
  readyPickupAssignedMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  readyPickupAssignedLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
    color: palette.primary,
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  readyPickupAssignedValue: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.foreground,
  },
  readyPickupAnimation: {
    width: "100%",
    height: 190,
  },
  readyPickupMeta: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "700",
    color: palette.foreground,
    textAlign: "center",
  },
  pickupWaitingCard: {
    minHeight: 320,
    borderRadius: 28,
    backgroundColor: "#FFF6F1",
    paddingHorizontal: 20,
    paddingVertical: 20,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  pickupWaitingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#FFFFFFCC",
  },
  pickupWaitingPillText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
    color: palette.primary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  pickupWaitingAnimation: {
    width: "100%",
    height: 170,
  },
  pickupWaitingTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "800",
    color: palette.foreground,
    textAlign: "center",
  },
  pickupWaitingSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: palette.mutedForeground,
    textAlign: "center",
    maxWidth: 300,
  },
  pickupWaitingMeta: {
    fontSize: 12,
    lineHeight: 18,
    color: palette.primary,
    fontWeight: "700",
    textAlign: "center",
  },
  stateCard: {
    minHeight: 240,
    borderRadius: 28,
    paddingHorizontal: 24,
    paddingVertical: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  stateIconWrap: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
  },
  stateTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "800",
    color: palette.foreground,
    textAlign: "center",
  },
  stateSubtitle: {
    fontSize: 14,
    lineHeight: 22,
    color: palette.mutedForeground,
    textAlign: "center",
  },
  routeCard: {
    marginHorizontal: 18,
    borderRadius: 22,
    backgroundColor: palette.surface,
    padding: 16,
    gap: 14,
    shadowColor: palette.shadow,
    shadowOpacity: 0.75,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  routeHeader: {
    gap: 2,
  },
  routeTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "800",
    color: palette.foreground,
  },
  routeSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    color: palette.mutedForeground,
  },
  routeSteps: {
    flexDirection: "row",
    gap: 10,
  },
  routeRail: {
    width: 18,
    alignItems: "center",
    paddingTop: 6,
  },
  routeDotPrimary: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: palette.primary,
  },
  routeLine: {
    width: 2,
    flex: 1,
    marginVertical: 6,
    backgroundColor: "#F0E7DF",
  },
  routeDotSecondary: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: palette.secondary,
  },
  routeStops: {
    flex: 1,
    gap: 14,
  },
  routeStop: {
    gap: 2,
  },
  routeStopLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: palette.primary,
  },
  routeStopTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
    color: palette.foreground,
  },
  routeStopMeta: {
    fontSize: 12,
    lineHeight: 18,
    color: palette.mutedForeground,
  },
  infoGrid: {
    marginHorizontal: 18,
    gap: 10,
  },
  infoCard: {
    borderRadius: 22,
    backgroundColor: palette.surface,
    padding: 14,
    gap: 12,
    shadowColor: palette.shadow,
    shadowOpacity: 0.75,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  infoCardHalf: {
    marginHorizontal: 0,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  infoCopy: {
    flex: 1,
    gap: 2,
  },
  infoMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  infoMetaFlexible: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
    color: palette.primary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  infoValue: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    color: palette.foreground,
  },
  infoMeta: {
    fontSize: 12,
    lineHeight: 18,
    color: palette.mutedForeground,
  },
  callButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF7FA",
    borderWidth: 1,
    borderColor: "#F3D2E0",
  },
  actionsCard: {
    marginHorizontal: 18,
    backgroundColor: palette.surface,
    borderRadius: 22,
    padding: 14,
    gap: 10,
    shadowColor: palette.shadow,
    shadowOpacity: 0.75,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: 999,
    backgroundColor: palette.foreground,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryButtonText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    color: palette.background,
  },
  secondaryButton: {
    minHeight: 46,
    borderRadius: 999,
    backgroundColor: palette.surfaceMuted,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  secondaryButtonText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.foreground,
  },
  loadingWrap: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  loadingCard: {
    borderRadius: 28,
    backgroundColor: palette.surface,
    paddingHorizontal: 22,
    paddingVertical: 24,
    alignItems: "center",
    gap: 10,
  },
  loadingTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "800",
    color: palette.foreground,
  },
  loadingText: {
    fontSize: 14,
    lineHeight: 22,
    color: palette.mutedForeground,
    textAlign: "center",
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
});
