import { timingSafeEqual } from 'node:crypto';

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

export function allowedCommunityAdminIds(): Set<number> {
  return new Set(
    (process.env.COMMUNITY_ADMIN_USER_IDS ?? '')
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isSafeInteger(value) && value > 0),
  );
}

/**
 * Never trust a client-side flag, email field or user-controlled ID.
 * The account must have passed backend password authentication and still
 * appear in the server administrator allowlist on every protected request.
 */
@Injectable()
export class CommunityAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const userId = ((request as any).session as any)?.communityAdminUserId;

    if (
      !Number.isSafeInteger(userId) ||
      !allowedCommunityAdminIds().has(userId)
    ) {
      throw new ForbiddenException('Требуется вход администратора');
    }

    // Double-submit and cross-site POST protection: the token is returned
    // only after password login and is never placed in a browser cookie.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const expected = ((request as any).session as any)?.communityAdminCsrf;
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
