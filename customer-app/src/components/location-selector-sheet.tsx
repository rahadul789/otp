import React from "react";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  useCustomerDeleteLocationMutation,
  useCustomerSaveLocationMutation,
  useCustomerTouchLocationMutation,
} from "@/src/hooks/use-customer-api";
import { useCustomerAuthStore } from "@/src/store/auth-store";
import { useLocationStore } from "@/src/store/location-store";
import { palette } from "@/src/theme/palette";
import type { SavedLocation } from "@/src/types/location";

type Props = {
  visible: boolean;
  onClose: () => void;
};

type LocationRowProps = {
  location: SavedLocation;
  isSelected: boolean;
  isDeleting: boolean;
  onPress: (locationId: string) => void;
  onEdit: (locationId: string) => void;
  onDelete: (locationId: string) => void;
};

const LocationRow = React.memo(function LocationRow({
  location,
  isSelected,
  isDeleting,
  onPress,
  onEdit,
  onDelete,
}: LocationRowProps) {
  return (
    <View
      style={[
        styles.locationCard,
        isSelected ? styles.locationCardSelected : null,
      ]}
    >
      <Pressable
        style={styles.locationCardBody}
        onPress={() => onPress(location.id)}
      >
        <View
          style={[
            styles.locationIconWrap,
            isSelected ? styles.locationIconWrapSelected : null,
          ]}
        >
          <Ionicons
            name={location.source === "gps" ? "navigate" : "location"}
            size={17}
            color={isSelected ? "#fff" : palette.secondary}
          />
        </View>

        <View style={styles.locationCopy}>
          <View style={styles.locationLabelRow}>
            <Text style={styles.locationLabel}>{location.label}</Text>
            {isSelected ? (
              <View style={styles.selectedInline}>
                <Ionicons
                  name="checkmark-circle"
                  size={14}
                  color={palette.secondary}
                />
                <Text style={styles.selectedInlineText}>Selected</Text>
              </View>
            ) : null}
          </View>
          <Text numberOfLines={2} style={styles.locationAddress}>
            {location.address}
          </Text>
        </View>
      </Pressable>

      <View style={styles.locationFooter}>
        <Text style={styles.locationMeta}>
          {location.lastUsedAt ? "Recently used" : "Saved place"}
        </Text>

        {location.id !== "current-location" ? (
          <View style={styles.locationActionIcons}>
            <Pressable
              style={styles.locationIconButton}
              onPress={() => onEdit(location.id)}
            >
              <Ionicons name="create-outline" size={17} color={palette.sky} />
            </Pressable>
            <Pressable
              style={[
                styles.locationIconButton,
                styles.locationIconButtonDanger,
              ]}
              onPress={() => onDelete(location.id)}
            >
              {isDeleting ? (
                <ActivityIndicator size="small" color={palette.secondary} />
              ) : (
                <Ionicons
                  name="trash-outline"
                  size={17}
                  color={palette.secondary}
                />
              )}
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
});

export function LocationSelectorSheet({ visible, onClose }: Props) {
  const LOCATION_PICKER_PATH = "/location-picker" as const;
  const LOCATION_PICKER_TIGHT_DELTA = 0.0045;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const selectedLocation = useLocationStore((state) => state.selectedLocation);
  const savedLocations = useLocationStore((state) => state.savedLocations);
  const removeSavedLocation = useLocationStore(
    (state) => state.removeSavedLocation,
  );
  const setCurrentCoordinates = useLocationStore(
    (state) => state.setCurrentCoordinates,
  );
  const setSelectedLocation = useLocationStore(
    (state) => state.setSelectedLocation,
  );
  const upsertSavedLocation = useLocationStore(
    (state) => state.upsertSavedLocation,
  );
  const hydrateSavedLocations = useLocationStore(
    (state) => state.hydrateSavedLocations,
  );
  const setPermissionGranted = useLocationStore(
    (state) => state.setPermissionGranted,
  );
  const setStartupStatus = useLocationStore((state) => state.setStartupStatus);
  const isAuthenticated = useCustomerAuthStore((state) =>
    Boolean(state.accessToken),
  );
  const saveLocationMutation = useCustomerSaveLocationMutation();
  const touchLocationMutation = useCustomerTouchLocationMutation();
  const deleteLocationMutation = useCustomerDeleteLocationMutation();

  const backdropOpacity = React.useRef(new Animated.Value(0)).current;
  const sheetTranslateY = React.useRef(new Animated.Value(44)).current;
  const [isMounted, setIsMounted] = React.useState(visible);
  const [isUsingCurrentLocation, setIsUsingCurrentLocation] =
    React.useState(false);
  const [pendingDeleteLocationId, setPendingDeleteLocationId] = React.useState<
    string | null
  >(null);

  const pendingDeleteLocation = React.useMemo(
    () =>
      savedLocations.find(
        (location) => location.id === pendingDeleteLocationId,
      ) ?? null,
    [pendingDeleteLocationId, savedLocations],
  );

  React.useEffect(() => {
    if (visible) {
      setIsMounted(true);
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.spring(sheetTranslateY, {
          toValue: 0,
          damping: 20,
          stiffness: 180,
          mass: 0.95,
          useNativeDriver: true,
        }),
      ]).start();
      return;
    }

    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(sheetTranslateY, {
        toValue: 28,
        duration: 180,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        setIsMounted(false);
      }
    });
  }, [backdropOpacity, sheetTranslateY, visible]);

  const handleSheetClose = React.useCallback(() => {
    if (isUsingCurrentLocation || deleteLocationMutation.isPending) {
      return;
    }
    onClose();
  }, [deleteLocationMutation.isPending, isUsingCurrentLocation, onClose]);

  const dismissSheetInstantly = React.useCallback(() => {
    backdropOpacity.stopAnimation();
    sheetTranslateY.stopAnimation();
    backdropOpacity.setValue(0);
    sheetTranslateY.setValue(28);
    setIsMounted(false);
    onClose();
  }, [backdropOpacity, onClose, sheetTranslateY]);

  const handleUseCurrentLocation = React.useCallback(async () => {
    try {
      setIsUsingCurrentLocation(true);

      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setPermissionGranted(false);
        setStartupStatus("permission_denied");
        return;
      }

      setPermissionGranted(true);
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const coords = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };

      setCurrentCoordinates(coords);

      let address = "Current precise location";
      let label = "Current location";

      try {
        const reverse = await Location.reverseGeocodeAsync(coords);
        const first = reverse[0];
        label =
          first?.name ||
          first?.street ||
          first?.district ||
          first?.city ||
          label;
        address =
          [
            first?.name,
            first?.street,
            first?.district,
            first?.city,
            first?.region,
          ]
            .filter(Boolean)
            .join(", ") || address;
      } catch {
        // Keep GPS coordinates even if reverse geocoding fails.
      }

      const location = {
        id: "current-location",
        label,
        address,
        latitude: coords.latitude,
        longitude: coords.longitude,
        source: "gps" as const,
        lastUsedAt: new Date().toISOString(),
      };

      setSelectedLocation(location);
      upsertSavedLocation(location);
      setStartupStatus("ready");

      if (isAuthenticated) {
        try {
          const locations = await saveLocationMutation.mutateAsync({
            label,
            address,
            latitude: coords.latitude,
            longitude: coords.longitude,
            source: "gps",
          });

          const nextLocations = locations.map((item) => ({
            id: item.id,
            label: item.label,
            address: item.address,
            latitude: item.latitude,
            longitude: item.longitude,
            source: item.source,
            isDefault: item.isDefault,
            lastUsedAt: item.lastUsedAt,
          }));

          hydrateSavedLocations(nextLocations);
          const matchedLocation =
            nextLocations.find(
              (item) =>
                item.latitude === coords.latitude &&
                item.longitude === coords.longitude &&
                item.address === address,
            ) ?? nextLocations[0];

          if (matchedLocation) {
            setSelectedLocation(matchedLocation);
          }
        } catch {
          // Keep local flow responsive even if sync fails.
        }
      }

      onClose();
    } finally {
      setIsUsingCurrentLocation(false);
    }
  }, [
    hydrateSavedLocations,
    isAuthenticated,
    onClose,
    saveLocationMutation,
    setCurrentCoordinates,
    setPermissionGranted,
    setSelectedLocation,
    setStartupStatus,
    upsertSavedLocation,
  ]);

  const handleSavedLocationPress = React.useCallback(
    async (locationId: string) => {
      const nextLocation = savedLocations.find(
        (location) => location.id === locationId,
      );
      if (!nextLocation) return;

      setSelectedLocation({
        ...nextLocation,
        lastUsedAt: new Date().toISOString(),
      });

      dismissSheetInstantly();

      if (
        isAuthenticated &&
        locationId !== "current-location" &&
        !locationId.startsWith("loc-")
      ) {
        void touchLocationMutation.mutateAsync(locationId).catch(() => {
          // Keep local selection even if backend sync fails.
        });
      }
    },
    [
      dismissSheetInstantly,
      isAuthenticated,
      savedLocations,
      setSelectedLocation,
      touchLocationMutation,
    ],
  );

  const handleDeleteSavedLocation = React.useCallback(
    async (locationId: string) => {
      setPendingDeleteLocationId(null);
      removeSavedLocation(locationId);

      if (
        !isAuthenticated ||
        locationId === "current-location" ||
        locationId.startsWith("loc-")
      ) {
        return;
      }

      try {
        await deleteLocationMutation.mutateAsync(locationId);
      } catch {
        // Local cleanup is already applied for smoother UX.
      }
    },
    [deleteLocationMutation, isAuthenticated, removeSavedLocation],
  );

  const handleChooseOnMap = React.useCallback(() => {
    dismissSheetInstantly();
    router.push({
      pathname: LOCATION_PICKER_PATH,
      params: { mode: "refine", delta: String(LOCATION_PICKER_TIGHT_DELTA) },
    });
  }, [LOCATION_PICKER_PATH, LOCATION_PICKER_TIGHT_DELTA, dismissSheetInstantly, router]);

  const handleAddLocation = React.useCallback(() => {
    dismissSheetInstantly();
    router.push({
      pathname: LOCATION_PICKER_PATH,
      params: { mode: "add", delta: String(LOCATION_PICKER_TIGHT_DELTA) },
    });
  }, [LOCATION_PICKER_PATH, LOCATION_PICKER_TIGHT_DELTA, dismissSheetInstantly, router]);

  const handleEditLocation = React.useCallback(
    (locationId: string) => {
      dismissSheetInstantly();
      router.push({
        pathname: LOCATION_PICKER_PATH,
        params: {
          mode: "edit",
          locationId,
          delta: String(LOCATION_PICKER_TIGHT_DELTA),
        },
      });
    },
    [LOCATION_PICKER_PATH, LOCATION_PICKER_TIGHT_DELTA, dismissSheetInstantly, router],
  );

  const renderLocationItem = React.useCallback(
    ({ item }: { item: SavedLocation }) => (
      <LocationRow
        location={item}
        isSelected={selectedLocation?.id === item.id}
        isDeleting={
          deleteLocationMutation.isPending &&
          pendingDeleteLocationId === item.id
        }
        onPress={handleSavedLocationPress}
        onEdit={handleEditLocation}
        onDelete={setPendingDeleteLocationId}
      />
    ),
    [
      deleteLocationMutation.isPending,
      handleEditLocation,
      handleSavedLocationPress,
      pendingDeleteLocationId,
      selectedLocation?.id,
    ],
  );

  if (!isMounted && !visible) {
    return null;
  }

  return (
    <>
      <Modal
        visible={isMounted}
        transparent
        animationType="none"
        onRequestClose={handleSheetClose}
      >
        <View style={styles.modalRoot}>
          <Animated.View
            style={[
              styles.backdrop,
              {
                opacity: backdropOpacity,
              },
            ]}
          >
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={handleSheetClose}
            />
          </Animated.View>

          <Animated.View
            style={[
              styles.sheetWrap,
              {
                transform: [{ translateY: sheetTranslateY }],
                paddingBottom: Math.max(insets.bottom, 16),
              },
            ]}
          >
            <View style={styles.handle} />

            <View style={styles.headerRow}>
              <View style={styles.headerCopy}>
                <Text style={styles.title}>Choose delivery location</Text>
                <Text style={styles.subtitle}>
                  Pick where you want your order delivered.
                </Text>
              </View>
              <Pressable style={styles.closeButton} onPress={handleSheetClose}>
                <Ionicons name="close" size={18} color={palette.foreground} />
              </Pressable>
            </View>

            {selectedLocation ? (
              <View style={styles.selectedSummary}>
                <View style={styles.selectedSummaryIcon}>
                  <Ionicons
                    name="checkmark-circle"
                    size={18}
                    color={palette.secondary}
                  />
                </View>
                <View style={styles.selectedSummaryCopy}>
                  <Text style={styles.selectedSummaryLabel}>
                    Delivering to
                  </Text>
                  <Text numberOfLines={1} style={styles.selectedSummaryTitle}>
                    {selectedLocation.label}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={styles.selectedSummaryAddress}
                  >
                    {selectedLocation.address}
                  </Text>
                </View>
              </View>
            ) : null}

            <View style={styles.actionStack}>
              <Pressable
                style={styles.primaryAction}
                onPress={handleUseCurrentLocation}
                disabled={isUsingCurrentLocation}
              >
                {isUsingCurrentLocation ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="locate" size={18} color="#fff" />
                )}
                <Text style={styles.primaryActionText}>
                  {isUsingCurrentLocation
                    ? "Finding your location..."
                    : "Use current location"}
                </Text>
              </Pressable>

              <View style={styles.secondaryActionRow}>
                <Pressable
                  style={styles.secondaryAction}
                  onPress={handleChooseOnMap}
                >
                  <View style={[styles.actionIconShell, styles.actionIconPink]}>
                    <Ionicons
                      name="map-outline"
                      size={17}
                      color={palette.foreground}
                    />
                  </View>
                  <View style={styles.actionCopy}>
                    <Text style={styles.secondaryActionText}>
                      Choose on map
                    </Text>
                    <Text style={styles.secondaryActionMeta}>
                      Refine the pin exactly where you want it.
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={palette.foreground}
                  />
                </Pressable>
              </View>
            </View>

            <View style={styles.savedHeader}>
              <Text style={styles.savedTitle}>Saved locations</Text>
              <View style={styles.savedHeaderActions}>
                {savedLocations.length < 3 ? (
                  <Pressable
                    style={styles.savedAddBadge}
                    onPress={handleAddLocation}
                  >
                    <Ionicons name="add" size={13} color={palette.sky} />
                    <Text style={styles.savedAddBadgeText}>Add</Text>
                  </Pressable>
                ) : null}
                <View style={styles.savedHeaderMeta}>
                  <Ionicons
                    name="bookmark-outline"
                    size={14}
                    color={palette.mutedForeground}
                  />
                  <Text style={styles.savedCount}>
                    {savedLocations.length}/3
                  </Text>
                </View>
              </View>
            </View>

            <FlatList
              data={savedLocations}
              keyExtractor={(item) => item.id}
              renderItem={renderLocationItem}
              style={styles.savedList}
              contentContainerStyle={styles.savedListContent}
              showsVerticalScrollIndicator={false}
              removeClippedSubviews
              initialNumToRender={4}
              maxToRenderPerBatch={4}
              windowSize={5}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <View style={styles.emptyIconWrap}>
                    <Ionicons
                      name="location-outline"
                      size={18}
                      color={palette.secondary}
                    />
                  </View>
                  <Text style={styles.emptyStateTitle}>
                    No saved location yet
                  </Text>
                  <Text style={styles.emptyStateText}>
                    Confirm a place once and it will stay here for faster
                    switching next time.
                  </Text>
                </View>
              }
            />
          </Animated.View>
        </View>
      </Modal>

      <Modal
        transparent
        visible={Boolean(pendingDeleteLocation)}
        animationType="fade"
        onRequestClose={() => setPendingDeleteLocationId(null)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setPendingDeleteLocationId(null)}
          />
          <View style={styles.modalCard}>
            <View style={styles.modalIconWrap}>
              <Ionicons
                name="trash-outline"
                size={18}
                color={palette.primary}
              />
            </View>
            <Text style={styles.modalTitle}>Delete saved place?</Text>
            <Text style={styles.modalSubtitle}>
              {pendingDeleteLocation?.label} will be removed from your saved
              addresses.
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalGhostButton}
                onPress={() => setPendingDeleteLocationId(null)}
              >
                <Text style={styles.modalGhostButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.modalDeleteButton}
                onPress={() => {
                  if (pendingDeleteLocationId) {
                    void handleDeleteSavedLocation(pendingDeleteLocationId);
                  }
                }}
              >
                <Text style={styles.modalDeleteButtonText}>Delete</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(16, 20, 28, 0.22)",
  },
  sheetWrap: {
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    backgroundColor: palette.surface,
    paddingHorizontal: 20,
    paddingTop: 12,
    maxHeight: "80%",
    shadowColor: palette.shadow,
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.12,
    shadowRadius: 22,
    elevation: 12,
  },
  handle: {
    alignSelf: "center",
    width: 46,
    height: 5,
    borderRadius: 999,
    backgroundColor: "#E8DEE5",
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  headerCopy: {
    flex: 1,
    gap: 6,
  },
  title: {
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "800",
    color: palette.foreground,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
    color: palette.mutedForeground,
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FBF7FB",
    borderWidth: 1,
    borderColor: "#EADDE6",
  },
  selectedSummary: {
    marginTop: 16,
    borderRadius: 22,
    backgroundColor: "#FFF5F8",
    borderWidth: 1,
    borderColor: "#F4CFDC",
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  selectedSummaryIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#FFE7F0",
    alignItems: "center",
    justifyContent: "center",
  },
  selectedSummaryCopy: {
    flex: 1,
    gap: 2,
  },
  selectedSummaryLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    color: palette.secondary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  selectedSummaryTitle: {
    fontSize: 15,
    lineHeight: 19,
    fontWeight: "800",
    color: palette.foreground,
  },
  selectedSummaryAddress: {
    fontSize: 12,
    lineHeight: 17,
    color: palette.mutedForeground,
  },
  actionStack: {
    marginTop: 18,
    gap: 12,
  },
  primaryAction: {
    minHeight: 56,
    borderRadius: 22,
    backgroundColor: palette.foreground,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    shadowColor: "rgba(255, 99, 146, 0.28)",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 1,
    shadowRadius: 20,
    elevation: 5,
  },
  primaryActionText: {
    fontSize: 15,
    lineHeight: 19,
    fontWeight: "800",
    color: "#fff",
  },
  secondaryActionRow: {
    gap: 10,
  },
  secondaryAction: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#E9DFE6",
    backgroundColor: palette.surface,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  actionIconShell: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  actionIconPink: {
    backgroundColor: "#F7F1F5",
  },
  actionCopy: {
    flex: 1,
    gap: 2,
  },
  secondaryActionText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    color: palette.foreground,
  },
  secondaryActionMeta: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "500",
    color: palette.mutedForeground,
  },
  savedHeader: {
    marginTop: 20,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  savedHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  savedTitle: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "800",
    color: palette.foreground,
  },
  savedAddBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#F8F2F6",
    borderWidth: 1,
    borderColor: "#E5D7E0",
  },
  savedAddBadgeText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    color: palette.secondary,
  },
  savedHeaderMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  savedCount: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    color: palette.mutedForeground,
  },
  savedList: {
    flexGrow: 0,
  },
  savedListContent: {
    paddingBottom: 10,
    gap: 12,
    flexGrow: 1,
  },
  emptyState: {
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "#E9DFE6",
    backgroundColor: palette.surface,
    padding: 18,
    alignItems: "center",
    gap: 8,
  },
  emptyIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFEAF1",
  },
  emptyStateTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    color: palette.foreground,
  },
  emptyStateText: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    color: palette.mutedForeground,
  },
  locationCard: {
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "#E9DFE6",
    backgroundColor: palette.surface,
    padding: 16,
    gap: 12,
  },
  locationCardSelected: {
    borderColor: palette.secondary,
    backgroundColor: "#FFF7FA",
  },
  locationCardBody: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  locationIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F6F0FF",
  },
  locationIconWrapSelected: {
    backgroundColor: palette.secondary,
  },
  locationCopy: {
    flex: 1,
    gap: 5,
  },
  locationLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  locationLabel: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    color: palette.foreground,
  },
  locationBadge: {
    borderRadius: 999,
    backgroundColor: "#FFF7FA",
    borderWidth: 1,
    borderColor: "#E6D8E2",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  locationBadgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    color: palette.secondary,
  },
  activeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#FFF0F6",
    borderWidth: 1,
    borderColor: palette.secondary,
  },
  activeBadgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    color: palette.secondary,
  },
  selectedInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  selectedInlineText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    color: palette.secondary,
  },
  locationAddress: {
    fontSize: 13,
    lineHeight: 19,
    color: palette.mutedForeground,
  },
  locationFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingLeft: 56,
  },
  locationMeta: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    color: palette.mutedForeground,
  },
  locationActionIcons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  locationIconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F5F1F6",
  },
  locationIconButtonDanger: {
    backgroundColor: "#FFF2F6",
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(30, 34, 43, 0.28)",
  },
  modalCard: {
    padding: 20,
    borderRadius: 28,
    backgroundColor: palette.surface,
    gap: 14,
    shadowColor: palette.shadow,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 6,
  },
  modalIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceMuted,
  },
  modalTitle: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: "800",
    color: palette.foreground,
  },
  modalSubtitle: {
    fontSize: 14,
    lineHeight: 22,
    color: palette.mutedForeground,
  },
  modalActions: {
    flexDirection: "row",
    gap: 10,
  },
  modalGhostButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceMuted,
  },
  modalGhostButtonText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.foreground,
  },
  modalDeleteButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.secondary,
  },
  modalDeleteButtonText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.surface,
  },
});
