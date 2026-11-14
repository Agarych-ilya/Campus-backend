import { createHmac } from 'node:crypto';
import {
  BadRequestException, ConflictException, ForbiddenException,
  Injectable, NotFoundException,
} from '@nestjs/common';
import { DbService } from '../../db.service';
import { ScheduleService } from '../../schedule/schedule.service';
import { normalizedStudyGroup } from '../lesson-notes/lesson-group-normalizer';
import { AttendanceIdentity } from './attendance.guard';
import {
  AttendanceOpenLessonDto, AttendanceDecisionDto,
  AttendanceRosterImportDto, AttendanceAbsencesDto,
} from './attendance.dto';

type LessonRow = {
  id: number | string; group_name: string; lesson_date: string;
  lesson_time: string; subject: string; lesson_type: string; room: string;
  state: 'open' | 'closed'; created_by: string;
};
type MemberRow = { owner_key: string; display_name: string };
type EntryRow = {
  owner_key: string; status: string; note: string | null;
  updated_at: Date | string;
};

@Injectable()
export class AttendanceService {
  constructor(
    private readonly db: DbService,
    private readonly schedule: ScheduleService,
  ) {}

  private schemaPromise?: Promise<void>;
  private async ensureSchema() {
    if (!this.schemaPromise) {
      this.schemaPromise = (async () => {
        await this.db.query(
          'CREATE TABLE IF NOT EXISTS campus_attendance_students (' +
          'group_name VARCHAR(60) NOT NULL, owner_key CHAR(64) NOT NULL, ' +
          'display_name VARCHAR(100) NOT NULL, ' +
          'joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, ' +
          'PRIMARY KEY(group_name,owner_key)' +
          ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
        );
        await this.db.query(
          'CREATE TABLE IF NOT EXISTS campus_attendance_lessons (' +
          'id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, ' +
          'group_name VARCHAR(60) NOT NULL, lesson_date VARCHAR(10) NOT NULL, ' +
          'lesson_time VARCHAR(60) NOT NULL, subject VARCHAR(180) NOT NULL, ' +
          'lesson_type VARCHAR(60) NOT NULL, room VARCHAR(100) NOT NULL, ' +
          "state ENUM('open','closed') NOT NULL DEFAULT 'open', " +
          'created_by CHAR(64) NOT NULL, ' +
          'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, ' +
          'UNIQUE KEY uniq_attendance_lesson ' +
          '(group_name,lesson_date,lesson_time,subject)' +
          ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
        );
        await this.db.query(
          'CREATE TABLE IF NOT EXISTS campus_attendance_entries (' +
          'lesson_id BIGINT UNSIGNED NOT NULL, owner_key CHAR(64) NOT NULL, ' +
          "status ENUM('pending','present','absent','excused','rejected') " +
          'NOT NULL, note VARCHAR(300) NULL, reviewer_key CHAR(64) NULL, ' +
          'updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ' +
          'ON UPDATE CURRENT_TIMESTAMP, ' +
          'PRIMARY KEY(lesson_id,owner_key)' +
          ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
        );
        // Imported BARS roster is separate from legacy self-registered
        // students. Never claim a client-imported roster is server-verified.
        await this.db.query(
          'CREATE TABLE IF NOT EXISTS campus_attendance_roster (' +
          'group_name VARCHAR(60) NOT NULL, owner_key CHAR(64) NOT NULL, ' +
          'display_name VARCHAR(120) NOT NULL, active TINYINT(1) NOT NULL, ' +
          'updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ' +
          'ON UPDATE CURRENT_TIMESTAMP, ' +
          'PRIMARY KEY(group_name,owner_key), ' +
          'INDEX idx_att_roster_active(group_name,active)' +
          ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
        );
        await this.db.query(
          'CREATE TABLE IF NOT EXISTS campus_attendance_lesson_roster (' +
          'lesson_id BIGINT UNSIGNED NOT NULL, owner_key CHAR(64) NOT NULL, ' +
          'display_name VARCHAR(120) NOT NULL, ' +
          'PRIMARY KEY(lesson_id,owner_key)' +
          ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
        );
        await this.db.query(
          'CREATE TABLE IF NOT EXISTS campus_attendance_roster_sync (' +
          'id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, ' +
          'group_name VARCHAR(60) NOT NULL, actor_key CHAR(64) NOT NULL, ' +
          'student_count SMALLINT UNSIGNED NOT NULL, ' +
          'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, ' +
          'INDEX idx_att_sync(group_name,id)' +
          ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
        );
        await this.db.query(
          'CREATE TABLE IF NOT EXISTS campus_attendance_audit (' +
          'id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, ' +
          'lesson_id BIGINT UNSIGNED NOT NULL, actor_key CHAR(64) NOT NULL, ' +
          'student_key CHAR(64) NULL, action VARCHAR(32) NOT NULL, ' +
          'old_status VARCHAR(20) NULL, new_status VARCHAR(20) NULL, ' +
          'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, ' +
          'INDEX idx_attendance_audit (lesson_id,id)' +
          ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
        );
      })().catch(error => { this.schemaPromise = undefined; throw error; });
    }
    await this.schemaPromise;
  }

  private starosta(actor: AttendanceIdentity) {
    if (!actor.isStarosta) {
      throw new ForbiddenException(
        'Только подтверждённый староста может редактировать журнал',
      );
    }
  }

  private date(raw: string): string {
    const match = /^\d{4}-\d{2}-\d{2}$/.test(raw);
    const parsed = match ? new Date(raw + 'T00:00:00Z') : null;
    if (!parsed || Number.isNaN(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== raw) {
      throw new BadRequestException('Некорректная дата занятия');
    }
    return raw;
  }

  private clean(text: string) {
    return text.normalize('NFC').replace(/\s+/g, ' ').trim();
  }

  /** Full class roster is private to an authenticated starosta. */
  async roster(actor: AttendanceIdentity) {
    this.starosta(actor);
    await this.ensureSchema();
    const students = await this.db.query(
      'SELECT owner_key, display_name FROM campus_attendance_roster ' +
      'WHERE group_name=? AND active=1 ORDER BY display_name LIMIT 121',
      [actor.group],
    ) as MemberRow[];
    const syncRows = await this.db.query(
      'SELECT created_at, student_count FROM campus_attendance_roster_sync ' +
      'WHERE group_name=? ORDER BY id DESC LIMIT 1',
      [actor.group],
    ) as Array<{ created_at: Date|string; student_count: number }>;
    return {
      group: actor.group,
      students: students.map(row => ({
        ownerKey: row.owner_key, displayName: row.display_name,
      })),
      imported: syncRows.length > 0,
      importedAt: syncRows[0]?.created_at ?? null,
      // Data was captured from BARS WebView by the starosta; the server
      // has not independently certified the roster against BARS.
      verification: 'starosta_reviewed_bars_page',
    };
  }

  async importRoster(actor: AttendanceIdentity, dto: AttendanceRosterImportDto) {
    this.starosta(actor);
    await this.ensureSchema();
    if (normalizedStudyGroup(dto.group) !== actor.group) {
      throw new ForbiddenException('Список относится к другой учебной группе');
    }
    const secret = process.env.SESSION_SECRET;
    if (!secret || secret.length < 32) {
      throw new ConflictException('Не настроен SESSION_SECRET для импорта');
    }
    if (dto.students.length > 120) {
      throw new BadRequestException('Слишком много студентов в списке');
    }
    const usedIds = new Set<string>();
    const usedNames = new Set<string>();
    const prepared = dto.students.map(student => {
      const name = this.clean(student.fullName);
      if (name.length < 5 || name.length > 120 ||
          !/^[\\p{L} .'-]+$/u.test(name) ||
          name.split(' ').filter(Boolean).length < 2) {
        throw new BadRequestException('Некорректное ФИО в списке БАРС');
      }
      const canonical = name.toLocaleLowerCase('ru-RU');
      if (usedNames.has(canonical)) {
        throw new BadRequestException(
          'Повторяющееся ФИО в группе. Проверь список студентов',
        );
      }
      usedNames.add(canonical);
      // Student row ID, when exposed by BARS, takes precedence; otherwise
      // normalized full name is stable across repeated roster imports.
      const source = student.sourceId?.trim() ?? '';
      if (source && !/^[a-zA-Z0-9_-]{1,120}$/.test(source)) {
        throw new BadRequestException('Некорректный идентификатор студента');
      }
      if (source && usedIds.has(source)) {
        throw new BadRequestException('Дублирующийся ID студента');
      }
      if (source) usedIds.add(source);
      const key = createHmac('sha256', secret)
        .update('attendance-roster-v1:' + actor.group + ':' +
          (source || 'fio:' + canonical)).digest('hex');
      return { ownerKey: key, displayName: name };
    });
    const keys = new Set(prepared.map(x => x.ownerKey));
    if (keys.size !== prepared.length) {
      throw new BadRequestException('Невозможно различить студентов по списку');
    }
    await this.db.withTransaction(async connection => {
      await connection.execute(
        'UPDATE campus_attendance_roster SET active=0 WHERE group_name=?',
        [actor.group],
      );
      for (const row of prepared) {
        await connection.execute(
          'INSERT INTO campus_attendance_roster ' +
          '(group_name,owner_key,display_name,active) VALUES (?,?,?,1) ' +
          'ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),active=1',
          [actor.group, row.ownerKey, row.displayName],
        );
      }
      await connection.execute(
        'INSERT INTO campus_attendance_roster_sync ' +
        '(group_name,actor_key,student_count) VALUES (?,?,?)',
        [actor.group, actor.ownerKey, prepared.length],
      );
    });
    return { group: actor.group, count: prepared.length, imported: true };
  }

  /**
   * One reviewed decision: all checked-out students are absent, everyone
   * else is explicitly confirmed present. Never infer absences from missing
   * self-checkins; do not write into official BARS from this endpoint.
   */
  async saveAbsences(
    actor: AttendanceIdentity, id: number, dto: AttendanceAbsencesDto,
  ) {
    this.starosta(actor);
    await this.lesson(actor, id);
    return this.db.withTransaction(async connection => {
      await this.ensureOpenTransaction(connection, actor, id);
      const [snapRows] = await connection.execute(
        'SELECT owner_key,display_name FROM campus_attendance_lesson_roster ' +
        'WHERE lesson_id=? ORDER BY owner_key',
        [id],
      );
      const snapshot = snapRows as unknown as MemberRow[];
      const [currentRows] = await connection.execute(
        'SELECT owner_key,display_name FROM campus_attendance_roster ' +
        'WHERE group_name=? AND active=1 ORDER BY owner_key',
        [actor.group],
      );
      const current = currentRows as unknown as MemberRow[];
      const rows = snapshot.length ? snapshot : current;
      if (!rows.length || rows.length > 120) {
        throw new ConflictException('Сначала загрузи полный список группы из БАРС');
      }
      const actual = rows.map(row => row.owner_key).sort();
      const submitted = [...dto.rosterKeys].sort();
      if (actual.length !== submitted.length ||
          actual.some((key, i) => key !== submitted[i])) {
        throw new ConflictException(
          'Список студентов изменился. Обнови журнал и проверь отметки',
        );
      }
      const missing = new Set(dto.absentKeys);
      if (missing.size !== dto.absentKeys.length ||
          dto.absentKeys.some(key => !actual.includes(key))) {
        throw new BadRequestException('Выбраны студенты вне этой группы');
      }
      if (!snapshot.length) {
        for (const row of rows) {
          await connection.execute(
            'INSERT INTO campus_attendance_lesson_roster ' +
            '(lesson_id,owner_key,display_name) VALUES (?,?,?)',
            [id, row.owner_key, row.display_name],
          );
        }
      }
      for (const row of rows) {
        const status = missing.has(row.owner_key) ? 'absent' : 'present';
        await connection.execute(
          'INSERT INTO campus_attendance_entries ' +
          '(lesson_id,owner_key,status,reviewer_key) VALUES (?,?,?,?) ' +
          'ON DUPLICATE KEY UPDATE status=VALUES(status),' +
          'reviewer_key=VALUES(reviewer_key),updated_at=CURRENT_TIMESTAMP',
          [id, row.owner_key, status, actor.ownerKey],
        );
        await this.auditTransaction(
          connection, id, actor.ownerKey, row.owner_key,
          'review', null, status,
        );
      }
      await connection.execute(
        "UPDATE campus_attendance_lessons SET state='closed' " +
        "WHERE id=? AND group_name=? AND state='open'",
        [id, actor.group],
      );
      await this.auditTransaction(
        connection, id, actor.ownerKey, null, 'close', 'open', 'closed',
      );
      return {
        state: 'closed', absent: missing.size,
        present: rows.length - missing.size, barsSynced: false,
      };
    });
  }

  async register(actor: AttendanceIdentity, displayName: string) {
    await this.ensureSchema();
    const name = this.clean(displayName);
    if (name.length < 2 || name.length > 100) {
      throw new BadRequestException('Укажи имя для списка группы');
    }
    await this.db.query(
      'INSERT INTO campus_attendance_students ' +
      '(group_name,owner_key,display_name) VALUES (?,?,?) ' +
      'ON DUPLICATE KEY UPDATE display_name=VALUES(display_name)',
      [actor.group, actor.ownerKey, name],
    );
    return { registered: true, displayName: name };
  }

  async me(actor: AttendanceIdentity) {
    await this.ensureSchema();
    const rows = await this.db.query(
      'SELECT display_name FROM campus_attendance_students ' +
      'WHERE group_name=? AND owner_key=? LIMIT 1',
      [actor.group, actor.ownerKey],
    ) as Array<{ display_name: string }>;
    return {
      group: actor.group,
      isStarosta: actor.isStarosta,
      registered: rows.length > 0,
      displayName: rows[0]?.display_name ?? null,
    };
  }

  async list(actor: AttendanceIdentity, date: string) {
    await this.ensureSchema();
    const day = this.date(date);
    const rows = await this.db.query(
      'SELECT id,lesson_date,lesson_time,subject,lesson_type,room,state ' +
      'FROM campus_attendance_lessons ' +
      'WHERE group_name=? AND lesson_date=? ORDER BY lesson_time',
      [actor.group, day],
    ) as LessonRow[];
    return rows.map(row => ({
      id: Number(row.id), date: row.lesson_date, time: row.lesson_time,
      subject: row.subject, type: row.lesson_type, room: row.room,
      state: row.state,
    }));
  }

  async open(actor: AttendanceIdentity, input: AttendanceOpenLessonDto) {
    this.starosta(actor);
    await this.ensureSchema();
    const date = this.date(input.date);
    const time = this.clean(input.time);
    const subject = this.clean(input.subject);
    const type = this.clean(input.type);
    const room = this.clean(input.room);
    // Client cannot invent lessons: server matches the canonical RUZ timetable.
    const response = await this.schedule.getSchedule(actor.group, date);
    const matching = response.lessons.filter(lesson => {
      const lessonDate = lesson.date;
      const matchDate = lessonDate === date ||
        lessonDate === date.slice(8) + '.' + date.slice(5, 7) +
          '.' + date.slice(0, 4);
      return matchDate && this.clean(lesson.time) === time &&
        this.clean(lesson.subject) === subject &&
        this.clean(lesson.type) === type &&
        this.clean(lesson.room) === room;
    });
    if (matching.length !== 1) {
      throw new BadRequestException(
        'Занятие не найдено однозначно в расписании МЭИ',
      );
    }
    await this.db.query(
      'INSERT INTO campus_attendance_lessons ' +
      '(group_name,lesson_date,lesson_time,subject,lesson_type,room,created_by) ' +
      'VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)',
      [actor.group, date, time, subject, type, room, actor.ownerKey],
    );
    const rows = await this.db.query(
      'SELECT id,state FROM campus_attendance_lessons ' +
      'WHERE group_name=? AND lesson_date=? AND lesson_time=? ' +
      'AND subject=? LIMIT 1',
      [actor.group, date, time, subject],
    ) as Array<{ id: number | string; state: 'open' | 'closed' }>;
    return { id: Number(rows[0].id), state: rows[0].state };
  }

  private async lesson(actor: AttendanceIdentity, id: number): Promise<LessonRow> {
    await this.ensureSchema();
    const rows = await this.db.query(
      'SELECT * FROM campus_attendance_lessons WHERE id=? LIMIT 1', [id],
    ) as LessonRow[];
    if (!rows.length ||
        normalizedStudyGroup(rows[0].group_name) !== actor.group) {
      throw new NotFoundException('Журнал занятия не найден в твоей группе');
    }
    return rows[0];
  }

  async detail(actor: AttendanceIdentity, id: number) {
    const lesson = await this.lesson(actor, id);
    const locked = await this.db.query(
      'SELECT owner_key,display_name FROM campus_attendance_lesson_roster ' +
      'WHERE lesson_id=? ORDER BY display_name',
      [id],
    ) as MemberRow[];
    const members = locked.length ? locked : await this.db.query(
      'SELECT owner_key,display_name FROM campus_attendance_roster ' +
      'WHERE group_name=? AND active=1 ORDER BY display_name LIMIT 121',
      [actor.group],
    ) as MemberRow[];
    const entries = await this.db.query(
      'SELECT owner_key,status,note,updated_at FROM campus_attendance_entries ' +
      'WHERE lesson_id=?', [id],
    ) as EntryRow[];
    const map = new Map(entries.map(row => [row.owner_key, row]));
    const studentEntries = members.map(member => ({
      ownerKey: member.owner_key,
      displayName: member.display_name,
      status: map.get(member.owner_key)?.status ?? 'unmarked',
      note: map.get(member.owner_key)?.note ?? null,
    }));
    const mine = studentEntries.find(row => row.ownerKey === actor.ownerKey);
    return {
      id: Number(lesson.id), group: lesson.group_name,
      date: lesson.lesson_date, time: lesson.lesson_time,
      subject: lesson.subject, state: lesson.state,
      mine: mine ? { status: mine.status, displayName: mine.displayName } : null,
      // Other students' names and statuses are only available to the starosta.
      students: actor.isStarosta ? studentEntries : undefined,
      summary: actor.isStarosta ? {
        present: studentEntries.filter(x => x.status === 'present').length,
        pending: studentEntries.filter(x => x.status === 'pending').length,
        unknown: studentEntries.filter(x => x.status === 'unmarked').length,
        absent: studentEntries.filter(x => x.status === 'absent').length,
        excused: studentEntries.filter(x => x.status === 'excused').length,
      } : undefined,
    };
  }

  private async ensureOpenTransaction(
    connection: import('mysql2/promise').PoolConnection,
    actor: AttendanceIdentity, id: number,
  ) {
    const [result] = await connection.execute(
      'SELECT state FROM campus_attendance_lessons ' +
      'WHERE id=? AND group_name=? FOR UPDATE',
      [id, actor.group],
    );
    const rows = result as unknown as Array<{ state: string }>;
    if (rows.length !== 1 || rows[0].state !== 'open') {
      throw new ConflictException('Журнал закрыт или недоступен');
    }
  }

  private async auditTransaction(
    connection: import('mysql2/promise').PoolConnection,
    id: number, actor: string, target: string | null,
    action: string, before: string | null, after: string | null,
  ) {
    await connection.execute(
      'INSERT INTO campus_attendance_audit ' +
      '(lesson_id,actor_key,student_key,action,old_status,new_status) ' +
      'VALUES (?,?,?,?,?,?)',
      [id, actor, target, action, before, after],
    );
  }

  async checkIn(actor: AttendanceIdentity, id: number) {
    await this.lesson(actor, id);
    return this.db.withTransaction(async connection => {
      await this.ensureOpenTransaction(connection, actor, id);
      const [memberRows] = await connection.execute(
        'SELECT owner_key FROM campus_attendance_students ' +
        'WHERE group_name=? AND owner_key=? LIMIT 1',
        [actor.group, actor.ownerKey],
      );
      const members = memberRows as unknown as MemberRow[];
      if (members.length !== 1) {
        throw new BadRequestException('Сначала добавь себя в список группы');
      }
      const [oldRows] = await connection.execute(
        'SELECT status FROM campus_attendance_entries ' +
        'WHERE lesson_id=? AND owner_key=?',
        [id, actor.ownerKey],
      );
      const existing = oldRows as unknown as Array<{status: string}>;
      if (existing.length && existing[0].status !== 'pending') {
        throw new ConflictException('Отметка уже проверена старостой');
      }
      await connection.execute(
        'INSERT INTO campus_attendance_entries (lesson_id,owner_key,status) ' +
        "VALUES (?,?,'pending') ON DUPLICATE KEY UPDATE " +
        "status='pending',updated_at=CURRENT_TIMESTAMP",
        [id, actor.ownerKey],
      );
      await this.auditTransaction(
        connection, id, actor.ownerKey, actor.ownerKey,
        'checkin', existing[0]?.status ?? null, 'pending',
      );
      return { status: 'pending' };
    });
  }

  async decide(
    actor: AttendanceIdentity, id: number, dto: AttendanceDecisionDto,
  ) {
    this.starosta(actor);
    await this.lesson(actor, id);
    return this.db.withTransaction(async connection => {
      await this.ensureOpenTransaction(connection, actor, id);
      const [memberRows] = await connection.execute(
        'SELECT owner_key FROM campus_attendance_students ' +
        'WHERE group_name=? AND owner_key=? LIMIT 1',
        [actor.group, dto.ownerKey],
      );
      const members = memberRows as unknown as MemberRow[];
      if (members.length !== 1) {
        throw new NotFoundException('Студент не зарегистрирован в группе');
      }
      const [oldRows] = await connection.execute(
        'SELECT status FROM campus_attendance_entries ' +
        'WHERE lesson_id=? AND owner_key=?',
        [id, dto.ownerKey],
      );
      const old = oldRows as unknown as Array<{ status: string }>;
      await connection.execute(
        'INSERT INTO campus_attendance_entries ' +
        '(lesson_id,owner_key,status,note,reviewer_key) VALUES (?,?,?,?,?) ' +
        'ON DUPLICATE KEY UPDATE status=VALUES(status),note=VALUES(note),' +
        'reviewer_key=VALUES(reviewer_key),updated_at=CURRENT_TIMESTAMP',
        [id, dto.ownerKey, dto.status, dto.note?.trim() ?? null, actor.ownerKey],
      );
      await this.auditTransaction(
        connection, id, actor.ownerKey, dto.ownerKey,
        'decision', old[0]?.status ?? null, dto.status,
      );
      return { status: dto.status };
    });
  }

  async close(actor: AttendanceIdentity, id: number, acknowledged: string[]) {
    this.starosta(actor);
    await this.lesson(actor, id);
    if (acknowledged.length > 200) {
      throw new BadRequestException('Слишком большой список студентов');
    }
    return this.db.withTransaction(async connection => {
      await this.ensureOpenTransaction(connection, actor, id);
      const [rosterRows] = await connection.execute(
        'SELECT s.owner_key,e.status FROM campus_attendance_students s ' +
        'LEFT JOIN campus_attendance_entries e ' +
        'ON e.owner_key=s.owner_key AND e.lesson_id=? ' +
        'WHERE s.group_name=? ORDER BY s.owner_key LIMIT 201',
        [id, actor.group],
      );
      const rows = rosterRows as unknown as Array<{
        owner_key: string; status: string | null;
      }>;
      if (!rows.length || rows.length > 200 ||
          rows.some(row =>
            !['present','absent','excused'].includes(row.status ?? ''))) {
        throw new ConflictException(
          'Перед закрытием проверь присутствие всех студентов группы',
        );
      }
      const actual = rows.map(row => row.owner_key).sort();
      const submitted = [...acknowledged].sort();
      if (submitted.length !== actual.length ||
          submitted.some((key, index) => key !== actual[index])) {
        throw new ConflictException('Состав группы изменился, обнови журнал');
      }
      await connection.execute(
        "UPDATE campus_attendance_lessons SET state='closed' " +
        "WHERE id=? AND group_name=? AND state='open'",
        [id, actor.group],
      );
      await this.auditTransaction(
        connection, id, actor.ownerKey, null, 'close', 'open', 'closed',
      );
      return { state: 'closed', barsSynced: false };
    });
  }

  async barsPreview(actor: AttendanceIdentity, id: number) {
    this.starosta(actor);
    const data = await this.detail(actor, id);
    if (data.state !== 'closed') {
      throw new ConflictException('Сначала заверши проверку посещаемости');
    }
    return {
      lessonId: id, date: data.date, subject: data.subject,
      // This is only a reviewable draft, not an official BARS write.
      mode: 'preview_only', barsSynced: false,
      absences: (data.students ?? []).filter(student =>
        student.status === 'absent'),
      excused: (data.students ?? []).filter(student =>
        student.status === 'excused'),
    };
  }
}
