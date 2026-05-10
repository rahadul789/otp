export function formatDateTime(value?: string | null) {
  if (!value) return "";

  return new Date(value).toLocaleString("en-BD", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
