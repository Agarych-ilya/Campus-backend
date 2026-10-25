import { randomBytes } from 'node:crypto';

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
  ServiceUnavailableException,
  ForbiddenException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthService } from '../../auth/auth.service';
import {
  communityAdminEnabled,
  allowedCommunityAdminIds,
  allowedCommunityAdminUsernames,
  normalizeAccountUsername,
  allowedCommunityAdminBarsRecordBooks,
  normalizeBarsRecordBook,
} from '../../auth/admin_identity';
import { CommunityAdminService } from './community-admin.service';
import type { CommunityAdminItem } from './community-admin.service';
import { CommunityAdminGuard } from './community-admin.guard';
import { BarsSessionVerifier } from './bars-session-verifier.service';
import {
  CommunityAdminLoginDto,
  BarsSessionLoginDto,
  ReviewCommunityDto,
  UpdateCommunityDto,
} from './community-admin.dto';

const validate = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

@Controller('services/admin')
export class CommunityAdminController {
  constructor(
    private readonly service: CommunityAdminService,
    private readonly auth: AuthService,
    private readonly barsVerifier: BarsSessionVerifier,
  ) {}

  /**
   * Admins use their existing backend username and password.
   * Allowed usernames or legacy IDs are configured only on the server.
   * The normal BARS webview is unrelated to server-side authentication.
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UsePipes(validate)
  async login(@Body() dto: CommunityAdminLoginDto, @Req() req: any) {
    if (!communityAdminEnabled()) {
      throw new ServiceUnavailableException(
        'Администратор не настроен на сервере',
      );
    }

    let user: { id: number; username: string; email: string };
    try {
      user = await this.auth.loginByUsername(dto.username, dto.password);
    } catch {
      // A bad password, nonexistent username and duplicate username
      // must all receive the same generic login error.
      throw new UnauthorizedException('Неверный логин или пароль');
    }

    const id = Number(user.id);
    const accountUsername = normalizeAccountUsername(user.username);
    const enabledForAccount = allowedCommunityAdminIds().has(id) ||
      allowedCommunityAdminUsernames().has(accountUsername);

    if (!Number.isSafeInteger(id) || id < 1 || !enabledForAccount) {
      throw new UnauthorizedException('Нет прав администратора');
    }

    // Regenerate session to avoid session fixation after authentication.
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((error) => error ? reject(error) : resolve()),
    );
    (req.session as any).communityAdminUserId = id;
    (req.session as any).communityAdminUsername = accountUsername;
    const csrfToken = randomBytes(32).toString('hex');
    (req.session as any).communityAdminCsrf = csrfToken;
    await new Promise<void>((resolve, reject) =>
      req.session.save((error) => error ? reject(error) : resolve()),
    );

    return { isAdmin: true, csrfToken };
  }

  /**
   * No second password: validate an existing BARS WebView session by fetching
   * the actual authenticated student pages on the server. The only admin
   * identifier is the verified record-book number from those pages.
   */
  @Post('bars-login')
  @HttpCode(HttpStatus.OK)
  @UsePipes(validate)
  async loginFromBars(
    @Body() dto: BarsSessionLoginDto,
    @Req() req: any,
  ) {
    const allowlisted = allowedCommunityAdminBarsRecordBooks();
    if (allowlisted.size === 0) {
      throw new ServiceUnavailableException(
        'Администраторы БАРС не настроены в COMMUNITY_ADMIN_BARS_RECORD_BOOKS',
      );
    }

    // BARS cookies are bearer credentials. Never receive them over remote
    // plain HTTP. USB adb reverse arrives at the backend via loopback.
    const peer = req.socket?.remoteAddress ?? '';
    const isLoopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer);
    if (!req.secure && !isLoopback) {
      throw new ForbiddenException(
        'Для входа через БАРС нужен HTTPS или локальный USB ADB Reverse',
      );
    }

    const verified = await this.barsVerifier.verify(dto.cookieHeader);
    const recordBook = normalizeBarsRecordBook(verified.recordBook);

    if (!allowlisted.has(recordBook)) {
      throw new UnauthorizedException('У этого аккаунта БАРС нет прав администратора');
    }

    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((error: Error | null) =>
        error ? reject(error) : resolve()),
    );
    (req.session as any).communityAdminBarsRecordBook = recordBook;
    (req.session as any).communityAdminBarsVerifiedAt = Date.now();
    const csrfToken = randomBytes(32).toString('hex');
    (req.session as any).communityAdminCsrf = csrfToken;
    await new Promise<void>((resolve, reject) =>
      req.session.save((error: Error | null) =>
        error ? reject(error) : resolve()),
    );

    // BARS cookies are discarded immediately; no BARS token is stored.
    return { isAdmin: true, csrfToken };
  }

  @Get('me')
  @UseGuards(CommunityAdminGuard)
  me() {
    return { isAdmin: true };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CommunityAdminGuard)
  async logout(@Req() req: any) {
    await new Promise<void>((resolve, reject) =>
      req.session.destroy((error) => error ? reject(error) : resolve()),
    );
    return { success: true };
  }

  @Get('groups')
  @UseGuards(CommunityAdminGuard)
  getAll(@Query('status') status = 'all'): Promise<CommunityAdminItem[]> {
    return this.service.list(status);
  }

  @Patch('submissions/:id')
  @UseGuards(CommunityAdminGuard)
  @UsePipes(validate)
  review(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReviewCommunityDto,
  ) {
    return this.service.review(id, dto.status);
  }

  @Patch('groups/:id')
  @UseGuards(CommunityAdminGuard)
  @UsePipes(validate)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCommunityDto,
  ) {
    return this.service.update(id, dto);
  }

  @Patch('groups/:id/icon')
  @UseGuards(CommunityAdminGuard)
  @UseInterceptors(
    FileInterceptor('icon', {
      limits: { fileSize: 700 * 1024, files: 1, fields: 0 },
    }),
  )
  updateIcon(
    @Param('id') id: string,
    @UploadedFile() icon: Express.Multer.File,
  ) {
    return this.service.updateIcon(id, icon);
  }

  @Delete('groups/:id')
  @UseGuards(CommunityAdminGuard)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Get('groups/icons/:id')
  @UseGuards(CommunityAdminGuard)
  async getIcon(
    @Param('id', ParseIntPipe) id: number,
    @Res() response: Response,
  ) {
    const icon = await this.service.getIcon(id);
    return response
      .status(200)
      .set({
        'Content-Type': icon.mime,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(icon.data);
  }
}
