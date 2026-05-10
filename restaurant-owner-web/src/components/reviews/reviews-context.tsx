import * as React from "react"

import { useOwnerReviewsQuery } from "@/hooks/use-owner-api"
import {
  mapOwnerReview,
  type OwnerListResponse,
  type OwnerReviewResponse,
} from "@/lib/backend-mappers"
import { useAppStore } from "@/store/app-store"

export function ReviewsProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const ownerAccount = useAppStore((state) => state.ownerAccount)
  const setReviews = useAppStore((state) => state.setReviews)
  const reviewsQuery = useOwnerReviewsQuery(ownerAccount.isAuthenticated)

  React.useEffect(() => {
    if (!reviewsQuery.data) return

    const mapped = (
      reviewsQuery.data as OwnerListResponse<OwnerReviewResponse>
    ).items.map(mapOwnerReview)
    setReviews(mapped)
  }, [reviewsQuery.data, setReviews])

  return <>{children}</>
}

export function useReviews() {
  const reviews = useAppStore((state) => state.reviews)
  const setReviews = useAppStore((state) => state.setReviews)

  return { reviews, setReviews }
}
