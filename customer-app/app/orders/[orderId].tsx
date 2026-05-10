import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { ReorderCartSwitchModal } from "@/src/components/orders/reorder-cart-switch-modal";
import { EmptyStateCard } from "@/src/components/empty-state-card";
import {
  useCustomerCancelOrderMutation,
  useCustomerOrderDetailsQuery,
  useCustomerReorderMutation,
  useCustomerReviewMutation,
} from "@/src/hooks/use-customer-api";
import { formatDateTimeAmPm } from "@/src/lib/date-time";
import { useAppBannerStore } from "@/src/store/app-banner-store";
import { palette } from "@/src/theme/palette";

function formatCurrency(amount: number) {
  return `Tk ${amount.toFixed(0)}`;
}

function isActiveStatus(status: string) {
  return ["New", "Accepted", "Preparing", "ReadyForPickup", "PickedUp"].includes(status);
}

function isCancelledStatus(status: string) {
  return ["Cancelled", "Rejected"].includes(status);
}

function canCancelOrder(status: string) {
  return status === "New";
}

const orderStatusSteps = [
  "New",
  "Accepted",
  "Preparing",
  "ReadyForPickup",
  "PickedUp",
  "Delivered",
] as const;

function getStatusMeta(status: string) {
  switch (status) {
    case "Delivered":
      return {
        label: "Delivered",
        color: palette.successText,
        background: palette.successSurface,
        icon: "checkmark-circle" as const,
      };
    case "Cancelled":
      return {
        label: "Cancelled",
        color: palette.foreground,
        background: "#F5F5F5",
        icon: "close-circle-outline" as const,
      };
    case "Rejected":
      return {
        label: "Rejected",
        color: palette.primary,
        background: "#FFF0F6",
        icon: "storefront-outline" as const,
      };
    case "PickedUp":
      return {
        label: "On the way",
        color: palette.sky,
        background: "#EAF2FF",
        icon: "bicycle-outline" as const,
      };
    case "Preparing":
      return {
        label: "Preparing",
        color: palette.amber,
        background: "#FFF0F7",
        icon: "restaurant-outline" as const,
      };
    case "ReadyForPickup":
      return {
        label: "Ready for pickup",
        color: palette.amber,
        background: "#FFF0F7",
        icon: "bag-handle-outline" as const,
      };
    case "Accepted":
      return {
        label: "Accepted",
        color: palette.sky,
        background: "#EAF2FF",
        icon: "checkmark-done-circle-outline" as const,
      };
    default:
      return {
        label: "Order placed",
        color: palette.secondary,
        background: "#FFE8F0",
        icon: "receipt-outline" as const,
      };
  }
}

function getTrackingBanner(order: {
  status: string;
  paymentMethod?: string;
  terminalReason?: string;
  cancelledBy?: string;
  history?: { note?: string }[];
}) {
  switch (order.status) {
    case "New":
      return {
        title: "Order placed successfully",
        subtitle:
          "The restaurant received your order. Rider assignment starts after food is ready.",
        icon: "receipt-outline" as const,
        tint: "#FFE8F0",
        accent: palette.secondary,
      };
    case "Accepted":
      return {
        title: "Restaurant confirmed your order",
        subtitle:
          "The kitchen is getting things ready. We will assign a rider after the food is ready.",
        icon: "checkmark-done-circle-outline" as const,
        tint: "#EAF2FF",
        accent: palette.sky,
      };
    case "Preparing":
      return {
        title: "Your food is being prepared",
        subtitle: "Rider assignment starts after the food is ready for pickup.",
        icon: "restaurant-outline" as const,
        tint: "#FFF0F7",
        accent: palette.amber,
      };
    case "ReadyForPickup":
      return {
        title: "Ready for rider pickup",
        subtitle: "Your order is packed and waiting to be collected.",
        icon: "bag-handle-outline" as const,
        tint: "#FFF0F7",
        accent: palette.amber,
      };
    case "Delivered":
      return {
        title: "Delivered successfully",
        subtitle: "This order already reached your address.",
        icon: "checkmark-circle" as const,
        tint: palette.successSurface,
        accent: palette.successText,
      };
    case "Cancelled":
      if (order.cancelledBy === "customer") {
        return {
          title: "You cancelled this order",
          subtitle:
            "This order was cancelled before the restaurant accepted it. You can place another one any time.",
          icon: "close-circle-outline" as const,
          tint: "#F5F5F5",
          accent: palette.foreground,
        };
      }
      if (
        order.cancelledBy === "system" ||
        order.terminalReason === "system_auto_cancel_unaccepted" ||
        order.terminalReason?.toLowerCase().includes("auto-cancel")
      ) {
        return {
          title: "Order auto-cancelled",
          subtitle:
            "The restaurant did not accept this order in time, so the system cancelled it automatically.",
          icon: "timer-outline" as const,
          tint: "#FFF7E8",
          accent: palette.amber,
        };
      }
      if (order.cancelledBy === "owner" || order.cancelledBy === "restaurant") {
        return {
          title: "Restaurant cancelled this order",
          subtitle:
            "The restaurant could not continue with this order. If you paid online, support can help with the refund flow.",
          icon: "storefront-outline" as const,
          tint: "#FFF0F6",
          accent: palette.primary,
        };
      }
      return {
        title: "This order was cancelled",
        subtitle:
          "This order is no longer active. If you paid online, support can help with the refund flow.",
        icon: "close-circle-outline" as const,
        tint: "#F5F5F5",
        accent: palette.foreground,
      };
    case "Rejected":
      return {
        title: "Restaurant cancelled this order",
        subtitle:
          "The restaurant could not accept this order. If you paid online, support can help with the refund flow.",
        icon: "storefront-outline" as const,
        tint: "#FFF0F6",
        accent: palette.primary,
      };
    default:
      return null;
  }
}

export default function OrderDetailsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ orderId?: string; justPlaced?: string }>();
  const orderId = typeof params.orderId === "string" ? params.orderId : undefined;
  const isJustPlaced = params.justPlaced === "1";
  const orderQuery = useCustomerOrderDetailsQuery(orderId);
  const cancelMutation = useCustomerCancelOrderMutation(orderId);
  const reorderMutation = useCustomerReorderMutation();
  const reviewMutation = useCustomerReviewMutation(orderId);
  const showBanner = useAppBannerStore((state) => state.showBanner);
  const [selectedRating, setSelectedRating] = useState(0);
  const [reviewComment, setReviewComment] = useState("");
  const [isCancelModalOpen, setCancelModalOpen] = useState(false);
  const [reorderConflictMeta, setReorderConflictMeta] = useState<{
    currentRestaurantName: string;
    incomingRestaurantName: string;
    previewItemName: string;
  } | null>(null);

  const order = orderQuery.data;
  const statusMeta = getStatusMeta(order?.status ?? "New");
  const trackingBanner = order ? getTrackingBanner(order) : null;
  const canReviewOrder = order?.status === "Delivered" && !order?.customerReview;
  const activeStatusIndex = Math.max(orderStatusSteps.indexOf((order?.status as never) ?? "New"), 0);
  const canCallRider = Boolean(order?.riderSnapshot?.phone) && isActiveStatus(order?.status ?? "");
  const itemRows = useMemo(() => order?.itemsSnapshot ?? [], [order?.itemsSnapshot]);
  const historyRows = useMemo(() => order?.history ?? [], [order?.history]);
  const restaurantLogoUrl =
    order &&
    "restaurantSnapshot" in order &&
    typeof (order as { restaurantSnapshot?: { logoUrl?: string } }).restaurantSnapshot?.logoUrl ===
      "string"
      ? (order as { restaurantSnapshot?: { logoUrl?: string } }).restaurantSnapshot?.logoUrl
      : "";

  const handleRetry = useCallback(() => {
    void orderQuery.refetch();
  }, [orderQuery]);

  const handleTrackLive = useCallback(() => {
    if (!order) return;
    void Haptics.selectionAsync();
    router.push({
      pathname: "/orders/[orderId]/tracking",
      params: { orderId: order._id },
    });
  }, [order, router]);

  const handleCallRider = useCallback(async () => {
    if (!order?.riderSnapshot?.phone) return;
    void Haptics.selectionAsync();
    await Linking.openURL(`tel:${order.riderSnapshot.phone}`);
  }, [order?.riderSnapshot?.phone]);

  const handleCancelOrder = useCallback(() => {
    cancelMutation.mutate({ reason: "customer_cancelled" });
  }, [cancelMutation]);

  const handleSubmitReview = useCallback(() => {
    if (!selectedRating) return;
    reviewMutation.mutate({
      rating: selectedRating,
      comment: reviewComment.trim() || undefined,
    });
  }, [reviewComment, reviewMutation, selectedRating]);

  const handleReorder = useCallback(
    async (forceReplace = false) => {
      if (!order) return;

      void Haptics.selectionAsync();
      const result = await reorderMutation.mutateAsync({
        order: {
          _id: order._id,
          orderNumber: order.orderNumber,
          restaurantId: order.restaurantId,
          itemsSnapshot: order.itemsSnapshot,
        },
        forceReplace,
      });

      if (result.status === "conflict") {
        setReorderConflictMeta({
          currentRestaurantName: result.currentRestaurantName,
          incomingRestaurantName: result.incomingRestaurantName,
          previewItemName: result.previewItemName,
        });
        return;
      }

      if (result.status === "empty") {
        showBanner({
          title: "Could not reorder this order",
          description:
            result.skippedCount > 0
              ? "Those items are no longer available with their previous configuration."
              : "We could not rebuild this order right now.",
          tone: "warning",
        });
        return;
      }

      showBanner({
        title:
          result.skippedCount > 0
            ? "Reordered what is still available"
            : "Items added to your cart",
        description:
          result.skippedCount > 0
            ? `${result.addedItemCount} item${result.addedItemCount === 1 ? "" : "s"} added. ${result.skippedCount} could not be added.`
            : `Added ${result.addedItemCount} item${result.addedItemCount === 1 ? "" : "s"} from this delivered order.`,
        tone: result.skippedCount > 0 ? "warning" : "success",
      });
      router.push("/(tabs)/cart");
    },
    [order, reorderMutation, router, showBanner]
  );

  if (orderQuery.isLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.loadingWrap}>
          <View style={styles.loadingCard}>
            <ActivityIndicator size="small" color={palette.primary} />
            <Text style={styles.loadingText}>Loading order details...</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (orderQuery.isError || !order) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.emptyState}>
          <EmptyStateCard
            title="Could not load this order"
            description="Please try again in a moment."
            actionLabel="Retry"
            onPress={handleRetry}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: 28 + Math.max(insets.bottom, 20) },
        ]}
      >
        <View style={styles.topHeader}>
          <Pressable style={styles.backButton} onPress={() => router.replace("/(tabs)/orders")}>
            <Ionicons name="chevron-back" size={20} color={palette.foreground} />
          </Pressable>

          <View style={styles.headerCopy}>
            <Text style={styles.kicker}>Order details</Text>
            <Text style={styles.title}>{order.orderNumber}</Text>
            <Text style={styles.subtitle}>
              {order.customerSnapshot?.deliveryAddress?.label || "Your delivery order"}
            </Text>
          </View>
        </View>

        <View style={[styles.heroCard, styles.heroCardTint]}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroLogoWrap}>
              {restaurantLogoUrl ? (
                <Image
                  source={restaurantLogoUrl}
                  style={styles.heroLogo}
                  contentFit="cover"
                  transition={120}
                  cachePolicy="memory-disk"
                />
              ) : (
                <View style={styles.heroLogoFallback}>
                  <Ionicons name="storefront-outline" size={20} color={palette.primary} />
                </View>
              )}
            </View>
            <View style={styles.heroCopy}>
              <View style={[styles.statusPill, { backgroundColor: statusMeta.background }]}>
                <Ionicons name={statusMeta.icon} size={14} color={statusMeta.color} />
                <Text style={[styles.statusPillText, { color: statusMeta.color }]}>
                  {statusMeta.label}
                </Text>
              </View>
              <Text style={styles.heroMeta}>Placed {formatDateTimeAmPm(order.createdAt)}</Text>
            </View>
          </View>

          <View style={styles.heroSummaryRow}>
            <MetricCard label="Total paid" value={formatCurrency(order.pricing?.total ?? 0)} />
            <MetricCard label="Items" value={`${itemRows.length}`} />
            <MetricCard
              label="Payment"
              value={order.paymentMethod === "Bkash" ? "bKash" : order.paymentMethod}
            />
          </View>
        </View>

        {isJustPlaced ? (
          <View style={styles.successFlashCard}>
            <View style={styles.successFlashIconWrap}>
              <Ionicons name="checkmark-circle" size={20} color={palette.successText} />
            </View>
            <View style={styles.successFlashCopy}>
              <Text style={styles.successFlashTitle}>Order placed successfully</Text>
              <Text style={styles.successFlashSubtitle}>
                We have saved your order and started the restaurant handoff.
              </Text>
            </View>
          </View>
        ) : null}

        <View style={styles.liveCard}>
          {order.status === "Delivered" ? (
            <Pressable
              style={[
                styles.reorderActionButton,
                reorderMutation.isPending ? styles.reorderActionButtonDisabled : null,
              ]}
              onPress={() => {
                void handleReorder();
              }}
              disabled={reorderMutation.isPending}
            >
              {reorderMutation.isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <View style={styles.reorderActionIconWrap}>
                    <Ionicons name="refresh-outline" size={18} color="#fff" />
                  </View>
                  <View style={styles.reorderActionCopy}>
                    <Text style={styles.reorderActionTitle}>Reorder these items</Text>
                    <Text style={styles.reorderActionSubtitle}>
                      Add this delivered order to your cart with the latest pricing and availability.
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#fff" />
                </>
              )}
            </Pressable>
          ) : null}

          {isCancelledStatus(order.status) && trackingBanner ? (
            <View style={[styles.cancelledStateCard, { backgroundColor: trackingBanner.tint }]}>
              <View style={[styles.cancelledStateIconWrap, { backgroundColor: "#FFFFFFB8" }]}>
                <Ionicons name={trackingBanner.icon} size={20} color={trackingBanner.accent} />
              </View>
              <View style={styles.cancelledStateCopy}>
                <Text style={styles.cancelledStateTitle}>{trackingBanner.title}</Text>
                <Text style={styles.cancelledStateSubtitle}>{trackingBanner.subtitle}</Text>
              </View>
            </View>
          ) : null}

          {isActiveStatus(order.status) ? (
            <Pressable style={styles.trackLiveButton} onPress={handleTrackLive}>
              <View style={styles.trackLiveIconWrap}>
                <Ionicons name="map-outline" size={18} color="#fff" />
              </View>
              <View style={styles.trackLiveButtonCopy}>
                <Text style={styles.trackLiveButtonTitle}>Track live</Text>
                <Text style={styles.trackLiveButtonSubtitle}>
                  {order.status === "PickedUp"
                    ? "Open full map, rider movement, and arrival updates."
                    : trackingBanner?.subtitle || "See the latest tracking state for this order."}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#fff" />
            </Pressable>
          ) : null}

          <View style={styles.actionButtonColumn}>
            {canCancelOrder(order.status) ? (
              <Pressable
                style={[styles.secondaryActionButton, styles.secondaryActionButtonDanger]}
                onPress={() => {
                  void Haptics.selectionAsync();
                  setCancelModalOpen(true);
                }}
                disabled={cancelMutation.isPending}
              >
                {cancelMutation.isPending ? (
                  <ActivityIndicator size="small" color={palette.primary} />
                ) : (
                  <>
                    <Ionicons name="close-circle-outline" size={16} color={palette.primary} />
                    <Text
                      style={[
                        styles.secondaryActionButtonText,
                        styles.secondaryActionButtonTextDanger,
                      ]}
                    >
                      Cancel order
                    </Text>
                  </>
                )}
              </Pressable>
            ) : null}

            {canCallRider ? (
              <Pressable style={styles.secondaryActionButton} onPress={handleCallRider}>
                <Ionicons name="call-outline" size={16} color={palette.foreground} />
                <Text style={styles.secondaryActionButtonText}>Call rider</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        <View style={[styles.sectionCard, styles.sectionCardRose]}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Order journey</Text>
            <Text style={styles.sectionHint}>Latest updates</Text>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.miniTimelineScroll}
          >
            {orderStatusSteps.map((step, index) => {
              const isDone = !isCancelledStatus(order.status) && index <= activeStatusIndex;
              const isCurrent = !isCancelledStatus(order.status) && index === activeStatusIndex;

              return (
                <View key={step} style={styles.miniTimelineItem}>
                  <View style={[styles.miniTimelineDot, isDone ? styles.miniTimelineDotDone : null]}>
                    {isDone ? (
                      <Ionicons name="checkmark" size={12} color="#fff" />
                    ) : null}
                  </View>
                  <Text
                    style={[
                      styles.miniTimelineLabel,
                      isDone ? styles.miniTimelineLabelActive : null,
                      isCurrent ? styles.miniTimelineLabelCurrent : null,
                    ]}
                  >
                    {getStatusMeta(step).label}
                  </Text>
                  {index < orderStatusSteps.length - 1 ? (
                    <View
                      style={[
                        styles.miniTimelineConnector,
                        isDone && index < activeStatusIndex ? styles.miniTimelineConnectorDone : null,
                      ]}
                    />
                  ) : null}
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.timelineList}>
            {historyRows.map((entry, index) => {
              const isLast = index === historyRows.length - 1;
              const isLatest = index === 0;
              const meta = getStatusMeta(entry.status);

              return (
                <View key={`${entry.status}-${entry.createdAt}-${index}`} style={styles.timelineRow}>
                  <View style={styles.timelineRail}>
                    <View
                      style={[
                        styles.timelineDot,
                        { backgroundColor: isLatest ? meta.color : palette.surfaceMuted },
                      ]}
                    >
                      <Ionicons
                        name={isLatest ? meta.icon : "checkmark"}
                        size={12}
                        color={isLatest ? "#fff" : palette.foreground}
                      />
                    </View>
                    {!isLast ? <View style={styles.timelineLine} /> : null}
                  </View>
                  <View style={styles.timelineCopy}>
                    <View style={styles.timelineTitleRow}>
                      <Text style={styles.timelineTitle}>{getStatusMeta(entry.status).label}</Text>
                      {isLatest ? (
                        <View style={styles.currentBadge}>
                          <Text style={styles.currentBadgeText}>Current</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.timelineDescription}>
                      {entry.note || `${entry.actor} updated this order.`}
                    </Text>
                    <Text style={styles.timelineMeta}>{formatDateTimeAmPm(entry.createdAt)}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        <View style={[styles.sectionCard, styles.sectionCardSky]}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Delivery details</Text>
            <Text style={styles.sectionHint}>Where this order is going</Text>
          </View>

          <DetailLine
            icon="home-outline"
            label="Dropping to"
            value={order.customerSnapshot?.deliveryAddress?.label || "Selected location"}
            meta={order.customerSnapshot?.deliveryAddress?.addressLine || "Delivery address unavailable"}
          />

          <DetailLine
            icon="wallet-outline"
            label="Payment"
            value={order.paymentMethod === "Bkash" ? "bKash" : order.paymentMethod}
            meta={`Total ${formatCurrency(order.pricing?.total ?? 0)}`}
          />

          <View style={styles.riderRow}>
            <View style={styles.riderAvatar}>
              <Ionicons name="bicycle-outline" size={20} color={palette.foreground} />
            </View>
            <View style={styles.riderCopy}>
              <Text style={styles.riderName}>
                {order.riderSnapshot?.name || "Waiting for rider assignment"}
              </Text>
              <Text style={styles.riderMeta}>
                {order.riderSnapshot?.vehicleType || "Rider details will appear once assigned."}
              </Text>
              {canCallRider ? (
                <Text style={styles.riderHintText}>{order.riderSnapshot?.phone}</Text>
              ) : null}
            </View>
            {canCallRider ? (
              <Pressable style={styles.riderActionButton} onPress={handleCallRider}>
                <Ionicons name="call-outline" size={18} color={palette.foreground} />
              </Pressable>
            ) : null}
          </View>
        </View>

        <View style={[styles.sectionCard, styles.sectionCardSand]}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Items</Text>
            <Text style={styles.sectionHint}>{itemRows.length} in this order</Text>
          </View>

          <View style={styles.itemList}>
            {itemRows.map((item, index) => (
              <View key={`${item.itemId ?? item.name}-${index}`} style={styles.itemRow}>
                <View style={styles.itemImagePlaceholder}>
                  <Ionicons name="restaurant-outline" size={18} color={palette.primary} />
                </View>
                <View style={styles.itemCopy}>
                  <View style={styles.itemTopRow}>
                    <Text style={styles.itemTitle}>{item.name || "Menu item"}</Text>
                    <Text style={styles.itemPrice}>
                      {formatCurrency((item.unitPrice ?? 0) * (item.quantity ?? 0))}
                    </Text>
                  </View>
                  <Text style={styles.itemQuantity}>
                    {item.quantity ?? 0} x {formatCurrency(item.unitPrice ?? 0)}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        <View style={[styles.sectionCard, styles.sectionCardMint]}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Payment summary</Text>
            <Text style={styles.sectionHint}>Final charged amount</Text>
          </View>

          <View style={styles.summaryBlock}>
            <SummaryRow label="Items subtotal" value={formatCurrency(order.pricing?.subtotal ?? 0)} />
            <SummaryRow label="Delivery fee" value={formatCurrency(order.pricing?.deliveryFee ?? 0)} />
            {(order.pricing?.discountAmount ?? 0) > 0 ? (
              <SummaryRow
                label="Discount"
                value={`-${formatCurrency(order.pricing?.discountAmount ?? 0)}`}
                highlight
              />
            ) : null}
            <View style={styles.divider} />
            <SummaryRow
              label="Total"
              value={formatCurrency(order.pricing?.total ?? 0)}
              strong
            />
          </View>
        </View>

        {order.customerReview ? (
          <View style={[styles.sectionCard, styles.sectionCardLavender]}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Your review</Text>
              <Text style={styles.sectionHint}>Already shared</Text>
            </View>

            <View style={styles.reviewDoneCard}>
              <View style={styles.reviewDoneBadge}>
                <Ionicons name="star" size={14} color={palette.amber} />
                <Text style={styles.reviewDoneBadgeText}>
                  {order.customerReview.rating} / 5 rating
                </Text>
              </View>
              <Text style={styles.reviewDoneText}>
                {order.customerReview.comment || "You submitted a rating without a comment."}
              </Text>
              {order.customerReview.ownerReply?.message ? (
                <View style={styles.noteCard}>
                  <Text style={styles.noteLabel}>Restaurant reply</Text>
                  <Text style={styles.noteText}>{order.customerReview.ownerReply.message}</Text>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        {canReviewOrder ? (
          <View style={[styles.sectionCard, styles.sectionCardLavender]}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Share your experience</Text>
              <Text style={styles.sectionHint}>Help others decide</Text>
            </View>

            <View style={styles.reviewComposer}>
              <Text style={styles.reviewPrompt}>
                Your feedback helps the restaurant improve and helps other customers decide.
              </Text>
              <View style={styles.reviewStarsRow}>
                {Array.from({ length: 5 }).map((_, index) => {
                  const ratingValue = index + 1;
                  const isActive = ratingValue <= selectedRating;

                  return (
                    <Pressable
                      key={`star-${ratingValue}`}
                      style={styles.reviewStarButton}
                      onPress={() => {
                        void Haptics.selectionAsync();
                        setSelectedRating(ratingValue);
                      }}
                    >
                      <Ionicons
                        name={isActive ? "star" : "star-outline"}
                        size={24}
                        color={isActive ? "#F59E0B" : palette.mutedForeground}
                      />
                    </Pressable>
                  );
                })}
              </View>

              <TextInput
                value={reviewComment}
                onChangeText={setReviewComment}
                placeholder="Tell us what went well or what could be better"
                placeholderTextColor={palette.placeholder}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                style={styles.reviewInput}
              />

              <Pressable
                style={[
                  styles.submitReviewButton,
                  (selectedRating === 0 || reviewMutation.isPending) && styles.submitReviewButtonDisabled,
                ]}
                disabled={selectedRating === 0 || reviewMutation.isPending}
                onPress={() => {
                  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  handleSubmitReview();
                }}
              >
                {reviewMutation.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.submitReviewButtonText}>Submit review</Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : null}
      </ScrollView>

      <Modal
        visible={isCancelModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCancelModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalIconWrap}>
              <Ionicons name="close-circle-outline" size={22} color={palette.primary} />
            </View>
            <Text style={styles.modalTitle}>Cancel this order?</Text>
            <Text style={styles.modalSubtitle}>
              You can only cancel before the restaurant accepts it. This action will move the order to your history.
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalSecondaryButton}
                onPress={() => setCancelModalOpen(false)}
              >
                <Text style={styles.modalSecondaryButtonText}>Keep order</Text>
              </Pressable>
              <Pressable
                style={styles.modalPrimaryButton}
                onPress={() => {
                  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  setCancelModalOpen(false);
                  handleCancelOrder();
                }}
              >
                <Text style={styles.modalPrimaryButtonText}>Cancel order</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <ReorderCartSwitchModal
        visible={Boolean(reorderConflictMeta)}
        previewItemName={reorderConflictMeta?.previewItemName ?? "Delivered items"}
        currentRestaurantName={reorderConflictMeta?.currentRestaurantName ?? "your current cart"}
        incomingRestaurantName={reorderConflictMeta?.incomingRestaurantName ?? "this restaurant"}
        onClose={() => setReorderConflictMeta(null)}
        onConfirm={() => {
          setReorderConflictMeta(null);
          void handleReorder(true);
        }}
      />
    </SafeAreaView>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.heroMetric}>
      <Text style={styles.heroMetricValue}>{value}</Text>
      <Text style={styles.heroMetricLabel}>{label}</Text>
    </View>
  );
}

function DetailLine({
  icon,
  label,
  value,
  meta,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  meta?: string;
}) {
  return (
    <View style={styles.detailLine}>
      <Ionicons name={icon} size={16} color={palette.primary} />
      <View style={styles.detailCopy}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text style={styles.detailValue}>{value}</Text>
        {meta ? <Text style={styles.detailMeta}>{meta}</Text> : null}
      </View>
    </View>
  );
}

function SummaryRow({
  label,
  value,
  highlight,
  strong,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  strong?: boolean;
}) {
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryLabel, strong ? styles.summaryStrong : null]}>{label}</Text>
      <Text
        style={[
          styles.summaryValue,
          highlight ? styles.summaryHighlight : null,
          strong ? styles.summaryStrong : null,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: palette.background },
  content: { gap: 16, paddingBottom: 32 },
  topHeader: {
    paddingHorizontal: 18,
    paddingTop: 8,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surface,
    shadowColor: palette.shadow,
    shadowOpacity: 0.8,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  headerCopy: { flex: 1, gap: 2 },
  kicker: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: palette.primary,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "800",
    color: palette.foreground,
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 18,
    color: palette.mutedForeground,
  },
  heroCard: {
    marginHorizontal: 18,
    padding: 16,
    borderRadius: 28,
    backgroundColor: palette.surface,
    gap: 10,
    shadowColor: palette.shadow,
    shadowOpacity: 0.9,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },
  heroCardTint: {
    backgroundColor: "#FFF7FB",
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  heroLogoWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: palette.surfaceMuted,
  },
  heroLogo: {
    width: "100%",
    height: "100%",
  },
  heroLogoFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceMuted,
  },
  heroCopy: { flex: 1, gap: 6 },
  statusPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
  },
  statusPillText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
  },
  heroMeta: {
    fontSize: 13,
    lineHeight: 18,
    color: palette.mutedForeground,
  },
  heroSummaryRow: {
    flexDirection: "row",
    gap: 10,
  },
  heroMetric: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: palette.surfaceMuted,
    gap: 2,
  },
  heroMetricValue: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    color: palette.foreground,
  },
  heroMetricLabel: {
    fontSize: 12,
    lineHeight: 16,
    color: palette.mutedForeground,
    fontWeight: "600",
  },
  successFlashCard: {
    marginHorizontal: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 24,
    backgroundColor: palette.successSurface,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    shadowColor: palette.shadow,
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  successFlashIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFFCC",
  },
  successFlashCopy: {
    flex: 1,
    gap: 2,
  },
  successFlashTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    color: palette.foreground,
  },
  successFlashSubtitle: {
    fontSize: 12,
    lineHeight: 17,
    color: palette.mutedForeground,
  },
  liveCard: {
    marginHorizontal: 18,
    gap: 10,
  },
  reorderActionButton: {
    minHeight: 74,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: palette.secondary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    shadowColor: palette.shadow,
    shadowOpacity: 0.8,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  reorderActionButtonDisabled: {
    opacity: 0.8,
  },
  reorderActionIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  reorderActionCopy: {
    flex: 1,
    gap: 4,
  },
  reorderActionTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    color: "#fff",
  },
  reorderActionSubtitle: {
    fontSize: 12,
    lineHeight: 17,
    color: "rgba(255,255,255,0.82)",
  },
  cancelledStateCard: {
    minHeight: 110,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    shadowColor: palette.shadow,
    shadowOpacity: 0.7,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  cancelledStateIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelledStateCopy: { flex: 1, gap: 4 },
  cancelledStateTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    color: palette.foreground,
  },
  cancelledStateSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: palette.mutedForeground,
  },
  trackLiveButton: {
    minHeight: 66,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: palette.foreground,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    shadowColor: palette.shadow,
    shadowOpacity: 0.8,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  trackLiveIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  trackLiveButtonCopy: { flex: 1, gap: 4 },
  trackLiveButtonTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    color: "#fff",
  },
  trackLiveButtonSubtitle: {
    fontSize: 12,
    lineHeight: 17,
    color: "rgba(255,255,255,0.74)",
  },
  actionButtonColumn: { gap: 10 },
  secondaryActionButton: {
    minHeight: 46,
    borderRadius: 999,
    backgroundColor: palette.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    shadowColor: palette.shadow,
    shadowOpacity: 0.7,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  secondaryActionButtonDanger: {
    backgroundColor: "#FFF0F6",
    borderWidth: 1,
    borderColor: "#FFD6C9",
  },
  secondaryActionButtonText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.foreground,
  },
  secondaryActionButtonTextDanger: {
    color: palette.primary,
  },
  sectionCard: {
    marginHorizontal: 18,
    padding: 16,
    borderRadius: 28,
    backgroundColor: palette.surface,
    gap: 10,
    shadowColor: palette.shadow,
    shadowOpacity: 0.75,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  sectionCardRose: {
    backgroundColor: "#FFF8FB",
  },
  sectionCardSky: {
    backgroundColor: "#F7FAFF",
  },
  sectionCardSand: {
    backgroundColor: "#FFFBF6",
  },
  sectionCardMint: {
    backgroundColor: "#F7FFFB",
  },
  sectionCardLavender: {
    backgroundColor: "#FAF8FF",
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  sectionTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "800",
    color: palette.foreground,
  },
  sectionHint: {
    fontSize: 12,
    lineHeight: 16,
    color: palette.mutedForeground,
  },
  miniTimelineScroll: {
    paddingHorizontal: 4,
    paddingBottom: 12,
    gap: 8,
  },
  miniTimelineItem: {
    minWidth: 96,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  miniTimelineDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceMuted,
  },
  miniTimelineDotDone: {
    backgroundColor: palette.mint,
    borderColor: palette.mint,
  },
  miniTimelineLabel: {
    minWidth: 48,
    fontSize: 12,
    lineHeight: 16,
    color: palette.mutedForeground,
    fontWeight: "600",
  },
  miniTimelineLabelActive: {
    color: palette.foreground,
  },
  miniTimelineLabelCurrent: {
    color: palette.primary,
  },
  miniTimelineConnector: {
    width: 24,
    height: 2,
    borderRadius: 999,
    backgroundColor: palette.border,
  },
  miniTimelineConnectorDone: {
    backgroundColor: palette.mint,
  },
  timelineList: { gap: 10 },
  timelineRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  timelineRail: {
    width: 24,
    alignItems: "center",
  },
  timelineDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  timelineLine: {
    width: 2,
    minHeight: 30,
    marginTop: 4,
    backgroundColor: palette.border,
  },
  timelineCopy: {
    flex: 1,
    paddingBottom: 10,
    gap: 4,
  },
  timelineTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  timelineTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.foreground,
  },
  currentBadge: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "#FFE8F0",
  },
  currentBadgeText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
    color: palette.secondary,
  },
  timelineDescription: {
    fontSize: 13,
    lineHeight: 19,
    color: palette.mutedForeground,
  },
  timelineMeta: {
    fontSize: 12,
    lineHeight: 16,
    color: palette.mutedForeground,
  },
  detailLine: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  detailCopy: { flex: 1, gap: 2 },
  detailLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
    color: palette.primary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  detailValue: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.foreground,
  },
  detailMeta: {
    fontSize: 12,
    lineHeight: 18,
    color: palette.mutedForeground,
  },
  riderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  riderAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceMuted,
  },
  riderCopy: { flex: 1, gap: 2 },
  riderName: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.foreground,
  },
  riderMeta: {
    fontSize: 12,
    lineHeight: 16,
    color: palette.mutedForeground,
  },
  riderHintText: {
    fontSize: 11,
    lineHeight: 15,
    color: palette.primary,
    fontWeight: "700",
  },
  riderActionButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceMuted,
  },
  itemList: { gap: 12 },
  itemRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  itemImagePlaceholder: {
    width: 62,
    height: 62,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceMuted,
  },
  itemCopy: { flex: 1, gap: 4 },
  itemTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  itemTitle: {
    flex: 1,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.foreground,
  },
  itemPrice: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.foreground,
  },
  itemQuantity: {
    fontSize: 12,
    lineHeight: 16,
    color: palette.mutedForeground,
  },
  summaryBlock: {
    gap: 10,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  summaryLabel: {
    fontSize: 14,
    lineHeight: 18,
    color: palette.mutedForeground,
  },
  summaryValue: {
    fontSize: 14,
    lineHeight: 18,
    color: palette.foreground,
  },
  summaryHighlight: {
    color: palette.successText,
  },
  summaryStrong: {
    fontWeight: "800",
    color: palette.foreground,
  },
  divider: {
    height: 1,
    backgroundColor: palette.border,
  },
  reviewComposer: { gap: 12 },
  reviewPrompt: {
    fontSize: 13,
    lineHeight: 19,
    color: palette.mutedForeground,
  },
  reviewStarsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  reviewStarButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceMuted,
  },
  reviewInput: {
    minHeight: 104,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 18,
    backgroundColor: palette.surfaceMuted,
    fontSize: 14,
    lineHeight: 21,
    color: palette.foreground,
  },
  submitReviewButton: {
    minHeight: 52,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.secondary,
  },
  submitReviewButtonDisabled: {
    opacity: 0.55,
  },
  submitReviewButtonText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
    color: "#fff",
  },
  reviewDoneCard: {
    padding: 14,
    borderRadius: 18,
    backgroundColor: palette.successSurface,
    gap: 10,
  },
  reviewDoneBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: palette.surface,
  },
  reviewDoneBadgeText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
    color: palette.successText,
  },
  reviewDoneText: {
    fontSize: 13,
    lineHeight: 19,
    color: palette.foreground,
  },
  noteCard: {
    padding: 12,
    borderRadius: 16,
    backgroundColor: palette.surface,
    gap: 4,
  },
  noteLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
    color: palette.primary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  noteText: {
    fontSize: 13,
    lineHeight: 19,
    color: palette.foreground,
  },
  loadingWrap: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  loadingCard: {
    borderRadius: 24,
    backgroundColor: palette.surface,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  loadingText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "600",
    color: palette.foreground,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(20,18,24,0.38)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    paddingHorizontal: 20,
    paddingVertical: 24,
    borderRadius: 28,
    backgroundColor: palette.surface,
    alignItems: "center",
    gap: 10,
    shadowColor: palette.shadow,
    shadowOpacity: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  modalIconWrap: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.primarySoft,
  },
  modalTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "800",
    color: palette.foreground,
    textAlign: "center",
  },
  modalSubtitle: {
    fontSize: 14,
    lineHeight: 22,
    color: palette.mutedForeground,
    textAlign: "center",
  },
  modalActions: {
    width: "100%",
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  modalSecondaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceMuted,
  },
  modalSecondaryButtonText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    color: palette.foreground,
  },
  modalPrimaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.foreground,
  },
  modalPrimaryButtonText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    color: "#fff",
  },
});
