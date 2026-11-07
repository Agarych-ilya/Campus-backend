import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../../auth/auth.service';
import { CommunityAdminController } from './community-admin.controller';
import { CommunityAdminService } from './community-admin.service';
import { BarsSessionVerifier } from './bars-session-verifier.service';

describe('CommunityAdminController login by username', () => {
  const savedIds = process.env.COMMUNITY_ADMIN_USER_IDS;
  const savedNames = process.env.COMMUNITY_ADMIN_USERNAMES;
  const loginByUsername = jest.fn();
  const controller = new CommunityAdminController(
    {} as CommunityAdminService,
    { loginByUsername } as unknown as AuthService,
    { verify: jest.fn() } as unknown as BarsSessionVerifier,
  );

  function mockRequest() {
    const session: any = {
      regenerate: (callback: (error?: Error) => void) => callback(),
      save: (callback: (error?: Error) => void) => callback(),
    };
    return { session };
  }

  beforeEach(() => {
    delete process.env.COMMUNITY_ADMIN_USER_IDS;
    process.env.COMMUNITY_ADMIN_USERNAMES = 'OgarkovIA';
    loginByUsername.mockReset();
  });

  afterAll(() => {
    if (savedIds === undefined) delete process.env.COMMUNITY_ADMIN_USER_IDS;
    else process.env.COMMUNITY_ADMIN_USER_IDS = savedIds;
    if (savedNames === undefined) {
      delete process.env.COMMUNITY_ADMIN_USERNAMES;
    } else {
      process.env.COMMUNITY_ADMIN_USERNAMES = savedNames;
    }
  });

  it('checks password before issuing administrator session', async () => {
    loginByUsername.mockResolvedValue({
      id: 11,
      username: 'OgarkovIA',
      email: 'owner@example.com',
    });
    const request = mockRequest();

    const result = await controller.login({
      username: 'OgarkovIA',
      password: 'StrongPassword123',
    }, request);

    expect(loginByUsername).toHaveBeenCalledWith(
      'OgarkovIA', 'StrongPassword123',
    );
    expect(result.isAdmin).toBe(true);
    expect(result.csrfToken).toHaveLength(64);
    expect(request.session.communityAdminUserId).toBe(11);
    expect(request.session.communityAdminUsername).toBe('ogarkovia');
  });

  it('refuses an account with an unallowlisted username', async () => {
    loginByUsername.mockResolvedValue({
      id: 15,
      username: 'AnotherStudent',
      email: 'student@example.com',
    });

    await expect(controller.login({
      username: 'AnotherStudent',
      password: 'StrongPassword123',
    }, mockRequest())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses an incorrect password or nonexistent account', async () => {
    loginByUsername.mockRejectedValue(new UnauthorizedException());
    await expect(controller.login({
      username: 'OgarkovIA',
      password: 'IncorrectPass123',
    }, mockRequest())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses all admin logins if the server allowlist is not configured', async () => {
    delete process.env.COMMUNITY_ADMIN_USERNAMES;
    await expect(controller.login({
      username: 'OgarkovIA',
      password: 'StrongPassword123',
    }, mockRequest())).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(loginByUsername).not.toHaveBeenCalled();
  });
});
