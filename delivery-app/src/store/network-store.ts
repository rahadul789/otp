import { create } from "zustand";

type NetworkStore = {
  isOnline: boolean;
  setOnline: (isOnline: boolean) => void;
};

export const useNetworkStore = create<NetworkStore>((set) => ({
  isOnline: true,
  setOnline: (isOnline) =>
    set((state) => (state.isOnline === isOnline ? state : { isOnline })),
}));

export function setDeliveryNetworkOnline(isOnline: boolean) {
  useNetworkStore.getState().setOnline(isOnline);
}
