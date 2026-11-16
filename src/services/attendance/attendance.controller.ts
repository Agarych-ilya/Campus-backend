import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post,
  Query, Req, Res, UploadedFile, UseGuards, UsePipes, UseInterceptors, ValidationPipe,
  ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { attendanceIdentity, AttendanceGuard } from './attendance.guard';
import { AttendanceService } from './attendance.service';
import { BarsSessionVerifier } from '../admin/bars-session-verifier.service';
import { ListingsService } from '../listings/listings.service';
import { normalizeBarsRecordBook } from '../../auth/admin_identity';
import { normalizedStudyGroup } from '../lesson-notes/lesson-group-normalizer';
import { BarsListingLoginDto } from '../listings/listings.dto';
import {
  AttendanceCloseDto, AttendanceDateDto, AttendanceDecisionDto,
  AttendanceMemberDto, AttendanceOpenLessonDto,
  AttendanceRosterImportDto, AttendanceAbsencesDto,
  AttendanceCorrectionDto, PublishBarsRankingDto,
} from './attendance.dto';

const validate = new ValidationPipe({
  whitelist: true, forbidNonWhitelisted: true, transform: true,
});

/** CampusApp attendance journal; no credentials or arbitrary URLs from phones. */
@Controller('services/attendance')
export class AttendanceController {
  constructor(
    private readonly service: AttendanceService,
    private readonly barsVerifier: BarsSessionVerifier,
  ) {}

  @Get('session')
  async session(@Req() req: any) {
    const actor = attendanceIdentity(req.session);
    if (!actor) return { authenticated: false, isStarosta: false };
    return { authenticated: true, ...await this.service.me(actor) };
  }

  @Get('my-absences')
  @UseGuards(AttendanceGuard)
  myAbsences(
    @Req() req: any,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.service.myAbsences(req.attendanceIdentity, from, to);
  }

  /** Own place by confirmed CampusApp attendance; no classmate records. */

  /** The student explicitly submits their own cached BARS current points.
   * Not an official university-grade feed. Withdrawal is always available.
   */
  @Get('score-ranking')
  @UseGuards(AttendanceGuard)
  scoreRanking(@Req() req: any, @Query('scope') scope = 'group') {
    return this.service.barsScoresRanking(req.attendanceIdentity, scope);
  }

  @Post('score-ranking')
  @UseGuards(AttendanceGuard) @UsePipes(validate)
  publishScore(@Req() req: any, @Body() dto: PublishBarsRankingDto) {
    return this.service.publishBarsScore(req.attendanceIdentity, dto);
  }

  @Delete('score-ranking')
  @UseGuards(AttendanceGuard)
  withdrawScore(@Req() req: any) {
    return this.service.withdrawBarsScore(req.attendanceIdentity);
  }

  /** The student's own avatar is server-side and authenticated. */
  @Post('avatar')
  @UseGuards(AttendanceGuard)
  @UseInterceptors(FileInterceptor('avatar', {
    storage: memoryStorage(),
    limits: {fileSize: 4 * 1024 * 1024,files:1},
  }))
  uploadAvatar(@Req() req: any, @UploadedFile() file: Express.Multer.File) {
    return this.service.uploadProfileAvatar(req.attendanceIdentity, file);
  }

  @Get('avatar')
  @UseGuards(AttendanceGuard)
  async myAvatar(@Req() req: any, @Res() res: Response) {
    const image = await this.service.myProfileAvatar(req.attendanceIdentity);
    return this.sendAvatar(res,image);
  }

  @Delete('avatar')
  @UseGuards(AttendanceGuard)
  removeAvatar(@Req() req: any) {
    return this.service.removeProfileAvatar(req.attendanceIdentity);
  }

  @Get('avatars/:id')
  @UseGuards(AttendanceGuard)
  async rankingAvatar(@Req() req: any,@Param('id') id: string,@Res() res: Response) {
    const image = await this.service.rankingProfileAvatar(
      req.attendanceIdentity,id,
    );
    return this.sendAvatar(res,image);
  }

  private sendAvatar(res: Response, image: {bytes:Buffer;mime:string}) {
    res.set({
      'Content-Type':image.mime,
      'Cache-Control':'private, no-store',
      'X-Content-Type-Options':'nosniff',
      'Content-Security-Policy':"default-src 'none'; sandbox",
    });
    return res.send(image.bytes);
  }

  @Get('ranking')
  @UseGuards(AttendanceGuard)
  personalRanking(@Req() req: any) {
    return this.service.personalAttendanceRank(req.attendanceIdentity);
  }

  @Get('roster')
  @UseGuards(AttendanceGuard)
  roster(@Req() req: any) {
    return this.service.roster(req.attendanceIdentity);
  }

  /** Re-synchronize a previously logged-in starosta, without opening a
   * student-table WebView. Credentials must match the current Campus session.
   */
  @Post('roster/sync')
  @UseGuards(AttendanceGuard) @UsePipes(validate)
  async syncRoster(@Req() req: any, @Body() dto: BarsListingLoginDto) {
    const actor = req.attendanceIdentity;
    if (!actor.isStarosta) {
      throw new ForbiddenException('Только староста может обновить список');
    }
    const peer = req.socket?.remoteAddress ?? '';
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer);
    if (!req.secure && !local) {
      throw new ForbiddenException('Для передачи сессии БАРС нужен HTTPS');
    }
    const verified = await this.barsVerifier.verify(dto.cookieHeader);
    if (ListingsService.ownerKey(normalizeBarsRecordBook(verified.recordBook)) !==
        actor.ownerKey || normalizedStudyGroup(verified.group ?? '') !== actor.group) {
      throw new ForbiddenException('Сессия БАРС принадлежит другому студенту');
    }
    return this.service.syncFromBars(actor, dto.cookieHeader);
  }

  @Post('roster/import')
  @UseGuards(AttendanceGuard) @UsePipes(validate)
  importRoster(@Req() req: any, @Body() dto: AttendanceRosterImportDto) {
    return this.service.importRoster(req.attendanceIdentity, dto);
  }

  @Post('lessons/:id/absences')
  @UseGuards(AttendanceGuard) @UsePipes(validate)
  saveAbsences(
    @Req() req: any, @Param('id', ParseIntPipe) id: number,
    @Body() dto: AttendanceAbsencesDto,
  ) {
    return this.service.saveAbsences(req.attendanceIdentity, id, dto);
  }

  /** Correct a saved absence; only the verified starosta of this lesson's
   * group can modify an existing record, with an audit trail.
   */
  @Patch('lessons/:id/attendance')
  @UseGuards(AttendanceGuard) @UsePipes(validate)
  correctAttendance(
    @Req() req: any, @Param('id', ParseIntPipe) id: number,
    @Body() dto: AttendanceCorrectionDto,
  ) {
    return this.service.correctClosedAttendance(req.attendanceIdentity, id, dto);
  }

  @Post('register')
  @UseGuards(AttendanceGuard) @UsePipes(validate)
  register(@Req() req: any, @Body() dto: AttendanceMemberDto) {
    return this.service.register(req.attendanceIdentity, dto.displayName);
  }

  @Get('lessons')
  @UseGuards(AttendanceGuard) @UsePipes(validate)
  lessons(@Req() req: any, @Query() dto: AttendanceDateDto) {
    return this.service.list(req.attendanceIdentity, dto.date);
  }

  @Post('lessons')
  @UseGuards(AttendanceGuard) @UsePipes(validate)
  open(@Req() req: any, @Body() dto: AttendanceOpenLessonDto) {
    return this.service.open(req.attendanceIdentity, dto);
  }

  @Get('lessons/:id')
  @UseGuards(AttendanceGuard)
  detail(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.service.detail(req.attendanceIdentity, id);
  }

  @Post('lessons/:id/check-in')
  @UseGuards(AttendanceGuard)
  checkIn(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.service.checkIn(req.attendanceIdentity, id);
  }

  @Patch('lessons/:id/decision')
  @UseGuards(AttendanceGuard) @UsePipes(validate)
  decide(
    @Req() req: any, @Param('id', ParseIntPipe) id: number,
    @Body() dto: AttendanceDecisionDto,
  ) {
    return this.service.decide(req.attendanceIdentity, id, dto);
  }

  @Post('lessons/:id/close')
  @UseGuards(AttendanceGuard) @UsePipes(validate)
  close(
    @Req() req: any, @Param('id', ParseIntPipe) id: number,
    @Body() dto: AttendanceCloseDto,
  ) {
    if (!req.attendanceIdentity.isStarosta) {
      throw new ForbiddenException('Только староста закрывает журнал');
    }
    return this.service.close(
      req.attendanceIdentity, id, dto.acknowledgedStudentKeys,
    );
  }

  @Get('lessons/:id/bars-preview')
  @UseGuards(AttendanceGuard)
  barsPreview(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.service.barsPreview(req.attendanceIdentity, id);
  }
}
