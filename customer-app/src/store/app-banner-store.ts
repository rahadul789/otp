import { create } from "zustand";

type AppBannerTone = "info" | "success" | "warning";

export type AppBanner = {
  id: string;
  title: string;
  description: string;
  tone: AppBannerTone;
  path?: string;
  actionLabel?: string;
};

type AppBannerStore = {
  banner: AppBanner | null;
  showBanner: (banner: Omit<AppBanner, "id">) => void;
  dismissBanner: () => void;
};

export const useAppBannerStore = create<AppBannerStore>(() => ({
  banner: null,
  showBanner: () => undefined,
  dismissBanner: () => undefined,
}));
