import { create } from "zustand";

type AppBannerTone = "info" | "success" | "warning";

export type AppBanner = {
  id: string;
  title: string;
  description: string;
  tone: AppBannerTone;
  emoji?: string;
  path?: string;
  actionLabel?: string;
};

type AppBannerStore = {
  banner: AppBanner | null;
  showBanner: (banner: Omit<AppBanner, "id">) => void;
  dismissBanner: () => void;
};

const createBannerId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const useAppBannerStore = create<AppBannerStore>((set) => ({
  banner: null,
  showBanner: (banner) =>
    set({
      banner: {
        id: createBannerId(),
        ...banner,
      },
    }),
  dismissBanner: () => set({ banner: null }),
}));
