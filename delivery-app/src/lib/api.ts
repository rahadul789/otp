import { useRiderAuthStore, type RiderProfile } from "@/src/store/auth-store";
import { setDeliveryNetworkOnline, useNetworkStore } from "@/src/store/network-store";
import { API_BASE_URL } from "@/src/config/api";

type ApiResponse<T> = {
  success: boolean;
  message?: string;
  data: T;
};

async function parseResponse<T>(response: Response) {
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok) {
    const defaultRateLimitMessage =
      "Too many attempts for now. Please wait a moment and try again.";

    if (contentType.includes("application/json") && text) {
      const payload = JSON.parse(text) as { message?: string };
      throw new Error(
        payload.message ??
          (response.status === 429
            ? defaultRateLimitMessage
            : `Request failed with status ${response.status}`)
      );
    }

    throw new Error(
      response.status === 429
        ? defaultRateLimitMessage
        : `Request failed with status ${response.status}`
    );
  }

  if (!contentType.includes("application/json") || !text) {
    throw new Error("Server returned a non-JSON response.");
  }

  return JSON.parse(text) as ApiResponse<T>;
}

function isLikelyNetworkError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    error.name === "TypeError" ||
    message.includes("network request failed") ||
    message.includes("failed to fetch") ||
    message.includes("networkerror")
  );
}

async function refreshRiderSession() {
  const { refreshToken } = useRiderAuthStore.getState();
  if (!refreshToken) return false;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/rider/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refreshToken }),
    });
    setDeliveryNetworkOnline(true);
  } catch (error) {
    if (isLikelyNetworkError(error)) {
      setDeliveryNetworkOnline(false);
    }
    throw error;
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      useRiderAuthStore.getState().clearSession();
    }
    return false;
  }

  const payload = await parseResponse<{
    accessToken: string;
    refreshToken: string;
    rider: RiderProfile;
  }>(response);

  useRiderAuthStore.getState().setSession({
    accessToken: payload.data.accessToken,
    refreshToken: payload.data.refreshToken,
    rider: payload.data.rider,
  });

  return true;
}

async function apiRequest<T>(path: string, init?: RequestInit, allowRetry = true) {
  const { accessToken } = useRiderAuthStore.getState();
  const headers = new Headers(init?.headers ?? {});
  let slowTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    useNetworkStore
      .getState()
      .markSlow("Connection is taking longer than usual. We are still trying.");
  }, 6000);

  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }

  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
    });
    if (slowTimer) {
      clearTimeout(slowTimer);
      slowTimer = null;
    }
    setDeliveryNetworkOnline(true);
  } catch (error) {
    if (slowTimer) {
      clearTimeout(slowTimer);
      slowTimer = null;
    }
    if (isLikelyNetworkError(error)) {
      const message = "You appear to be offline. Reconnect and try again.";
      useNetworkStore.getState().markOffline(message);
      throw new Error(message);
    }
    throw error;
  }

  if (response.status === 401 && allowRetry && !path.includes("/rider/auth/refresh")) {
    const refreshed = await refreshRiderSession();
    if (refreshed) {
      return apiRequest<T>(path, init, false);
    }
  }

  return parseResponse<T>(response);
}

export async function apiGet<T>(path: string) {
  return apiRequest<T>(path, { method: "GET" });
}

export async function apiPost<T>(path: string, body?: unknown, method: "POST" | "PATCH" = "POST") {
  return apiRequest<T>(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function apiDelete<T>(path: string) {
  return apiRequest<T>(path, { method: "DELETE" });
}
