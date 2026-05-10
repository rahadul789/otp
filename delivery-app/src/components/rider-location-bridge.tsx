import * as Location from "expo-location";
import { PropsWithChildren, useEffect, useRef } from "react";

import { useUpdateRiderProfileLocationMutation } from "@/src/hooks/use-rider-api";
import { useRiderAuthStore } from "@/src/store/auth-store";

const HEARTBEAT_INTERVAL_MS = 60000;

export function RiderLocationBridge({ children }: PropsWithChildren) {
  const rider = useRiderAuthStore((state) => state.rider);
  const updateLocationMutation = useUpdateRiderProfileLocationMutation();
  const mutateProfileLocation = updateLocationMutation.mutate;
  const isLocationMutationPendingRef = useRef(false);
  const lastSentAtRef = useRef(0);

  useEffect(() => {
    isLocationMutationPendingRef.current = updateLocationMutation.isPending;
  }, [updateLocationMutation.isPending]);

  useEffect(() => {
    if (!rider?.id || rider.isAvailableForAssignments === false || rider.activeTrackingOrderId) {
      return;
    }

    let subscription: Location.LocationSubscription | null = null;
    let isMounted = true;

    const start = async () => {
      const permission = await Location.getForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        return;
      }

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: HEARTBEAT_INTERVAL_MS,
          distanceInterval: 80,
        },
        (position) => {
          if (!isMounted || isLocationMutationPendingRef.current) {
            return;
          }

          const now = Date.now();
          if (now - lastSentAtRef.current < HEARTBEAT_INTERVAL_MS) {
            return;
          }

          lastSentAtRef.current = now;
          mutateProfileLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            heading: typeof position.coords.heading === "number" ? position.coords.heading : undefined,
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

    void start();

    return () => {
      isMounted = false;
      subscription?.remove();
    };
  }, [
    rider?.activeTrackingOrderId,
    rider?.id,
    rider?.isAvailableForAssignments,
    mutateProfileLocation,
  ]);

  return children;
}
