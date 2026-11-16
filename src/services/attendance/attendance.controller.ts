import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post,
  Query, Req, Res, UploadedFile, UseGuards, UsePipes, UseInterceptors, ValidationPipe,
  ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { attendanceIdentity, AttendanceGuard } from './attendance.guard';
import type { AttendanceIdentity } from './attendance.guard';
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
  AttendanceManagedGroupDto, AttendanceReportQueryDto,
  AttendanceRosterSyncDto,
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

  /** A group only appears as editable after an independent BARS headman
   * check, not just because it is linked from a university menu.
   */
  private scopedActor(req: any, selected?: string): AttendanceIdentity {
    const actor = req.attendanceIdentity as AttendanceIdentity;
    const group = selected
      ? normalizedStudyGroup(selected) : actor.group;
    if (group === actor.group && actor.isStarosta) return actor;
    if (!(actor.managedGroups ?? []).includes(group)) {
      throw new ForbiddenException('Нет подтверждённых прав на эту группу');
    }
    return {...actor, group, isStarosta: true};
  }

  private requirePrivateBarsTransport(req: any) {
    const peer = req.socket?.remoteAddress ?? '';
    if (!req.secure &&
        !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer)) {
      throw new ForbiddenException('Для сессии БАРС нужен HTTPS');
    }
  }

  private async checkOwnBarsAccount(req: any, cookies: string) {
    this.requirePrivateBarsTransport(req);
    const actor = req.attendanceIdentity as AttendanceIdentity;
    const verified = await this.barsVerifier.verify(cookies);
    if (ListingsService.ownerKey(
          normalizeBarsRecordBook(verified.recordBook)) !== actor.ownerKey ||
        normalizedStudyGroup(verified.group ?? '') !== actor.group) {
      throw new ForbiddenException('Сессия БАРС принадлежит другому студенту');
    }
  }

  @Get('managed-groups')
  @UseGuards(AttendanceGuard)
  managedGroups(@Req() req: any) {
    const actor = req.attendanceIdentity as AttendanceIdentity;
    return {group: actor.group, isStarosta: actor.isStarosta,
      groups:actor.managedGroups ?? []};
  }

  /** No automatic network polling: the user explicitly requests discovery. */
  @Post('managed-groups/discover')
  @UseGuards(AttendanceGuard) @UsePipes(validate)
  async discoverManagedGroups(@Req() req: any, @Body() dto: BarsListingLoginDto) {
    await this.checkOwnBarsAccount(req,dto.cookieHeader);
    return {
      candidates: await this.barsVerifier.discoverGroupCandidates(dto.cookieHeader),
    };
  }

  /** Never trust a candidate list as evidence of headman privileges. */
  @Post('managed-groups/verify')
  @UseGuards(AttendanceGuard) @UsePipes(validate)
  async verifyManagedGroup(
    @Req() req: any, @Body() dto: AttendanceManagedGroupDto,
  ) {
    await this.checkOwnBarsAccount(req,dto.cookieHeader);
    const group = normalizedStudyGroup(dto.group);
    const candidates = await this.barsVerifier
      .discoverGroupCandidates(dto.cookieHeader);
    if (!candidates.includes(group) ||
        !await this.barsVerifier.verifyStarosta(dto.cookieHeader,group)) {
      throw new ForbiddenException(
        'БАРС не подтвердил права старосты этой группы',
      );
    }
    const actor = req.attendanceIdentity as AttendanceIdentity;
    const current = req.session.listingManagedGroupsVerifiedAt ===
        req.session.listingVerifiedAt &&
      Array.isArray(req.session.listingManagedGroups)
        ? req.session.listingManagedGroups : [];
    req.session.listingManagedGroups = [...new Set([
      ...current.filter((x: unknown) => typeof x === 'string'),
      group,
    ])].slice(0,40);
    req.session.listingManagedGroupsVerifiedAt =
      req.session.listingVerifiedAt;
    await new Promise<void>((resolve,reject) =>
      req.session.save((error: Error | null) =>
        error ? reject(error) : resolve()));
    return {
      group,
      groups: [
        ...new Set([...(actor.managedGroups ?? []),group]),
      ].sort((a,b) => a.localeCompare(b,'ru')),
    };
  }

  @Get('roster')
  @UseGuards(AttendanceGuard)
  roster(@Req() req: any, @Query('group') group?: string) {
    return this.service.roster(this.scopedActor(req,group));
  }

  @Get('reports')
  @UseGuards(AttendanceGuard) @UsePipes(validate)
  report(@Req() req: any, @Query() dto: AttendanceReportQueryDto) {
    return this.service.attendanceReport(
      this.scopedActor(req,dto.group),dto.from,dto.to,
    );
  }

  /** Re-synchronize a previously logged-in starosta, without opening a
   * student-table WebView. Credentials must match the current Campus session.
   */
  @Post('roster/sync')
  @UseGuards(AttendanceGuard) @UsePipes(validate)
  async syncRoster(@Req() req: any, @Body() dto: AttendanceRosterSyncDto) {
    const actor = this.scopedActor(req,dto.group);
    await this.checkOwnBarsAccount(req,dto.cookieHeader);
    // An additional group must be rechecked at the actual BARS source.
    if (actor.group !== req.attendanceIdentity.group &&
        !await this.barsVerifier.verifyStarosta(dto.cookieHeader,actor.group)) {
      throw new ForbiddenException('БАРС больше не подтверждает права старосты');
    }
    return this.service.syncFromBars(actor,dto.cookieHeader);
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
