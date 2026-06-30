import { ConflictException, Injectable, UnauthorizedException, NotFoundException, } from '@nestjs/common';
import { RegisterDto, LoginDto } from './dto/create-auth.dto';
import * as bcrypt from 'bcrypt';
import { DbService } from '../db.service';

@Injectable()
export class AuthService {
  constructor(private db: DbService) {}

  async register(request: RegisterDto) {
    const { username, email, password } = request;

    const cleanEmail = email.trim().toLowerCase();

    const existingUsers = await this.db.query(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      [cleanEmail]
    ) as any[];

    if (existingUsers.length > 0) {
      throw new ConflictException('Этот email уже используется');
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    await this.db.query(
      'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
      [username, cleanEmail, hashedPassword]
    );

    return {
      message: 'Success!',
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

    return {
      message: 'Success!',
    };
  }
}
