import { ListingsController } from './listings.controller';
import { BarsSessionVerifier } from '../admin/bars-session-verifier.service';
import { ListingsService } from './listings.service';

describe('ListingsController fast BARS login', () => {
  const oldSecret = process.env.SESSION_SECRET;
  beforeAll(() => {
    process.env.SESSION_SECRET = 'campus-test-secret-32-characters-012345';
  });
  afterAll(() => {
    if (oldSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = oldSecret;
  });

  test('does not wait for roster Chromium work during successful starosta login',
    async () => {
      const verifier = {
        verify: jest.fn().mockResolvedValue({
          recordBook: '123456', group: 'А-03-23', studentId: '123',
        }),
        verifyStarosta: jest.fn().mockResolvedValue(true),
        verifyAccountLogin: jest.fn().mockResolvedValue('examplelogin'),
      } as unknown as BarsSessionVerifier;
      const controller = new ListingsController(
        {} as ListingsService, verifier,
      );
      const session: Record<string, any> = {
        regenerate: (callback: (error: null) => void) => callback(null),
        save: (callback: (error: null) => void) => callback(null),
      };
      const req = {
        secure: true,
        socket: {remoteAddress: '127.0.0.1'},
        session,
      };
      const result = await controller.barsLogin(
        req, { cookieHeader: 'ASP.NET_SessionId=example' },
      );
      expect(result).toMatchObject({
        authenticated: true,
        rosterSync: 'deferred',
        group: 'А-03-23',
      });
      expect(session.listingStarostaGroup).toBe('А-03-23');
      expect(verifier.verify).toHaveBeenCalledTimes(1);
      expect(verifier.verifyStarosta).toHaveBeenCalledTimes(1);
      expect(verifier.verifyAccountLogin).toHaveBeenCalledTimes(1);
    });
});
