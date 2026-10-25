import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import {
  allowedCommunityAdminIds,
  CommunityAdminGuard,
} from './community-admin.guard';

describe('CommunityAdminGuard', () => {
  const old = process.env.COMMUNITY_ADMIN_USER_IDS;
  const guard = new CommunityAdminGuard();

  afterEach(() => {
    if (old === undefined) delete process.env.COMMUNITY_ADMIN_USER_IDS;
    else process.env.COMMUNITY_ADMIN_USER_IDS = old;
  });

  function context(
    userId: number | null,
    method = 'GET',
    csrf?: string,
    savedCsrf = 'a'.repeat(64),
  ): ExecutionContext {
    const request = {
      method,
      session: {
        communityAdminUserId: userId,
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

  it('never grants administrator access without server configuration', () => {
    delete process.env.COMMUNITY_ADMIN_USER_IDS;
    expect(allowedCommunityAdminIds().size).toBe(0);
    expect(() => guard.canActivate(context(7)))
      .toThrow(ForbiddenException);
  });

  it('allows only the configured and already logged-in account ID', () => {
    process.env.COMMUNITY_ADMIN_USER_IDS = '7,15';
    expect(guard.canActivate(context(7))).toBe(true);
    expect(guard.canActivate(context(15))).toBe(true);
    expect(() => guard.canActivate(context(8)))
      .toThrow(ForbiddenException);
    expect(() => guard.canActivate(context(null)))
      .toThrow(ForbiddenException);
  });

  it('requires a matching CSRF token to mutate data', () => {
    process.env.COMMUNITY_ADMIN_USER_IDS = '7';
    expect(() => guard.canActivate(context(7, 'DELETE')))
      .toThrow(ForbiddenException);
    expect(() => guard.canActivate(context(7, 'PATCH', 'wrong')))
      .toThrow(ForbiddenException);
    expect(
      guard.canActivate(context(7, 'PATCH', 'a'.repeat(64))),
    ).toBe(true);
  });
});
