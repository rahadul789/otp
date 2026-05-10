import mongoose from "mongoose"

import { logger } from "../../config/logger"
import { emitSocketEvent } from "../../config/socket"
import { CustomerModel } from "./customer.model"

type CustomerPushPayload = {
  title: string
  body: string
  contentType?: "text" | "image" | "image_text"
  imageUrl?: string
  data?: Record<string, unknown>
}

type CustomerNotificationRecord = {
  id: string
  type: string
  title: string
  description: string
  path: string
  campaignId: string
  campaignVariant: string
  contentType: string
  imageUrl: string
  isRead: boolean
  readAt: string | null
  createdAt: string
}

type ExpoPushMessage = {
  to: string
  sound: "default"
  title: string
  body: string
  mutableContent?: boolean
  image?: string
  richContent?: {
    image?: string
  }
  data?: Record<string, unknown>
}

function isExpoPushToken(token: string) {
  return /^ExponentPushToken\[[^\]]+\]$/.test(token) || /^ExpoPushToken\[[^\]]+\]$/.test(token)
}

function isNotificationEnabled(
  settings: {
    orderUpdates?: boolean
    restaurantStatus?: boolean
    reviewReplies?: boolean
  } | null | undefined,
  type: string
) {
  switch (type) {
    case "order_status":
      return settings?.orderUpdates ?? true
    case "restaurant_status":
      return settings?.restaurantStatus ?? true
    case "review_reply":
      return settings?.reviewReplies ?? true
    default:
      return true
  }
}

function mapCustomerNotification(notification: {
  _id?: mongoose.Types.ObjectId | string
  type?: string
  title?: string
  description?: string
  path?: string
  campaignId?: string
  campaignVariant?: string
  contentType?: string
  imageUrl?: string
  isRead?: boolean
  readAt?: Date | string | null
  createdAt?: Date | string | null
}): CustomerNotificationRecord {
  return {
    id: String(notification._id ?? ""),
    type: notification.type ?? "system",
    title: notification.title ?? "",
    description: notification.description ?? "",
    path: notification.path ?? "",
    campaignId: notification.campaignId ?? "",
    campaignVariant: notification.campaignVariant ?? "",
    contentType: notification.contentType ?? "text",
    imageUrl: notification.imageUrl ?? "",
    isRead: Boolean(notification.isRead),
    readAt: notification.readAt ? new Date(notification.readAt).toISOString() : null,
    createdAt: notification.createdAt
      ? new Date(notification.createdAt).toISOString()
      : new Date().toISOString()
  }
}

export async function createCustomerNotification(params: {
  customerId: string
  payload: CustomerPushPayload
}) {
  const path =
    typeof params.payload.data?.path === "string" ? params.payload.data.path : ""
  const type =
    typeof params.payload.data?.type === "string" ? params.payload.data.type : "system"
  const campaignId =
    typeof params.payload.data?.campaignId === "string" ? params.payload.data.campaignId : ""
  const campaignVariant =
    typeof params.payload.data?.variant === "string" ? params.payload.data.variant : ""
  const customer = await CustomerModel.findById(params.customerId).select("notificationSettings")

  if (!isNotificationEnabled(customer?.notificationSettings, type)) {
    logger.info({ customerId: params.customerId, type }, "Notification skipped by customer preference")
    return null
  }

  const notificationId = new mongoose.Types.ObjectId()

  await CustomerModel.updateOne(
    { _id: params.customerId },
    {
      $push: {
        notifications: {
          $each: [
            {
              _id: notificationId,
              type,
              title: params.payload.title,
              description: params.payload.body,
              path,
              campaignId,
              campaignVariant,
              contentType: params.payload.contentType ?? "text",
              imageUrl: params.payload.imageUrl ?? "",
              isRead: false,
              readAt: null,
              createdAt: new Date()
            }
          ],
          $position: 0,
          $slice: 100
        }
      }
    }
  )

  const notification = mapCustomerNotification({
    _id: notificationId,
    type,
    title: params.payload.title,
    description: params.payload.body,
    path,
    campaignId,
    campaignVariant,
    contentType: params.payload.contentType ?? "text",
    imageUrl: params.payload.imageUrl ?? "",
    isRead: false,
    readAt: null,
    createdAt: new Date()
  })

  emitSocketEvent(`customer:${params.customerId}`, "customer.notification.created", notification)

  return notification
}

export async function listCustomerNotifications(customerId: string, params?: {
  page?: number
  limit?: number
}) {
  const customer = await CustomerModel.findById(customerId).select("notifications")
  const notifications = [...(customer?.notifications ?? [])]
    .sort((left, right) => {
      const leftTime = new Date(left.createdAt ?? 0).getTime()
      const rightTime = new Date(right.createdAt ?? 0).getTime()
      return rightTime - leftTime
    })
  const mappedNotifications = notifications.map((notification) =>
    mapCustomerNotification(notification.toObject())
  )
  const limit = Math.min(Math.max(params?.limit ?? 20, 1), 50)
  const page = Math.max(params?.page ?? 1, 1)
  const start = (page - 1) * limit
  const items = mappedNotifications.slice(start, start + limit)
  const total = mappedNotifications.length

  return {
    items,
    total,
    unreadCount: mappedNotifications.filter((notification) => !notification.isRead).length,
    page,
    limit,
    hasMore: start + items.length < total,
    nextPage: start + items.length < total ? page + 1 : null
  }
}

export async function markCustomerNotificationAsRead(params: {
  customerId: string
  notificationId: string
}) {
  await CustomerModel.updateOne(
    {
      _id: params.customerId,
      "notifications._id": params.notificationId
    },
    {
      $set: {
        "notifications.$.isRead": true,
        "notifications.$.readAt": new Date()
      }
    }
  )

  return listCustomerNotifications(params.customerId)
}

export async function markCustomerNotificationOpened(params: {
  customerId: string
  notificationId?: string
  campaignId?: string
}) {
  const filters: Record<string, unknown>[] = []

  if (params.notificationId) {
    filters.push({ "notifications._id": params.notificationId })
  }

  if (params.campaignId) {
    filters.push({ "notifications.campaignId": params.campaignId })
  }

  if (!filters.length) return { recorded: false, matched: 0, modified: 0 }

  const result = await CustomerModel.updateOne(
    {
      _id: params.customerId,
      $or: filters,
    },
    {
      $set: {
        "notifications.$.isRead": true,
        "notifications.$.readAt": new Date(),
      },
    },
  )

  return {
    recorded: result.matchedCount > 0,
    matched: result.matchedCount,
    modified: result.modifiedCount,
  }
}

export async function markAllCustomerNotificationsAsRead(customerId: string) {
  await CustomerModel.updateOne(
    { _id: customerId },
    {
      $set: {
        "notifications.$[notification].isRead": true,
        "notifications.$[notification].readAt": new Date()
      }
    },
    {
      arrayFilters: [
        {
          "notification.isRead": false
        }
      ]
    }
  )

  return listCustomerNotifications(customerId)
}

export async function sendPushToCustomer(params: {
  customerId: string
  payload: CustomerPushPayload
  excludeExpoTokens?: Set<string>
}) {
  const createdNotification = await createCustomerNotification(params)

  if (!createdNotification) {
    return { sent: 0, disabled: 0, inAppCreated: 0, skipped: true, sentExpoTokens: [], ticketIds: [] }
  }

  const customer = await CustomerModel.findById(params.customerId).select("pushTokens")

  if (!customer?.pushTokens?.length) {
    logger.info({ customerId: params.customerId }, "Push skipped: no customer push tokens")
    return { sent: 0, disabled: 0, inAppCreated: 1, sentExpoTokens: [], ticketIds: [] }
  }

  const activeTokens = customer.pushTokens.filter(
    (token) => !token.disabledAt && isExpoPushToken(token.expoPushToken)
  )
  const latestActiveToken = [...activeTokens]
    .filter((token) => !params.excludeExpoTokens?.has(token.expoPushToken))
    .sort((left, right) => {
      const leftTime = new Date(left.lastSeenAt ?? 0).getTime()
      const rightTime = new Date(right.lastSeenAt ?? 0).getTime()
      return rightTime - leftTime
    })[0]
  const uniqueActiveTokens = latestActiveToken ? [latestActiveToken] : []

  if (!uniqueActiveTokens.length) {
    logger.info({ customerId: params.customerId }, "Push skipped: no active Expo push tokens")
    return { sent: 0, disabled: 0, inAppCreated: 1, sentExpoTokens: [], ticketIds: [] }
  }

  const sentExpoTokens = uniqueActiveTokens.map((token) => token.expoPushToken)
  const messages: ExpoPushMessage[] = uniqueActiveTokens.map((token) => ({
    to: token.expoPushToken,
    sound: "default",
    title: params.payload.title,
    body: params.payload.body,
    ...(params.payload.imageUrl
      ? {
          mutableContent: true,
          image: params.payload.imageUrl,
          richContent: { image: params.payload.imageUrl },
        }
      : {}),
    data: {
      ...params.payload.data,
      notificationId: createdNotification.id,
    }
  }))

  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(messages)
  })

  if (!response.ok) {
    logger.error(
      {
        customerId: params.customerId,
        status: response.status
      },
      "Expo push send failed"
    )
    return { sent: 0, disabled: 0, inAppCreated: 1, sentExpoTokens: [], ticketIds: [] }
  }

  const payload = (await response.json()) as {
    data?: Array<{
      status?: string
      id?: string
      details?: {
        error?: string
      }
    }>
  }

  const invalidIndexes: number[] = []
  let sent = 0
  const ticketIds: string[] = []

  payload.data?.forEach((entry, index) => {
    if (entry.status === "ok") {
      sent += 1
      if (entry.id) ticketIds.push(entry.id)
      return
    }

    if (entry.details?.error === "DeviceNotRegistered") {
      invalidIndexes.push(index)
    }
  })

  if (invalidIndexes.length) {
    const invalidTokenIds = invalidIndexes
      .map((index) => uniqueActiveTokens[index]?._id)
      .filter(Boolean)

    if (invalidTokenIds.length) {
      await CustomerModel.updateOne(
        { _id: params.customerId },
        {
          $set: {
            "pushTokens.$[token].disabledAt": new Date()
          }
        },
        {
          arrayFilters: [
            {
              "token._id": { $in: invalidTokenIds }
            }
          ]
        }
      )
    }
  }

  logger.info(
    {
      customerId: params.customerId,
      sent,
      disabled: invalidIndexes.length
    },
    "Expo push processed"
  )

  return { sent, disabled: invalidIndexes.length, inAppCreated: 1, sentExpoTokens, ticketIds }
}
