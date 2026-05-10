export function formatDateTimeAmPm(value?: string | Date | null) {
  if (!value) return "Not available yet";

  return new Intl.DateTimeFormat("en-BD", {
    dateStyle: "medium",
    timeStyle: "short",
    hour12: true,
  }).format(new Date(value));
}

export function formatTimeAmPm(value?: string | Date | null) {
  if (!value) return "Not available yet";

  return new Intl.DateTimeFormat("en-BD", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}
