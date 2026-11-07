import { timingSafeEqual } from 'node:crypto';

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  allowedCommunityAdminIds,
  allowedCommunityAdminUsernames,
  normalizeAccountUsername,
  allowedCommunityAdminBarsRecordBooks,
  normalizeBarsRecordBook,
} from '../../auth/admin_identity';

// Backward-compatible export for existing guard tests.
export { allowedCommunityAdminIds } from '../../auth/admin_identity';

/**
 * Only a backend-authenticated username + session can grant admin rights.
 * BARS display names, client flags and unverified email fields are ignored.
 */
@Injectable()
export class CommunityAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const session = (request as any).session as any | undefined;
    const userId = session?.communityAdminUserId;
    const username = session?.communityAdminUsername;

    const hasBackendLogin =
      Number.isSafeInteger(userId) &&
      userId > 0 &&
      typeof username === 'string' &&
      (
        allowedCommunityAdminIds().has(userId) ||
        allowedCommunityAdminUsernames().has(
          normalizeAccountUsername(username),
        )
      );

    const barsRecordBook = session?.communityAdminBarsRecordBook;
    const verifiedAt = session?.communityAdminBarsVerifiedAt;
    const hasVerifiedBarsLogin =
      typeof barsRecordBook === 'string' &&
      typeof verifiedAt === 'number' &&
      Number.isFinite(verifiedAt) &&
      verifiedAt <= Date.now() &&
      Date.now() - verifiedAt < 30 * 60 * 1000 &&
      allowedCommunityAdminBarsRecordBooks().has(
        normalizeBarsRecordBook(barsRecordBook),
      );

    const permitted = hasBackendLogin || hasVerifiedBarsLogin;

    if (!permitted) {
      throw new ForbiddenException('Требуется вход администратора');
    }

    // Only password login issues the CSRF token. Never accept a username
    // directly from headers to authorize an update or deletion.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const expected = session?.communityAdminCsrf;
      const actual = request.headers['x-community-csrf'];
      if (
        typeof expected !== 'string' ||
        typeof actual !== 'string' ||
        expected.length !== actual.length ||
        !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))
      ) {
        throw new ForbiddenException('Необходимо обновить сессию администратора');
      }
    }

    return true;
  }
}
