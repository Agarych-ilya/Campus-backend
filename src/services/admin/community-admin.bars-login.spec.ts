import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../../auth/auth.service';
import { CommunityAdminService } from './community-admin.service';
import { CommunityAdminController } from './community-admin.controller';
import { BarsSessionVerifier } from './bars-session-verifier.service';

describe('CommunityAdminController BARS authentication', () => {
  const oldNames = process.env.COMMUNITY_ADMIN_BARS_RECORD_BOOKS;
  const verifier = { verify: jest.fn() };
  const controller = new CommunityAdminController(
    {} as CommunityAdminService,
    {} as AuthService,
    verifier as unknown as BarsSessionVerifier,
  );

  function request(remoteAddress = '127.0.0.1', secure = false) {
    const session: any = {
      regenerate: (callback: (error?: Error) => void) => callback(),
      save: (callback: (error?: Error) => void) => callback(),
    };
    return { secure, socket: { remoteAddress }, session };
  }

  beforeEach(() => {
    process.env.COMMUNITY_ADMIN_BARS_RECORD_BOOKS = '123456';
    verifier.verify.mockReset();
    verifier.verify.mockResolvedValue({ recordBook: '123456' });
  });

  afterAll(() => {
    if (oldNames === undefined) {
      delete process.env.COMMUNITY_ADMIN_BARS_RECORD_BOOKS;
    } else {
      process.env.COMMUNITY_ADMIN_BARS_RECORD_BOOKS = oldNames;
    }
  });

  it('grants admin status only after live BARS validation', async () => {
    const req = request();
    const result = await controller.loginFromBars({
      cookieHeader: 'ASP.NET_SessionId=abc123',
    }, req);

    expect(verifier.verify).toHaveBeenCalledWith('ASP.NET_SessionId=abc123');
    expect(result.csrfToken).toHaveLength(64);
    expect(req.session.communityAdminBarsRecordBook).toBe('123456');
    expect(req.session.communityAdminBarsVerifiedAt).toEqual(expect.any(Number));
    expect(req.session.communityAdminUserId).toBeUndefined();
  });

  it('denies valid BARS students not in the server allowlist', async () => {
    verifier.verify.mockResolvedValue({ recordBook: '222222' });

    await expect(controller.loginFromBars({
      cookieHeader: 'ASP.NET_SessionId=abc123',
    }, request())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('denies fake or expired BARS cookies', async () => {
    verifier.verify.mockRejectedValue(new UnauthorizedException());
    await expect(controller.loginFromBars({
      cookieHeader: 'ASP.NET_SessionId=fake',
    }, request())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('denies sessions with no server-side admin record book configured', async () => {
    delete process.env.COMMUNITY_ADMIN_BARS_RECORD_BOOKS;
    await expect(controller.loginFromBars({
      cookieHeader: 'ASP.NET_SessionId=abc123',
    }, request())).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('refuses BARS cookie transmission from remote plaintext HTTP', async () => {
    await expect(controller.loginFromBars({
      cookieHeader: 'ASP.NET_SessionId=abc123',
    }, request('192.168.1.19'))).rejects.toBeInstanceOf(ForbiddenException);
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('allows HTTPS when deployed behind a trusted TLS terminator', async () => {
    const req = request('192.168.1.19', true);
    await controller.loginFromBars({
      cookieHeader: 'ASP.NET_SessionId=abc123',
    }, req);
    expect(verifier.verify).toHaveBeenCalledTimes(1);
  });
});
