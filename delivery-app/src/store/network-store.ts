import { create } from "zustand";

type NetworkStore = {
  status: "online" | "slow" | "offline";
  isOnline: boolean;
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
  message: string;
  setOnline: (isOnline: boolean) => void;
  markSlow: (message?: string) => void;
  markOffline: (message?: string) => void;
  markOnline: () => void;
  setNetworkState: (state: {
    isConnected: boolean | null;
    isInternetReachable: boolean | null;
  }) => void;
};

export const useNetworkStore = create<NetworkStore>((set) => ({
  status: "online",
  isOnline: true,
  isConnected: null,
  isInternetReachable: null,
  message: "",
  setOnline: (isOnline) =>
    set((state) =>
      state.isOnline === isOnline
        ? state
        : {
            isOnline,
            status: isOnline ? "online" : "offline",
            message: isOnline ? "" : "You appear to be offline. Reconnect and try again.",
          },
    ),
  markSlow: (message = "Connection is taking longer than usual. We are still trying.") =>
    set({
      status: "slow",
      isOnline: true,
      message,
    }),
  markOffline: (message = "You appear to be offline. Reconnect and try again.") =>
    set({
      status: "offline",
      isOnline: false,
      message,
    }),
  markOnline: () =>
    set({
      status: "online",
      isOnline: true,
      message: "",
    }),
  setNetworkState: ({ isConnected, isInternetReachable }) => {
    const isOnline = Boolean(isConnected) && isInternetReachable !== false;
    set((state) =>
      state.isOnline === isOnline &&
      state.isConnected === isConnected &&
      state.isInternetReachable === isInternetReachable &&
      (isOnline || state.status === "offline")
        ? state
        : {
            status: isOnline ? "online" : "offline",
            isOnline,
            isConnected,
            isInternetReachable,
            message: isOnline ? "" : "You appear to be offline. Reconnect and try again.",
          },
    );
  },
}));

export function setDeliveryNetworkOnline(isOnline: boolean) {
  if (isOnline) {
    useNetworkStore.getState().markOnline();
    return;
  }

  useNetworkStore.getState().markOffline();
}
