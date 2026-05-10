import * as Location from "expo-location";
import { useEffect, useRef } from "react";

import { useLocationStore } from "@/src/store/location-store";

function buildAddress(
  address?: Partial<Location.LocationGeocodedAddress> | null
) {
  if (!address) return "Netrokona service area";

  return (
    [
      address.name,
      address.street,
      address.district,
      address.city,
      address.region,
    ]
      .filter(Boolean)
      .join(", ") || "Netrokona service area"
  );
}

export function useAppStartup() {
  const hasStartedRef = useRef(false);
  const setStartupStatus = useLocationStore((state) => state.setStartupStatus);
  const setPermissionGranted = useLocationStore(
    (state) => state.setPermissionGranted
  );
  const setCurrentCoordinates = useLocationStore(
    (state) => state.setCurrentCoordinates
  );
  const setSelectedLocation = useLocationStore(
    (state) => state.setSelectedLocation
  );
  const upsertSavedLocation = useLocationStore((state) => state.upsertSavedLocation);

  useEffect(() => {
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;

    async function bootstrapLocation() {
      setStartupStatus("loading_location");

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setPermissionGranted(false);
        setStartupStatus("permission_denied");
        return;
      }

      setPermissionGranted(true);

      try {
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        const coords = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        setCurrentCoordinates(coords);

        let addressLabel = "Current location";
        let addressText = "Current precise location";

        try {
          const reverse = await Location.reverseGeocodeAsync(coords);
          const first = reverse[0];
          addressText = buildAddress(first);
          addressLabel = first?.name || "Current location";
        } catch {
          addressText = "Current precise location";
        }

        const location = {
          id: "current-location",
          label: addressLabel,
          address: addressText,
          latitude: coords.latitude,
          longitude: coords.longitude,
          source: "gps" as const,
        };

        setSelectedLocation(location);
        upsertSavedLocation(location);
        setStartupStatus("ready");
      } catch {
        setStartupStatus("location_unavailable");
      }
    }

    bootstrapLocation();
  }, [
    setCurrentCoordinates,
    setPermissionGranted,
    setSelectedLocation,
    setStartupStatus,
    upsertSavedLocation,
  ]);
}
