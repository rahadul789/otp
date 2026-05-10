import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Screen } from "@/src/components/screen";
import { OfflineNoticeCard } from "@/src/components/offline-notice-card";
import {
  useCustomerMediaUploadSignatureMutation,
  useCustomerProfileUpdateMutation,
} from "@/src/hooks/use-customer-api";
import { getCustomerAuthErrorMessage } from "@/src/lib/auth-error-message";
import { useIsOnline } from "@/src/hooks/use-network-status";
import { useCustomerAuthStore } from "@/src/store/auth-store";
import { palette } from "@/src/theme/palette";

type ProfileImageValue = {
  url?: string;
  publicId?: string;
};

export default function ProfileEditScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const customer = useCustomerAuthStore((state) => state.customer);
  const isOnline = useIsOnline();
  const updateMutation = useCustomerProfileUpdateMutation();
  const uploadSignatureMutation = useCustomerMediaUploadSignatureMutation();
  const [fullName, setFullName] = useState(customer?.fullName ?? "");
  const [email, setEmail] = useState(customer?.email ?? "");
  const [profileImage, setProfileImage] = useState<ProfileImageValue>(
    customer?.profileImage ?? {}
  );
  const [errorText, setErrorText] = useState("");
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  const initials = useMemo(() => {
    const source = fullName.trim() || customer?.fullName?.trim() || "Customer";
    const next = source
      .split(" ")
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

    return next || "CU";
  }, [customer?.fullName, fullName]);
  const trimmedFullName = fullName.trim();
  const trimmedEmail = email.trim();
  const normalizedCustomerImage = customer?.profileImage?.url?.trim() ?? "";
  const normalizedProfileImage = profileImage?.url?.trim() ?? "";
  const hasChanges = useMemo(
    () =>
      trimmedFullName !== (customer?.fullName?.trim() ?? "") ||
      trimmedEmail !== (customer?.email?.trim() ?? "") ||
      normalizedProfileImage !== normalizedCustomerImage,
    [
      customer?.email,
      customer?.fullName,
      normalizedCustomerImage,
      normalizedProfileImage,
      trimmedEmail,
      trimmedFullName,
    ]
  );

  async function handlePickImage() {
    if (!isOnline) {
      setErrorText("Reconnect to upload a profile photo.");
      return;
    }
    try {
      setErrorText("");
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (permission.status !== "granted") {
        setErrorText(
          "Photo library permission is required to upload a profile picture."
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.9,
        allowsEditing: true,
        aspect: [1, 1],
        selectionLimit: 1,
        legacy: true,
      });

      if (result.canceled || !result.assets?.[0]) {
        return;
      }

      setIsUploadingImage(true);

      const asset = result.assets[0];
      const signature = await uploadSignatureMutation.mutateAsync({
        folder: "foodbela/customer/profile",
        resourceType: "image",
      });

      const formData = new FormData();
      formData.append("file", {
        uri: asset.uri,
        type: asset.mimeType ?? "image/jpeg",
        name: asset.fileName ?? `customer-profile-${Date.now()}.jpg`,
      } as unknown as Blob);
      formData.append("api_key", signature.apiKey);
      formData.append("timestamp", String(signature.timestamp));
      formData.append("signature", signature.signature);
      formData.append("folder", signature.folder);

      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${signature.cloudName}/${signature.resourceType}/upload`,
        {
          method: "POST",
          body: formData,
        }
      );

      const payload = (await response.json()) as {
        secure_url?: string;
        public_id?: string;
        error?: { message?: string };
      };

      if (!response.ok || !payload.secure_url) {
        throw new Error(
          payload.error?.message ?? "Could not upload the profile image."
        );
      }

      setProfileImage({
        url: payload.secure_url,
        publicId: payload.public_id,
      });
    } catch (error) {
      setErrorText(
        getCustomerAuthErrorMessage(error, "Could not upload profile photo.")
      );
    } finally {
      setIsUploadingImage(false);
    }
  }

  function handleRemoveImage() {
    setProfileImage({ url: "", publicId: "" });
    setErrorText("");
  }

  async function handleSave() {
    if (!isOnline) {
      setErrorText("Reconnect to save your profile changes.");
      return;
    }
    if (!trimmedFullName) {
      setErrorText("Full name is required.");
      return;
    }

    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setErrorText("Enter a valid email address.");
      return;
    }

    try {
      setErrorText("");
      await updateMutation.mutateAsync({
        fullName: trimmedFullName,
        email: trimmedEmail,
        profileImage,
      });
      router.back();
    } catch (error) {
      setErrorText(
        getCustomerAuthErrorMessage(error, "Could not update profile.")
      );
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={insets.top + 12}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: 8, paddingBottom: Math.max(insets.bottom, 16) + 48 },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.topBar}>
            <Pressable onPress={() => router.back()} style={styles.backButton}>
              <Ionicons
                name="chevron-back"
                size={20}
                color={palette.foreground}
              />
            </Pressable>
            <Text style={styles.topBarTitle}>Edit profile</Text>
            <View style={styles.topBarSpacer} />
          </View>

          {!isOnline ? (
            <OfflineNoticeCard description="You can review your profile here. Reconnect to upload a photo or save changes." />
          ) : null}

          <View style={styles.heroCard}>
            <View style={styles.heroGlowPrimary} />
            <View style={styles.heroGlowSecondary} />

            <View style={styles.heroHeader}>
              <View style={styles.avatarShell}>
                {profileImage?.url ? (
                  <Image
                    source={{ uri: profileImage.url }}
                    style={styles.avatarImage}
                    contentFit="cover"
                  />
                ) : (
                  <View style={styles.avatarFallback}>
                    <Text style={styles.avatarFallbackText}>{initials}</Text>
                  </View>
                )}

                {(isUploadingImage || updateMutation.isPending) ? (
                  <View style={styles.avatarOverlay}>
                    <ActivityIndicator size="small" color="#fff" />
                  </View>
                ) : null}
              </View>

              <View style={styles.heroCopy}>
                <Text style={styles.heroTitle}>Make your account feel like you</Text>
                <Text style={styles.heroSubtitle}>
                  Update your name, photo, and email so your account stays polished
                  across orders and support.
                </Text>
              </View>
            </View>

            <View style={styles.photoActionRow}>
              <Pressable
                style={[
                  styles.photoButton,
                  profileImage?.url ? styles.photoButtonHalf : styles.photoButtonPrimaryFull,
                  styles.photoButtonPrimary,
                ]}
                onPress={handlePickImage}
                disabled={isUploadingImage || updateMutation.isPending || !isOnline}
              >
                {isUploadingImage ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="image-outline" size={16} color="#fff" />
                    <Text style={styles.photoButtonPrimaryText}>
                      {profileImage?.url ? "Change photo" : "Upload photo"}
                    </Text>
                  </>
                )}
              </Pressable>

              {profileImage?.url ? (
                <Pressable
                  style={[styles.photoButton, styles.photoButtonHalf]}
                  onPress={handleRemoveImage}
                  disabled={isUploadingImage || updateMutation.isPending || !isOnline}
                >
                  <Ionicons
                    name="trash-outline"
                    size={16}
                    color={palette.foreground}
                  />
                  <Text style={styles.photoButtonText}>Remove</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          <View style={styles.formCard}>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Full name</Text>
              <TextInput
                value={fullName}
                onChangeText={setFullName}
                placeholder="Your full name"
                placeholderTextColor={palette.placeholder}
                style={styles.input}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="name@example.com"
                placeholderTextColor={palette.placeholder}
                keyboardType="email-address"
                autoCapitalize="none"
                style={styles.input}
              />
              <Text style={styles.fieldHint}>
                Add your email and we will send order receipts there. Later we can
                also use it for important account and support updates.
              </Text>
            </View>

            {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}

            <Pressable
              style={[
                styles.primaryButton,
                (!hasChanges || updateMutation.isPending || isUploadingImage) &&
                  styles.primaryButtonDisabled,
                !isOnline &&
                  styles.primaryButtonDisabled,
              ]}
              onPress={handleSave}
              disabled={!hasChanges || updateMutation.isPending || isUploadingImage || !isOnline}
            >
              {updateMutation.isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Text style={styles.primaryButtonText}>Save changes</Text>
                  <Ionicons name="arrow-forward" size={16} color="#fff" />
                </>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    padding: 18,
    paddingBottom: 36,
    gap: 18,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  topBarTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "800",
    color: palette.foreground,
  },
  topBarSpacer: {
    width: 42,
    height: 42,
  },
  heroCard: {
    overflow: "hidden",
    borderRadius: 30,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 20,
    gap: 18,
    shadowColor: palette.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  heroGlowPrimary: {
    position: "absolute",
    top: -22,
    right: -10,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "#FFE5EE",
  },
  heroGlowSecondary: {
    position: "absolute",
    bottom: -26,
    left: -16,
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "#FFF0C7",
  },
  heroHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    zIndex: 1,
  },
  avatarShell: {
    width: 94,
    height: 94,
    borderRadius: 47,
    overflow: "hidden",
    backgroundColor: "#F7EEF4",
    borderWidth: 1,
    borderColor: "#F2DFE8",
  },
  avatarImage: {
    width: "100%",
    height: "100%",
  },
  avatarFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFE7F1",
  },
  avatarFallbackText: {
    fontSize: 30,
    lineHeight: 34,
    fontWeight: "800",
    color: "#D85A8A",
  },
  avatarOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(28, 24, 36, 0.38)",
  },
  heroCopy: {
    flex: 1,
    gap: 6,
  },
  heroTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "800",
    color: palette.foreground,
  },
  heroSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "500",
    color: palette.mutedForeground,
  },
  photoActionRow: {
    flexDirection: "row",
    gap: 10,
    zIndex: 1,
  },
  photoButton: {
    minHeight: 46,
    borderRadius: 18,
    backgroundColor: "#F7F2F6",
    borderWidth: 1,
    borderColor: "#EEE1E9",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  photoButtonHalf: {
    flex: 1,
  },
  photoButtonPrimaryFull: {
    flex: 1,
  },
  photoButtonPrimary: {
    backgroundColor: palette.secondary,
    borderColor: palette.secondary,
  },
  photoButtonPrimaryText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    color: "#fff",
  },
  photoButtonText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.foreground,
  },
  formCard: {
    borderRadius: 30,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 20,
    gap: 18,
  },
  fieldGroup: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    color: palette.foreground,
  },
  input: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E9E6EE",
    backgroundColor: "#FBFAFD",
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 15,
    color: palette.foreground,
  },
  fieldHint: {
    fontSize: 12,
    lineHeight: 18,
    color: palette.mutedForeground,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    color: "#C62828",
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: 20,
    backgroundColor: palette.secondary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryButtonDisabled: {
    opacity: 0.55,
  },
  primaryButtonText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    color: "#fff",
  },
});
