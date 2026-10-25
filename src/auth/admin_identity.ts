/**
 * The administrator role is configured only on the backend.
 * Never infer it from a Flutter profile name, BARS nickname or request body.
 */
export function normalizeAccountUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function allowedCommunityAdminUsernames(): Set<string> {
  return new Set(
    (process.env.COMMUNITY_ADMIN_USERNAMES ?? '')
      .split(',')
      .map(normalizeAccountUsername)
      .filter((value) => value.length > 0),
  );
}

/** Legacy numeric-ID configuration remains supported. */
export function allowedCommunityAdminIds(): Set<number> {
  return new Set(
    (process.env.COMMUNITY_ADMIN_USER_IDS ?? '')
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isSafeInteger(value) && value > 0),
  );
}

export function communityAdminEnabled(): boolean {
  return allowedCommunityAdminUsernames().size > 0 ||
    allowedCommunityAdminIds().size > 0;
}
