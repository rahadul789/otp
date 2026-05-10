const ACCESS_TOKEN_KEY = "admin_access_token"
const REFRESH_TOKEN_KEY = "admin_refresh_token"
const ADMIN_PROFILE_KEY = "admin_profile"

export type AdminProfile = {
  id: string
  fullName: string
  email: string
  role: "admin"
}

function isAdminProfile(value: unknown): value is AdminProfile {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === "string" &&
    candidate.id.trim().length > 0 &&
    typeof candidate.fullName === "string" &&
    candidate.fullName.trim().length > 0 &&
    typeof candidate.email === "string" &&
    typeof candidate.role === "string" &&
    candidate.role === "admin"
  )
}

export function getAdminAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY)
}

export function getAdminRefreshToken() {
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

export function getAdminProfile(): AdminProfile | null {
  const raw = localStorage.getItem(ADMIN_PROFILE_KEY)
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isAdminProfile(parsed)) {
      clearAdminSession()
      return null
    }
    return parsed
  } catch {
    clearAdminSession()
    return null
  }
}

export function setAdminSession(payload: {
  accessToken: string
  refreshToken: string
  admin: AdminProfile
}) {
  localStorage.setItem(ACCESS_TOKEN_KEY, payload.accessToken)
  localStorage.setItem(REFRESH_TOKEN_KEY, payload.refreshToken)
  localStorage.setItem(ADMIN_PROFILE_KEY, JSON.stringify(payload.admin))
}

export function clearAdminSession() {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
  localStorage.removeItem(ADMIN_PROFILE_KEY)
}
