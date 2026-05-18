import { useEffect, useMemo } from "react";
import { Alert } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";

import { connectRiderSocket, disconnectRiderSocket } from "@/src/lib/socket-client";
import { useDeliveryCopy } from "@/src/lib/copy";
import { patchRiderOrderCaches, type RiderOrder } from "@/src/hooks/use-rider-api";
import { useRiderAuthStore } from "@/src/store/auth-store";
import { setDeliveryNetworkOnline } from "@/src/store/network-store";

type RiderSocketOrderPayload = RiderOrder & {
  _id?: string;
  id?: string;
};

type RiderAssignmentPayload = {
  orderId?: string;
  orderNumber?: string;
  message?: string;
  assignmentAction?: "assigned" | "reassigned" | "unassigned";
};

type RiderRestaurantUpdatedPayload = {
  orderId?: string;
};

export function RiderSocketBridge() {
  const riderId = useRiderAuthStore((state: { rider: { id?: string } | null }) => state.rider?.id ?? "");
  const accessToken = useRiderAuthStore((state: { accessToken: string }) => state.accessToken);
  const queryClient = useQueryClient();
  const { copy, language } = useDeliveryCopy();
  const riderSocketCopy = useMemo(() => {
    const riderSocketText = (copy as Record<string, unknown>).riderSocket as Record<string, unknown> | undefined;

    return {
      assignmentUpdated:
        typeof riderSocketText?.assignmentUpdated === "string"
          ? riderSocketText.assignmentUpdated
          : language === "bn"
            ? "অ্যাসাইনমেন্ট আপডেট"
            : "Assignment updated",
      newAssignment:
        typeof riderSocketText?.newAssignment === "string"
          ? riderSocketText.newAssignment
          : language === "bn"
            ? "নতুন অ্যাসাইনমেন্ট"
            : "New assignment",
      assignmentChanged:
        typeof riderSocketText?.assignmentChanged === "string"
          ? riderSocketText.assignmentChanged
          : language === "bn"
            ? "আপনার ডেলিভারি অ্যাসাইনমেন্ট পরিবর্তন হয়েছে।"
            : "Your delivery assignment has changed.",
      viewOrder:
        typeof riderSocketText?.viewOrder === "string"
          ? riderSocketText.viewOrder
          : language === "bn"
            ? "অর্ডার দেখুন"
            : "View order",
      okay:
        typeof riderSocketText?.okay === "string"
          ? riderSocketText.okay
          : language === "bn"
            ? "ঠিক আছে"
            : "Okay",
    };
  }, [copy, language]);

  useEffect(() => {
    if (!riderId || !accessToken) {
      disconnectRiderSocket();
      return;
    }

    const socket = connectRiderSocket(riderId, accessToken);
    const handleSocketConnected = () => {
      setDeliveryNetworkOnline(true);
    };
    const handleSocketDisconnected = (reason: string) => {
      if (reason !== "io client disconnect") {
        setDeliveryNetworkOnline(false);
      }
    };
    const handleConnectError = () => {
      setDeliveryNetworkOnline(false);
    };
    const handleOrderUpdated = (payload: RiderSocketOrderPayload) => {
      patchRiderOrderCaches(queryClient, payload);
    };

    const handleAssignmentUpdated = (payload: RiderAssignmentPayload) => {
      queryClient.invalidateQueries({ queryKey: ["rider", "orders"] });
      queryClient.invalidateQueries({ queryKey: ["rider", "profile"] });

      const orderId = payload.orderId;
      if (orderId) {
        queryClient.invalidateQueries({ queryKey: ["rider", "order", orderId] });
      }

      Alert.alert(
        payload.assignmentAction === "unassigned"
          ? riderSocketCopy.assignmentUpdated
          : riderSocketCopy.newAssignment,
        payload.message ?? riderSocketCopy.assignmentChanged,
        orderId
          ? [
              {
                text: riderSocketCopy.viewOrder,
                onPress: () => router.push(`/orders/${orderId}`)
              },
              { text: riderSocketCopy.okay, style: "cancel" }
            ]
          : [{ text: riderSocketCopy.okay }]
      );
    };

    const handleProfileUpdated = () => {
      queryClient.invalidateQueries({ queryKey: ["rider", "profile"] });
    };
    const handleRestaurantUpdated = (payload: RiderRestaurantUpdatedPayload) => {
      queryClient.invalidateQueries({ queryKey: ["rider", "orders"] });
      if (payload.orderId) {
        queryClient.invalidateQueries({ queryKey: ["rider", "order", payload.orderId] });
      }
    };

    socket.on("connect", handleSocketConnected);
    socket.on("disconnect", handleSocketDisconnected);
    socket.on("connect_error", handleConnectError);
    socket.on("rider.order.updated", handleOrderUpdated);
    socket.on("rider.assignment.updated", handleAssignmentUpdated);
    socket.on("rider.profile.updated", handleProfileUpdated);
    socket.on("rider.restaurant.updated", handleRestaurantUpdated);

    return () => {
      socket.off("connect", handleSocketConnected);
      socket.off("disconnect", handleSocketDisconnected);
      socket.off("connect_error", handleConnectError);
      socket.off("rider.order.updated", handleOrderUpdated);
      socket.off("rider.assignment.updated", handleAssignmentUpdated);
      socket.off("rider.profile.updated", handleProfileUpdated);
      socket.off("rider.restaurant.updated", handleRestaurantUpdated);
      disconnectRiderSocket();
    };
  }, [accessToken, queryClient, riderId, riderSocketCopy]);

  return null;
}
