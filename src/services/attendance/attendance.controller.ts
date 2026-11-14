import {
  Body, Controller, Get, Param, ParseIntPipe, Patch, Post,
  Query, Req, UseGuards, UsePipes, ValidationPipe,
  ForbiddenException,
} from '@nestjs/common';
import { attendanceIdentity, AttendanceGuard } from './attendance.guard';
import { AttendanceService } from './attendance.service';
import {
  AttendanceCloseDto, AttendanceDateDto, AttendanceDecisionDto,
  AttendanceMemberDto, AttendanceOpenLessonDto,
  AttendanceRosterImportDto, AttendanceAbsencesDto,
} from './attendance.dto';

const validate = new ValidationPipe({
  whitelist: true, forbidNonWhitelisted: true, transform: true,
});

/** CampusApp attendance journal; no credentials or arbitrary URLs from phones. */
@Controller('services/attendance')
export class AttendanceController {
  constructor(private readonly service: AttendanceService) {}

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

  @Get('roster')
  @UseGuards(AttendanceGuard)
  roster(@Req() req: any) {
    return this.service.roster(req.attendanceIdentity);
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
