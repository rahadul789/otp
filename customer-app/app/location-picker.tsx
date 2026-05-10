import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import MapView, { Region } from "react-native-maps";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import {
  useCustomerSaveLocationMutation,
  useCustomerUpdateLocationMutation,
} from "@/src/hooks/use-customer-api";
import { useCustomerAuthStore } from "@/src/store/auth-store";
import { useLocationStore } from "@/src/store/location-store";
import { palette } from "@/src/theme/palette";
import type { SavedLocation } from "@/src/types/location";

const DEFAULT_LOCATION_PICKER_DELTA = 0.0045;
const DEFAULT_LOCATION_PICKER_ZOOM = 17;
const MIN_LOCATION_PICKER_ZOOM = 14;
const MAX_LOCATION_PICKER_ZOOM = 20;

function buildResolvedAddress(
  result: Location.LocationGeocodedAddress | undefined,
) {
  if (!result) return "";

  return [
    result.name,
    result.street,
    result.district,
    result.city,
    result.region,
  ]
    .filter(Boolean)
    .join(", ");
}

function buildResolvedLabel(
  result: Location.LocationGeocodedAddress | undefined,
) {
  if (!result) return "";
  return result.name || result.street || result.district || result.city || "";
}

export default function LocationPickerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string; locationId?: string; delta?: string }>();
  const isAddMode = params.mode === "add";
  const isEditMode = params.mode === "edit";
  const mapDelta = useMemo(() => {
    const raw = Number(params.delta);
    if (Number.isFinite(raw) && raw > 0 && raw <= 0.02) {
      return raw;
    }
    return DEFAULT_LOCATION_PICKER_DELTA;
  }, [params.delta]);
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView | null>(null);
  const hasAppliedInitialCameraRef = useRef(false);
  const reverseGeocodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const pinPulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const isDraggingRef = useRef(false);

  const selectedLocation = useLocationStore((state) => state.selectedLocation);
  const savedLocations = useLocationStore((state) => state.savedLocations);
  const currentCoordinates = useLocationStore(
    (state) => state.currentCoordinates,
  );
  const upsertSavedLocation = useLocationStore(
    (state) => state.upsertSavedLocation,
  );
  const hydrateSavedLocations = useLocationStore(
    (state) => state.hydrateSavedLocations,
  );
  const setSelectedLocation = useLocationStore(
    (state) => state.setSelectedLocation,
  );
  const isAuthenticated = useCustomerAuthStore((state) =>
    Boolean(state.accessToken),
  );
  const saveLocationMutation = useCustomerSaveLocationMutation();
  const updateLocationMutation = useCustomerUpdateLocationMutation();

  const editingLocation =
    isEditMode && typeof params.locationId === "string"
      ? savedLocations.find((location) => location.id === params.locationId) ?? null
      : null;

  const initialLabel = editingLocation
    ? editingLocation.label
    : isAddMode
      ? "New location"
      : selectedLocation?.label ?? "Current location";
  const initialAddress = editingLocation
    ? editingLocation.address
    : isAddMode
      ? ""
      : selectedLocation?.address ?? "";

  const [label, setLabel] = useState(
    initialLabel,
  );
  const [address, setAddress] = useState(initialAddress);
  const [manualNote, setManualNote] = useState("");
  const [isResolvingAddress, setIsResolvingAddress] = useState(false);
  const [isLoadingInitialRegion, setIsLoadingInitialRegion] = useState(
    !selectedLocation && !currentCoordinates,
  );
  const [isLocating, setIsLocating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [region, setRegion] = useState<Region | null>(
    editingLocation
      ? {
          latitude: editingLocation.latitude,
          longitude: editingLocation.longitude,
          latitudeDelta: mapDelta,
          longitudeDelta: mapDelta,
        }
      : !isAddMode && selectedLocation
      ? {
          latitude: selectedLocation.latitude,
          longitude: selectedLocation.longitude,
          latitudeDelta: mapDelta,
          longitudeDelta: mapDelta,
        }
      : currentCoordinates
        ? {
            latitude: currentCoordinates.latitude,
            longitude: currentCoordinates.longitude,
            latitudeDelta: mapDelta,
            longitudeDelta: mapDelta,
          }
        : null,
  );

  const pinLift = useRef(new Animated.Value(0)).current;
  const pinPulse = useRef(new Animated.Value(1)).current;
  const pinBob = useRef(new Animated.Value(0)).current;
  const pinHalo = useRef(new Animated.Value(0)).current;
  const currentPulse = useRef(new Animated.Value(1)).current;

  const isConfirming = useMemo(
    () =>
      isSubmitting ||
      saveLocationMutation.isPending ||
      updateLocationMutation.isPending,
    [isSubmitting, saveLocationMutation.isPending, updateLocationMutation.isPending],
  );

  useEffect(() => {
    const bobAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(pinBob, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pinBob, {
          toValue: 0,
          duration: 1200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );

    const haloAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(pinHalo, {
          toValue: 1,
          duration: 1500,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pinHalo, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );

    bobAnimation.start();
    haloAnimation.start();

    return () => {
      bobAnimation.stop();
      haloAnimation.stop();
      pinPulseLoopRef.current?.stop();
      if (reverseGeocodeTimerRef.current) {
        clearTimeout(reverseGeocodeTimerRef.current);
      }
    };
  }, [pinBob, pinHalo]);

  useEffect(() => {
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const showSubscription = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const resolveAddress = useCallback(async (
    latitude: number,
    longitude: number,
    _preserveManual = true,
  ) => {
    setIsResolvingAddress(true);
    try {
      const result = await Location.reverseGeocodeAsync({
        latitude,
        longitude,
      });
      const first = result[0];
      if (!first) return;

      const nextAddress = buildResolvedAddress(first);

      if (nextAddress) {
        setAddress(nextAddress);
      }

      const nextLabel = buildResolvedLabel(first);
      if (nextLabel) {
        setLabel(nextLabel);
      }
    } catch {
      // Keep manual input if reverse geocoding fails.
    } finally {
      setIsResolvingAddress(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function ensureInitialRegion() {
      if (region) {
        setIsLoadingInitialRegion(false);
        return;
      }

      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== "granted") {
          if (isMounted) {
            setIsLoadingInitialRegion(false);
          }
          return;
        }

        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        if (!isMounted) return;

        const nextRegion = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          latitudeDelta: mapDelta,
          longitudeDelta: mapDelta,
        };
        setRegion(nextRegion);
        void resolveAddress(nextRegion.latitude, nextRegion.longitude, false);
      } finally {
        if (isMounted) {
          setIsLoadingInitialRegion(false);
        }
      }
    }

    void ensureInitialRegion();

    return () => {
      isMounted = false;
    };
  }, [mapDelta, region, resolveAddress]);

  const applyInitialCamera = useCallback(() => {
    if (!region || hasAppliedInitialCameraRef.current || !mapRef.current) {
      return;
    }

    hasAppliedInitialCameraRef.current = true;
    mapRef.current.animateCamera(
      {
        center: {
          latitude: region.latitude,
          longitude: region.longitude,
        },
        zoom: DEFAULT_LOCATION_PICKER_ZOOM,
        heading: 0,
        pitch: 0,
      },
      { duration: 0 },
    );
  }, [region]);

  useEffect(() => {
    setLabel(initialLabel);
    setAddress(initialAddress);
    setManualNote("");
  }, [initialAddress, initialLabel]);

  function startDraggingPin() {
    if (isDraggingRef.current) return;
    isDraggingRef.current = true;

    Animated.timing(pinLift, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    pinPulseLoopRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pinPulse, {
          toValue: 1.08,
          duration: 320,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pinPulse, {
          toValue: 1,
          duration: 320,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    pinPulseLoopRef.current.start();
  }

  function stopDraggingPin() {
    isDraggingRef.current = false;
    pinPulseLoopRef.current?.stop();
    pinPulse.setValue(1);

    Animated.timing(pinLift, {
      toValue: 0,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }

  function handleRegionChange() {
    startDraggingPin();
  }

  function handleRegionChangeComplete(nextRegion: Region) {
    stopDraggingPin();
    setRegion(nextRegion);

    if (reverseGeocodeTimerRef.current) {
      clearTimeout(reverseGeocodeTimerRef.current);
    }

    reverseGeocodeTimerRef.current = setTimeout(() => {
      void resolveAddress(nextRegion.latitude, nextRegion.longitude);
    }, 260);
  }

  async function handleGoToCurrentLocation() {
    setIsLocating(true);

    Animated.sequence([
      Animated.timing(currentPulse, {
        toValue: 1.08,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(currentPulse, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();

    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        Alert.alert(
          "Location access needed",
          "Turn on location so we can center the map on your current spot.",
        );
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const nextRegion = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        latitudeDelta: mapDelta,
        longitudeDelta: mapDelta,
      };
      setRegion(nextRegion);
      mapRef.current?.animateCamera(
        {
          center: {
            latitude: nextRegion.latitude,
            longitude: nextRegion.longitude,
          },
          zoom: DEFAULT_LOCATION_PICKER_ZOOM,
          heading: 0,
          pitch: 0,
        },
        { duration: 320 },
      );
      await resolveAddress(nextRegion.latitude, nextRegion.longitude, false);
    } finally {
      setIsLocating(false);
    }
  }

  async function handleConfirm() {
    if (isConfirming) {
      return;
    }
    if (!region) {
      Alert.alert(
        "Location unavailable",
        "Please allow location access and try again.",
      );
      return;
    }
    if (!address.trim()) {
      Alert.alert(
        "Address required",
        "Please add an address note before saving.",
      );
      return;
    }

    const finalAddress = [address.trim(), manualNote.trim()]
      .filter(Boolean)
      .join(", ");

    setIsSubmitting(true);

    const nextLocation: SavedLocation = {
      id:
        isAddMode || (!editingLocation && !selectedLocation?.id)
          ? `loc-${Date.now()}`
          : editingLocation?.id ?? selectedLocation!.id,
      label: label.trim() || "Selected location",
      address: finalAddress,
      latitude: region.latitude,
      longitude: region.longitude,
      source:
        editingLocation?.source === "saved" ||
        (!isAddMode && selectedLocation?.source === "saved")
          ? "saved"
          : "manual",
    };

    setSelectedLocation(nextLocation);
    upsertSavedLocation(nextLocation);

    startTransition(() => {
      router.back();
    });

    if (!isAuthenticated) {
      setIsSubmitting(false);
      return;
    }

    void (async () => {
      try {
        const locations =
          isEditMode && editingLocation && !editingLocation.id.startsWith("loc-")
            ? await updateLocationMutation.mutateAsync({
                locationId: editingLocation.id,
                label: nextLocation.label,
                address: nextLocation.address,
                latitude: nextLocation.latitude,
                longitude: nextLocation.longitude,
                source: nextLocation.source,
              })
            : await saveLocationMutation.mutateAsync({
                label: nextLocation.label,
                address: nextLocation.address,
                latitude: nextLocation.latitude,
                longitude: nextLocation.longitude,
                source: nextLocation.source,
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
              item.latitude === nextLocation.latitude &&
              item.longitude === nextLocation.longitude &&
              item.address === nextLocation.address
          ) ?? nextLocations[0];

        if (matchedLocation) {
          setSelectedLocation(matchedLocation);
        }
      } catch {
        // Keep the optimistic local location even if account sync is slow or unavailable.
      } finally {
        setIsSubmitting(false);
      }
    })();
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <StatusBar style="dark" backgroundColor={palette.background} />

      <View style={styles.header}>
        <Pressable style={styles.headerButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={palette.foreground} />
        </Pressable>

        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>Choose from map</Text>
          <Text style={styles.headerSubtitle}>
            Drag the map to fine-tune the exact delivery spot.
          </Text>
        </View>

        <Pressable
          style={styles.headerLocateButton}
          onPress={handleGoToCurrentLocation}
        >
          {isLocating ? (
            <ActivityIndicator size="small" color={palette.surface} />
          ) : (
            <Ionicons name="locate" size={18} color={palette.surface} />
          )}
        </Pressable>
      </View>

      <View style={styles.mapWrap}>
        {region ? (
          <>
            <MapView
              ref={mapRef}
              style={styles.map}
              initialRegion={region}
              minZoomLevel={MIN_LOCATION_PICKER_ZOOM}
              maxZoomLevel={MAX_LOCATION_PICKER_ZOOM}
              showsCompass={false}
              showsBuildings
              toolbarEnabled={false}
              showsUserLocation
              showsMyLocationButton={false}
              rotateEnabled={false}
              pitchEnabled={false}
              onMapReady={applyInitialCamera}
              onRegionChange={handleRegionChange}
              onRegionChangeComplete={handleRegionChangeComplete}
            />

            <View pointerEvents="none" style={styles.centerPinWrap}>
              <Animated.View
                style={[
                  styles.pinShadow,
                  {
                    transform: [
                      {
                        scale: pinLift.interpolate({
                          inputRange: [0, 1],
                          outputRange: [1, 0.72],
                        }),
                      },
                    ],
                    opacity: pinLift.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.22, 0.08],
                    }),
                  },
                ]}
              />

              <Animated.View
                style={[
                  styles.pinHalo,
                  {
                    transform: [
                      {
                        scale: pinHalo.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.7, 1.45],
                        }),
                      },
                    ],
                    opacity: pinHalo.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.24, 0],
                    }),
                  },
                ]}
              />

              <Animated.View
                style={[
                  styles.pinWrap,
                  {
                    transform: [
                      {
                        translateY: pinLift.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, -18],
                        }),
                      },
                      {
                        translateY: pinBob.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, -4],
                        }),
                      },
                      { scale: pinPulse },
                    ],
                  },
                ]}
              >
                <Ionicons name="location" size={40} color={palette.secondary} />
              </Animated.View>
            </View>

            <Animated.View
              style={[
                styles.currentLocationFab,
                {
                  transform: [{ scale: currentPulse }],
                  bottom: Math.max(insets.bottom, 14) + 10,
                },
              ]}
            >
              <Pressable
                style={styles.currentLocationFabInner}
                onPress={handleGoToCurrentLocation}
              >
                {isLocating ? (
                  <ActivityIndicator size="small" color={palette.foreground} />
                ) : (
                  <Ionicons
                    name="navigate"
                    size={20}
                    color={palette.foreground}
                  />
                )}
              </Pressable>
            </Animated.View>
          </>
        ) : (
          <View style={styles.mapFallback}>
            {isLoadingInitialRegion ? (
              <>
                <ActivityIndicator size="small" color={palette.primary} />
                <Text style={styles.mapFallbackTitle}>Opening the map...</Text>
                <Text style={styles.mapFallbackText}>
                  We are trying to read your current location so you can
                  fine-tune it on the map.
                </Text>
              </>
            ) : (
              <>
                <Ionicons
                  name="location-outline"
                  size={28}
                  color={palette.primary}
                />
                <Text style={styles.mapFallbackTitle}>
                  Location access is needed
                </Text>
                <Text style={styles.mapFallbackText}>
                  Allow location access first, then reopen the map picker to
                  choose your exact delivery point.
                </Text>
              </>
            )}
          </View>
        )}
      </View>

      <View
        style={[
          styles.bottomCard,
          {
            marginBottom: keyboardHeight
              ? Math.max(keyboardHeight - insets.bottom - 10, 14)
              : 0,
            paddingBottom: Math.max(insets.bottom, 8),
          },
        ]}
      >
        <View style={styles.cardGlowWarm} />
        <View style={styles.cardGlowCool} />

        <View style={styles.bottomTopRow}>
          <View style={styles.bottomIcon}>
            <Ionicons name="pin" size={16} color={palette.foreground} />
          </View>

          <View style={styles.bottomCopy}>
            <Text style={styles.bottomLabel}>
              {params.mode === "saved" ? "Saved place" : "Current location"}
            </Text>
            <Text style={styles.bottomTitle} numberOfLines={3}>
              {address || "Move the map to choose your exact spot"}
            </Text>
            <Text style={styles.bottomSubtitle} numberOfLines={2}>
              {region
                ? `${region.latitude.toFixed(6)}, ${region.longitude.toFixed(6)}`
                : "Waiting for location access"}
            </Text>
          </View>

          {isResolvingAddress ? (
            <View style={styles.statusPill}>
              <ActivityIndicator size="small" color={palette.foreground} />
            </View>
          ) : null}
        </View>

        <View style={styles.manualFieldWrap}>
          <Text style={styles.manualFieldLabel}>Location label</Text>
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder="Home, Office, Pickup gate"
            placeholderTextColor={palette.mutedForeground}
            style={styles.manualFieldInput}
          />
        </View>

        <View style={styles.manualFieldWrap}>
          <Text style={styles.manualFieldLabel}>
            Address details (optional)
          </Text>
          <TextInput
            value={manualNote}
            onChangeText={setManualNote}
            placeholder="Flat, floor, landmark, or short delivery note"
            placeholderTextColor={palette.mutedForeground}
            style={[styles.manualFieldInput, styles.manualFieldInputMultiline]}
            multiline
            numberOfLines={2}
            textAlignVertical="top"
          />
        </View>

        <Pressable
          style={[
            styles.confirmButton,
            isConfirming
              ? styles.confirmButtonDisabled
              : null,
          ]}
          onPress={handleConfirm}
          disabled={isConfirming}
        >
          {isConfirming ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.confirmButtonText}>Confirm location</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 14,
  },
  headerCopy: {
    flex: 1,
    gap: 2,
    paddingTop: 2,
  },
  headerButton: {
    width: 46,
    height: 46,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surface,
    shadowColor: palette.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 18,
    elevation: 4,
  },
  headerTitle: {
    fontSize: 21,
    lineHeight: 27,
    fontWeight: "800",
    color: palette.foreground,
  },
  headerSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    color: palette.mutedForeground,
  },
  headerLocateButton: {
    width: 46,
    height: 46,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.sky,
    shadowColor: palette.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 18,
    elevation: 4,
  },
  mapWrap: {
    flex: 1,
    marginHorizontal: 14,
    borderRadius: 38,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: "#F6EDE6",
  },
  map: {
    flex: 1,
  },
  mapFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 10,
    backgroundColor: palette.background,
  },
  mapFallbackTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "700",
    color: palette.foreground,
    textAlign: "center",
  },
  mapFallbackText: {
    fontSize: 14,
    lineHeight: 22,
    color: palette.mutedForeground,
    textAlign: "center",
  },
  centerPinWrap: {
    position: "absolute",
    top: "50%",
    left: 0,
    right: 0,
    alignItems: "center",
    marginTop: -34,
  },
  pinHalo: {
    position: "absolute",
    width: 46,
    height: 46,
    borderRadius: 999,
    backgroundColor: "rgba(255, 99, 146, 0.26)",
  },
  pinShadow: {
    position: "absolute",
    bottom: -8,
    width: 26,
    height: 10,
    borderRadius: 999,
    backgroundColor: "#000000",
  },
  pinWrap: {
    alignItems: "center",
    justifyContent: "center",
    shadowColor: palette.secondary,
    shadowOpacity: 0.24,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  currentLocationFab: {
    position: "absolute",
    right: 14,
  },
  currentLocationFabInner: {
    width: 54,
    height: 54,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surface,
    shadowColor: palette.shadow,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 1,
    shadowRadius: 24,
    elevation: 7,
  },
  bottomCard: {
    overflow: "hidden",
    marginHorizontal: 14,
    marginTop: 10,
    paddingHorizontal: 20,
    paddingTop: 20,
    borderRadius: 38,
    backgroundColor: palette.surface,
    gap: 10,
    shadowColor: palette.shadow,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 1,
    shadowRadius: 24,
    elevation: 7,
  },
  cardGlowWarm: {
    position: "absolute",
    top: -26,
    right: -18,
    width: 120,
    height: 120,
    borderRadius: 999,
    backgroundColor: "#FFD6A8",
    opacity: 0.55,
  },
  cardGlowCool: {
    position: "absolute",
    bottom: -42,
    left: -24,
    width: 110,
    height: 110,
    borderRadius: 999,
    backgroundColor: "#C9D8FF",
    opacity: 0.45,
  },
  bottomTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    minHeight: 104,
  },
  bottomIcon: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EBF1FF",
  },
  bottomCopy: {
    flex: 1,
    gap: 4,
    minHeight: 104,
  },
  bottomLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
    color: palette.mutedForeground,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  bottomTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
    color: palette.foreground,
  },
  bottomSubtitle: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
    color: palette.mutedForeground,
  },
  statusPill: {
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF2C8",
  },
  manualFieldWrap: {
    gap: 6,
  },
  manualFieldLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
    color: palette.mutedForeground,
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  manualFieldInput: {
    minHeight: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.background,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    lineHeight: 23,
    fontWeight: "500",
    color: palette.foreground,
  },
  manualFieldInputMultiline: {
    minHeight: 64,
  },
  confirmButton: {
    minHeight: 54,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.foreground,
    marginTop: 2,
    shadowColor: palette.shadow,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 4,
  },
  confirmButtonDisabled: {
    opacity: 0.7,
  },
  confirmButtonText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.surface,
  },
});
