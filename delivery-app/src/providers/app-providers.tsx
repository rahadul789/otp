import { QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { RiderLocationBridge } from "@/src/components/rider-location-bridge";
import { RiderPushBridge } from "@/src/components/rider-push-bridge";
import { RiderSocketBridge } from "@/src/components/rider-socket-bridge";
import { queryClient } from "@/src/lib/query-client";

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <RiderPushBridge>
            <RiderSocketBridge />
            <RiderLocationBridge>{children}</RiderLocationBridge>
          </RiderPushBridge>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
