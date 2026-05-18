import { apiPost } from "@/src/lib/api";
import { secureStateStorage } from "@/src/lib/secure-storage";

export const customerAnalyticsEventTypes = [
  "page_view",
  "restaurant_view",
  "menu_item_view",
  "cart_add",
  "cart_view",
  "checkout_start",
  "payment_initiated",
  "payment_completed",
  "payment_failed",
  "payment_cancelled",
  "signup_started",
  "signup_completed",
  "order_created",
  "search",
  "campaign_open",
  "voucher_applied",
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
const attributionStorageKey = "customer-app:analytics:last-attribution";
const sessionId = buildId("session");
let anonymousIdPromise: Promise<string> | null = null;

export type CustomerAnalyticsAttribution = {
  source?: string;
  medium?: string;
  campaignId?: string;
  voucherId?: string;
  referrer?: string;
  path?: string;
  capturedAt?: string;
};

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

function hasAttributionValue(input: CustomerAnalyticsAttribution) {
  return Boolean(
    input.source ||
      input.medium ||
      input.campaignId ||
      input.voucherId ||
      input.referrer,
  );
}

async function getRememberedAttribution() {
  try {
    const rawValue = await secureStateStorage.getItem(attributionStorageKey);
    if (!rawValue) return null;
    const parsed = JSON.parse(rawValue) as CustomerAnalyticsAttribution;
    return hasAttributionValue(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function rememberCustomerAttribution(
  input: CustomerAnalyticsAttribution,
) {
  if (!hasAttributionValue(input)) return;

  try {
    await secureStateStorage.setItem(
      attributionStorageKey,
      JSON.stringify({
        ...input,
        capturedAt: input.capturedAt ?? new Date().toISOString(),
      }),
    );
  } catch {
    // Attribution is helpful for analytics, but it must never interrupt the app.
  }
}

export async function trackCustomerEvent(input: TrackCustomerEventInput) {
  try {
    const anonymousId = await getAnonymousId();
    const attribution = await getRememberedAttribution();
    const metadata = attribution
      ? {
          attribution,
          ...(input.metadata ?? {}),
        }
      : input.metadata;

    await apiPost("/customer/analytics/events", {
      ...input,
      metadata,
      anonymousId,
      sessionId,
      sourceApp: "customer-app",
      occurredAt: new Date().toISOString(),
    });
  } catch {
    // Analytics must never block browsing, checkout, or auth flows.
  }
}
