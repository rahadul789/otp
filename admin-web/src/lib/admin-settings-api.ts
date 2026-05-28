import { adminRequest } from "./api"
import type { PlatformContent } from "./admin-api"

export type AdminPlatformSettings = Pick<
  PlatformContent,
  "branding" | "operations" | "auth" | "supportContact" | "helpCenter" | "legal"
>

export type AdminPlatformSettingsResponse = {
  settings: AdminPlatformSettings
  meta: {
    updatedAt: string | null
    updatedByAdminId: string | null
    updatedByAdminName: string
  }
  history: Array<{
    updatedAt: string
    updatedByAdminId: string | null
    updatedByAdminName: string
    changedSections: string[]
  }>
}

export async function getAdminPlatformSettings() {
  const response = await adminRequest<AdminPlatformSettingsResponse>("/admin/settings")
  return response.data
}

export async function updateAdminPlatformSettings(settings: AdminPlatformSettings) {
  const response = await adminRequest<AdminPlatformSettingsResponse>("/admin/settings", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ settings }),
  })
  return response.data
}
