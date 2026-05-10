import { QueryClientProvider } from "@tanstack/react-query";
import { PropsWithChildren } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { CustomerLocationSync } from "@/src/components/customer-location-sync";
import { NetworkStateBridge } from "@/src/components/network-state-bridge";
import { OfflineBanner } from "@/src/components/offline-banner";
import { CustomerPushBridge } from "@/src/components/customer-push-bridge";
import { CustomerSocketBridge } from "@/src/components/customer-socket-bridge";
import { queryClient } from "@/src/lib/query-client";

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <CustomerPushBridge>
            <NetworkStateBridge />
            <CustomerLocationSync />
            <CustomerSocketBridge />
            <OfflineBanner />
            {children}
          </CustomerPushBridge>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
