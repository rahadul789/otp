import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { LoaderCircle } from "lucide-react"

import { api, ApiError } from "@/lib/api"
import { clearOwnerAuthSession, getOwnerAuthSession } from "@/lib/auth-session"
import {
  buildOwnerAccountFromProfile,
  getDefaultSignedOutOwnerAccount,
  type OwnerProfileResponse,
} from "@/lib/backend-mappers"
import { useAppStore } from "@/store/app-store"

function FullscreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="flex flex-col items-center gap-4 rounded-3xl border bg-card px-8 py-10 shadow-sm">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border bg-primary/5 text-primary">
          <LoaderCircle className="h-6 w-6 animate-spin" />
        </div>
        <div className="space-y-1 text-center">
          <p className="font-medium">Restoring your session</p>
          <p className="text-sm text-muted-foreground">
            Checking your owner account and syncing the latest access state.
          </p>
        </div>
      </div>
    </div>
  )
}

export function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const setOwnerAccount = useAppStore((state) => state.setOwnerAccount)
  const setRestaurantLifecycleStatus = useAppStore(
    (state) => state.setRestaurantLifecycleStatus
  )
  const setAuthBootstrapped = useAppStore((state) => state.setAuthBootstrapped)

  const session = React.useMemo(() => getOwnerAuthSession(), [])

  const bootstrapQuery = useQuery({
    queryKey: ["owner", "session-bootstrap"],
    enabled: !!session?.accessToken,
    retry: false,
    queryFn: ({ signal }) =>
      api.get<OwnerProfileResponse>("/owner/me", signal).then((response) => response),
  })

  React.useEffect(() => {
    if (!session?.accessToken) {
      setOwnerAccount(getDefaultSignedOutOwnerAccount())
      setRestaurantLifecycleStatus("account_created")
      setAuthBootstrapped(true)
      return
    }

    if (bootstrapQuery.data) {
      const ownerAccount = buildOwnerAccountFromProfile(bootstrapQuery.data)
      setOwnerAccount(ownerAccount)
      setRestaurantLifecycleStatus(bootstrapQuery.data.restaurantLifecycleStatus)
      setAuthBootstrapped(true)
    }
  }, [
    bootstrapQuery.data,
    session?.accessToken,
    setOwnerAccount,
    setAuthBootstrapped,
    setRestaurantLifecycleStatus,
  ])

  React.useEffect(() => {
    if (!(bootstrapQuery.error instanceof ApiError)) return

    clearOwnerAuthSession()
    setOwnerAccount(getDefaultSignedOutOwnerAccount())
    setRestaurantLifecycleStatus("account_created")
    setAuthBootstrapped(true)
  }, [bootstrapQuery.error, setOwnerAccount, setRestaurantLifecycleStatus, setAuthBootstrapped])

  if (session?.accessToken && bootstrapQuery.isPending) {
    return <FullscreenLoader />
  }

  return <>{children}</>
}
