import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { secureStateStorage } from "@/src/lib/secure-storage";

export type RecentVisitedRestaurant = {
  id: string;
  name: string;
  visitedAt?: string;
  subtitle?: string;
  imageUrl?: string | null;
  isOpen?: boolean;
  offerLabel?: string | null;
  distanceKm?: number | null;
  avgRating?: number | null;
  reviewCount?: number;
  lowestMenuPrice?: number | null;
  preparationTimeMinutes?: number | null;
};

type BrowseHistoryStore = {
  recentSearches: string[];
  recentVisitedRestaurants: RecentVisitedRestaurant[];
  addRecentSearch: (query: string) => void;
  removeRecentSearch: (query: string) => void;
  addRecentVisitedRestaurant: (restaurant: RecentVisitedRestaurant) => void;
};

const MAX_RECENT_SEARCHES = 3;
const MAX_RECENT_VISITED_RESTAURANTS = 6;

export const useBrowseHistoryStore = create<BrowseHistoryStore>()(
  persist(
    (set) => ({
      recentSearches: [],
      recentVisitedRestaurants: [],
      addRecentSearch: (query) =>
        set((state) => {
          const normalized = query.trim();

          if (!normalized) {
            return state;
          }

          const nextRecentSearches = [
            normalized,
            ...state.recentSearches.filter(
              (entry) => entry.toLowerCase() !== normalized.toLowerCase()
            ),
          ].slice(0, MAX_RECENT_SEARCHES);

          return {
            recentSearches: nextRecentSearches,
          };
        }),
      removeRecentSearch: (query) =>
        set((state) => ({
          recentSearches: state.recentSearches.filter((entry) => entry !== query),
        })),
      addRecentVisitedRestaurant: (restaurant) =>
        set((state) => ({
          recentVisitedRestaurants: [
            {
              ...restaurant,
              visitedAt: new Date().toISOString(),
            },
            ...state.recentVisitedRestaurants.filter(
              (entry) => entry.id !== restaurant.id
            ),
          ].slice(0, MAX_RECENT_VISITED_RESTAURANTS),
        })),
    }),
    {
      name: "customer-browse-history-state",
      storage: createJSONStorage(() => secureStateStorage),
      partialize: (state) => ({
        recentSearches: state.recentSearches,
        recentVisitedRestaurants: state.recentVisitedRestaurants,
      }),
    }
  )
);
