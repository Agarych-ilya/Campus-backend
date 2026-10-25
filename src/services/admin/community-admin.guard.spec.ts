import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import {
  allowedCommunityAdminIds,
  CommunityAdminGuard,
} from './community-admin.guard';
import {
  allowedCommunityAdminUsernames,
  allowedCommunityAdminBarsRecordBooks,
} from '../../auth/admin_identity';

describe('CommunityAdminGuard', () => {
  const oldIds = process.env.COMMUNITY_ADMIN_USER_IDS;
  const oldUsernames = process.env.COMMUNITY_ADMIN_USERNAMES;
  const oldBars = process.env.COMMUNITY_ADMIN_BARS_RECORD_BOOKS;
  const guard = new CommunityAdminGuard();

  afterEach(() => {
    if (oldIds === undefined) delete process.env.COMMUNITY_ADMIN_USER_IDS;
    else process.env.COMMUNITY_ADMIN_USER_IDS = oldIds;

    if (oldUsernames === undefined) delete process.env.COMMUNITY_ADMIN_USERNAMES;
    else process.env.COMMUNITY_ADMIN_USERNAMES = oldUsernames;

    if (oldBars === undefined) delete process.env.COMMUNITY_ADMIN_BARS_RECORD_BOOKS;
    else process.env.COMMUNITY_ADMIN_BARS_RECORD_BOOKS = oldBars;
  });

  function context(
    userId: number | null,
    method = 'GET',
    csrf?: string,
    savedCsrf = 'a'.repeat(64),
    username = 'OgarkovIA',
    barsBook?: string,
    barsVerifiedAt?: number,
  ): ExecutionContext {
    const request = {
      method,
      session: {
        communityAdminUserId: userId,
        communityAdminUsername: username,
        communityAdminBarsRecordBook: barsBook,
        communityAdminBarsVerifiedAt: barsVerifiedAt,
        communityAdminCsrf: savedCsrf,
      },
      headers: { 'x-community-csrf': csrf },
    };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  }

  it('never grants administrator access without server allowlist', () => {
    delete process.env.COMMUNITY_ADMIN_USER_IDS;
    delete process.env.COMMUNITY_ADMIN_USERNAMES;
    delete process.env.COMMUNITY_ADMIN_BARS_RECORD_BOOKS;
    expect(allowedCommunityAdminIds().size).toBe(0);
    expect(allowedCommunityAdminUsernames().size).toBe(0);
    expect(allowedCommunityAdminBarsRecordBooks().size).toBe(0);
    expect(() => guard.canActivate(context(7)))
      .toThrow(ForbiddenException);
  });

  it('keeps existing username+password sessions valid', () => {
    delete process.env.COMMUNITY_ADMIN_USER_IDS;
    delete process.env.COMMUNITY_ADMIN_BARS_RECORD_BOOKS;
    process.env.COMMUNITY_ADMIN_USERNAMES = 'OgarkovIA';
    expect(guard.canActivate(context(7))).toBe(true);
    expect(() => guard.canActivate(context(7, 'GET', undefined, 'a'.repeat(64), 'hacker')))
      .toThrow(ForbiddenException);
    expect(() => guard.canActivate(context(null)))
      .toThrow(ForbiddenException);
  });

  it('still accepts previous numeric-ID configurations', () => {
    delete process.env.COMMUNITY_ADMIN_USERNAMES;
    delete process.env.COMMUNITY_ADMIN_BARS_RECORD_BOOKS;
    process.env.COMMUNITY_ADMIN_USER_IDS = '7,15';
    expect(guard.canActivate(context(7))).toBe(true);
    expect(guard.canActivate(context(15))).toBe(true);
    expect(() => guard.canActivate(context(8)))
      .toThrow(ForbiddenException);
  });

  it('allows freshly verified BARS sessions with no backend account', () => {
    delete process.env.COMMUNITY_ADMIN_USER_IDS;
    delete process.env.COMMUNITY_ADMIN_USERNAMES;
    process.env.COMMUNITY_ADMIN_BARS_RECORD_BOOKS = '123 456';

    expect(guard.canActivate(
      context(null, 'GET', undefined, 'a'.repeat(64),
        '', '123456', Date.now()),
    )).toBe(true);

    expect(guard.canActivate(
      context(null, 'PATCH', 'a'.repeat(64), 'a'.repeat(64),
        '', '123456', Date.now()),
    )).toBe(true);
  });

  it('rejects BARS session with different book, missing proof, or age over 30 minutes', () => {
    delete process.env.COMMUNITY_ADMIN_USER_IDS;
    delete process.env.COMMUNITY_ADMIN_USERNAMES;
    process.env.COMMUNITY_ADMIN_BARS_RECORD_BOOKS = '123456';

    expect(() => guard.canActivate(
      context(null, 'GET', undefined, 'a'.repeat(64),
        '', '999999', Date.now()),
    )).toThrow(ForbiddenException);

    expect(() => guard.canActivate(
      context(null, 'GET', undefined, 'a'.repeat(64),
        '', '123456'),
    )).toThrow(ForbiddenException);

    expect(() => guard.canActivate(
      context(null, 'GET', undefined, 'a'.repeat(64),
        '', '123456', Date.now() - 31 * 60 * 1000),
    )).toThrow(ForbiddenException);
  });

  it('requires matching CSRF for both kinds of admin session', () => {
    delete process.env.COMMUNITY_ADMIN_USER_IDS;
    delete process.env.COMMUNITY_ADMIN_USERNAMES;
    process.env.COMMUNITY_ADMIN_BARS_RECORD_BOOKS = '123456';

    expect(() => guard.canActivate(
      context(null, 'DELETE', undefined, 'a'.repeat(64),
        '', '123456', Date.now()),
    )).toThrow(ForbiddenException);

    expect(() => guard.canActivate(
      context(null, 'DELETE', 'wrong', 'a'.repeat(64),
        '', '123456', Date.now()),
    )).toThrow(ForbiddenException);
  });
});
