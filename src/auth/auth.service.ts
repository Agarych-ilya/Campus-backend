import { ConflictException, Injectable, UnauthorizedException, NotFoundException, } from '@nestjs/common';
import { RegisterDto, LoginDto } from './dto/create-auth.dto';
import * as bcrypt from 'bcrypt';
import {
  allowedCommunityAdminUsernames,
  normalizeAccountUsername,
} from './admin_identity';
import { DbService } from '../db.service';

@Injectable()
export class AuthService {
  constructor(private db: DbService) {}

  async register(request: RegisterDto) {
    const username = request.username.trim();
    const cleanEmail = request.email.trim().toLowerCase();

    // An admin username must be provisioned before it is allowlisted in .env.
    // Otherwise anyone could self-register that name and claim the role.
    if (allowedCommunityAdminUsernames().has(
      normalizeAccountUsername(username),
    )) {
      throw new ConflictException(
        'Имя администратора зарезервировано. Войди в существующий аккаунт',
      );
    }

    const existingUsers = await this.db.query(
      'SELECT id FROM users WHERE email = ? OR LOWER(username) = ? LIMIT 2',
      [cleanEmail, normalizeAccountUsername(username)],
    ) as Array<{ id: number }>;
    if (existingUsers.length > 0) {
      throw new ConflictException(
        'Этот email или логин уже зарегистрирован',
      );
    }

    const hashedPassword = await bcrypt.hash(request.password, 12);
    const result = await this.db.query(
      'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
      [username, cleanEmail, hashedPassword],
    ) as { insertId: number };

    return {
      id: result.insertId,
      username,
      email: cleanEmail,
    };
  }

  async login(request: LoginDto) {
    const { email, password } = request;
    const cleanEmail = email.trim().toLowerCase();

    const users = await this.db.query(
      'SELECT * FROM users WHERE email = ? LIMIT 1',
      [cleanEmail]
    ) as any[];

    if (users.length === 0) {
      throw new NotFoundException(`Пользователь не найден (${cleanEmail})`);
    }

    const candidat = users[0];
    const isValid = await bcrypt.compare(password, candidat.password_hash);

    if (!isValid) {
      throw new NotFoundException(`Неверный пароль`);
    }

    const toSession = { id: candidat.id, username: candidat.username, email: candidat.email };
    return toSession;
  }
  /**
   * Administrator password verification by the Campus-backend username.
   * Duplicate usernames are rejected rather than arbitrarily choosing one.
   * A username by itself is never proof of identity.
   */
  async loginByUsername(
    username: string,
    password: string,
  ): Promise<{ id: number; username: string; email: string }> {
    const normalized = normalizeAccountUsername(username);
    if (!normalized || !password) {
      throw new UnauthorizedException('Неверный логин или пароль');
    }

    const users = await this.db.query(
      'SELECT id, username, email, password_hash FROM users ' +
        'WHERE LOWER(username) = ? LIMIT 2',
      [normalized],
    ) as Array<{
      id: number;
      username: string;
      email: string;
      password_hash: string;
    }>;

    // Prevent a duplicate username from inheriting another account's
    // administrator role, even in older databases without a UNIQUE index.
    if (users.length !== 1) {
      throw new UnauthorizedException('Неверный логин или пароль');
    }

    const user = users[0];
    if (!await bcrypt.compare(password, user.password_hash)) {
      throw new UnauthorizedException('Неверный логин или пароль');
    }

    return {
      id: Number(user.id),
      username: user.username,
      email: user.email,
    };
  }

}
