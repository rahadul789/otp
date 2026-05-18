import { Ionicons } from "@expo/vector-icons";
import LottieView from "lottie-react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import { EmptyStateCard } from "@/src/components/empty-state-card";
import { LiveOrderMap } from "@/src/components/orders/live-order-map";
import { styles } from "@/src/components/orders/order-tracking.styles";
import { PreparationRuntime } from "@/src/components/orders/preparation-runtime";
import { ReorderCartSwitchModal } from "@/src/components/orders/reorder-cart-switch-modal";
import { OfflineNoticeCard } from "@/src/components/offline-notice-card";
import {
  useCustomerOrderDetailsQuery,
  useCustomerReorderMutation,
  useCustomerRestaurantDetailsQuery,
  useCustomerReviewMutation,
} from "@/src/hooks/use-customer-api";
import { formatCurrency } from "@/src/lib/currency";
import {
  getCustomerOrderStatusMeta,
  getLiveOrderJourneyIndex,
  getLiveOrderTrackingState,
  LIVE_ORDER_JOURNEY_STEPS,
} from "@/src/lib/customer-order-display";
import {
  formatDateMedium,
  formatDurationMinutes,
  formatTimeAmPm,
} from "@/src/lib/date-time";
import { formatCustomerAddressLine } from "@/src/lib/location-address";
import { formatShortOrderIdLabel } from "@/src/lib/order-id";
import { useIsOnline } from "@/src/hooks/use-network-status";
import { useAppBannerStore } from "@/src/store/app-banner-store";
import { palette } from "@/src/theme/palette";

type OrderTimelineSource = {
  createdAt?: string;
  history?: { status: string; createdAt?: string | null }[];
  timestamps?: {
    placedAt?: string;
    acceptedAt?: string;
    preparingAt?: string;
    readyForPickupAt?: string;
    pickedUpAt?: string;
    deliveredAt?: string;
    cancelledAt?: string;
  };
};

const TIMESTAMP_KEY_BY_STATUS = {
  New: "placedAt",
  Accepted: "acceptedAt",
  Preparing: "preparingAt",
  ReadyForPickup: "readyForPickupAt",
  PickedUp: "pickedUpAt",
  Delivered: "deliveredAt",
} as const;

function getOrderStatusTime(order: OrderTimelineSource, status: string) {
  const timestampKey =
    TIMESTAMP_KEY_BY_STATUS[status as keyof typeof TIMESTAMP_KEY_BY_STATUS];

  return (
    (timestampKey ? order.timestamps?.[timestampKey] : undefined) ??
    order.history?.find((entry) => entry.status === status)?.createdAt ??
    (status === "New" ? order.createdAt : undefined)
  );
}

export default function OrderTrackingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ orderId?: string }>();
  const [isDetailsOpen, setDetailsOpen] = useState(false);
  const [selectedRating, setSelectedRating] = useState(0);
  const [reviewComment, setReviewComment] = useState("");
  const [reorderConflictMeta, setReorderConflictMeta] = useState<{
    currentRestaurantName: string;
    incomingRestaurantName: string;
    previewItemName: string;
  } | null>(null);
  const detailsSheetProgress = useRef(new Animated.Value(0)).current;
  const orderId =
    typeof params.orderId === "string" ? params.orderId : undefined;
  const orderQuery = useCustomerOrderDetailsQuery(orderId);
  const reviewMutation = useCustomerReviewMutation(orderId);
  const reorderMutation = useCustomerReorderMutation();
  const showBanner = useAppBannerStore((state) => state.showBanner);
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

  const itemRows = useMemo(
    () => order?.itemsSnapshot ?? [],
    [order?.itemsSnapshot],
  );
  const openDetailsSheet = () => {
    setDetailsOpen(true);
  };
  const closeDetailsSheet = () => {
    Animated.timing(detailsSheetProgress, {
      toValue: 0,
      duration: 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setDetailsOpen(false);
      }
    });
  };
  const detailsBackdropOpacity = detailsSheetProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });
  const detailsSheetTranslateY = detailsSheetProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [28, 0],
  });

  useEffect(() => {
    if (!isDetailsOpen) return;

    detailsSheetProgress.setValue(0);
    Animated.timing(detailsSheetProgress, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [detailsSheetProgress, isDetailsOpen]);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace("/(tabs)/orders");
  };

  if (orderQuery.isLoading) {
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
            <Pressable style={styles.backButton} onPress={handleBack}>
              <Ionicons
                name="chevron-back"
                size={20}
                color={palette.foreground}
              />
            </Pressable>
            <View style={styles.headerCopy}>
              <Text style={styles.kicker}>Order details</Text>
              <Text style={styles.orderIdText}>Loading order</Text>
            </View>
          </View>
          <View style={styles.loadingPanel}>
            <ActivityIndicator size="small" color={palette.primary} />
            <View style={styles.loadingCopy}>
              <Text style={styles.loadingTitle}>Loading live tracking</Text>
              <Text style={styles.loadingText}>
                Pulling your latest rider and delivery updates.
              </Text>
            </View>
          </View>
        </ScrollView>
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

  const trackingState = getLiveOrderTrackingState(order);
  const remainingMinutes =
    order.riderTracking?.remainingDurationMinutes ?? null;
  const statusMeta = getCustomerOrderStatusMeta(order.status);
  const canShowLiveMap = order.status === "PickedUp";
  const hasAssignedRider = Boolean(
    order.riderSnapshot?.name || order.riderSnapshot?.phone,
  );
  const journeyIndex = getLiveOrderJourneyIndex(order.status);
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
  const restaurantName = restaurant?.name || "Restaurant";
  const canReviewOrder = order.status === "Delivered" && !order.customerReview;
  const restaurantAddressText = formatCustomerAddressLine(
    typeof restaurant?.address === "string"
      ? restaurant.address
      : [restaurant?.address?.address, restaurant?.address?.city]
          .filter(Boolean)
          .join(", "),
    "Restaurant pickup details will appear here.",
  );
  const deliveryAddressText = formatCustomerAddressLine(
    order.customerSnapshot?.deliveryAddress?.addressLine,
    "Delivery address unavailable",
  );
  const isDeliveredOrder = order.status === "Delivered";
  const totalItemCount = itemRows.reduce(
    (sum, item) => sum + Math.max(item.quantity ?? 0, 0),
    0,
  );
  const isCurrentOrderReordering =
    reorderMutation.isPending && reorderMutation.variables?.order._id === order._id;
  const handleCallRider = () => {
    if (!riderPhone) {
      return;
    }

    void Linking.openURL(`tel:${riderPhone}`);
  };
  const handleSubmitReview = () => {
    if (!selectedRating) {
      return;
    }

    reviewMutation.mutate({
      rating: selectedRating,
      comment: reviewComment.trim() || undefined,
    });
  };
  const handleReorder = async (forceReplace = false) => {
    const result = await reorderMutation.mutateAsync({
      order: {
        _id: order._id,
        orderNumber: order.orderNumber,
        restaurantId: order.restaurantId,
        itemsSnapshot: order.itemsSnapshot,
      },
      forceReplace,
    });

    if (result.status === "conflict") {
      setReorderConflictMeta({
        currentRestaurantName: result.currentRestaurantName,
        incomingRestaurantName: result.incomingRestaurantName,
        previewItemName: result.previewItemName,
      });
      return;
    }

    if (result.status === "empty") {
      showBanner({
        title: "Could not reorder this order",
        description:
          result.skippedCount > 0
            ? "Those items are no longer available with their previous configuration."
            : "We could not rebuild this order right now.",
        tone: "warning",
      });
      return;
    }

    showBanner({
      title:
        result.skippedCount > 0
          ? "Reorder ready with available items"
          : "Reorder ready",
      description:
        result.skippedCount > 0
          ? `${result.addedItemCount} item${result.addedItemCount === 1 ? "" : "s"} restored. ${result.skippedCount} could not be added.`
          : `Your cart now has ${result.addedItemCount} item${result.addedItemCount === 1 ? "" : "s"} from this delivered order.`,
      tone: result.skippedCount > 0 ? "warning" : "success",
    });
    router.push("/(tabs)/cart");
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
          <Pressable style={styles.backButton} onPress={handleBack}>
            <Ionicons
              name="chevron-back"
              size={20}
              color={palette.foreground}
            />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.kicker}>Order details</Text>
            <View style={styles.orderHeaderRow}>
              <Text style={styles.orderIdText}>
                {formatShortOrderIdLabel(order.orderNumber)}
              </Text>
              <View
                style={[
                  styles.statusPill,
                  { backgroundColor: statusMeta.background },
                ]}
              >
                <Ionicons
                  name={statusMeta.icon}
                  size={13}
                  color={statusMeta.color}
                />
                <Text style={[styles.statusPillText, { color: statusMeta.color }]}>
                  {statusMeta.label}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {!isOnline ? (
          <View style={styles.offlineNoticeWrap}>
            <OfflineNoticeCard description="You're offline. Live rider movement is paused until your connection returns." />
          </View>
        ) : null}

        {!isDeliveredOrder ? (
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
                  color="#9A4F00"
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
                          ? `${formatDurationMinutes(
                              Math.max(remainingMinutes, 1),
                            )} left`
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
                  <View style={styles.readyPickupAssignedLeft}>
                    <View style={styles.readyPickupAssignedAvatar}>
                      <Ionicons
                        name="bicycle-outline"
                        size={17}
                        color={palette.secondary}
                      />
                    </View>
                  <View style={styles.readyPickupAssignedCopy}>
                    <Text style={styles.readyPickupAssignedLabel}>
                      Assigned rider
                    </Text>
                    <View style={styles.readyPickupAssignedMetaRow}>
                      <Text style={styles.readyPickupAssignedValue} numberOfLines={1}>
                        {order.riderSnapshot?.name || "Rider assigned"}
                      </Text>
                      {riderPhone ? (
                        <>
                          <View style={styles.readyPickupAssignedDot} />
                          <Text style={styles.readyPickupAssignedPhone} numberOfLines={1}>
                            {riderPhone}
                          </Text>
                        </>
                      ) : null}
                    </View>
                  </View>
                  </View>
                  {riderPhone ? (
                    <Pressable
                      style={styles.readyPickupCallButton}
                      onPress={handleCallRider}
                    >
                      <Ionicons
                        name="call-outline"
                        size={16}
                        color={palette.secondary}
                      />
                    </Pressable>
                  ) : null}
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
        ) : null}

        {isDeliveredOrder ? (
          <View style={styles.deliveredSummaryCard}>
            <View style={styles.deliveredSummaryTopRow}>
              <View style={styles.deliveredSummaryCopy}>
                <View style={styles.deliveredSummaryIcon}>
                  <Ionicons
                    name="checkmark-done-outline"
                    size={18}
                    color={palette.secondary}
                  />
                </View>
                <View style={styles.deliveredSummaryTextWrap}>
                  <Text style={styles.deliveredSummaryTitle}>
                    Delivered successfully
                  </Text>
                  <Text style={styles.deliveredSummaryMeta}>
                    {totalItemCount} item{totalItemCount === 1 ? "" : "s"} from {restaurantName}
                  </Text>
                </View>
              </View>
              <View style={styles.deliveredSummaryTotalBox}>
                <Text style={styles.deliveredSummaryTotalLabel}>Total</Text>
                <Text style={styles.deliveredSummaryTotalValue}>
                  {formatCurrency(order.pricing?.total ?? 0)}
                </Text>
                <Pressable
                  style={[
                    styles.deliveredReorderButton,
                    isCurrentOrderReordering ? styles.deliveredReorderButtonDisabled : null,
                  ]}
                  disabled={isCurrentOrderReordering}
                  onPress={() => {
                    void handleReorder();
                  }}
                >
                  {isCurrentOrderReordering ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="refresh-outline" size={14} color="#fff" />
                      <Text style={styles.deliveredReorderButtonText}>Reorder</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}

        {journeyIndex >= 0 && !isDeliveredOrder ? (
          <View style={styles.journeyCard}>
            <Text style={styles.journeyTitle}>Order journey</Text>

            <View style={styles.journeyRow}>
              {LIVE_ORDER_JOURNEY_STEPS.map((step, index) => {
                const isCompleted = index < journeyIndex;
                const isCurrent = index === journeyIndex;
                const isDeliveredCurrent =
                  order.status === "Delivered" && step.key === "Delivered";

                return (
                  <View key={step.key} style={styles.journeyStep}>
                    <View style={styles.journeyMarkerRow}>
                      <View
                        style={[
                          styles.journeyMarker,
                          isCompleted || isDeliveredCurrent
                            ? styles.journeyMarkerDone
                            : null,
                          isCurrent && !isDeliveredCurrent
                            ? styles.journeyMarkerCurrent
                            : null,
                        ]}
                      >
                        <Text
                          style={[
                            styles.journeyMarkerText,
                            isCompleted || isDeliveredCurrent
                              ? styles.journeyMarkerTextOnSolid
                              : null,
                            isCurrent && !isDeliveredCurrent
                              ? styles.journeyMarkerTextCurrent
                              : null,
                          ]}
                        >
                          {index + 1}
                        </Text>
                      </View>
                      {index < LIVE_ORDER_JOURNEY_STEPS.length - 1 ? (
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

        <View style={styles.detailsButtonRow}>
          <Pressable
            style={[styles.detailsButton, styles.detailsButtonFull]}
            onPress={openDetailsSheet}
          >
            <Ionicons name="receipt-outline" size={15} color="#fff" />
            <Text style={styles.detailsButtonText}>Order details</Text>
          </Pressable>
        </View>

        {!isDeliveredOrder ? (
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
                <Text style={styles.routeStopTitle}>{restaurantName}</Text>
                <Text style={styles.routeStopMeta}>
                  {restaurantAddressText}
                </Text>
              </View>

              <View style={styles.routeStop}>
                <Text style={styles.routeStopLabel}>Deliver to</Text>
                <Text style={styles.routeStopTitle}>
                  {order.customerSnapshot?.deliveryAddress?.label ||
                    "Your location"}
                </Text>
                <Text style={styles.routeStopMeta}>{deliveryAddressText}</Text>
              </View>
            </View>
          </View>
        </View>
        ) : null}

        {order.customerReview ? (
          <View style={styles.reviewCard}>
            <View style={styles.reviewHeaderRow}>
              <View>
                <Text style={styles.reviewTitle}>Your review</Text>
                <Text style={styles.reviewHint}>Already shared</Text>
              </View>
              <View style={styles.reviewDoneBadge}>
                <Ionicons name="star" size={14} color={palette.amber} />
                <Text style={styles.reviewDoneBadgeText}>
                  {order.customerReview.rating}/5
                </Text>
              </View>
            </View>
            <Text style={styles.reviewDoneText}>
              {order.customerReview.comment ||
                "You submitted a rating without a comment."}
            </Text>
          </View>
        ) : null}

        {canReviewOrder ? (
          <View style={styles.reviewCard}>
            <View style={styles.reviewHeaderRow}>
              <View>
                <Text style={styles.reviewTitle}>Rate this order</Text>
                <Text style={styles.reviewHint}>
                  Tell us how your food and delivery felt.
                </Text>
              </View>
            </View>
            <View style={styles.reviewStarsRow}>
              {Array.from({ length: 5 }).map((_, index) => {
                const ratingValue = index + 1;
                const isActive = ratingValue <= selectedRating;

                return (
                  <Pressable
                    key={`star-${ratingValue}`}
                    style={styles.reviewStarButton}
                    onPress={() => setSelectedRating(ratingValue)}
                  >
                    <Ionicons
                      name={isActive ? "star" : "star-outline"}
                      size={23}
                      color={isActive ? palette.amber : palette.mutedForeground}
                    />
                  </Pressable>
                );
              })}
            </View>
            <TextInput
              value={reviewComment}
              onChangeText={setReviewComment}
              placeholder="Add a short note (optional)"
              placeholderTextColor={palette.placeholder}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              style={styles.reviewInput}
            />
            <Pressable
              style={[
                styles.submitReviewButton,
                selectedRating === 0 || reviewMutation.isPending
                  ? styles.submitReviewButtonDisabled
                  : null,
              ]}
              disabled={selectedRating === 0 || reviewMutation.isPending}
              onPress={handleSubmitReview}
            >
              {reviewMutation.isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.submitReviewButtonText}>Submit review</Text>
              )}
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      <Modal
        visible={isDetailsOpen}
        transparent
        animationType="none"
        onRequestClose={closeDetailsSheet}
      >
        <View style={styles.modalBackdrop}>
          <Animated.View
            pointerEvents="none"
            style={[styles.modalOverlay, { opacity: detailsBackdropOpacity }]}
          />
          <Pressable
            style={styles.modalBackdropTouch}
            onPress={closeDetailsSheet}
          />
          <Animated.View
            style={[
              styles.detailsSheet,
              { transform: [{ translateY: detailsSheetTranslateY }] },
            ]}
          >
            <View style={styles.detailsHandle} />
            <View style={styles.detailsHeader}>
              <View>
                <Text style={styles.detailsTitle}>Order items</Text>
                <Text style={styles.detailsSubtitle}>
                  {restaurantName} - {formatShortOrderIdLabel(order.orderNumber)}
                </Text>
                <Text style={styles.detailsDateText}>
                  Placed {formatDateMedium(order.createdAt)}
                </Text>
              </View>
              <Pressable
                style={styles.detailsCloseButton}
                onPress={closeDetailsSheet}
              >
                <Ionicons name="close" size={18} color={palette.foreground} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.detailsList}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{
                paddingBottom: Math.max(insets.bottom, 16),
              }}
            >
              {journeyIndex >= 0 ? (
                <View style={styles.detailsTimelineCard}>
                  <Text style={styles.detailsTimelineTitle}>Order timeline</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.detailsTimelineRow}
                  >
                    {LIVE_ORDER_JOURNEY_STEPS.map((step, index) => {
                      const statusTime = getOrderStatusTime(order, step.key);
                      const isCompleted = Boolean(statusTime) || index < journeyIndex;
                      const isCurrent = index === journeyIndex;
                      const isDeliveredCurrent =
                        order.status === "Delivered" && step.key === "Delivered";

                      return (
                        <View key={step.key} style={styles.detailsTimelineStep}>
                          <View style={styles.journeyMarkerRow}>
                            <View
                              style={[
                                styles.journeyMarker,
                                isCompleted || isDeliveredCurrent
                                  ? styles.journeyMarkerDone
                                  : null,
                                isCurrent && !isDeliveredCurrent
                                  ? styles.journeyMarkerCurrent
                                  : null,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.journeyMarkerText,
                                  isCompleted || isDeliveredCurrent
                                    ? styles.journeyMarkerTextOnSolid
                                    : null,
                                  isCurrent && !isDeliveredCurrent
                                    ? styles.journeyMarkerTextCurrent
                                    : null,
                                ]}
                              >
                                {index + 1}
                              </Text>
                            </View>
                            {index < LIVE_ORDER_JOURNEY_STEPS.length - 1 ? (
                              <View
                                style={[
                                  styles.detailsTimelineLine,
                                  isCompleted ? styles.journeyLineDone : null,
                                ]}
                              />
                            ) : null}
                          </View>
                          <Text
                            numberOfLines={2}
                            style={[
                              styles.detailsTimelineLabel,
                              isCompleted || isCurrent
                                ? styles.journeyStepLabelActive
                                : null,
                            ]}
                          >
                            {step.label}
                          </Text>
                          <Text style={styles.detailsTimelineTime}>
                            {statusTime ? formatTimeAmPm(statusTime) : "Pending"}
                          </Text>
                        </View>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : null}

              {itemRows.map((item, index) => {
                const quantity = item.quantity ?? 0;
                const unitPrice = item.unitPrice ?? 0;

                return (
                  <View
                    key={`${item.itemId ?? item.name}-${index}`}
                    style={styles.detailsItemRow}
                  >
                    <View style={styles.detailsItemIcon}>
                      <Ionicons
                        name="restaurant-outline"
                        size={16}
                        color={palette.primary}
                      />
                    </View>
                    <View style={styles.detailsItemCopy}>
                      <View style={styles.detailsItemTopRow}>
                        <Text style={styles.detailsItemName} numberOfLines={1}>
                          {item.name || "Menu item"}
                        </Text>
                        <Text style={styles.detailsItemPrice}>
                          {formatCurrency(quantity * unitPrice)}
                        </Text>
                      </View>
                      <Text style={styles.detailsItemMeta}>
                        {quantity} x {formatCurrency(unitPrice)}
                      </Text>
                    </View>
                  </View>
                );
              })}

              <View style={styles.detailsDivider} />

              <View style={styles.paymentSummary}>
                <View style={styles.paymentRow}>
                  <Text style={styles.paymentLabel}>Items subtotal</Text>
                  <Text style={styles.paymentValue}>
                    {formatCurrency(order.pricing?.subtotal ?? 0)}
                  </Text>
                </View>
                <View style={styles.paymentRow}>
                  <Text style={styles.paymentLabel}>Delivery fee</Text>
                  <Text style={styles.paymentValue}>
                    {formatCurrency(order.pricing?.deliveryFee ?? 0)}
                  </Text>
                </View>
                {(order.pricing?.discountAmount ?? 0) > 0 ? (
                  <View style={styles.paymentRow}>
                    <Text style={styles.paymentLabel}>Discount</Text>
                    <Text style={styles.paymentDiscount}>
                      -{formatCurrency(order.pricing?.discountAmount ?? 0)}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.detailsDivider} />
                <View style={styles.paymentRow}>
                  <Text style={styles.paymentValueStrong}>Total</Text>
                  <Text style={styles.paymentValueStrong}>
                    {formatCurrency(order.pricing?.total ?? 0)}
                  </Text>
                </View>
              </View>

            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
      <ReorderCartSwitchModal
        visible={Boolean(reorderConflictMeta)}
        previewItemName={reorderConflictMeta?.previewItemName ?? "Delivered items"}
        currentRestaurantName={reorderConflictMeta?.currentRestaurantName ?? "your current cart"}
        incomingRestaurantName={reorderConflictMeta?.incomingRestaurantName ?? restaurantName}
        onClose={() => setReorderConflictMeta(null)}
        onConfirm={() => {
          setReorderConflictMeta(null);
          void handleReorder(true);
        }}
      />
    </SafeAreaView>
  );
}
