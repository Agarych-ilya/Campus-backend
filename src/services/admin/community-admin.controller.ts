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
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthService } from '../../auth/auth.service';
import { LoginDto } from '../../auth/dto/create-auth.dto';
import { CommunityAdminService } from './community-admin.service';
import type { CommunityAdminItem } from './community-admin.service';
import {
  allowedCommunityAdminIds,
  CommunityAdminGuard,
} from './community-admin.guard';
import { ReviewCommunityDto, UpdateCommunityDto } from './community-admin.dto';

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
  ) {}

  /**
   * Admins use an existing backend account and server-side allowlisted ID.
   * The normal BARS webview is unrelated to server-side authentication.
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UsePipes(validate)
  async login(@Body() dto: LoginDto, @Req() req: any) {
    const allowed = allowedCommunityAdminIds();
    if (allowed.size === 0) {
      throw new ServiceUnavailableException(
        'Список администраторов не настроен на сервере',
      );
    }

    let id: number;
    try {
      const user = await this.auth.login(dto);
      id = Number(user.id);
    } catch {
      // No account enumeration, even for the admin-only endpoint.
      throw new UnauthorizedException('Неверные данные для входа');
    }

    if (!Number.isSafeInteger(id) || !allowed.has(id)) {
      throw new UnauthorizedException('Нет прав администратора');
    }

    // Regenerate session to avoid session fixation after authentication.
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((error) => error ? reject(error) : resolve()),
    );
    (req.session as any).communityAdminUserId = id;
    const csrfToken = randomBytes(32).toString('hex');
    (req.session as any).communityAdminCsrf = csrfToken;
    await new Promise<void>((resolve, reject) =>
      req.session.save((error) => error ? reject(error) : resolve()),
    );

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
