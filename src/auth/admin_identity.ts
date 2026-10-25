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

/**
 * Only a record book read by our server from an authenticated BARS page
 * can be compared against this allowlist. Never accept a local profile's
 * claimed record book as proof of identity.
 */
export function normalizeBarsRecordBook(recordBook: string): string {
  return recordBook.normalize('NFKC').trim().replace(/\\s+/g, '').toUpperCase();
}

export function allowedCommunityAdminBarsRecordBooks(): Set<string> {
  return new Set(
    (process.env.COMMUNITY_ADMIN_BARS_RECORD_BOOKS ?? '')
      .split(',')
      .map(normalizeBarsRecordBook)
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
    allowedCommunityAdminIds().size > 0 ||
    allowedCommunityAdminBarsRecordBooks().size > 0;
}
