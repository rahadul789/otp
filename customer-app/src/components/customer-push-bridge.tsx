import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { useRouter } from "expo-router";
import { PropsWithChildren, useEffect, useRef } from "react";
import { Platform } from "react-native";

import {
  useRegisterCustomerPushTokenMutation,
  useUnregisterCustomerPushTokenMutation,
} from "@/src/hooks/use-customer-api";
import { apiPost } from "@/src/lib/api";
import { queryClient } from "@/src/lib/query-client";
import { useIsOnline } from "@/src/hooks/use-network-status";
import { useCustomerAuthStore } from "@/src/store/auth-store";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const PUSH_INSTALL_ID_KEY = "foodbela.customer.pushInstallId";

async function getStablePushInstallId() {
  const existingId = await SecureStore.getItemAsync(PUSH_INSTALL_ID_KEY);
  if (existingId) return existingId;

  const nextId = `${Platform.OS}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  await SecureStore.setItemAsync(PUSH_INSTALL_ID_KEY, nextId);
  return nextId;
}

async function getExpoProjectId() {
  const easProjectId =
    Constants.easConfig?.projectId ??
    ((Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
      "");

  return easProjectId || undefined;
}

async function registerForPushNotificationsAsync() {
  if (!Device.isDevice) {
    console.log("[push] Physical device not available for push registration.");
    return null;
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#0EA5E9",
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const permissionResult = await Notifications.requestPermissionsAsync();
    finalStatus = permissionResult.status;
  }

  if (finalStatus !== "granted") {
    console.log("[push] Notification permission not granted.");
    return null;
  }

  const projectId = await getExpoProjectId();
  try {
    const token = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );

    console.log("[push] Expo push token acquired.", token.data);
    return token.data;
  } catch (error) {
    console.log("[push] Failed to get Expo push token.", error);
    return null;
  }
}

export function CustomerPushBridge({ children }: PropsWithChildren) {
  const router = useRouter();
  const customer = useCustomerAuthStore((state) => state.customer);
  const isOnline = useIsOnline();
  const registerMutation = useRegisterCustomerPushTokenMutation();
  const unregisterMutation = useUnregisterCustomerPushTokenMutation();
  const tokenRef = useRef("");

  useEffect(() => {
    void Notifications.setAutoServerRegistrationEnabledAsync(false).catch((error) => {
      console.log("[push] Failed to disable Expo auto server registration.", error);
    });
  }, []);

  useEffect(() => {
    const recordOpen = (data?: Record<string, unknown>) => {
      if (!data) return;
      void apiPost("/customer/push-events/open", {
        source: data.source,
        notificationId: data.notificationId,
        campaignId: data.campaignId,
        voucherId: data.voucherId,
        path: data.path,
        variant: data.variant,
      })
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ["customer", "notifications"] });
        })
        .catch(() => undefined);
    };

    const openNotificationCenter = (data?: Record<string, unknown>) => {
      const path = typeof data?.path === "string" ? data.path : "";
      const notificationId = typeof data?.notificationId === "string" ? data.notificationId : "";
      const campaignId = typeof data?.campaignId === "string" ? data.campaignId : "";

      router.replace({
        pathname: "/notifications",
        params: {
          fromPush: "1",
          notificationId,
          campaignId,
          targetPath: path,
        },
      } as never);
    };

    const receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {
      void notification;
    });

    const responseSubscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data;
        recordOpen(data);
        openNotificationCenter(data);
        void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
      }
    );

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = response.notification.request.content.data;
      recordOpen(data);
      openNotificationCenter(data);
      void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
    });

    return () => {
      receivedSubscription.remove();
      responseSubscription.remove();
    };
  }, [router]);

  useEffect(() => {
    if (!customer?.id) {
      if (tokenRef.current) {
        void unregisterMutation.mutateAsync({ expoPushToken: tokenRef.current }).catch(() => undefined);
        tokenRef.current = "";
      }
      return;
    }

    if (!isOnline) {
      console.log("[push] Device appears offline. Push registration skipped for now.");
      return;
    }

    const run = async () => {
      const expoPushToken = await registerForPushNotificationsAsync();

      if (!expoPushToken || tokenRef.current === expoPushToken) {
        if (!expoPushToken) {
          console.log("[push] Push token unavailable. Registration skipped.");
        }
        return;
      }

      await registerMutation.mutateAsync({
        expoPushToken,
        platform: Platform.OS === "ios" ? "ios" : "android",
        deviceId: await getStablePushInstallId(),
        appVersion: Constants.expoConfig?.version,
      });

      tokenRef.current = expoPushToken;
      console.log("[push] Push token registered with backend.");
    };

    void run().catch((error) => {
      console.log("[push] Push registration failed.", error);
    });
  }, [customer?.id, isOnline, registerMutation, unregisterMutation]);

  return children;
}
