import { apiPost } from "@/src/lib/api";
import { secureStateStorage } from "@/src/lib/secure-storage";

export const customerAnalyticsEventTypes = [
  "page_view",
  "restaurant_view",
  "menu_item_view",
  "cart_add",
  "cart_view",
  "checkout_start",
  "signup_started",
  "signup_completed",
  "order_created",
  "search",
  "custom",
] as const;

export type CustomerAnalyticsEventType =
  (typeof customerAnalyticsEventTypes)[number];

export type AnalyticsMetadataValue =
  | string
  | number
  | boolean
  | null
  | AnalyticsMetadataValue[]
  | { [key: string]: AnalyticsMetadataValue };

export type AnalyticsMetadata = Record<string, AnalyticsMetadataValue>;

type TrackCustomerEventInput = {
  eventType: CustomerAnalyticsEventType;
  path: string;
  screenName?: string;
  entityType?: string;
  entityId?: string;
  metadata?: AnalyticsMetadata;
};

const anonymousIdStorageKey = "customer-app:analytics:anonymous-id";
const sessionId = buildId("session");
let anonymousIdPromise: Promise<string> | null = null;

function buildId(prefix: string) {
  const cryptoObject = globalThis.crypto as
    | { randomUUID?: () => string }
    | undefined;
  const uuid = cryptoObject?.randomUUID?.();

  if (uuid) {
    return `${prefix}_${uuid}`;
  }

  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 12)}`;
}

async function getAnonymousId() {
  if (!anonymousIdPromise) {
    anonymousIdPromise = (async () => {
      try {
        const existingId = await secureStateStorage.getItem(
          anonymousIdStorageKey,
        );
        if (existingId) {
          return existingId;
        }

        const newId = buildId("anon");
        await secureStateStorage.setItem(anonymousIdStorageKey, newId);
        return newId;
      } catch {
        return buildId("anon");
      }
    })();
  }

  return anonymousIdPromise;
}

export async function trackCustomerEvent(input: TrackCustomerEventInput) {
  try {
    const anonymousId = await getAnonymousId();

    await apiPost("/customer/analytics/events", {
      ...input,
      anonymousId,
      sessionId,
      sourceApp: "customer-app",
      occurredAt: new Date().toISOString(),
    });
  } catch {
    // Analytics must never block browsing, checkout, or auth flows.
  }
}
