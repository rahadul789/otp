import {
  useGlobalSearchParams,
  usePathname,
  useSegments,
} from "expo-router";
import { useEffect, useMemo, useRef } from "react";

import {
  trackCustomerEvent,
  type AnalyticsMetadataValue,
  type AnalyticsMetadata,
} from "@/src/lib/analytics";

const blockedParamFragments = [
  "address",
  "cartpayload",
  "email",
  "latitude",
  "longitude",
  "otp",
  "password",
  "phone",
  "token",
  "walletnumber",
];

function isBlockedParamKey(key: string) {
  const normalizedKey = key.toLowerCase();
  return blockedParamFragments.some((fragment) =>
    normalizedKey.includes(fragment),
  );
}

function formatParamValue(value: unknown): AnalyticsMetadataValue {
  if (Array.isArray(value)) {
    return value.slice(0, 5).map((item) => formatParamValue(item));
  }

  if (typeof value === "string") {
    return value.slice(0, 120);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  return String(value ?? "").slice(0, 120);
}

function sanitizeParams(params: Record<string, unknown>): AnalyticsMetadata {
  return Object.entries(params)
    .slice(0, 20)
    .reduce<AnalyticsMetadata>((safeParams, [key, value]) => {
      safeParams[key] = isBlockedParamKey(key)
        ? "[redacted]"
        : formatParamValue(value);
      return safeParams;
    }, {});
}

function getScreenName(segments: string[]) {
  const screenName = segments
    .filter((segment) => !segment.startsWith("("))
    .join("/");

  return screenName || "home";
}

function getRestaurantId(pathname: string) {
  const match = pathname.match(/^\/restaurants\/([^/?#]+)/);
  return match?.[1];
}

export function CustomerAnalyticsBridge() {
  const pathname = usePathname();
  const segments = useSegments();
  const searchParams = useGlobalSearchParams();
  const lastTrackedKeyRef = useRef("");

  const safeParams = useMemo(
    () => sanitizeParams(searchParams as Record<string, unknown>),
    [searchParams],
  );
  const paramsKey = useMemo(() => JSON.stringify(safeParams), [safeParams]);
  const screenName = useMemo(
    () => getScreenName(segments as string[]),
    [segments],
  );

  useEffect(() => {
    const trackingKey = `${pathname}|${paramsKey}`;
    if (lastTrackedKeyRef.current === trackingKey) {
      return;
    }
    lastTrackedKeyRef.current = trackingKey;

    void trackCustomerEvent({
      eventType: "page_view",
      path: pathname,
      screenName,
      metadata: {
        params: safeParams,
        segments: segments as string[],
      },
    });

    const restaurantId = getRestaurantId(pathname);
    if (restaurantId) {
      void trackCustomerEvent({
        eventType: "restaurant_view",
        path: pathname,
        screenName,
        entityType: "restaurant",
        entityId: restaurantId,
      });
    }

    if (pathname === "/checkout") {
      void trackCustomerEvent({
        eventType: "checkout_start",
        path: pathname,
        screenName,
      });
    }

    if (pathname === "/(tabs)/cart" || pathname === "/cart") {
      void trackCustomerEvent({
        eventType: "cart_view",
        path: pathname,
        screenName,
      });
    }
  }, [paramsKey, pathname, safeParams, screenName, segments]);

  return null;
}
