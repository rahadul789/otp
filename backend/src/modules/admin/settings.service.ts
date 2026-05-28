import { createInMemoryAsyncCache } from "../../common/utils/in-memory-cache"
import {
  getAdminEditablePlatformContent,
  getPlatformContent,
  updatePlatformContent,
} from "../public/content.service"
import { platformContent } from "../public/content"

type PlatformContent = Awaited<ReturnType<typeof getPlatformContent>>
type AdminEditablePlatformContent = Awaited<ReturnType<typeof getAdminEditablePlatformContent>>

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
    updatedAt: string | null
    updatedByAdminId: string | null
    updatedByAdminName: string
    changedSections: string[]
  }>
}

const SETTINGS_CACHE_KEY = "admin-platform-settings"
const adminPlatformSettingsCache = createInMemoryAsyncCache<AdminPlatformSettingsResponse>({
  ttlMs: 15_000,
  staleWhileRevalidateMs: 45_000,
  maxEntries: 1,
})

function pickAdminPlatformSettings(content: AdminPlatformSettings): AdminPlatformSettings {
  return {
    branding: content.branding,
    operations: content.operations,
    auth: content.auth,
    supportContact: content.supportContact,
    helpCenter: content.helpCenter,
    legal: content.legal,
  }
}

function mapSettingsResponse(
  editor: AdminEditablePlatformContent,
  settings: AdminPlatformSettings,
): AdminPlatformSettingsResponse {
  return {
    settings,
    meta: editor.meta,
    history: editor.history,
  }
}

export async function getAdminPlatformSettings() {
  return adminPlatformSettingsCache.getOrSet(SETTINGS_CACHE_KEY, async () => {
    const editor = await getAdminEditablePlatformContent()
    const content = editor.content ?? platformContent
    const settings = pickAdminPlatformSettings({
      branding: content.branding ?? platformContent.branding,
      operations: content.operations ?? platformContent.operations,
      auth: content.auth ?? platformContent.auth,
      supportContact: content.supportContact ?? platformContent.supportContact,
      helpCenter: content.helpCenter ?? platformContent.helpCenter,
      legal: content.legal ?? platformContent.legal,
    })

    return mapSettingsResponse(editor, settings)
  })
}

export async function updateAdminPlatformSettings(params: {
  adminId: string
  settings: AdminPlatformSettings
}) {
  adminPlatformSettingsCache.clear()

  const currentContent = await getPlatformContent()
  const nextContent: PlatformContent = {
    ...currentContent,
    branding: params.settings.branding,
    operations: params.settings.operations,
    auth: params.settings.auth,
    supportContact: params.settings.supportContact,
    helpCenter: params.settings.helpCenter,
    legal: params.settings.legal,
  }

  const editor = await updatePlatformContent({
    content: nextContent,
    adminId: params.adminId,
  })

  adminPlatformSettingsCache.clear()
  return mapSettingsResponse(editor, pickAdminPlatformSettings(editor.content))
}
