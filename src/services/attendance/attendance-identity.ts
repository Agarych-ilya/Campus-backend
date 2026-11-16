import { createHmac } from 'node:crypto';
import { normalizedStudyGroup } from '../lesson-notes/lesson-group-normalizer';

/**
 * Opaque, group-bound identifiers. Never persist or send raw BARS IDs,
 * usernames, emails or session cookies in the attendance lookup.
 */
export function rosterIdentityHash(
  group: string,
  kind: 'student' | 'login',
  raw: string | undefined | null,
): string | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32 || !raw) return null;
  const canonical = raw.normalize('NFC').trim().toLowerCase();
  if (!canonical || canonical.length > 150) return null;
  if (kind === 'student' && !/^(?:\d{1,16}|[a-f0-9-]{32,36})$/.test(canonical)) {
    return null;
  }
  if (kind === 'login' &&
      !/^[a-z][a-z0-9_.-]{2,63}$/.test(canonical)) {
    return null;
  }
  return createHmac('sha256', secret)
    .update(['campus-attendance-account-v1',
      normalizedStudyGroup(group), kind, canonical].join('|'))
    .digest('hex');
}
