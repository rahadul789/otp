import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { secureStateStorage } from "@/src/lib/secure-storage";
import type { SavedLocation, StartupStatus } from "@/src/types/location";

type LocationStore = {
  startupStatus: StartupStatus;
  permissionGranted: boolean | null;
  currentCoordinates: { latitude: number; longitude: number } | null;
  selectedLocation: SavedLocation | null;
  savedLocations: SavedLocation[];
  setStartupStatus: (status: StartupStatus) => void;
  setPermissionGranted: (value: boolean) => void;
  setCurrentCoordinates: (coords: { latitude: number; longitude: number }) => void;
  setSelectedLocation: (location: SavedLocation) => void;
  upsertSavedLocation: (location: SavedLocation) => void;
  removeSavedLocation: (locationId: string) => void;
  hydrateSavedLocations: (locations: SavedLocation[]) => void;
};

function areLocationsEqual(left: SavedLocation[], right: SavedLocation[]) {
  if (left.length !== right.length) return false;

  return left.every((location, index) => {
    const next = right[index];
    return (
      location.id === next?.id &&
      location.label === next?.label &&
      location.address === next?.address &&
      location.latitude === next?.latitude &&
      location.longitude === next?.longitude &&
      location.source === next?.source &&
      Boolean(location.isDefault) === Boolean(next?.isDefault) &&
      (location.lastUsedAt ?? null) === (next?.lastUsedAt ?? null)
    );
  });
}

function sortLocations(locations: SavedLocation[]) {
  return [...locations].sort((left, right) => {
    if (left.isDefault && !right.isDefault) return -1;
    if (!left.isDefault && right.isDefault) return 1;

    const leftUsedAt = left.lastUsedAt ? new Date(left.lastUsedAt).getTime() : 0;
    const rightUsedAt = right.lastUsedAt ? new Date(right.lastUsedAt).getTime() : 0;
    return rightUsedAt - leftUsedAt;
  });
}

export const useLocationStore = create<LocationStore>()(
  persist(
    (set) => ({
      startupStatus: "loading_location",
      permissionGranted: null,
      currentCoordinates: null,
      selectedLocation: null,
      savedLocations: [],
      setStartupStatus: (startupStatus) => set({ startupStatus }),
      setPermissionGranted: (permissionGranted) => set({ permissionGranted }),
      setCurrentCoordinates: (currentCoordinates) => set({ currentCoordinates }),
      setSelectedLocation: (selectedLocation) => set({ selectedLocation }),
      upsertSavedLocation: (location) =>
        set((state) => {
          const withoutDuplicate = state.savedLocations.filter(
            (item) => item.id !== location.id
          );
          const nextLocations = sortLocations([
            {
              ...location,
              lastUsedAt: location.lastUsedAt ?? new Date().toISOString(),
            },
            ...withoutDuplicate,
          ]).slice(0, 3);

          return {
            savedLocations: nextLocations,
          };
        }),
      removeSavedLocation: (locationId) =>
        set((state) => {
          const nextLocations = state.savedLocations.filter(
            (location) => location.id !== locationId
          );
          const selectedLocation =
            state.selectedLocation?.id === locationId ? nextLocations[0] ?? null : state.selectedLocation;

          return {
            selectedLocation,
            savedLocations: nextLocations,
          };
        }),
      hydrateSavedLocations: (locations) =>
        set((state) => {
          const nextLocations = sortLocations(locations).slice(0, 3);
          const nextSelectedLocation =
            nextLocations.find((location) => location.id === state.selectedLocation?.id) ??
            state.selectedLocation ??
            nextLocations[0] ??
            null;

          const selectedLocationUnchanged =
            (state.selectedLocation?.id ?? null) === (nextSelectedLocation?.id ?? null) &&
            (state.selectedLocation?.address ?? null) === (nextSelectedLocation?.address ?? null) &&
            (state.selectedLocation?.label ?? null) === (nextSelectedLocation?.label ?? null) &&
            (state.selectedLocation?.lastUsedAt ?? null) === (nextSelectedLocation?.lastUsedAt ?? null) &&
            (state.selectedLocation?.isDefault ?? false) === (nextSelectedLocation?.isDefault ?? false);

          if (
            areLocationsEqual(state.savedLocations, nextLocations) &&
            selectedLocationUnchanged
          ) {
            return state;
          }

          return {
            selectedLocation: nextSelectedLocation,
            savedLocations: nextLocations,
          };
        }),
    }),
    {
      name: "customer-location-state",
      storage: createJSONStorage(() => secureStateStorage),
      partialize: (state) => ({
        permissionGranted: state.permissionGranted,
        currentCoordinates: state.currentCoordinates,
        selectedLocation: state.selectedLocation,
        savedLocations: state.savedLocations,
      }),
    }
  )
);
