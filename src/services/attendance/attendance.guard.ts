import { timingSafeEqual } from 'node:crypto';
import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable,
} from '@nestjs/common';
import { normalizeBarsRecordBook } from '../../auth/admin_identity';
import { ListingsService } from '../listings/listings.service';
import { normalizedStudyGroup } from '../lesson-notes/lesson-group-normalizer';

export interface AttendanceIdentity {
  ownerKey: string;
  group: string;
  isStarosta: boolean;
  rosterStudentHash?: string;
  rosterLoginHash?: string;
}

const maxSessionAge = 24 * 60 * 60 * 1000;

/** Never trust a group, student ID or "isStarosta" value sent by Flutter. */
export function attendanceIdentity(session: any): AttendanceIdentity | null {
  const verifiedAt = session?.listingVerifiedAt;
  if (!Number.isFinite(verifiedAt) || verifiedAt > Date.now() ||
      Date.now() - verifiedAt > maxSessionAge ||
      !/^[a-f0-9]{64}$/.test(session?.listingOwnerKey ?? '') ||
      typeof session?.listingGroup !== 'string') {
    return null;
  }
  const group = normalizedStudyGroup(session.listingGroup);
  if (!/^[А-ЯЁA-Z0-9]+(?:-[А-ЯЁA-Z0-9]+){1,3}$/.test(group)) return null;
  const ownerKey: string = session.listingOwnerKey;
  const allowlist = (process.env.CAMPUS_STAROSTA_GROUP_BOOKS ?? '')
    .split(';').map(x => x.trim()).filter(Boolean);
  const checkedByBars =
    typeof session.listingStarostaGroup === 'string' &&
    normalizedStudyGroup(session.listingStarostaGroup) === group &&
    Number.isFinite(session.listingStarostaVerifiedAt) &&
    session.listingStarostaVerifiedAt === session.listingVerifiedAt;
  const manuallyConfigured = allowlist.some(item => {
    const separator = item.indexOf('=');
    if (separator < 1) return false;
    const configuredGroup = normalizedStudyGroup(item.slice(0, separator));
    const book = normalizeBarsRecordBook(item.slice(separator + 1));
    if (!book || configuredGroup !== group) return false;
    const key = ListingsService.ownerKey(book);
    return timingSafeEqual(Buffer.from(key, 'hex'),
      Buffer.from(ownerKey, 'hex'));
  });
  const safeHash = (value: unknown): string | undefined =>
    typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
      ? value : undefined;
  return {
    ownerKey, group,
    isStarosta: checkedByBars || manuallyConfigured,
    rosterStudentHash: safeHash(session.listingRosterStudentHash),
    rosterLoginHash: safeHash(session.listingRosterLoginHash),
  };
}

@Injectable()
export class AttendanceGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<any>();
    const identity = attendanceIdentity(req.session);
    if (!identity) {
      throw new ForbiddenException(
        'Для посещаемости требуется действующая подтверждённая сессия БАРС',
      );
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const expected = req.session.listingCsrf;
      const actual = req.headers['x-listing-csrf'];
      if (typeof expected !== 'string' ||
          typeof actual !== 'string' || expected.length !== 64 ||
          actual.length !== expected.length ||
          !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) {
        throw new ForbiddenException('Обнови подтверждение сессии БАРС');
      }
    }
    req.attendanceIdentity = identity;
    return true;
  }
}
