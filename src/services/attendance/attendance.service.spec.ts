import {
  BadRequestException, ConflictException, ForbiddenException,
} from '@nestjs/common';
import { DbService } from '../../db.service';
import { ScheduleService } from '../../schedule/schedule.service';
import { ListingsService } from '../listings/listings.service';
import { attendanceIdentity } from './attendance.guard';
import { AttendanceService } from './attendance.service';

const oldSecret = process.env.SESSION_SECRET;
const oldRoles = process.env.CAMPUS_STAROSTA_GROUP_BOOKS;

describe('BARS attendance - verified group and review workflow', () => {
  const group = 'А-03-23';
  const owner = 'a'.repeat(64);
  const classmate = 'b'.repeat(64);
  const actor = { ownerKey: owner, group, isStarosta: true };
  const student = { ownerKey: classmate, group, isStarosta: false };
  const lesson = {
    id: 8, group_name: group, lesson_date: '2026-11-14',
    lesson_time: '10:00–11:30', subject: 'Теория управления',
    lesson_type: 'Лекция', room: 'В-308',
    state: 'open', created_by: owner,
  };

  let query: jest.Mock;
  let api: AttendanceService;
  let schedule: { getSchedule: jest.Mock };

  beforeEach(() => {
    query = jest.fn(async (sql: string) => {
      if (sql.startsWith('SELECT * FROM campus_attendance_lessons')) {
        return [lesson];
      }
      if (sql.startsWith('SELECT state FROM campus_attendance_lessons')) {
        return [{state: 'open'}];
      }
      if (sql.startsWith('SELECT owner_key,display_name FROM campus_attendance_students')) {
        return [
          {owner_key: owner, display_name: 'Староста'},
          {owner_key: classmate, display_name: 'Студент'},
        ];
      }
      if (sql.startsWith('SELECT owner_key,status,note,updated_at')) {
        return [{owner_key: classmate, status: 'pending', note: null}];
      }
      if (sql.startsWith('SELECT owner_key FROM campus_attendance_students')) {
        return [{owner_key: classmate}];
      }
      if (sql.startsWith('SELECT status FROM campus_attendance_entries')) return [];
      if (sql.startsWith('SELECT')) return [];
      return {affectedRows: 1, insertId: 8};
    });
    schedule = {
      getSchedule: jest.fn(async () => ({
        lessons: [{
          date: '14.11.2026',
          time: '10:00–11:30',
          subject: 'Теория управления',
          type: 'Лекция',
          room: 'В-308',
        }],
      })),
    };
    const withTransaction = jest.fn(async (callback) =>
      callback({execute: async (sql: string, params: unknown[]) =>
        [await query(sql, params), []]}));
    api = new AttendanceService(
      {query, withTransaction} as unknown as DbService,
      schedule as unknown as ScheduleService,
    );
  });

  afterAll(() => {
    if (oldSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = oldSecret;
    if (oldRoles === undefined) delete process.env.CAMPUS_STAROSTA_GROUP_BOOKS;
    else process.env.CAMPUS_STAROSTA_GROUP_BOOKS = oldRoles;
  });

  test('starosta permission comes from verified record book, not app claims', () => {
    process.env.SESSION_SECRET = 's'.repeat(48);
    process.env.CAMPUS_STAROSTA_GROUP_BOOKS = 'А-03-23=123ABC';
    const ownerKey = ListingsService.ownerKey('123ABC');
    const normal = {
      listingOwnerKey: ownerKey, listingGroup: 'A-03-23',
      listingVerifiedAt: Date.now(),
    };
    expect(attendanceIdentity(normal)?.isStarosta).toBe(true);
    expect(attendanceIdentity({...normal, listingGroup: 'А-02-23'})?.isStarosta)
      .toBe(false);
    expect(attendanceIdentity({...normal, listingVerifiedAt: 0})).toBeNull();
    expect(attendanceIdentity({...normal, listingOwnerKey: 'invalid'})).toBeNull();
  });

  test('cannot open journal for lesson not found in real RUZ timetable',
      async () => {
    await expect(api.open(actor, {
      date: '2026-11-14', time: '12:00–13:30',
      subject: 'Неизвестная пара', type: 'Лекция', room: 'В-308',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(query.mock.calls.some(([sql]) =>
      String(sql).startsWith('INSERT INTO campus_attendance_lessons'))).toBe(false);
  });

  test('regular student cannot create official lesson or review classmates',
      async () => {
    const item = {
      date: '2026-11-14', time: '10:00–11:30',
      subject: 'Теория управления', type: 'Лекция', room: 'В-308',
    };
    await expect(api.open(student, item))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(api.decide(student, 8, {
      ownerKey: owner, status: 'absent',
    })).rejects.toBeInstanceOf(ForbiddenException);
  });

  test('check-in becomes pending and cannot directly mark presence', async () => {
    const reply = await api.checkIn(student, 8);
    expect(reply).toEqual({status: 'pending'});
    expect(query.mock.calls.some(([sql, params]) =>
      String(sql).startsWith('INSERT INTO campus_attendance_entries') &&
      params[0] === 8 && params[1] === classmate)).toBe(true);
    expect(query.mock.calls.some(([sql]) =>
      String(sql).startsWith('INSERT INTO campus_attendance_audit'))).toBe(true);
  });

  test('only starosta can see names and statuses for the whole group',
      async () => {
    const publicView = await api.detail(student, 8);
    expect(publicView.students).toBeUndefined();
    expect(publicView.summary).toBeUndefined();
    const privateView = await api.detail(actor, 8);
    expect(privateView.students).toHaveLength(2);
    expect(privateView.students?.some(item =>
      item.status === 'pending')).toBe(true);
  });

  test('closing fails until every group member has explicit final status',
      async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT * FROM campus_attendance_lessons')) return [lesson];
      if (sql.startsWith('SELECT state FROM campus_attendance_lessons')) {
        return [{state: 'open'}];
      }
      if (sql.startsWith('SELECT s.owner_key,e.status')) return [
        {owner_key: owner, status: 'present'},
        {owner_key: classmate, status: null},
      ];
      if (sql.startsWith('SELECT')) return [];
      return {affectedRows: 1};
    });
    await expect(api.close(actor, 8, [owner, classmate]))
      .rejects.toBeInstanceOf(ConflictException);
    expect(query.mock.calls.some(([sql]) =>
      String(sql).startsWith('UPDATE campus_attendance_lessons'))).toBe(false);
  });

  test('close checks exact roster and cannot silently declare nonresponders absent',
      async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT * FROM campus_attendance_lessons')) return [lesson];
      if (sql.startsWith('SELECT state FROM campus_attendance_lessons')) {
        return [{state: 'open'}];
      }
      if (sql.startsWith('SELECT s.owner_key,e.status')) return [
        {owner_key: owner, status: 'present'},
        {owner_key: classmate, status: 'absent'},
      ];
      if (sql.startsWith('SELECT')) return [];
      return {affectedRows: 1};
    });
    await expect(api.close(actor, 8, [owner]))
      .rejects.toBeInstanceOf(ConflictException);
    const done = await api.close(actor, 8, [classmate, owner]);
    expect(done).toEqual({state: 'closed', barsSynced: false});
  });
});
