import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { DbService } from '../db.service';
import { AuthService } from './auth.service';

describe('AuthService administrator usernames', () => {
  let service: AuthService;
  let query: jest.Mock;
  const formerAdminNames = process.env.COMMUNITY_ADMIN_USERNAMES;

  beforeEach(() => {
    query = jest.fn();
    service = new AuthService({ query } as unknown as DbService);
    delete process.env.COMMUNITY_ADMIN_USERNAMES;
  });

  afterAll(() => {
    if (formerAdminNames === undefined) {
      delete process.env.COMMUNITY_ADMIN_USERNAMES;
    } else {
      process.env.COMMUNITY_ADMIN_USERNAMES = formerAdminNames;
    }
  });

  it('authenticates a unique OgarkovIA account using its password', async () => {
    const hash = await bcrypt.hash('StrongPassword123', 4);
    query.mockResolvedValue([{
      id: 11,
      username: 'OgarkovIA',
      email: 'owner@example.com',
      password_hash: hash,
    }]);

    const account = await service.loginByUsername(
      'ogarkovia', 'StrongPassword123',
    );

    expect(account.id).toBe(11);
    expect(account.username).toBe('OgarkovIA');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE LOWER(username) = ? LIMIT 2'),
      ['ogarkovia'],
    );
  });

  it('rejects an incorrect password', async () => {
    const hash = await bcrypt.hash('StrongPassword123', 4);
    query.mockResolvedValue([{
      id: 11,
      username: 'OgarkovIA',
      email: 'owner@example.com',
      password_hash: hash,
    }]);

    await expect(
      service.loginByUsername('OgarkovIA', 'WrongPassword123'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses usernames shared by two backend accounts', async () => {
    query.mockResolvedValue([
      { id: 11, username: 'OgarkovIA', password_hash: 'irrelevant' },
      { id: 25, username: 'ogarkovia', password_hash: 'irrelevant' },
    ]);

    await expect(
      service.loginByUsername('OgarkovIA', 'StrongPassword123'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('blocks public registration of an already allowlisted admin name', async () => {
    process.env.COMMUNITY_ADMIN_USERNAMES = 'OgarkovIA';

    await expect(service.register({
      username: 'OgarkovIA',
      email: 'owner@example.com',
      password: 'StrongPassword123',
    })).rejects.toBeInstanceOf(ConflictException);

    expect(query).not.toHaveBeenCalled();
  });

  it('prevents registering duplicate usernames before admin setup', async () => {
    query.mockResolvedValue([{ id: 11 }]);

    await expect(service.register({
      username: 'ogarkovia',
      email: 'new@example.com',
      password: 'StrongPassword123',
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('can provision a unique account before configuring the admin name', async () => {
    query.mockResolvedValueOnce([])
      .mockResolvedValueOnce({ insertId: 11 });

    const account = await service.register({
      username: 'OgarkovIA',
      email: 'owner@example.com',
      password: 'StrongPassword123',
    });

    expect(account).toEqual({
      id: 11,
      username: 'OgarkovIA',
      email: 'owner@example.com',
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO users'),
      expect.arrayContaining(['OgarkovIA', 'owner@example.com']),
    );
  });
});
