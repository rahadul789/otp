export function resolvePostAuthRedirect(redirectTo?: string | null) {
  if (typeof redirectTo === "string" && redirectTo.trim()) {
    return redirectTo;
  }

  return "/(tabs)";
}

