import { DbService } from '../db.service';
import { AuthService } from './auth.service';

describe('AuthService user table bootstrap', () => {
  const oldNames = process.env.COMMUNITY_ADMIN_USERNAMES;
  let query: jest.Mock;
  let auth: AuthService;
  let exists: boolean;

  beforeEach(() => {
    delete process.env.COMMUNITY_ADMIN_USERNAMES;
    exists = false;
    query = jest.fn().mockImplementation((sql: string) => {
      if (sql.startsWith('CREATE TABLE IF NOT EXISTS users')) {
        exists = true;
        return Promise.resolve({ warningStatus: 0 });
      }
      if (!exists) {
        return Promise.reject(
          Object.assign(new Error("Table 'campus.users' doesn't exist"), {
            code: 'ER_NO_SUCH_TABLE',
            errno: 1146,
          }),
        );
      }
      if (sql.startsWith('SELECT')) return Promise.resolve([]);
      if (sql.startsWith('INSERT')) {
        return Promise.resolve({ insertId: 4 });
      }
      throw new Error('Unexpected SQL: ' + sql);
    });
    auth = new AuthService({ query } as unknown as DbService);
  });

  afterAll(() => {
    if (oldNames === undefined) delete process.env.COMMUNITY_ADMIN_USERNAMES;
    else process.env.COMMUNITY_ADMIN_USERNAMES = oldNames;
  });

  it('automatically creates the absent users table and retries registration', async () => {
    const user = await auth.register({
      username: 'OgarkovIA',
      email: 'owner@example.com',
      password: 'ExamplePassword123!',
    });

    expect(user).toEqual({
      id: 4,
      username: 'OgarkovIA',
      email: 'owner@example.com',
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS users'),
    );
    const createSql = query.mock.calls
      .map(([sql]) => sql as string)
      .find((sql) => sql.startsWith('CREATE TABLE IF NOT EXISTS users'))!;
    expect(createSql).toContain('UNIQUE KEY uq_users_username');
    expect(createSql).toContain('UNIQUE KEY uq_users_email');
    expect(createSql).toContain('password_hash VARCHAR(255) NOT NULL');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO users'),
      expect.arrayContaining(['OgarkovIA', 'owner@example.com']),
    );
  });

  it('does not execute CREATE TABLE if the table is already present', async () => {
    exists = true;

    await auth.register({
      username: 'OgarkovIA',
      email: 'owner@example.com',
      password: 'ExamplePassword123!',
    });

    expect(query.mock.calls.some(([sql]) =>
      String(sql).startsWith('CREATE TABLE'))).toBe(false);
  });

  it('does not silently swallow unrelated SQL errors', async () => {
    query.mockRejectedValueOnce(
      Object.assign(new Error('Access denied'), {
        code: 'ER_DBACCESS_DENIED_ERROR',
      }),
    );

    await expect(auth.register({
      username: 'OgarkovIA',
      email: 'owner@example.com',
      password: 'ExamplePassword123!',
    })).rejects.toThrow('Access denied');

    expect(query.mock.calls.some(([sql]) =>
      String(sql).startsWith('CREATE TABLE'))).toBe(false);
  });

  it('does not cache a failed table creation forever', async () => {
    const denied = Object.assign(new Error('CREATE TABLE denied'), {
      code: 'ER_TABLEACCESS_DENIED_ERROR',
    });
    query.mockImplementationOnce(() => Promise.reject(
      Object.assign(new Error('Missing'), { code: 'ER_NO_SUCH_TABLE' }),
    )).mockImplementationOnce(() => Promise.reject(denied));

    await expect(auth.register({
      username: 'OgarkovIA',
      email: 'owner@example.com',
      password: 'ExamplePassword123!',
    })).rejects.toThrow('CREATE TABLE denied');

    const created = await auth.register({
      username: 'OgarkovIA',
      email: 'owner@example.com',
      password: 'ExamplePassword123!',
    });
    expect(created.id).toBe(4);
  });
});
