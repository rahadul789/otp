import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { appStateStorage } from "@/src/lib/app-storage";

type SelectedOption = {
  groupName: string;
  optionLabel: string;
};

export type CartItem = {
  key: string;
  itemId: string;
  name: string;
  imageUrl?: string | null;
  quantity: number;
  unitPrice: number;
  selectedVariantOptions: SelectedOption[];
  selectedAddOnOptions: SelectedOption[];
};

type RestaurantCartIdentity = {
  restaurantId: string;
  restaurantName: string;
};

type AddCartItemInput = {
  restaurant: RestaurantCartIdentity;
  item: Omit<CartItem, "key">;
};

type CartReorderContext = {
  orderId: string;
  orderNumber: string;
};

type CartStore = {
  restaurant: RestaurantCartIdentity | null;
  items: CartItem[];
  reorderContext: CartReorderContext | null;
  addItem: (input: AddCartItemInput) => void;
  replaceCart: (input: AddCartItemInput) => void;
  setCart: (input: {
    restaurant: RestaurantCartIdentity;
    items: Omit<CartItem, "key">[];
  }) => void;
  setReorderContext: (context: CartReorderContext | null) => void;
  syncPricing: (items: { key: string; unitPrice: number }[]) => void;
  updateQuantity: (key: string, quantity: number) => void;
  removeItem: (key: string) => void;
  clearCart: () => void;
};

export function buildCartItemKey(item: Omit<CartItem, "key">) {
  const variants = item.selectedVariantOptions
    .map((option) => `${option.groupName}:${option.optionLabel}`)
    .sort()
    .join("|");
  const addOns = item.selectedAddOnOptions
    .map((option) => `${option.groupName}:${option.optionLabel}`)
    .sort()
    .join("|");
  return `${item.itemId}__${variants}__${addOns}`;
}

export function getCartItemCount(items: CartItem[]) {
  return items.reduce((total, item) => total + item.quantity, 0);
}

export function getCartSubtotal(items: CartItem[]) {
  return items.reduce((total, item) => total + item.quantity * item.unitPrice, 0);
}

export const useCartStore = create<CartStore>()(
  persist(
    (set) => ({
      restaurant: null,
      items: [],
      reorderContext: null,
      addItem: ({ restaurant, item }) =>
        set((state) => {
          const key = buildCartItemKey(item);
          if (state.restaurant && state.restaurant.restaurantId !== restaurant.restaurantId) {
            return state;
          }

          const existingItem = state.items.find((entry) => entry.key === key);
          if (existingItem) {
            return {
              restaurant,
              items: state.items.map((entry) =>
                entry.key === key
                  ? { ...entry, quantity: entry.quantity + item.quantity }
                  : entry
              ),
            };
          }

          return {
            restaurant,
            items: [...state.items, { ...item, key }],
          };
        }),
      replaceCart: ({ restaurant, item }) =>
        set({
          restaurant,
          reorderContext: null,
          items: [{ ...item, key: buildCartItemKey(item) }],
        }),
      setCart: ({ restaurant, items }) =>
        set({
          restaurant,
          items: items.map((item) => ({ ...item, key: buildCartItemKey(item) })),
        }),
      setReorderContext: (context) =>
        set({
          reorderContext: context,
        }),
      syncPricing: (pricedItems) =>
        set((state) => {
          if (!pricedItems.length) {
            return state;
          }

          const priceMap = new Map(pricedItems.map((item) => [item.key, item.unitPrice]));
          let hasChange = false;

          const nextItems = state.items.map((item) => {
            const nextPrice = priceMap.get(item.key);
            if (typeof nextPrice !== "number" || nextPrice === item.unitPrice) {
              return item;
            }

            hasChange = true;
            return { ...item, unitPrice: nextPrice };
          });

          return hasChange ? { items: nextItems } : state;
        }),
      updateQuantity: (key, quantity) =>
        set((state) => {
          if (quantity <= 0) {
            const nextItems = state.items.filter((item) => item.key !== key);
            return {
              restaurant: nextItems.length > 0 ? state.restaurant : null,
              items: nextItems,
            };
          }

          return {
            items: state.items.map((item) =>
              item.key === key ? { ...item, quantity } : item
            ),
          };
        }),
      removeItem: (key) =>
        set((state) => {
          const nextItems = state.items.filter((item) => item.key !== key);
          return {
            restaurant: nextItems.length > 0 ? state.restaurant : null,
            items: nextItems,
          };
        }),
      clearCart: () => set({ restaurant: null, items: [], reorderContext: null }),
    }),
    {
      name: "customer-cart-state",
      storage: createJSONStorage(() => appStateStorage),
      partialize: (state) => ({
        restaurant: state.restaurant,
        items: state.items,
        reorderContext: state.reorderContext,
      }),
    }
  )
);
