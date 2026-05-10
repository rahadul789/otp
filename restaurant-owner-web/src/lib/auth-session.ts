const AUTH_SESSION_STORAGE_KEY = "restaurant-owner-auth-session"

export type OwnerAuthSession = {
  accessToken: string
  refreshToken: string
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
}

export function getOwnerAuthSession(): OwnerAuthSession | null {
  if (!canUseStorage()) return null

  const raw = window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<OwnerAuthSession>
    if (!parsed.accessToken || !parsed.refreshToken) return null

    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
    }
  } catch {
    return null
  }
}

export function setOwnerAuthSession(session: OwnerAuthSession) {
  if (!canUseStorage()) return

  window.localStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session))
}

export function clearOwnerAuthSession() {
  if (!canUseStorage()) return
  window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY)
}

