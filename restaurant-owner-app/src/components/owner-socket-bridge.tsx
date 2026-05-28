import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import type { OwnerOrder } from "@/src/hooks/use-owner-api";
import {
  connectOwnerSocket,
  disconnectOwnerSocket,
  getOwnerSocket,
} from "@/src/lib/socket-client";
import { patchOwnerOrderQueryCaches } from "@/src/lib/owner-order-cache";
import { useOwnerAuthStore } from "@/src/store/auth-store";

export function OwnerSocketBridge() {
  const queryClient = useQueryClient();
  const owner = useOwnerAuthStore((state) => state.owner);
  const accessToken = useOwnerAuthStore((state) => state.accessToken);
  const joinedRef = useRef("");
  const tokenRef = useRef("");

  useEffect(() => {
    if (!owner?.id || !accessToken) {
      joinedRef.current = "";
      tokenRef.current = "";
      disconnectOwnerSocket();
      return;
    }

    if (joinedRef.current !== owner.id || tokenRef.current !== accessToken) {
      connectOwnerSocket(owner.id, accessToken);
      joinedRef.current = owner.id;
      tokenRef.current = accessToken;
    }

    const socket = getOwnerSocket();
    const ensureJoined = () => socket.emit("owner:join", owner.id);
    const handleOrderUpdated = (payload: OwnerOrder) => {
      patchOwnerOrderQueryCaches(queryClient, payload);
      void queryClient.invalidateQueries({
        queryKey: ["owner", "orders", "details", payload._id],
      });
      void queryClient.invalidateQueries({ queryKey: ["owner", "orders"] });
      void queryClient.invalidateQueries({ queryKey: ["owner", "dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["owner", "payouts"] });
    };
    const handleNotificationCreated = () => {
      void queryClient.invalidateQueries({ queryKey: ["owner", "notifications"] });
      void queryClient.invalidateQueries({ queryKey: ["owner", "payouts"] });
      void queryClient.invalidateQueries({ queryKey: ["owner", "dashboard"] });
    };
    const handlePayoutMethodUpdated = () => {
      void queryClient.invalidateQueries({ queryKey: ["owner", "payouts"] });
      void queryClient.invalidateQueries({ queryKey: ["owner", "dashboard"] });
    };
    const handlePayoutUpdated = () => {
      void queryClient.invalidateQueries({ queryKey: ["owner", "payouts"] });
      void queryClient.invalidateQueries({ queryKey: ["owner", "dashboard"] });
    };
    const handleMenuUpdated = () => {
      void queryClient.invalidateQueries({ queryKey: ["owner", "menu-items"] });
    };
    const handleStoreUpdated = () => {
      void queryClient.invalidateQueries({ queryKey: ["owner", "store-settings"] });
      void queryClient.invalidateQueries({ queryKey: ["owner", "dashboard"] });
    };
    const handlePromotionUpdated = () => {
      void queryClient.invalidateQueries({ queryKey: ["owner", "vouchers"] });
      void queryClient.invalidateQueries({ queryKey: ["owner", "dashboard"] });
    };

    socket.on("connect", ensureJoined);
    socket.on("order.updated", handleOrderUpdated);
    socket.on("notification.created", handleNotificationCreated);
    socket.on("payout.method.updated", handlePayoutMethodUpdated);
    socket.on("payout.updated", handlePayoutUpdated);
    socket.on("menu.updated", handleMenuUpdated);
    socket.on("store.updated", handleStoreUpdated);
    socket.on("promotion.updated", handlePromotionUpdated);

    return () => {
      socket.off("connect", ensureJoined);
      socket.off("order.updated", handleOrderUpdated);
      socket.off("notification.created", handleNotificationCreated);
      socket.off("payout.method.updated", handlePayoutMethodUpdated);
      socket.off("payout.updated", handlePayoutUpdated);
      socket.off("menu.updated", handleMenuUpdated);
      socket.off("store.updated", handleStoreUpdated);
      socket.off("promotion.updated", handlePromotionUpdated);
    };
  }, [accessToken, owner?.id, queryClient]);

  return null;
}
