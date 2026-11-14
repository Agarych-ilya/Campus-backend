import { randomBytes } from 'node:crypto';

import {
  Body, Controller, Delete, ForbiddenException, Get, HttpCode, HttpStatus,
  Ip, Param, ParseIntPipe, Patch, Post, Query, Req, Res, UploadedFiles,
  UseGuards, UseInterceptors, UsePipes, ValidationPipe,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import { normalizeBarsRecordBook } from '../../auth/admin_identity';
import { BarsSessionVerifier } from '../admin/bars-session-verifier.service';
import {
  BarsListingLoginDto, CreateListingDto, ListingReportDto, UpdateListingDto,
} from './listings.dto';
import { ListingsOwnerGuard } from './listings-owner.guard';
import { ListingsService } from './listings.service';

const validate = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

@Controller('services/listings')
export class ListingsController {
  constructor(
    private readonly listings: ListingsService,
    private readonly bars: BarsSessionVerifier,
  ) {}

  private sessionKey(req: any): string | undefined {
    const session = req.session;
    const ts = session?.listingVerifiedAt;
    return session && typeof session.listingOwnerKey === 'string' &&
        typeof ts === 'number' && ts <= Date.now() &&
        Date.now() - ts < 24 * 60 * 60 * 1000
      ? session.listingOwnerKey
      : undefined;
  }

  @Get()
  list(
    @Query() query: {
      kind?: string; category?: string; q?: string;
      sort?: string; mine?: string; free?: string;
    },
    @Req() req: any,
  ) {
    return this.listings.list(query, this.sessionKey(req));
  }

  @Get('session')
  session(@Req() req: any) {
    const authenticated = !!this.sessionKey(req);
    return {
      authenticated,
      group: authenticated ? (req.session?.listingGroup ?? null) : null,
    };
  }

  @Post('bars-login')
  @HttpCode(HttpStatus.OK)
  @UsePipes(validate)
  async barsLogin(@Req() req: any, @Body() dto: BarsListingLoginDto) {
    const peer = req.socket?.remoteAddress ?? '';
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1']
      .includes(peer);
    if (!req.secure && !local) {
      throw new ForbiddenException(
        'Для подтверждения через БАРС нужен HTTPS или USB ADB Reverse',
      );
    }
    const verified = await this.bars.verify(dto.cookieHeader);
    const key = ListingsService.ownerKey(
      normalizeBarsRecordBook(verified.recordBook),
    );

    // Rotate the session identifier against fixation, preserving only
    // previously authenticated CampusApp and moderator session fields.
    const previous: Record<string, unknown> = {};
    for (const field of [
      'user',
      'communityAdminUserId', 'communityAdminUsername',
      'communityAdminBarsRecordBook', 'communityAdminBarsVerifiedAt',
      'communityAdminCsrf',
    ]) {
      if (req.session[field] !== undefined) {
        previous[field] = req.session[field];
      }
    }
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((error: Error | null) =>
        error ? reject(error) : resolve()),
    );
    Object.assign(req.session, previous);
    req.session.listingOwnerKey = key;
    // Group comes only from the verified BARS student row.
    req.session.listingGroup = verified.group ?? null;
    req.session.listingVerifiedAt = Date.now();
    req.session.listingCsrf = randomBytes(32).toString('hex');
    await new Promise<void>((resolve, reject) =>
      req.session.save((error: Error | null) =>
        error ? reject(error) : resolve()),
    );
    return {
      authenticated: true,
      csrfToken: req.session.listingCsrf,
      group: req.session.listingGroup,
    };
  }

  @Get(':id')
  getOne(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
  ) {
    return this.listings.one(id, this.sessionKey(req));
  }

  @Get(':id/photos/:slot')
  async photo(
    @Param('id', ParseIntPipe) id: number,
    @Param('slot', ParseIntPipe) slot: number,
    @Res() res: Response,
  ) {
    const photo = await this.listings.photo(id, slot);
    res.status(200).set({
      'Content-Type': photo.mime,
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    }).send(photo.data);
  }

  @Post()
  @UseGuards(ListingsOwnerGuard)
  @UsePipes(validate)
  @UseInterceptors(FilesInterceptor('photos', 3, {
    limits: { fileSize: 5 * 1024 * 1024, files: 3, fields: 14 },
  }))
  create(
    @Body() dto: CreateListingDto,
    @UploadedFiles() photos: Express.Multer.File[] | undefined,
    @Req() req: any,
  ) {
    return this.listings.create(dto, req.session.listingOwnerKey, photos);
  }

  @Patch(':id')
  @UseGuards(ListingsOwnerGuard)
  @UsePipes(validate)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateListingDto,
    @Req() req: any,
  ) {
    return this.listings.update(id, dto, req.session.listingOwnerKey);
  }

  @Delete(':id')
  @UseGuards(ListingsOwnerGuard)
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
  ) {
    return this.listings.remove(id, req.session.listingOwnerKey);
  }

  @Post(':id/report')
  @UsePipes(validate)
  @HttpCode(HttpStatus.ACCEPTED)
  report(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ListingReportDto,
    @Ip() ip: string,
  ) {
    return this.listings.report(id, dto, ip);
  }
}
