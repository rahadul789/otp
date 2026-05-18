export function formatCurrency(value?: number | null) {
  const amount = Number.isFinite(value ?? NaN) ? Number(value) : 0;
  return `Tk ${Math.round(amount).toLocaleString("en-BD")}`;
}

export function formatTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export function getOrderPlacedAt(order: { timestamps?: Record<string, string | undefined> }) {
  return (
    order.timestamps?.createdAt ??
    order.timestamps?.placedAt ??
    order.timestamps?.New ??
    ""
  );
}
