import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DbService } from '../../db.service';
import { ScheduleService } from '../../schedule/schedule.service';
import { BarsRosterFetcher } from './bars-roster-fetcher.service';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';
import { BarsSessionVerifier } from '../admin/bars-session-verifier.service';
import { attendanceIdentity } from './attendance.guard';

const actor = {
  ownerKey:'f'.repeat(64), group:'А-03-23', isStarosta:true,
  managedGroups:['А-03-23','А-04-23'],
};

describe('Headman cabinet security and reports', () => {
  test('extra managed group is rejected unless verified during this session', () => {
    const current = Date.now();
    const verified = attendanceIdentity({
      listingOwnerKey:'f'.repeat(64),
      listingGroup:'А-03-23',
      listingVerifiedAt:current,
      listingStarostaGroup:'А-03-23',
      listingStarostaVerifiedAt:current,
      listingManagedGroups:['А-04-23'],
      listingManagedGroupsVerifiedAt:current,
    });
    expect(verified?.managedGroups).toEqual(['А-03-23','А-04-23']);
    const stale = attendanceIdentity({
      listingOwnerKey:'f'.repeat(64),
      listingGroup:'А-03-23',
      listingVerifiedAt:current,
      listingManagedGroups:['А-04-23'],
      listingManagedGroupsVerifiedAt:current-1,
    });
    expect(stale?.managedGroups).toEqual([]);
  });

  test('scope rejects any unverified group, never trusts a supplied name', () => {
    const mockedService = {roster:jest.fn(),attendanceReport:jest.fn()};
    const controller = new AttendanceController(
      mockedService as unknown as AttendanceService,
      {} as BarsSessionVerifier,
    );
    const req = {attendanceIdentity:actor};
    controller.roster(req,'А-04-23');
    expect(mockedService.roster).toHaveBeenCalledWith(expect.objectContaining({
      group:'А-04-23',isStarosta:true,
    }));
    expect(() => controller.roster(req,'А-05-23'))
      .toThrow(ForbiddenException);
    controller.report(req,{
      group:'А-04-23',from:'2026-09-01',to:'2026-10-01',
    });
    expect(mockedService.attendanceReport).toHaveBeenCalledWith(
      expect.objectContaining({group:'А-04-23'}),
      '2026-09-01','2026-10-01',
    );
  });

  test('reports read only snapshot rows from closed CampusApp lessons', async () => {
    const query = jest.fn(async(sql:string,params:unknown[] = []) => {
      if (sql.startsWith('CREATE TABLE')) return {};
      if (sql.startsWith('SELECT l.id AS lesson_id')) {
        expect(sql).toContain("l.state='closed'");
        expect(sql).toContain('l.group_name=?');
        expect(sql).toContain('campus_attendance_lesson_roster');
        expect(params).toEqual(['А-03-23','2026-09-01','2026-10-01']);
        return [
          {
            lesson_id:42,lesson_date:'2026-09-10',lesson_time:'10:15–11:50',
            subject:'ТАУ',lesson_type:'Практика',room:'М-307',
            owner_key:'e'.repeat(64),
            display_name:'Тестовый Студент',status:'absent',
          },
        ];
      }
      throw new Error('Unexpected SQL ' + sql);
    });
    const service = new AttendanceService(
      {query} as unknown as DbService,
      {} as ScheduleService,{} as BarsRosterFetcher,
    );
    const report = await service.attendanceReport(
      actor,'2026-09-01','2026-10-01',
    );
    expect(report.source).toBe('campus_attendance_closed_lessons');
    expect(report.rows[0]).toMatchObject({
      displayName:'Тестовый Студент',subject:'ТАУ',status:'absent',
    });
    await expect(service.attendanceReport(
      actor,'2026-01-01','2026-11-01',
    )).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.attendanceReport(
      {...actor,isStarosta:false},'2026-09-01','2026-10-01',
    )).rejects.toBeInstanceOf(ForbiddenException);
  });
});
