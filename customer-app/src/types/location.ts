export type StartupStatus =
  | "loading_location"
  | "ready"
  | "permission_denied"
  | "location_unavailable";

export type SavedLocation = {
  id: string;
  label: string;
  address: string;
  latitude: number;
  longitude: number;
  source: "gps" | "manual" | "saved";
  isDefault?: boolean;
  lastUsedAt?: string | null;
};
