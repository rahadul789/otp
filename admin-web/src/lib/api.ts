import {
  clearAdminSession,
  getAdminAccessToken,
  notifyAdminSessionExpired,
  setAdminSession
} from "./admin-session"

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:5000/api/v1"

type ApiResponse<T> = {
  success: boolean
  message?: string
  data: T
}

class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

let refreshSessionPromise: Promise<string> | null = null

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, {
    ...init,
    credentials: "include"
  })
  const contentType = response.headers.get("content-type") ?? ""

  if (!response.ok) {
    let errorMessage = `Request failed with status ${response.status}`
    if (contentType.includes("application/json")) {
      const errorPayload = (await response.json()) as { message?: string }
      errorMessage = errorPayload.message ?? errorMessage
    }
    if (response.status === 429 && errorMessage === `Request failed with status ${response.status}`) {
      errorMessage = "Too many attempts for now. Please wait a bit and try again."
    }
    throw new ApiError(response.status, errorMessage)
  }

  if (contentType.includes("application/json")) {
    return (await response.json()) as ApiResponse<T>
  }

    throw new ApiError(500, "Unexpected response from server.")
}

async function refreshAdminSession() {
  if (refreshSessionPromise) {
    return refreshSessionPromise
  }

  refreshSessionPromise = (async () => {
    let payload: ApiResponse<{
      accessToken: string
      admin: {
        id: string
        fullName: string
        email: string
        role: "admin"
      }
    }>
    try {
      payload = await fetchJson<{
        accessToken: string
        admin: {
          id: string
          fullName: string
          email: string
          role: "admin"
        }
      }>(`${API_BASE_URL}/admin/auth/refresh`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({})
      })
    } catch (error) {
      if (error instanceof ApiError && [401, 403].includes(error.status)) {
        clearAdminSession()
        notifyAdminSessionExpired()
      }
      throw error
    }

    setAdminSession(payload.data)
    return payload.data.accessToken
  })()

  try {
    return await refreshSessionPromise
  } finally {
    refreshSessionPromise = null
  }
}

export async function adminRequest<T>(
  path: string,
  init?: RequestInit & { skipAuth?: boolean }
) {
  const headers = new Headers(init?.headers)
  const shouldAuth = !init?.skipAuth

  if (shouldAuth) {
    const accessToken = getAdminAccessToken()
    if (accessToken) {
      headers.set("authorization", `Bearer ${accessToken}`)
    }
  }

  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json")
  }

  try {
    return await fetchJson<T>(`${API_BASE_URL}${path}`, {
      ...init,
      headers
    })
  } catch (error) {
    if (error instanceof ApiError && error.status === 401 && shouldAuth) {
      let newToken = ""
      try {
        newToken = await refreshAdminSession()
      } catch (refreshError) {
        if (refreshError instanceof ApiError && [401, 403].includes(refreshError.status)) {
          clearAdminSession()
          notifyAdminSessionExpired()
          throw new Error("Admin session expired. Please sign in again.")
        }
        throw refreshError
      }
      headers.set("authorization", `Bearer ${newToken}`)
      return await fetchJson<T>(`${API_BASE_URL}${path}`, {
        ...init,
        headers
      })
    }
    throw error
  }
}

export function getApiBaseUrl() {
  return API_BASE_URL
}
