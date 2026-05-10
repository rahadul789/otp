import { useEffect } from "react";

import { useCustomerSavedLocationsQuery } from "@/src/hooks/use-customer-api";
import { useCustomerAuthStore } from "@/src/store/auth-store";
import { useLocationStore } from "@/src/store/location-store";

export function CustomerLocationSync() {
  const isAuthenticated = useCustomerAuthStore((state) => Boolean(state.accessToken));
  const hydrateSavedLocations = useLocationStore((state) => state.hydrateSavedLocations);

  const savedLocationsQuery = useCustomerSavedLocationsQuery(isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated) return;
    const backendLocations = savedLocationsQuery.data;
    if (!backendLocations) return;

    hydrateSavedLocations(
      backendLocations.map((location) => ({
        id: location.id,
        label: location.label,
        address: location.address,
        latitude: location.latitude,
        longitude: location.longitude,
        source: location.source,
        isDefault: location.isDefault,
        lastUsedAt: location.lastUsedAt,
      }))
    );
  }, [hydrateSavedLocations, isAuthenticated, savedLocationsQuery.data]);

  return null;
}
