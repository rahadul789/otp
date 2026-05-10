import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { PropsWithChildren, useEffect, useRef } from "react";
import { Platform } from "react-native";

import {
  useRegisterRiderPushTokenMutation,
  useUnregisterRiderPushTokenMutation,
} from "@/src/hooks/use-rider-api";
import { useNetworkStatus } from "@/src/hooks/use-network-status";
import { useRiderAuthStore } from "@/src/store/auth-store";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function getExpoProjectId() {
  const easProjectId =
    Constants.easConfig?.projectId ??
    ((Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas
      ?.projectId ??
      "");

  return easProjectId || undefined;
}

async function registerForPushNotificationsAsync() {
  if (!Device.isDevice) {
    console.log("[rider-push] Physical device not available for push registration.");
    return null;
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#0f766e",
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const permissionResult = await Notifications.requestPermissionsAsync();
    finalStatus = permissionResult.status;
  }

  if (finalStatus !== "granted") {
    console.log("[rider-push] Notification permission not granted.");
    return null;
  }

  const projectId = await getExpoProjectId();

  try {
    const token = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    console.log("[rider-push] Expo push token acquired.", token.data);
    return token.data;
  } catch (error) {
    console.log("[rider-push] Failed to get Expo push token.", error);
    return null;
  }
}

export function RiderPushBridge({ children }: PropsWithChildren) {
  const router = useRouter();
  const rider = useRiderAuthStore((state) => state.rider);
  const isOnline = useNetworkStatus();
  const registerMutation = useRegisterRiderPushTokenMutation();
  const unregisterMutation = useUnregisterRiderPushTokenMutation();
  const tokenRef = useRef("");

  useEffect(() => {
    void Notifications.setAutoServerRegistrationEnabledAsync(false).catch((error) => {
      console.log("[rider-push] Failed to disable Expo auto server registration.", error);
    });
  }, []);

  useEffect(() => {
    const openPath = (path?: unknown) => {
      if (typeof path === "string" && path) {
        router.replace(path as never);
        return;
      }

      router.replace("/(app)/available");
    };

    const responseSubscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        openPath(response.notification.request.content.data?.path);
        void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
      }
    );

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      openPath(response.notification.request.content.data?.path);
      void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
    });

    return () => {
      responseSubscription.remove();
    };
  }, [router]);

  useEffect(() => {
    if (!rider?.id) {
      if (tokenRef.current) {
        void unregisterMutation
          .mutateAsync({ expoPushToken: tokenRef.current })
          .catch(() => undefined);
        tokenRef.current = "";
      }
      return;
    }

    if (!isOnline) {
      console.log("[rider-push] Device appears offline. Push registration skipped for now.");
      return;
    }

    const run = async () => {
      const expoPushToken = await registerForPushNotificationsAsync();

      if (!expoPushToken || tokenRef.current === expoPushToken) {
        if (!expoPushToken) {
          console.log("[rider-push] Push token unavailable. Registration skipped.");
        }
        return;
      }

      await registerMutation.mutateAsync({
        expoPushToken,
        platform: Platform.OS === "ios" ? "ios" : "android",
        deviceId: Constants.sessionId,
        appVersion: Constants.expoConfig?.version,
      });

      tokenRef.current = expoPushToken;
      console.log("[rider-push] Push token registered with backend.");
    };

    void run().catch((error) => {
      console.log("[rider-push] Push registration failed.", error);
    });
  }, [isOnline, registerMutation, rider?.id, unregisterMutation]);

  return children;
}
