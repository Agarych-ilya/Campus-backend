import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * The Flutter UI is never trusted to decide administrator permissions.
 * Only a valid server-side session established by the admin login may mutate.
 */
@Injectable()
export class CommunityAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const userId = (request.session as any)?.communityAdminUserId;

    if (!Number.isSafeInteger(userId) || userId < 1) {
      throw new ForbiddenException('Требуется вход администратора');
    }
    return true;
  }
}
