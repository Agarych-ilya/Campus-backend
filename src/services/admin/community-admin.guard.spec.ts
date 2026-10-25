import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import {
  allowedCommunityAdminIds,
  CommunityAdminGuard,
} from './community-admin.guard';
import { allowedCommunityAdminUsernames } from '../../auth/admin_identity';

describe('CommunityAdminGuard', () => {
  const oldIds = process.env.COMMUNITY_ADMIN_USER_IDS;
  const oldUsernames = process.env.COMMUNITY_ADMIN_USERNAMES;
  const guard = new CommunityAdminGuard();

  afterEach(() => {
    if (oldIds === undefined) delete process.env.COMMUNITY_ADMIN_USER_IDS;
    else process.env.COMMUNITY_ADMIN_USER_IDS = oldIds;
    if (oldUsernames === undefined) delete process.env.COMMUNITY_ADMIN_USERNAMES;
    else process.env.COMMUNITY_ADMIN_USERNAMES = oldUsernames;
  });

  function context(
    userId: number | null,
    method = 'GET',
    csrf?: string,
    savedCsrf = 'a'.repeat(64),
    username = 'OgarkovIA',
  ): ExecutionContext {
    const request = {
      method,
      session: {
        communityAdminUserId: userId,
        communityAdminUsername: username,
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
    expect(allowedCommunityAdminIds().size).toBe(0);
    expect(allowedCommunityAdminUsernames().size).toBe(0);
    expect(() => guard.canActivate(context(7)))
      .toThrow(ForbiddenException);
  });

  it('allows the configured username only with a verified server session', () => {
    delete process.env.COMMUNITY_ADMIN_USER_IDS;
    process.env.COMMUNITY_ADMIN_USERNAMES = 'OgarkovIA';

    expect(allowedCommunityAdminUsernames().has('ogarkovia')).toBe(true);
    expect(guard.canActivate(context(7))).toBe(true);
    expect(() => guard.canActivate(context(7, 'GET', undefined, 'a'.repeat(64), 'hacker')))
      .toThrow(ForbiddenException);
    expect(() => guard.canActivate(context(null)))
      .toThrow(ForbiddenException);
  });

  it('keeps the previous numeric-ID allowlist working', () => {
    delete process.env.COMMUNITY_ADMIN_USERNAMES;
    process.env.COMMUNITY_ADMIN_USER_IDS = '7,15';
    expect(guard.canActivate(context(7))).toBe(true);
    expect(guard.canActivate(context(15))).toBe(true);
    expect(() => guard.canActivate(context(8)))
      .toThrow(ForbiddenException);
  });

  it('requires matching CSRF token before admin edits or deletions', () => {
    delete process.env.COMMUNITY_ADMIN_USER_IDS;
    process.env.COMMUNITY_ADMIN_USERNAMES = 'OgarkovIA';
    expect(() => guard.canActivate(context(7, 'DELETE')))
      .toThrow(ForbiddenException);
    expect(() => guard.canActivate(context(7, 'PATCH', 'wrong')))
      .toThrow(ForbiddenException);
    expect(guard.canActivate(context(7, 'PATCH', 'a'.repeat(64))))
      .toBe(true);
  });
});
