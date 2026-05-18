import { create } from "zustand";

type NetworkStatus = "online" | "slow" | "offline";

type NetworkStore = {
  status: NetworkStatus;
  message: string;
  updatedAt: number;
  markOnline: () => void;
  markSlow: (message?: string) => void;
  markOffline: (message?: string) => void;
};

export const useNetworkStore = create<NetworkStore>()((set) => ({
  status: "online",
  message: "",
  updatedAt: Date.now(),
  markOnline: () =>
    set({
      status: "online",
      message: "",
      updatedAt: Date.now(),
    }),
  markSlow: (message = "Connection looks slow. We are still trying.") =>
    set({
      status: "slow",
      message,
      updatedAt: Date.now(),
    }),
  markOffline: (message = "You appear to be offline. Reconnect and try again.") =>
    set({
      status: "offline",
      message,
      updatedAt: Date.now(),
    }),
}));
