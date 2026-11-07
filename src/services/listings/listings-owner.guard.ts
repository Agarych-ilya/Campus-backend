import { timingSafeEqual } from 'node:crypto';

import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable,
} from '@nestjs/common';

@Injectable()
export class ListingsOwnerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<any>();
    const session = req.session;
    const verifiedAt = session?.listingVerifiedAt;
    if (!session || typeof session.listingOwnerKey !== 'string' ||
        !/^[a-f0-9]{64}$/.test(session.listingOwnerKey) ||
        typeof verifiedAt !== 'number' || verifiedAt > Date.now() ||
        Date.now() - verifiedAt > 24 * 60 * 60 * 1000) {
      throw new ForbiddenException('Войди в БАРС, чтобы управлять объявлениями');
    }
    const expected = session.listingCsrf;
    const actual = req.headers['x-listing-csrf'];
    if (typeof expected !== 'string' ||
        typeof actual !== 'string' ||
        expected.length !== 64 ||
        actual.length !== expected.length ||
        !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) {
      throw new ForbiddenException('Необходимо обновить сессию объявлений');
    }
    return true;
  }
}
