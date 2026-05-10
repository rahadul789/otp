import { Ionicons } from "@expo/vector-icons";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import * as Location from "expo-location";
import MapView, { Marker, Polyline, type Region } from "react-native-maps";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  useAcceptOrderMutation,
  useActivateTrackingMutation,
  useDeliverOrderMutation,
  usePickupOrderMutation,
  useRiderOrderDetailsQuery,
  useUpdateRiderLocationMutation,
} from "@/src/hooks/use-rider-api";
import { useNetworkStatus } from "@/src/hooks/use-network-status";
import { isBangla, useDeliveryCopy } from "@/src/lib/copy";
import { formatDateTime } from "@/src/lib/date-time";
import { useRiderAuthStore } from "@/src/store/auth-store";
import { palette } from "@/src/theme/palette";

type Coordinate = { latitude: number; longitude: number };
type FocusMode = "customer" | "restaurant" | "rider" | "overview";

const HOLD_DURATION_MS = 1200;

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function calculateDistanceKm(pointA: Coordinate, pointB: Coordinate) {
  const earthRadius = 6371;
  const deltaLat = toRadians(pointB.latitude - pointA.latitude);
  const deltaLng = toRadians(pointB.longitude - pointA.longitude);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(toRadians(pointA.latitude)) *
      Math.cos(toRadians(pointB.latitude)) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);

  return earthRadius * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function estimateCycleEtaMinutes(distanceKm: number) {
  if (distanceKm <= 0) return 0;
  return Math.max(1, Math.round((distanceKm / 14) * 60));
}

function formatDistanceLabel(distanceKm?: number | null) {
  if (typeof distanceKm !== "number" || Number.isNaN(distanceKm)) return "--";
  if (distanceKm < 1) return `${Math.max(1, Math.round(distanceKm * 1000))} m`;
  return `${distanceKm.toFixed(2)} km`;
}

function formatEtaLabel(minutes?: number | null) {
  if (typeof minutes !== "number" || Number.isNaN(minutes)) return "--";
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = Math.round(minutes % 60);
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function buildCurvedPolyline(start: Coordinate, end: Coordinate) {
  const midLatitude = (start.latitude + end.latitude) / 2;
  const midLongitude = (start.longitude + end.longitude) / 2;
  const latitudeOffset = (end.longitude - start.longitude) * 0.12;
  const longitudeOffset = (start.latitude - end.latitude) * 0.12;
  const control = {
    latitude: midLatitude + latitudeOffset,
    longitude: midLongitude + longitudeOffset,
  };

  return Array.from({ length: 18 }, (_, index) => {
    const t = index / 17;
    return {
      latitude:
        (1 - t) * (1 - t) * start.latitude +
        2 * (1 - t) * t * control.latitude +
        t * t * end.latitude,
      longitude:
        (1 - t) * (1 - t) * start.longitude +
        2 * (1 - t) * t * control.longitude +
        t * t * end.longitude,
    };
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildAdaptiveRegion(points: (Coordinate | null | undefined)[], singlePointDelta = 0.014) {
  const validPoints = points.filter((point): point is Coordinate => Boolean(point));

  if (!validPoints.length) return undefined;

  if (validPoints.length === 1) {
    return {
      latitude: validPoints[0].latitude,
      longitude: validPoints[0].longitude,
      latitudeDelta: singlePointDelta,
      longitudeDelta: singlePointDelta * 0.82,
    } satisfies Region;
  }

  const latitudes = validPoints.map((point) => point.latitude);
  const longitudes = validPoints.map((point) => point.longitude);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);

  let widestDistanceKm = 0;
  for (let index = 0; index < validPoints.length; index += 1) {
    for (let nextIndex = index + 1; nextIndex < validPoints.length; nextIndex += 1) {
      widestDistanceKm = Math.max(
        widestDistanceKm,
        calculateDistanceKm(validPoints[index], validPoints[nextIndex])
      );
    }
  }

  const distanceDelta = clamp(Math.max(0.012, widestDistanceKm * 0.02), 0.012, 0.28);
  const latitudeDelta = clamp(Math.max((maxLatitude - minLatitude) * 1.55, distanceDelta), 0.012, 0.32);
  const longitudeDelta = clamp(
    Math.max((maxLongitude - minLongitude) * 1.55, distanceDelta * 0.9),
    0.01,
    0.32
  );

  return {
    latitude: (minLatitude + maxLatitude) / 2,
    longitude: (minLongitude + maxLongitude) / 2,
    latitudeDelta,
    longitudeDelta,
  } satisfies Region;
}

function tightenRegion(region: Region | undefined, factor = 0.78) {
  if (!region) return undefined;

  return {
    ...region,
    latitudeDelta: clamp(region.latitudeDelta * factor, 0.008, 0.24),
    longitudeDelta: clamp(region.longitudeDelta * factor, 0.007, 0.24),
  } satisfies Region;
}

const HomeMarkerContent = memo(function HomeMarkerContent() {
  return (
    <View collapsable={false} style={styles.markerRoot}>
      <View style={styles.customerMarkerPin}>
        <Ionicons name="home" size={13} color="#fff" />
      </View>
    </View>
  );
});

const RestaurantMarkerContent = memo(function RestaurantMarkerContent() {
  return (
    <View collapsable={false} style={styles.markerRoot}>
      <View style={styles.restaurantMarkerPin}>
        <Ionicons name="storefront" size={13} color="#fff" />
      </View>
    </View>
  );
});

const RiderMarkerContent = memo(function RiderMarkerContent() {
  return (
    <View collapsable={false} style={styles.markerRoot}>
      <View style={styles.riderMarkerPin}>
        <Ionicons name="bicycle-outline" size={13} color={palette.foreground} />
      </View>
    </View>
  );
});

export default function RiderOrderDetailsScreen() {
  const params = useLocalSearchParams<{ orderId?: string }>();
  const orderId = params.orderId;
  const rider = useRiderAuthStore((state) => state.rider);
  const { copy, language } = useDeliveryCopy();
  const isNetworkOnline = useNetworkStatus();
  const detailCopy = useMemo(
    () =>
      isBangla(language)
        ? {
            mapView: "ম্যাপ ভিউ",
            customerView: "কাস্টমার",
            restaurantView: "রেস্টুরেন্ট",
            riderView: "রাইডার",
            overviewView: "সবগুলো",
            liveEstimate: "লাইভ ডেলিভারি হিসাব",
            tripEarning: "ট্রিপ তথ্য",
            currentSync: "সিঙ্ক অবস্থা",
            routeSummary: "রুট সারাংশ",
            perspectiveHint: "চেপে পরের ভিউ দেখুন",
            holdTitle: "ডেলিভারি সম্পন্ন করতে ধরে রাখুন",
            holdHint: "বার পূর্ণ হলে ডেলিভারি সম্পন্ন হবে",
            releaseHint: "ছেড়ে দিলে বাতিল হবে",
            keepHolding: (seconds: string) => `${seconds} সেকেন্ড ধরে রাখুন`,
            completing: "ডেলিভারি সম্পন্ন করা হচ্ছে...",
            restaurantAddress: "ঠিকানা",
            restaurantPhone: "ফোন",
            openInMaps: "ম্যাপে খুলুন",
            etaLabel: "ETA",
            riderToRestaurant: "রাইডার থেকে রেস্টুরেন্ট",
            riderToCustomer: "রাইডার থেকে কাস্টমার",
            restaurantToCustomer: "রেস্টুরেন্ট থেকে কাস্টমার",
            focusHint: "ফোকাস বেছে নিন",
          }
        : {
            mapView: "Map view",
            customerView: "Customer",
            restaurantView: "Restaurant",
            riderView: "Rider",
            overviewView: "Overview",
            liveEstimate: "Live delivery estimate",
            tripEarning: "Trip details",
            currentSync: "Sync status",
            routeSummary: "Route summary",
            perspectiveHint: "Tap to switch to the next view",
            holdTitle: "Hold to complete delivery",
            holdHint: "Delivery completes when the bar fills",
            releaseHint: "Release early to cancel",
            keepHolding: (seconds: string) => `Keep holding • ${seconds}s`,
            completing: "Completing delivery...",
            restaurantAddress: "Address",
            restaurantPhone: "Phone",
            openInMaps: "Open in Maps",
            etaLabel: "ETA",
            riderToRestaurant: "Rider to restaurant",
            riderToCustomer: "Rider to customer",
            restaurantToCustomer: "Restaurant to customer",
            focusHint: "Choose focus",
            reconnectAction: "Reconnect to continue",
            reconnectTracking: "Reconnect to resume live updates and trip actions.",
            reconnectAccept: "Reconnect before accepting this order.",
            reconnectDelivery: "Reconnect before updating this trip.",
            pausedAssignments: "Paused",
          },
    [language]
  );
  const detailText = detailCopy as Record<string, unknown>;
  const reconnectActionLabel =
    typeof detailText.reconnectAction === "string"
      ? detailText.reconnectAction
      : language === "bn"
        ? "আবার যোগাযোগ করুন"
        : "Reconnect to continue";
  const reconnectTrackingLabel =
    typeof detailText.reconnectTracking === "string"
      ? detailText.reconnectTracking
      : language === "bn"
        ? "লাইভ আপডেট আর ট্রিপ অ্যাকশন চালু রাখতে আবার যোগাযোগ করুন।"
        : "Reconnect to resume live updates and trip actions.";
  const reconnectAcceptLabel =
    typeof detailText.reconnectAccept === "string"
      ? detailText.reconnectAccept
      : language === "bn"
        ? "এই অর্ডার গ্রহণ করার আগে আবার যোগাযোগ করুন।"
        : "Reconnect before accepting this order.";
  const reconnectDeliveryLabel =
    typeof detailText.reconnectDelivery === "string"
      ? detailText.reconnectDelivery
      : language === "bn"
        ? "এই ট্রিপ আপডেট করার আগে আবার যোগাযোগ করুন।"
        : "Reconnect before updating this trip.";
  const pausedAssignmentsLabel =
    typeof detailText.pausedAssignments === "string"
      ? detailText.pausedAssignments
      : language === "bn"
        ? "পজ করা"
        : "Paused";

  const [trackingError, setTrackingError] = useState("");
  const [syncState, setSyncState] = useState<"live" | "syncing" | "offline">("live");
  const [queuedLocationCount, setQueuedLocationCount] = useState(0);
  const [lastSuccessfulSyncAt, setLastSuccessfulSyncAt] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [focusMode, setFocusMode] = useState<FocusMode>("overview");
  const [holdProgress, setHoldProgress] = useState(0);
  const [activeHoldAction, setActiveHoldAction] = useState<"pickup" | "deliver" | null>(null);
  const [shouldTrackMarkerViews, setShouldTrackMarkerViews] = useState(true);
  const lastLocationSentAtRef = useRef(0);
  const isCompletingDeliveryRef = useRef(false);
  const isLocationMutationPendingRef = useRef(false);
  const queuedLocationsRef = useRef<
    {
      latitude: number;
      longitude: number;
      heading?: number;
      accuracyMeters?: number;
      speedKmph?: number;
    }[]
  >([]);
  const isFlushingQueueRef = useRef(false);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);
  const flushLocationQueueRef = useRef<() => Promise<void>>(async () => undefined);
  const holdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdStartedAtRef = useRef<number | null>(null);
  const mapRef = useRef<MapView | null>(null);
  const mapReadyRef = useRef(false);
  const orderQuery = useRiderOrderDetailsQuery(orderId);
  const acceptMutation = useAcceptOrderMutation();
  const activateTrackingMutation = useActivateTrackingMutation();
  const pickupMutation = usePickupOrderMutation();
  const deliverMutation = useDeliverOrderMutation();
  const locationMutation = useUpdateRiderLocationMutation(orderId);
  const mutateRiderLocation = locationMutation.mutateAsync;

  useEffect(() => {
    isLocationMutationPendingRef.current = locationMutation.isPending;
  }, [locationMutation.isPending]);

  const order = orderQuery.data;
  const isAssignmentsPaused = rider?.isAvailableForAssignments === false;
  const trackingLocation = order?.riderTracking?.currentLocation;
  const lastKnownRiderLocation = rider?.lastKnownLocation;
  const restaurantCoordinate = useMemo(
    () =>
      typeof order?.restaurant?.latitude === "number" && typeof order?.restaurant?.longitude === "number"
        ? {
            latitude: order.restaurant.latitude,
            longitude: order.restaurant.longitude,
          }
        : null,
    [order?.restaurant?.latitude, order?.restaurant?.longitude]
  );
  const customerCoordinate = useMemo(
    () =>
      typeof order?.customer?.deliveryAddress?.latitude === "number" &&
      typeof order?.customer?.deliveryAddress?.longitude === "number"
        ? {
            latitude: order.customer.deliveryAddress.latitude,
            longitude: order.customer.deliveryAddress.longitude,
          }
        : null,
    [order?.customer?.deliveryAddress?.latitude, order?.customer?.deliveryAddress?.longitude]
  );
  const riderCoordinate = useMemo(
    () =>
      typeof trackingLocation?.latitude === "number" && typeof trackingLocation?.longitude === "number"
        ? {
            latitude: trackingLocation.latitude,
            longitude: trackingLocation.longitude,
          }
        : typeof lastKnownRiderLocation?.latitude === "number" &&
            typeof lastKnownRiderLocation?.longitude === "number"
          ? {
              latitude: lastKnownRiderLocation.latitude,
              longitude: lastKnownRiderLocation.longitude,
            }
          : null,
    [
      lastKnownRiderLocation?.latitude,
      lastKnownRiderLocation?.longitude,
      trackingLocation?.latitude,
      trackingLocation?.longitude,
    ]
  );

  const isPickedUp = order?.status === "PickedUp";
  const isAssignedPrePickup =
    order?.status === "ReadyForPickup" && order?.assignmentState === "assigned_to_you";
  const isAcceptStep = order?.status === "ReadyForPickup" && order?.assignmentState === "unassigned";
  const isPickupStep = order?.status === "ReadyForPickup" && order?.assignmentState === "assigned_to_you";
  const hasAnotherActiveLiveTrip =
    Boolean(rider?.activeTrackingOrderId) && rider?.activeTrackingOrderId !== order?.id;
  const isPreviewOnlyRoute =
    (isAssignedPrePickup || isPickedUp) &&
    !order?.isTrackingActiveForRider &&
    hasAnotherActiveLiveTrip;
  const shouldShowCurrentApproachLeg =
    isPickedUp ? Boolean(order?.isTrackingActiveForRider) : isAssignedPrePickup && !isPreviewOnlyRoute;
  const statusLabel = !isNetworkOnline
    ? copy.common.offline
    : isAssignmentsPaused
      ? pausedAssignmentsLabel
      : copy.common.online;
  const isAcceptDisabled = !isNetworkOnline || isAssignmentsPaused || acceptMutation.isPending;
  const isPickupDisabled = !isNetworkOnline || pickupMutation.isPending;
  const isDeliverDisabled = !isNetworkOnline || deliverMutation.isPending;
  const isTrackingActivationDisabled = !isNetworkOnline || activateTrackingMutation.isPending;
  const offlineAcceptWarning =
    copy.orderDetails.warningOfflineAccept ?? "Reconnect before accepting a new order.";

  const activePrimaryRoute = useMemo(() => {
    if (isPickedUp && shouldShowCurrentApproachLeg && riderCoordinate && customerCoordinate) {
      return [riderCoordinate, customerCoordinate];
    }
    if (isAssignedPrePickup && shouldShowCurrentApproachLeg && riderCoordinate && restaurantCoordinate) {
      return [riderCoordinate, restaurantCoordinate];
    }
    return [] as Coordinate[];
  }, [
    customerCoordinate,
    isAssignedPrePickup,
    isPickedUp,
    restaurantCoordinate,
    riderCoordinate,
    shouldShowCurrentApproachLeg,
  ]);

  const nextLegRoute = useMemo(() => {
    if (!restaurantCoordinate || !customerCoordinate) return [] as Coordinate[];
    return buildCurvedPolyline(restaurantCoordinate, customerCoordinate);
  }, [customerCoordinate, restaurantCoordinate]);

  const fallbackRiderRoute = useMemo(() => {
    if (!riderCoordinate) return [] as Coordinate[];

    const target =
      focusMode === "customer"
        ? customerCoordinate
        : focusMode === "restaurant"
          ? restaurantCoordinate
          : focusMode === "rider"
            ? isPickedUp
              ? customerCoordinate
              : restaurantCoordinate ?? customerCoordinate
            : isPickedUp
              ? customerCoordinate
              : restaurantCoordinate;

    if (!target) return [] as Coordinate[];
    return buildCurvedPolyline(riderCoordinate, target);
  }, [customerCoordinate, focusMode, isPickedUp, restaurantCoordinate, riderCoordinate]);

  const currentLegDistanceKm = useMemo(() => {
    if (isPickedUp) {
      if (typeof order?.riderTracking?.remainingDistanceKm === "number") {
        return order.riderTracking.remainingDistanceKm;
      }
      return riderCoordinate && customerCoordinate
        ? calculateDistanceKm(riderCoordinate, customerCoordinate)
        : null;
    }

    return riderCoordinate && restaurantCoordinate
      ? calculateDistanceKm(riderCoordinate, restaurantCoordinate)
      : null;
  }, [customerCoordinate, isPickedUp, order?.riderTracking?.remainingDistanceKm, restaurantCoordinate, riderCoordinate]);

  const nextLegDistanceKm = useMemo(() => {
    if (isPickedUp) return null;
    return restaurantCoordinate && customerCoordinate
      ? calculateDistanceKm(restaurantCoordinate, customerCoordinate)
      : null;
  }, [customerCoordinate, isPickedUp, restaurantCoordinate]);

  const currentLegEtaMinutes = useMemo(() => {
    if (isPickedUp && typeof order?.riderTracking?.remainingDurationMinutes === "number") {
      return Math.max(1, Math.round(order.riderTracking.remainingDurationMinutes));
    }
    return typeof currentLegDistanceKm === "number"
      ? estimateCycleEtaMinutes(currentLegDistanceKm)
      : null;
  }, [currentLegDistanceKm, isPickedUp, order?.riderTracking?.remainingDurationMinutes]);

  const nextLegEtaMinutes = useMemo(
    () => (typeof nextLegDistanceKm === "number" ? estimateCycleEtaMinutes(nextLegDistanceKm) : null),
    [nextLegDistanceKm]
  );

  const fullTripEtaMinutes = useMemo(() => {
    if (isPickedUp) return currentLegEtaMinutes;
    if (typeof currentLegEtaMinutes === "number" && typeof nextLegEtaMinutes === "number") {
      return currentLegEtaMinutes + nextLegEtaMinutes;
    }
    return currentLegEtaMinutes ?? nextLegEtaMinutes ?? null;
  }, [currentLegEtaMinutes, isPickedUp, nextLegEtaMinutes]);

  const availableFocusModes = useMemo(() => {
    const modes: FocusMode[] = [];
    if (customerCoordinate) modes.push("customer");
    if (restaurantCoordinate) modes.push("restaurant");
    if (riderCoordinate) modes.push("rider");
    modes.push("overview");
    return modes;
  }, [customerCoordinate, restaurantCoordinate, riderCoordinate]);

  useEffect(() => {
    if (!availableFocusModes.includes(focusMode)) {
      setFocusMode(availableFocusModes[0] ?? "overview");
    }
  }, [availableFocusModes, focusMode]);

  const activeMapRegion = useMemo(() => {
    switch (focusMode) {
      case "customer":
        return tightenRegion(
          buildAdaptiveRegion(
            [customerCoordinate, riderCoordinate ?? restaurantCoordinate],
            0.011
          ),
          0.7
        );
      case "restaurant":
        return tightenRegion(
          buildAdaptiveRegion(
            [restaurantCoordinate, isPickedUp ? customerCoordinate : riderCoordinate ?? customerCoordinate],
            0.011
          ),
          0.7
        );
      case "rider":
        return tightenRegion(
          buildAdaptiveRegion(
            [riderCoordinate, isPickedUp ? customerCoordinate : restaurantCoordinate],
            0.01
          ),
          0.68
        );
      case "overview":
      default:
        return tightenRegion(
          buildAdaptiveRegion([restaurantCoordinate, customerCoordinate, riderCoordinate], 0.014),
          0.84
        );
    }
  }, [customerCoordinate, focusMode, isPickedUp, restaurantCoordinate, riderCoordinate]);

  useEffect(() => {
    if (mapRef.current && activeMapRegion) {
      mapRef.current.animateToRegion(activeMapRegion, 350);
    }
  }, [activeMapRegion]);

  useEffect(() => {
    setShouldTrackMarkerViews(true);
    const timer = setTimeout(() => {
      setShouldTrackMarkerViews(false);
    }, 700);

    return () => {
      clearTimeout(timer);
    };
  }, [focusMode, restaurantCoordinate, customerCoordinate, riderCoordinate]);

  const focusModeMeta = useMemo(() => {
    switch (focusMode) {
      case "customer":
        return { label: detailCopy.customerView, icon: "home-outline" as const };
      case "restaurant":
        return { label: detailCopy.restaurantView, icon: "storefront-outline" as const };
      case "rider":
        return { label: detailCopy.riderView, icon: "bicycle-outline" as const };
      case "overview":
      default:
        return { label: detailCopy.overviewView, icon: "scan-outline" as const };
    }
  }, [detailCopy.customerView, detailCopy.overviewView, detailCopy.restaurantView, detailCopy.riderView, focusMode]);

  const cycleMapFocus = useCallback(() => {
    setFocusMode((current) => {
      const currentIndex = availableFocusModes.indexOf(current);
      const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % availableFocusModes.length;
      return availableFocusModes[nextIndex] ?? "overview";
    });
  }, [availableFocusModes]);

  const syncTimestampLabel = useMemo(
    () =>
      formatDateTime(
        lastSuccessfulSyncAt ??
          order?.riderTracking?.lastUpdatedAt ??
          rider?.lastKnownLocation?.updatedAt ??
          null
      ),
    [lastSuccessfulSyncAt, order?.riderTracking?.lastUpdatedAt, rider?.lastKnownLocation?.updatedAt]
  );

  const timelineRows = useMemo(() => order?.history ?? [], [order?.history]);
  const itemRows = useMemo(() => order?.items ?? [], [order?.items]);

  const routeSummary = useMemo(() => {
    if (isPreviewOnlyRoute) return copy.orderDetails.previewText;
    if (isPickedUp) return copy.orderDetails.routeHintPickedUp;
    if (order?.assignmentState === "assigned_to_you") return copy.orderDetails.routeHintAssigned;
    if (order?.assignmentState === "unassigned") return copy.orderDetails.routeHintDefault;
    return copy.orderDetails.routeHintPreview;
  }, [
    copy.orderDetails.previewText,
    copy.orderDetails.routeHintAssigned,
    copy.orderDetails.routeHintDefault,
    copy.orderDetails.routeHintPickedUp,
    copy.orderDetails.routeHintPreview,
    isPickedUp,
    isPreviewOnlyRoute,
    order?.assignmentState,
  ]);

  const shouldShowTripSyncStatus = isAssignedPrePickup || isPickedUp;

  const riderToRestaurantDistanceKm = useMemo(
    () =>
      riderCoordinate && restaurantCoordinate
        ? calculateDistanceKm(riderCoordinate, restaurantCoordinate)
        : null,
    [restaurantCoordinate, riderCoordinate]
  );

  const riderToCustomerDistanceKm = useMemo(
    () =>
      riderCoordinate && customerCoordinate
        ? calculateDistanceKm(riderCoordinate, customerCoordinate)
        : null,
    [customerCoordinate, riderCoordinate]
  );

  const openInNativeMaps = useCallback(() => {
    const destination = isPickedUp
      ? customerCoordinate ?? restaurantCoordinate
      : restaurantCoordinate ?? customerCoordinate;

    if (!destination) {
      return;
    }

    const originSegment = riderCoordinate
      ? `&origin=${riderCoordinate.latitude},${riderCoordinate.longitude}`
      : "";
    const url = `https://www.google.com/maps/dir/?api=1${originSegment}&destination=${destination.latitude},${destination.longitude}&travelmode=bicycling`;
    void Linking.openURL(url);
  }, [customerCoordinate, isPickedUp, restaurantCoordinate, riderCoordinate]);

  const clearHoldTimers = useCallback(() => {
    if (holdTimeoutRef.current) {
      clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }
    if (holdIntervalRef.current) {
      clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
  }, []);

  const resetHoldState = useCallback(() => {
    clearHoldTimers();
    holdStartedAtRef.current = null;
    setActiveHoldAction(null);
    setHoldProgress(0);
  }, [clearHoldTimers]);

  useEffect(() => () => resetHoldState(), [resetHoldState]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await orderQuery.refetch();
    } finally {
      setIsRefreshing(false);
    }
  }, [orderQuery]);

  const scheduleQueueRetry = useCallback((delayMs: number) => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
    }

    retryTimeoutRef.current = setTimeout(() => {
      retryTimeoutRef.current = null;
      void flushLocationQueueRef.current();
    }, delayMs);
  }, []);

  const flushLocationQueue = useCallback(async () => {
    if (
      isFlushingQueueRef.current ||
      !orderId ||
      order?.status !== "PickedUp" ||
      !order?.isTrackingActiveForRider ||
      queuedLocationsRef.current.length === 0 ||
      isCompletingDeliveryRef.current
    ) {
      return;
    }

    isFlushingQueueRef.current = true;
    setSyncState("syncing");

    try {
      while (queuedLocationsRef.current.length > 0) {
        const nextPayload = queuedLocationsRef.current[0];
        const updatedOrder = await mutateRiderLocation(nextPayload);
        queuedLocationsRef.current.shift();
        setQueuedLocationCount(queuedLocationsRef.current.length);
        setLastSuccessfulSyncAt(updatedOrder.riderTracking?.lastUpdatedAt ?? new Date().toISOString());
        retryAttemptRef.current = 0;
      }

      setSyncState("live");
    } catch (error) {
      retryAttemptRef.current += 1;
      setSyncState("offline");
      setTrackingError(
        error instanceof Error ? error.message : copy.orderDetails.trackingWeakConnection
      );
      scheduleQueueRetry(Math.min(30000, 3000 * 2 ** (retryAttemptRef.current - 1)));
    } finally {
      isFlushingQueueRef.current = false;
    }
  }, [
    copy.orderDetails.trackingWeakConnection,
    mutateRiderLocation,
    order?.isTrackingActiveForRider,
    order?.status,
    orderId,
    scheduleQueueRetry,
  ]);

  useEffect(() => {
    flushLocationQueueRef.current = flushLocationQueue;
  }, [flushLocationQueue]);

  const enqueueLocationUpdate = useCallback(
    (payload: {
      latitude: number;
      longitude: number;
      heading?: number;
      accuracyMeters?: number;
      speedKmph?: number;
    }) => {
      queuedLocationsRef.current.push(payload);
      setQueuedLocationCount(queuedLocationsRef.current.length);
      setSyncState(queuedLocationsRef.current.length > 1 ? "offline" : "syncing");
      void flushLocationQueue();
    },
    [flushLocationQueue]
  );

  useEffect(() => {
    if (order?.status !== "PickedUp" || !orderId || !order?.isTrackingActiveForRider) {
      return;
    }

    let subscription: Location.LocationSubscription | null = null;
    let isMounted = true;

    const startWatching = async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        if (isMounted) {
          setTrackingError(copy.orderDetails.trackingPermissionError);
        }
        return;
      }

      try {
        const currentPosition = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        if (isMounted && !isCompletingDeliveryRef.current) {
          lastLocationSentAtRef.current = Date.now();
          enqueueLocationUpdate({
            latitude: currentPosition.coords.latitude,
            longitude: currentPosition.coords.longitude,
            heading:
              typeof currentPosition.coords.heading === "number"
                ? currentPosition.coords.heading
                : undefined,
            accuracyMeters:
              typeof currentPosition.coords.accuracy === "number"
                ? currentPosition.coords.accuracy
                : undefined,
            speedKmph:
              typeof currentPosition.coords.speed === "number" && currentPosition.coords.speed > 0
                ? currentPosition.coords.speed * 3.6
                : undefined,
          });
        }
      } catch {
        if (isMounted) {
          setTrackingError(copy.orderDetails.trackingWaitingFirstLocation);
        }
      }

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 15000,
          distanceInterval: 60,
        },
        (position) => {
          if (isCompletingDeliveryRef.current || isLocationMutationPendingRef.current) {
            return;
          }

          const now = Date.now();
          if (now - lastLocationSentAtRef.current < 15000) {
            return;
          }

          lastLocationSentAtRef.current = now;
          enqueueLocationUpdate({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            heading:
              typeof position.coords.heading === "number" ? position.coords.heading : undefined,
            accuracyMeters:
              typeof position.coords.accuracy === "number" ? position.coords.accuracy : undefined,
            speedKmph:
              typeof position.coords.speed === "number" && position.coords.speed > 0
                ? position.coords.speed * 3.6
                : undefined,
          });
        }
      );
    };

    startWatching().catch(() => {
      if (isMounted) {
        setTrackingError(copy.orderDetails.trackingStartError);
      }
    });

    return () => {
      isMounted = false;
      subscription?.remove();
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  }, [
    copy.orderDetails.trackingPermissionError,
    copy.orderDetails.trackingStartError,
    copy.orderDetails.trackingWaitingFirstLocation,
    enqueueLocationUpdate,
    order?.isTrackingActiveForRider,
    order?.status,
    orderId,
  ]);

  useEffect(() => {
    if (order?.status !== "PickedUp" || !order?.isTrackingActiveForRider) {
      queuedLocationsRef.current = [];
      setQueuedLocationCount(0);
      setSyncState("live");
      retryAttemptRef.current = 0;
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    }
  }, [order?.isTrackingActiveForRider, order?.status]);

  const handleAccept = async () => {
    if (!order) return;
    if (!isNetworkOnline) {
      Alert.alert(copy.common.offline, reconnectAcceptLabel);
      return;
    }
    if (isAssignmentsPaused) {
      Alert.alert(pausedAssignmentsLabel, offlineAcceptWarning);
      return;
    }

    try {
      await acceptMutation.mutateAsync(order.id);
    } catch (error) {
      Alert.alert(
        copy.orderDetails.acceptFailed,
        error instanceof Error ? error.message : copy.orderDetails.acceptFailedText
      );
    }
  };

  const handlePickup = useCallback(async () => {
    if (!isNetworkOnline) {
      Alert.alert(copy.common.offline, reconnectDeliveryLabel);
      resetHoldState();
      return;
    }

    try {
      const pickedUpOrder = await pickupMutation.mutateAsync(order!.id);
      resetHoldState();

      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (permission.status === "granted" && pickedUpOrder.isTrackingActiveForRider) {
          const currentPosition = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });

          lastLocationSentAtRef.current = Date.now();
          enqueueLocationUpdate({
            latitude: currentPosition.coords.latitude,
            longitude: currentPosition.coords.longitude,
            heading:
              typeof currentPosition.coords.heading === "number"
                ? currentPosition.coords.heading
                : undefined,
            accuracyMeters:
              typeof currentPosition.coords.accuracy === "number"
                ? currentPosition.coords.accuracy
                : undefined,
            speedKmph:
              typeof currentPosition.coords.speed === "number" && currentPosition.coords.speed > 0
                ? currentPosition.coords.speed * 3.6
                : undefined,
          });
        }
      } catch {
        setTrackingError(copy.orderDetails.pickupSavedWaiting);
      }
    } catch (error) {
      resetHoldState();
      Alert.alert(
        copy.orderDetails.pickupFailed,
        error instanceof Error ? error.message : copy.orderDetails.pickupFailedText
      );
    }
  }, [
    copy.common.offline,
    copy.orderDetails.pickupFailed,
    copy.orderDetails.pickupFailedText,
    copy.orderDetails.pickupSavedWaiting,
    reconnectDeliveryLabel,
    enqueueLocationUpdate,
    isNetworkOnline,
    order,
    pickupMutation,
    resetHoldState,
  ]);

  const handleDeliver = useCallback(async () => {
    if (!isNetworkOnline) {
      Alert.alert(copy.common.offline, reconnectDeliveryLabel);
      resetHoldState();
      return;
    }

    isCompletingDeliveryRef.current = true;

    try {
      await deliverMutation.mutateAsync(order!.id);
      router.replace("/(app)/history");
    } catch (error) {
      isCompletingDeliveryRef.current = false;
      resetHoldState();
      Alert.alert(
        copy.orderDetails.deliverFailed,
        error instanceof Error ? error.message : copy.orderDetails.deliverFailedText
      );
    }
  }, [
    copy.common.offline,
    copy.orderDetails.deliverFailed,
    copy.orderDetails.deliverFailedText,
    reconnectDeliveryLabel,
    deliverMutation,
    isNetworkOnline,
    order,
    resetHoldState,
  ]);

  const handleActivateTracking = async () => {
    if (!isNetworkOnline) {
      Alert.alert(copy.common.offline, reconnectTrackingLabel);
      return;
    }

    try {
      await activateTrackingMutation.mutateAsync(order!.id);
    } catch (error) {
      Alert.alert(
        copy.orderDetails.trackingSwitchFailed,
        error instanceof Error ? error.message : copy.orderDetails.trackingSwitchFailedText
      );
    }
  };

  const startHoldAction = useCallback(
    (action: "pickup" | "deliver", onComplete: () => void) => {
      const isBusy =
        action === "pickup"
          ? pickupMutation.isPending || activeHoldAction !== null
          : deliverMutation.isPending || activeHoldAction !== null;

      if (isBusy) return;

      setActiveHoldAction(action);
      setHoldProgress(0);
      holdStartedAtRef.current = Date.now();

      holdIntervalRef.current = setInterval(() => {
        if (!holdStartedAtRef.current) return;
        const nextProgress = Math.min(1, (Date.now() - holdStartedAtRef.current) / HOLD_DURATION_MS);
        setHoldProgress(nextProgress);
      }, 16);

      holdTimeoutRef.current = setTimeout(() => {
        clearHoldTimers();
        setHoldProgress(1);
        onComplete();
      }, HOLD_DURATION_MS);
    },
    [activeHoldAction, clearHoldTimers, deliverMutation.isPending, pickupMutation.isPending]
  );

  const startPickupHold = useCallback(() => {
    startHoldAction("pickup", () => {
      void handlePickup();
    });
  }, [handlePickup, startHoldAction]);

  const startDeliverHold = useCallback(() => {
    startHoldAction("deliver", () => {
      void handleDeliver();
    });
  }, [handleDeliver, startHoldAction]);

  const cancelHoldAction = useCallback(() => {
    if (pickupMutation.isPending || deliverMutation.isPending || activeHoldAction === null) return;
    resetHoldState();
  }, [activeHoldAction, deliverMutation.isPending, pickupMutation.isPending, resetHoldState]);

  if (orderQuery.isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="small" color={palette.primaryStrong} />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>{copy.orderDetails.unavailable}</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={palette.primaryStrong}
          />
        }
      >
        <View style={styles.topRow}>
          <View style={styles.topIdentityRow}>
            <Pressable style={styles.backButton} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={20} color={palette.primaryStrong} />
            </Pressable>
            <View style={styles.orderHeadingWrap}>
              <Text style={styles.topOrderId}>{order.orderNumber}</Text>
              <Text style={styles.topOrderStatus}>{order.status}</Text>
            </View>
          </View>
          <View
            style={[
              styles.topStatusBadge,
              !isNetworkOnline || isAssignmentsPaused
                ? styles.topStatusBadgeOffline
                : styles.topStatusBadgeOnline,
            ]}
          >
            <Text
              style={[
                styles.topStatusBadgeText,
                !isNetworkOnline || isAssignmentsPaused
                  ? styles.topStatusBadgeTextOffline
                  : styles.topStatusBadgeTextOnline,
              ]}
            >
              {statusLabel}
            </Text>
          </View>
        </View>

        <View style={styles.dualCardRow}>
          <View style={[styles.infoCardHalf, styles.infoCardRestaurant]}>
            <View style={styles.infoHeaderRow}>
              <View style={styles.infoHeaderMain}>
                <View style={[styles.infoIcon, styles.infoIconRestaurant]}>
                  <Ionicons name="storefront-outline" size={18} color={palette.primaryStrong} />
                </View>
                <Text style={styles.sectionTitle}>{copy.orderDetails.restaurantTitle}</Text>
              </View>
              {order.restaurant?.phone ? (
                <Pressable
                  style={styles.cardActionButton}
                  onPress={() => Linking.openURL(`tel:${order.restaurant?.phone}`)}
                >
                  <Ionicons name="call" size={15} color={palette.primaryStrong} />
                </Pressable>
              ) : null}
            </View>
            <Text style={styles.infoTitle}>{order.restaurant?.name ?? copy.common.restaurant}</Text>
            <Text style={styles.infoText}>{order.restaurant?.address ?? "--"}</Text>
            <Text style={styles.infoText}>{order.restaurant?.phone ?? "--"}</Text>
          </View>

          <View style={[styles.infoCardHalf, styles.infoCardCustomer]}>
            <View style={styles.infoHeaderRow}>
              <View style={styles.infoHeaderMain}>
                <View style={[styles.infoIcon, styles.infoIconCustomer]}>
                  <Ionicons name="person-outline" size={18} color={palette.primaryStrong} />
                </View>
                <Text style={styles.sectionTitle}>{copy.orderDetails.customerTitle}</Text>
              </View>
              {order.customer?.phone ? (
                <Pressable
                  style={styles.cardActionButton}
                  onPress={() => Linking.openURL(`tel:${order.customer?.phone}`)}
                >
                  <Ionicons name="call" size={15} color={palette.primaryStrong} />
                </Pressable>
              ) : null}
            </View>
            <Text style={styles.infoTitle}>{order.customer?.name ?? copy.common.customer}</Text>
            <Text style={styles.infoText}>{order.customer?.deliveryAddress?.label ?? "--"}</Text>
            <Text style={styles.infoText}>{order.customer?.phone ?? "--"}</Text>
          </View>
        </View>

        <View style={styles.mapCard}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>{detailCopy.routeSummary}</Text>
            <Text style={styles.sectionBadge}>{detailCopy.etaLabel} • {formatEtaLabel(fullTripEtaMinutes)}</Text>
          </View>

          {activeMapRegion ? (
            <View style={styles.mapShell}>
              <MapView
                ref={mapRef}
                style={styles.map}
                initialRegion={activeMapRegion}
                minZoomLevel={13}
                maxZoomLevel={19}
                scrollEnabled={false}
                pitchEnabled={false}
                rotateEnabled={false}
                zoomEnabled={false}
                toolbarEnabled={false}
                showsCompass={false}
                onMapReady={() => {
                  mapReadyRef.current = true;
                  mapRef.current?.animateToRegion(activeMapRegion, 1);
                }}
              >
                {restaurantCoordinate ? (
                  <Marker
                    coordinate={restaurantCoordinate}
                    anchor={{ x: 0.5, y: 0.5 }}
                    zIndex={3}
                    tracksViewChanges={shouldTrackMarkerViews}
                  >
                    <RestaurantMarkerContent />
                  </Marker>
                ) : null}

                {customerCoordinate ? (
                  <Marker
                    coordinate={customerCoordinate}
                    anchor={{ x: 0.5, y: 0.5 }}
                    zIndex={4}
                    tracksViewChanges={shouldTrackMarkerViews}
                  >
                    <HomeMarkerContent />
                  </Marker>
                ) : null}

                {riderCoordinate ? (
                  <Marker
                    coordinate={riderCoordinate}
                    anchor={{ x: 0.5, y: 0.5 }}
                    zIndex={5}
                    tracksViewChanges={shouldTrackMarkerViews}
                  >
                    <RiderMarkerContent />
                  </Marker>
                ) : null}

                {activePrimaryRoute.length === 2 ? (
                  <Polyline
                    coordinates={activePrimaryRoute}
                    strokeColor={palette.secondary}
                    strokeWidth={5}
                    lineDashPattern={[10, 8]}
                  />
                ) : null}

                {!activePrimaryRoute.length && fallbackRiderRoute.length > 1 ? (
                  <Polyline
                    coordinates={fallbackRiderRoute}
                    strokeColor={palette.secondary}
                    strokeWidth={4}
                    lineDashPattern={[10, 8]}
                  />
                ) : null}

                {nextLegRoute.length > 1 ? (
                  <Polyline
                    coordinates={nextLegRoute}
                    strokeColor={palette.amber}
                    strokeWidth={4}
                    lineDashPattern={[8, 8]}
                  />
                ) : null}
              </MapView>

              <View style={styles.mapActionDock}>
                <Pressable style={styles.mapUtilityButton} onPress={cycleMapFocus}>
                  <Ionicons name={focusModeMeta.icon} size={15} color="#fff" />
                  <Text style={styles.mapUtilityButtonText}>{focusModeMeta.label}</Text>
                </Pressable>
                <Pressable style={styles.mapUtilityButton} onPress={openInNativeMaps}>
                  <Ionicons name="navigate" size={15} color="#fff" />
                  <Text style={styles.mapUtilityButtonText}>{detailCopy.openInMaps}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          <View style={styles.mapLegendRow}>
            <View style={styles.legendChip}>
              <View style={styles.legendPrimaryLine} />
              <Text style={styles.legendText}>
                {isPickedUp ? copy.orderDetails.currentDeliveryLeg : copy.orderDetails.currentPickupLeg}
              </Text>
            </View>
            <View style={styles.legendChip}>
              <View style={styles.legendSecondaryLine} />
              <Text style={styles.legendText}>
                {isPickedUp ? copy.orderDetails.routeContext : copy.orderDetails.nextDeliveryLeg}
              </Text>
            </View>
          </View>

          <View style={styles.metricsRow}>
            <View style={[styles.metricCard, styles.metricRose]}>
              <Text style={styles.metricLabel}>
                {isPickedUp ? detailCopy.riderToCustomer : detailCopy.riderToRestaurant}
              </Text>
              <Text style={styles.metricValue}>
                {formatDistanceLabel(isPickedUp ? riderToCustomerDistanceKm : riderToRestaurantDistanceKm)}
              </Text>
            </View>
            <View style={[styles.metricCard, styles.metricSky]}>
              <Text style={styles.metricLabel}>
                {isPickedUp ? detailCopy.restaurantToCustomer : detailCopy.riderToCustomer}
              </Text>
              <Text style={styles.metricValue}>
                {formatDistanceLabel(isPickedUp ? nextLegDistanceKm : riderToCustomerDistanceKm)}
              </Text>
            </View>
            <View style={[styles.metricCard, styles.metricAmber]}>
              <Text style={styles.metricLabel}>
                {isPickedUp ? detailCopy.etaLabel : detailCopy.restaurantToCustomer}
              </Text>
              <Text style={styles.metricValue}>
                {isPickedUp ? formatEtaLabel(fullTripEtaMinutes) : formatDistanceLabel(nextLegDistanceKm)}
              </Text>
            </View>
          </View>

          <View style={styles.etaCard}>
            <Text style={styles.etaLabel}>{detailCopy.liveEstimate}</Text>
            <Text style={styles.etaValue}>{formatEtaLabel(fullTripEtaMinutes)}</Text>
            <Text style={styles.etaMeta}>
              {isPreviewOnlyRoute ? copy.orderDetails.activateToSeeLiveApproach : routeSummary}
            </Text>
          </View>

          {shouldShowTripSyncStatus ? (
            <View style={styles.syncCard}>
              <View style={styles.syncHeaderRow}>
                <Text style={styles.syncTitle}>{detailCopy.currentSync}</Text>
                <View
                  style={[
                    styles.syncStateBadge,
                    syncState === "live"
                      ? styles.syncStateBadgeLive
                      : syncState === "syncing"
                        ? styles.syncStateBadgeSyncing
                        : styles.syncStateBadgeOffline,
                  ]}
                >
                  <Text
                    style={[
                      styles.syncStateBadgeText,
                      syncState === "live"
                        ? styles.syncStateBadgeTextLive
                        : syncState === "syncing"
                          ? styles.syncStateBadgeTextSyncing
                          : styles.syncStateBadgeTextOffline,
                    ]}
                  >
                    {syncState === "live"
                      ? copy.orderDetails.syncLive
                      : syncState === "syncing"
                        ? copy.orderDetails.syncSyncing
                        : copy.orderDetails.syncOffline}
                  </Text>
                </View>
              </View>
              <Text style={styles.syncText}>
                {syncState === "live"
                  ? copy.orderDetails.lastSync(syncTimestampLabel)
                  : syncState === "syncing"
                    ? copy.orderDetails.queuedWaiting(queuedLocationCount)
                    : copy.orderDetails.queuedRetry(queuedLocationCount)}
              </Text>
              {trackingError ? <Text style={styles.errorText}>{trackingError}</Text> : null}
            </View>
          ) : null}
        </View>

        {!isNetworkOnline || (!riderCoordinate && !isPickedUp) || (isAssignmentsPaused && order.assignmentState === "unassigned") ? (
          <View style={styles.warningCard}>
            <Ionicons name="warning-outline" size={18} color={palette.warningText} />
            <Text style={styles.warningText}>
              {!isNetworkOnline
                ? reconnectTrackingLabel
                : !riderCoordinate && !isPickedUp
                ? copy.orderDetails.riderLocationWarning
                : offlineAcceptWarning}
            </Text>
          </View>
        ) : null}

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>{copy.orderDetails.itemsTitle}</Text>
          </View>
          <View style={styles.itemList}>
            {itemRows.map((item: { name?: string; quantity?: number }, index: number) => (
              <View key={`${item.name}-${index}`} style={styles.itemRow}>
                <Text style={styles.itemQuantity}>{item.quantity}x</Text>
                <Text style={styles.itemName}>{item.name}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{copy.orderDetails.timelineTitle}</Text>
          <View style={styles.timelineList}>
            {timelineRows.map((entry: { status: string; createdAt: string | null }, index: number) => (
              <View key={`${entry.status}-${index}`} style={styles.timelineRow}>
                <View style={styles.timelineDot} />
                <View style={styles.timelineCopyWrap}>
                  <Text style={styles.timelineStatus}>{entry.status}</Text>
                  <Text style={styles.timelineMeta}>{formatDateTime(entry.createdAt)}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {isAcceptStep ? (
          <Pressable
            style={[styles.primaryAction, isAcceptDisabled && styles.buttonDisabled]}
            onPress={handleAccept}
            disabled={isAcceptDisabled}
          >
            {acceptMutation.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                <Text style={styles.primaryActionText}>
                  {!isNetworkOnline ? reconnectActionLabel : copy.orderDetails.acceptOrder}
                </Text>
              </>
            )}
          </Pressable>
        ) : null}

        {isPickupStep ? (
          <View style={styles.holdShell}>
            <Text style={styles.holdTitle}>{copy.orderDetails.pickUpOrder}</Text>
            <Pressable
              style={[styles.holdButton, isPickupDisabled && styles.buttonDisabled]}
              onPressIn={startPickupHold}
              onPressOut={cancelHoldAction}
              disabled={isPickupDisabled}
            >
              <View style={[styles.holdProgressFill, { width: `${holdProgress * 100}%` }]} />
              <View style={styles.holdButtonContent}>
                {pickupMutation.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="bag-handle-outline" size={18} color="#fff" />
                )}
                <Text style={styles.holdButtonText}>
                  {!isNetworkOnline ? reconnectActionLabel : copy.orderDetails.pickUpOrder}
                </Text>
              </View>
            </Pressable>
          </View>
        ) : null}

        {order.status === "PickedUp" && !order.isTrackingActiveForRider ? (
          <Pressable
            style={[styles.secondaryAction, isTrackingActivationDisabled && styles.buttonDisabled]}
            onPress={handleActivateTracking}
            disabled={isTrackingActivationDisabled}
          >
            {activateTrackingMutation.isPending ? (
              <ActivityIndicator size="small" color={palette.primaryStrong} />
            ) : (
              <>
                <Ionicons name="navigate-outline" size={18} color={palette.primaryStrong} />
                <Text style={styles.secondaryActionText}>
                  {!isNetworkOnline ? reconnectActionLabel : copy.orderDetails.makeLiveTrip}
                </Text>
              </>
            )}
          </Pressable>
        ) : null}

        {order.status === "PickedUp" ? (
          <View style={styles.holdShell}>
            <Text style={styles.holdTitle}>{copy.orderDetails.holdToDeliver}</Text>
            <Pressable
              style={[styles.holdButton, isDeliverDisabled && styles.buttonDisabled]}
              onPressIn={startDeliverHold}
              onPressOut={cancelHoldAction}
              disabled={isDeliverDisabled}
            >
              <View style={[styles.holdProgressFill, { width: `${holdProgress * 100}%` }]} />
              <View style={styles.holdButtonContent}>
                {deliverMutation.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="checkmark-done-outline" size={18} color="#fff" />
                )}
                <Text style={styles.holdButtonText}>
                  {!isNetworkOnline ? reconnectActionLabel : copy.orderDetails.holdToDeliver}
                </Text>
              </View>
            </Pressable>
          </View>
        ) : null}
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
    padding: 20,
    paddingBottom: 32,
    gap: 16,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.background,
    padding: 20,
  },
  emptyText: {
    fontSize: 14,
    color: palette.mutedForeground,
    textAlign: "center",
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  topIdentityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  orderHeadingWrap: {
    gap: 2,
  },
  topOrderId: {
    fontSize: 18,
    fontWeight: "800",
    color: palette.foreground,
  },
  topOrderStatus: {
    fontSize: 13,
    fontWeight: "700",
    color: palette.secondary,
  },
  topStatusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
  },
  topStatusBadgeOnline: {
    backgroundColor: palette.successSurface,
    borderColor: "#B7E8D1",
  },
  topStatusBadgeOffline: {
    backgroundColor: "#F4EDE6",
    borderColor: palette.border,
  },
  topStatusBadgeText: {
    fontSize: 12,
    fontWeight: "800",
  },
  topStatusBadgeTextOnline: {
    color: palette.successText,
  },
  topStatusBadgeTextOffline: {
    color: palette.mutedForeground,
  },
  mapCard: {
    backgroundColor: palette.surface,
    borderRadius: 28,
    paddingTop: 16,
    paddingBottom: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: palette.border,
    overflow: "hidden",
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: palette.foreground,
  },
  mapModeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: palette.surfaceMuted,
    borderWidth: 1,
    borderColor: palette.border,
  },
  mapModeTextWrap: {
    gap: 1,
  },
  mapModeLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: palette.mutedForeground,
    textTransform: "uppercase",
  },
  mapModeValue: {
    fontSize: 13,
    fontWeight: "800",
    color: palette.primaryStrong,
  },
  mapShell: {
    overflow: "hidden",
  },
  map: {
    height: 372,
  },
  markerRoot: {
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
  },
  customerMarkerPin: {
    width: 26,
    height: 26,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.secondary,
    borderWidth: 2,
    borderColor: palette.surface,
    shadowColor: palette.shadow,
    shadowOpacity: 0.75,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  restaurantMarkerPin: {
    width: 26,
    height: 26,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.primary,
    borderWidth: 2,
    borderColor: palette.surface,
    shadowColor: palette.shadow,
    shadowOpacity: 0.75,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  riderMarkerPin: {
    width: 26,
    height: 26,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.amber,
    borderWidth: 2,
    borderColor: palette.surface,
    shadowColor: palette.shadow,
    shadowOpacity: 0.75,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  mapActionDock: {
    position: "absolute",
    right: 12,
    top: 12,
    gap: 8,
    alignItems: "flex-end",
  },
  mapUtilityButton: {
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: palette.secondary,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  mapUtilityButtonText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#fff",
  },
  mapLegendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 16,
  },
  legendChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: palette.surfaceMuted,
  },
  legendPrimaryLine: {
    width: 24,
    height: 0,
    borderTopWidth: 3,
    borderStyle: "dashed",
    borderColor: palette.secondary,
  },
  legendSecondaryLine: {
    width: 24,
    height: 0,
    borderTopWidth: 3,
    borderStyle: "dashed",
    borderColor: palette.amber,
  },
  legendText: {
    fontSize: 12,
    fontWeight: "700",
    color: palette.foreground,
  },
  perspectiveHint: {
    fontSize: 12,
    color: palette.mutedForeground,
  },
  metricsRow: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
  },
  metricCard: {
    flex: 1,
    borderRadius: 22,
    padding: 12,
    gap: 4,
  },
  metricRose: {
    backgroundColor: "#FFE8F0",
  },
  metricSky: {
    backgroundColor: "#EAF1FF",
  },
  metricAmber: {
    backgroundColor: "#FFF1D9",
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: palette.mutedForeground,
    textTransform: "uppercase",
  },
  metricValue: {
    fontSize: 15,
    fontWeight: "800",
    color: palette.foreground,
  },
  metricMeta: {
    fontSize: 12,
    color: palette.mutedForeground,
    lineHeight: 18,
  },
  etaCard: {
    marginHorizontal: 16,
    borderRadius: 22,
    padding: 14,
    gap: 4,
    backgroundColor: palette.surfaceMuted,
  },
  etaLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: palette.mutedForeground,
    textTransform: "uppercase",
  },
  etaValue: {
    fontSize: 20,
    fontWeight: "800",
    color: palette.foreground,
  },
  etaMeta: {
    fontSize: 12,
    lineHeight: 18,
    color: palette.mutedForeground,
  },
  syncCard: {
    marginHorizontal: 16,
    borderRadius: 20,
    padding: 14,
    gap: 6,
    backgroundColor: palette.surfaceMuted,
  },
  syncHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  syncTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: palette.foreground,
  },
  syncStateBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  syncStateBadgeLive: {
    backgroundColor: palette.successSurface,
  },
  syncStateBadgeSyncing: {
    backgroundColor: "#EAF1FF",
  },
  syncStateBadgeOffline: {
    backgroundColor: palette.warningSurface,
  },
  syncStateBadgeText: {
    fontSize: 11,
    fontWeight: "800",
  },
  syncStateBadgeTextLive: {
    color: palette.successText,
  },
  syncStateBadgeTextSyncing: {
    color: palette.sky,
  },
  syncStateBadgeTextOffline: {
    color: palette.warningText,
  },
  syncText: {
    fontSize: 12,
    color: palette.mutedForeground,
    lineHeight: 18,
  },
  errorText: {
    fontSize: 12,
    color: "#DC2626",
    lineHeight: 18,
  },
  warningCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 18,
    padding: 14,
    backgroundColor: palette.warningSurface,
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: palette.warningText,
    fontWeight: "700",
  },
  dualCardRow: {
    flexDirection: "row",
    gap: 12,
  },
  infoCardHalf: {
    flex: 1,
    borderRadius: 24,
    padding: 16,
    gap: 10,
    borderWidth: 1,
  },
  infoCardRestaurant: {
    backgroundColor: "#FFF1EA",
    borderColor: "#F7C9B5",
  },
  infoCardCustomer: {
    backgroundColor: "#EEF4FF",
    borderColor: "#CCD9FF",
  },
  infoHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  infoHeaderMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  infoIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceMuted,
  },
  infoIconRestaurant: {
    backgroundColor: "#FFDCCB",
  },
  infoIconCustomer: {
    backgroundColor: "#DCE8FF",
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: palette.foreground,
  },
  infoText: {
    fontSize: 14,
    lineHeight: 20,
    color: palette.mutedForeground,
  },
  cardActionButton: {
    width: 36,
    height: 36,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.78)",
  },
  sectionCard: {
    backgroundColor: palette.surface,
    borderRadius: 24,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: palette.border,
  },
  sectionBadge: {
    fontSize: 12,
    fontWeight: "700",
    color: palette.secondary,
  },
  itemList: {
    gap: 10,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  itemQuantity: {
    minWidth: 36,
    fontSize: 13,
    fontWeight: "800",
    color: palette.secondary,
  },
  itemName: {
    flex: 1,
    fontSize: 14,
    color: palette.foreground,
  },
  timelineList: {
    gap: 12,
  },
  timelineRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    marginTop: 5,
    backgroundColor: palette.secondary,
  },
  timelineCopyWrap: {
    flex: 1,
    gap: 2,
  },
  timelineStatus: {
    fontSize: 14,
    fontWeight: "700",
    color: palette.foreground,
  },
  timelineMeta: {
    fontSize: 12,
    color: palette.mutedForeground,
  },
  primaryAction: {
    minHeight: 56,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: palette.primaryStrong,
  },
  primaryActionText: {
    fontSize: 16,
    fontWeight: "800",
    color: "#fff",
  },
  secondaryAction: {
    minHeight: 56,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: palette.surfaceMuted,
  },
  secondaryActionText: {
    fontSize: 16,
    fontWeight: "800",
    color: palette.primaryStrong,
  },
  buttonDisabled: {
    opacity: 0.72,
  },
  holdShell: {
    gap: 12,
    borderRadius: 24,
    padding: 16,
    backgroundColor: palette.primaryStrong,
  },
  holdTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#fff",
  },
  holdButton: {
    overflow: "hidden",
    minHeight: 58,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  holdProgressFill: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: palette.secondary,
  },
  holdButtonContent: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  holdButtonText: {
    fontSize: 16,
    fontWeight: "800",
    color: "#fff",
  },
});
