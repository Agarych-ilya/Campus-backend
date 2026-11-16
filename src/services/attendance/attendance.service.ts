import { createHmac, randomUUID } from 'node:crypto';
import {
  BadRequestException, ConflictException, ForbiddenException,
  Injectable, NotFoundException,
} from '@nestjs/common';
import { DbService } from '../../db.service';
import { ScheduleService } from '../../schedule/schedule.service';
import { normalizedStudyGroup } from '../lesson-notes/lesson-group-normalizer';
import { AttendanceIdentity } from './attendance.guard';
import { rosterIdentityHash } from './attendance-identity';
import { BarsRosterFetcher } from './bars-roster-fetcher.service';
import {
  AttendanceOpenLessonDto, AttendanceDecisionDto,
  AttendanceRosterImportDto, AttendanceAbsencesDto,
  AttendanceCorrectionDto, PublishBarsRankingDto,
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
    private readonly barsRoster: BarsRosterFetcher,
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
          'CREATE TABLE IF NOT EXISTS campus_attendance_roster_accounts (' +
          'group_name VARCHAR(60) NOT NULL, owner_key CHAR(64) NOT NULL, ' +
          'source_hash CHAR(64) NULL, login_hash CHAR(64) NULL, ' +
          'PRIMARY KEY(group_name,owner_key), ' +
          'INDEX idx_roster_source(group_name,source_hash), ' +
          'INDEX idx_roster_login(group_name,login_hash)' +
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
          'CREATE TABLE IF NOT EXISTS campus_attendance_roster_verified (' +
          'group_name VARCHAR(60) NOT NULL PRIMARY KEY, ' +
          'source VARCHAR(32) NOT NULL, ' +
          'verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP' +
          ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
        );
        await this.db.query(
          'CREATE TABLE IF NOT EXISTS campus_grade_rankings (' +
          'group_name VARCHAR(60) NOT NULL, owner_key CHAR(64) NOT NULL, ' +
          'semester VARCHAR(96) NOT NULL, ' +
          'average_score DECIMAL(6,2) NOT NULL, ' +
          'score_total DECIMAL(9,2) NOT NULL, ' +
          'subject_count SMALLINT UNSIGNED NOT NULL, ' +
          'updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ' +
          'ON UPDATE CURRENT_TIMESTAMP, ' +
          'PRIMARY KEY(group_name,owner_key), ' +
          'INDEX idx_grade_rank_group(group_name,semester,average_score), ' +
          'INDEX idx_grade_rank_semester(semester,average_score)' +
          ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
        );
        // New source of truth: existing currentScore averages are invalid.
        await this.db.query(
          'CREATE TABLE IF NOT EXISTS campus_weighted_grade_rankings (' +
          'group_name VARCHAR(60) NOT NULL, owner_key CHAR(64) NOT NULL, ' +
          'semester VARCHAR(96) NOT NULL, ' +
          'average_score DECIMAL(5,2) NOT NULL, ' +
          'score_total DECIMAL(12,3) NOT NULL, ' +
          'total_weight DECIMAL(12,3) NOT NULL, ' +
          'subject_count SMALLINT UNSIGNED NOT NULL, ' +
          'updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, ' +
          'PRIMARY KEY(group_name,owner_key), ' +
          'INDEX idx_weighted_group(group_name,semester,average_score)' +
          ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
        );
        await this.db.query(
          'CREATE TABLE IF NOT EXISTS campus_profile_avatars (' +
          'actor_key CHAR(64) NOT NULL PRIMARY KEY, ' +
          'group_name VARCHAR(60) NOT NULL, ' +
          'roster_key CHAR(64) NULL, ' +
          'avatar_id CHAR(36) NOT NULL UNIQUE, ' +
          'mime VARCHAR(24) NOT NULL, image_data LONGBLOB NOT NULL, ' +
          'updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, ' +
          'INDEX idx_profile_avatar_roster(group_name,roster_key)' +
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

  /**
   * Privacy-preserving personal rank by attendance among the imported group.
   * Importing the BARS roster alone does NOT reveal grades of classmates:
   * ranks only become meaningful after reviewed, closed CampusApp lessons.
   * Return only the authenticated student's own position, never peer names.
   */
  async personalAttendanceRank(actor: AttendanceIdentity) {
    await this.ensureSchema();
    const sync = await this.db.query(
      'SELECT student_count FROM campus_attendance_roster_sync ' +
      'WHERE group_name=? ORDER BY id DESC LIMIT 1', [actor.group],
    ) as Array<{student_count: number | string}>;
    if (!sync.length) {
      return {group: actor.group, imported: false, total: 0,
        rank: null, attended: 0, reviewedLessons: 0,
        metric: 'attendance'};
    }
    const rows = await this.db.query(
      'SELECT r.owner_key, ' +
      "COUNT(CASE WHEN l.id IS NOT NULL AND e.status IN ('present','absent') " +
      'THEN 1 END) AS reviewed_count, ' +
      "SUM(CASE WHEN l.id IS NOT NULL AND e.status='present' " +
      'THEN 1 ELSE 0 END) AS present_count ' +
      'FROM campus_attendance_roster r ' +
      'LEFT JOIN campus_attendance_entries e ON e.owner_key=r.owner_key ' +
      "LEFT JOIN campus_attendance_lessons l ON l.id=e.lesson_id " +
      "AND l.group_name=r.group_name AND l.state='closed' " +
      'WHERE r.group_name=? AND r.active=1 ' +
      'GROUP BY r.owner_key ORDER BY r.owner_key LIMIT 121',
      [actor.group],
    ) as Array<{
      owner_key: string; reviewed_count: number|string;
      present_count: number|string;
    }>;
    const mine = await this.ownRosterKey(actor);
    const results = rows.map(row => ({
      key: row.owner_key,
      reviewed: Math.max(0, Number(row.reviewed_count) || 0),
      present: Math.max(0, Number(row.present_count) || 0),
    }));
    const self = results.find(row => row.key === mine);
    let rank: number | null = null;
    if (self && self.reviewed > 0) {
      // Competition rank: tied attendance percentages share a place.
      rank = 1 + results.filter(row => row.reviewed > 0 &&
        row.present * self.reviewed > self.present * row.reviewed).length;
    }
    return {
      group: actor.group, imported: true, total: rows.length,
      rank, attended: self?.present ?? 0,
      reviewedLessons: self?.reviewed ?? 0,
      metric: 'attendance',
    };
  }


  /**
   * Ranking is based ONLY on voluntarily published numeric BARS current
   * scores, not attendance. These points are parsed from the student's local
   * BARS cache and are not server-verified. Never represent this as an
   * official MPEI ranking. Other students' score details are not exposed.
   */
  async publishBarsScore(actor: AttendanceIdentity, dto: PublishBarsRankingDto) {
    await this.ensureSchema();
    const mine = await this.ownRosterKey(actor);
    if (!mine) {
      throw new ForbiddenException(
        'Нет подтверждённой связи аккаунта со списком группы БАРС',
      );
    }
    // A BARS-proven starosta may have imported the group through the
    // earlier authenticated Flutter flow before server-side syncing existed.
    // Such imports have a roster_sync row, but no roster_verified marker.
    // The student's own active roster identity was already independently
    // matched by ownRosterKey above. Do not demand a second import.
    const imported = await this.db.query(
      'SELECT student_count FROM campus_attendance_roster_sync ' +
      'WHERE group_name=? ORDER BY id DESC LIMIT 1',
      [actor.group],
    ) as Array<{student_count: number|string}>;
    if (imported.length !== 1 || Number(imported[0].student_count) < 1) {
      throw new ForbiddenException(
        'Список группы ещё не загружен в CampusApp. ' +
        'Попроси старосту открыть журнал и загрузить группу.',
      );
    }
    const semester = this.clean(dto.semester);
    if (!semester || semester.length > 96 ||
        /[\x00-\x1f\x7f]/.test(semester)) {
      throw new BadRequestException('Неверный семестр');
    }
    if (!Array.isArray(dto.subjects) ||
        dto.subjects.length < 1 || dto.subjects.length > 400) {
      throw new BadRequestException('Нужны баллы хотя бы по одному предмету');
    }
    const names = new Set<string>();
    let weightedTotal = 0;
    let totalWeight = 0;
    for (const subject of dto.subjects) {
      const name = this.clean(subject.name).toLocaleLowerCase('ru-RU');
      const mark = subject.points;
      const weight = subject.weight;
      if (!name || name.length > 180 || names.has(name) ||
          typeof mark !== 'number' || !Number.isFinite(mark) ||
          mark < 2 || mark > 5 ||
          Math.round(mark * 100) / 100 !== mark ||
          typeof weight !== 'number' || !Number.isFinite(weight) ||
          weight <= 0 || weight > 100 ||
          Math.round(weight * 1000) / 1000 !== weight) {
        throw new BadRequestException('Некорректная оценка или её вес');
      }
      names.add(name);
      weightedTotal += mark * weight;
      totalWeight += weight;
    }
    if (totalWeight <= 0) {
      throw new BadRequestException('Не найдено корректных весов оценок');
    }
    const scoreTotal = Math.round(weightedTotal * 1000) / 1000;
    const averageScore = Math.round(weightedTotal / totalWeight * 100) / 100;
    await this.db.query(
      'INSERT INTO campus_weighted_grade_rankings ' +
      '(group_name,owner_key,semester,average_score,score_total,total_weight,subject_count) ' +
      'VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE ' +
      'semester=VALUES(semester),average_score=VALUES(average_score),' +
      'score_total=VALUES(score_total),total_weight=VALUES(total_weight),' +
      'subject_count=VALUES(subject_count),updated_at=CURRENT_TIMESTAMP',
      [actor.group, mine, semester, averageScore, scoreTotal,
        Math.round(totalWeight * 1000) / 1000, dto.subjects.length],
    );
    await this.db.query(
      'UPDATE campus_profile_avatars SET group_name=?, roster_key=? ' +
      'WHERE actor_key=?', [actor.group, mine, actor.ownerKey],
    );
    return {published:true, semester, subjectCount:dto.subjects.length,
      scoreTotal, totalWeight, averageScore,
      metric:'weighted_control_grades_2_5', source:'participant_submitted'};
  }

  async withdrawBarsScore(actor: AttendanceIdentity) {
    await this.ensureSchema();
    const mine = await this.ownRosterKey(actor);
    if (!mine) {
      return {withdrawn:true};
    }
    await this.db.query(
      'DELETE FROM campus_weighted_grade_rankings WHERE group_name=? AND owner_key=?',
      [actor.group, mine],
    );
    return {withdrawn:true};
  }

  async barsScoresRanking(actor: AttendanceIdentity, scope: string) {
    if (scope !== 'group' && scope !== 'stream') {
      throw new BadRequestException('Режим рейтинга: group или stream');
    }
    await this.ensureSchema();
    const mine = await this.ownRosterKey(actor);
    const stream = scope === 'stream';
    if (stream && !actor.group.startsWith('А-')) {
      throw new ForbiddenException(
        'Рейтинг потока доступен только студентам групп А-',
      );
    }
    // All and only A-... groups comprise the user-requested stream.
    // Other groups remain excluded even if their snapshots exist.
    const groupFilter = stream
      ? "r.group_name LIKE 'А-%'"
      : 'r.group_name=?';
    const filterParams = stream ? [] : [actor.group];
    const [rosterCount] = await this.db.query(
      'SELECT COUNT(*) AS total FROM campus_attendance_roster r ' +
      'WHERE r.active=1 AND EXISTS (' +
      'SELECT 1 FROM campus_attendance_roster_sync rs ' +
      'WHERE rs.group_name=r.group_name) AND ' + groupFilter,
      filterParams,
    ) as Array<{total:number|string}>;
    const ownRows = mine ? await this.db.query(
      'SELECT semester FROM campus_weighted_grade_rankings ' +
      'WHERE group_name=? AND owner_key=? LIMIT 1',
      [actor.group, mine],
    ) as Array<{semester:string}> : [];
    const newest = await this.db.query(
      'SELECT gr.semester FROM campus_weighted_grade_rankings gr ' +
      'JOIN campus_attendance_roster r ON r.group_name=gr.group_name ' +
      'AND r.owner_key=gr.owner_key AND r.active=1 ' +
      'WHERE EXISTS (SELECT 1 FROM campus_attendance_roster_sync rs ' +
      'WHERE rs.group_name=r.group_name) AND ' + groupFilter +
      ' ORDER BY gr.updated_at DESC LIMIT 1',
      filterParams,
    ) as Array<{semester:string}>;
    const semester = ownRows[0]?.semester ?? newest[0]?.semester ?? null;
    if (!semester) return {scope, group:actor.group, semester:null,
      total:Number(rosterCount?.total ?? 0), participants:0,
      myPlace:null, myAverage:null, published:false, entries:[],
      metric:'weighted_control_grades_2_5',source:'participant_submitted'};
    const entries = await this.db.query(
      'SELECT gr.owner_key, gr.group_name, r.display_name, ' +
      'gr.average_score, gr.subject_count, gr.score_total, a.avatar_id ' +
      'FROM campus_weighted_grade_rankings gr JOIN campus_attendance_roster r ' +
      'ON r.group_name=gr.group_name AND r.owner_key=gr.owner_key ' +
      'AND r.active=1 ' +
      'LEFT JOIN campus_profile_avatars a ' +
      'ON a.roster_key=gr.owner_key AND a.group_name=gr.group_name ' +
      'WHERE gr.semester=? AND ' + groupFilter +
      ' AND EXISTS (SELECT 1 FROM campus_attendance_roster_sync rs ' +
      'WHERE rs.group_name=r.group_name) ' +
      ' ORDER BY gr.average_score DESC, gr.owner_key ASC LIMIT 5000',
      [semester, ...filterParams],
    ) as Array<{
      owner_key:string; group_name:string; display_name:string;
      average_score:string|number; subject_count:string|number;
      score_total:string|number; avatar_id:string|null;
    }>;
    let previousScore: number | null = null;
    let currentPlace = 0;
    const leaderboard = entries.map((entry, index) => {
      const score = Number(entry.average_score);
      if (previousScore === null || score !== previousScore) {
        currentPlace = index + 1;
        previousScore = score;
      }
      return {
        place: currentPlace,
        displayName: entry.display_name,
        group: entry.group_name,
        averageScore: score,
        subjectCount: Number(entry.subject_count),
        avatarId: entry.avatar_id ?? null,
        mine: !!mine && entry.owner_key === mine &&
          entry.group_name === actor.group,
      };
    });
    const own = leaderboard.find(entry => entry.mine);
    return {
      scope, group:actor.group, semester,
      total:Number(rosterCount?.total ?? 0),
      participants:leaderboard.length,
      myPlace:own?.place ?? null,
      myAverage:own?.averageScore ?? null,
      published:!!own,
      entries:leaderboard,
      metric:'weighted_control_grades_2_5',source:'participant_submitted',
    };
  }

  /** Profile avatars are stored by the server's BARS-session actor key.
   * Do not trust an ownerKey supplied by Flutter or a guessed local path.
   */
  async uploadProfileAvatar(actor: AttendanceIdentity, file?: Express.Multer.File) {
    await this.ensureSchema();
    const bytes = file?.buffer;
    if (!bytes || bytes.length === 0 || bytes.length > 4 * 1024 * 1024) {
      throw new BadRequestException('Фото должно быть меньше 4 МБ');
    }
    // Whitelist real image signatures. Do not trust supplied Content-Type.
    const jpeg = bytes.length > 3 && bytes[0] === 0xff &&
      bytes[1] === 0xd8 && bytes[2] === 0xff;
    const png = bytes.length > 8 &&
      bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const webp = bytes.length > 12 &&
      bytes.toString('ascii',0,4) === 'RIFF' &&
      bytes.toString('ascii',8,12) === 'WEBP';
    const mime = jpeg ? 'image/jpeg' : png ? 'image/png' :
      webp ? 'image/webp' : null;
    if (!mime) {
      throw new BadRequestException('Поддерживаются только JPG, PNG и WebP');
    }
    const matchedRosterKey = await this.ownRosterKey(actor);
    const avatarId = randomUUID();
    await this.db.query(
      'INSERT INTO campus_profile_avatars ' +
      '(actor_key,group_name,roster_key,avatar_id,mime,image_data) ' +
      'VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE ' +
      'group_name=VALUES(group_name),roster_key=VALUES(roster_key),' +
      'avatar_id=VALUES(avatar_id),mime=VALUES(mime),' +
      'image_data=VALUES(image_data),updated_at=CURRENT_TIMESTAMP',
      [actor.ownerKey,actor.group,matchedRosterKey,avatarId,mime,bytes],
    );
    return {saved:true,avatarId};
  }

  async myProfileAvatar(actor: AttendanceIdentity) {
    await this.ensureSchema();
    const rows = await this.db.query(
      'SELECT image_data,mime FROM campus_profile_avatars ' +
      'WHERE actor_key=? LIMIT 1',
      [actor.ownerKey],
    ) as Array<{image_data:Buffer;mime:string}>;
    if (!rows.length) throw new NotFoundException('Аватарка не загружена');
    return {bytes:rows[0].image_data,mime:rows[0].mime};
  }

  async removeProfileAvatar(actor: AttendanceIdentity) {
    await this.ensureSchema();
    await this.db.query(
      'DELETE FROM campus_profile_avatars WHERE actor_key=?',
      [actor.ownerKey],
    );
    return {deleted:true};
  }

  async rankingProfileAvatar(actor: AttendanceIdentity, id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw new NotFoundException('Нет аватарки');
    }
    await this.ensureSchema();
    const rows = await this.db.query(
      'SELECT a.image_data,a.mime FROM campus_profile_avatars a ' +
      'INNER JOIN campus_weighted_grade_rankings gr ' +
      'ON gr.owner_key=a.roster_key AND gr.group_name=a.group_name ' +
      'WHERE a.avatar_id=? AND (a.group_name=? ' +
      "OR (?=1 AND a.group_name LIKE 'А-%')) LIMIT 1",
      [id,actor.group,actor.group.startsWith('А-') ? 1 : 0],
    ) as Array<{image_data:Buffer;mime:string}>;
    if (!rows.length) throw new NotFoundException('Нет аватарки');
    return {bytes:rows[0].image_data,mime:rows[0].mime};
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
    const verified = await this.db.query(
      'SELECT source FROM campus_attendance_roster_verified ' +
      'WHERE group_name=? LIMIT 1', [actor.group],
    ) as Array<{source: string}>;
    return {
      group: actor.group,
      students: students.map(row => ({
        ownerKey: row.owner_key, displayName: row.display_name,
      })),
      imported: syncRows.length > 0,
      importedAt: syncRows[0]?.created_at ?? null,
      verification: verified[0]?.source === 'backend_bars_verified'
        ? 'backend_bars_verified' : 'starosta_reviewed_bars_page',
    };
  }

  /** Server owns the browser, HTML parsing and database import. Raw BARS
   * credentials are used only for this request, never persisted to MySQL.
   */
  async syncFromBars(actor: AttendanceIdentity, cookies: string) {
    this.starosta(actor);
    const students = await this.barsRoster.fetch(cookies, actor.group);
    return this.importRoster(actor, {group: actor.group, students}, true);
  }

  async importRoster(
    actor: AttendanceIdentity, dto: AttendanceRosterImportDto,
    verifiedByServer = false,
  ) {
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
    const usedAccounts = new Set<string>();
    const prepared = dto.students.map(student => {
      const name = this.clean(student.fullName);
      if (name.length < 5 || name.length > 120 ||
          !/^[\p{L} .'-]+$/u.test(name) ||
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
      const email = student.email?.trim().toLowerCase() ?? '';
      if (email && !/^[a-z][a-z0-9_.-]{2,63}@mpei\.ru$/.test(email)) {
        throw new BadRequestException('Некорректная университетская почта');
      }
      const sourceHash = rosterIdentityHash(actor.group, 'student', source);
      const loginHash = rosterIdentityHash(actor.group, 'login',
        email ? email.slice(0, -'@mpei.ru'.length) : null);
      for (const match of [sourceHash, loginHash]) {
        if (match && usedAccounts.has(match)) {
          throw new BadRequestException(
            'У нескольких студентов совпадают идентификаторы БАРС',
          );
        }
        if (match) usedAccounts.add(match);
      }
      return { ownerKey: key, displayName: name, sourceHash, loginHash };
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
      await connection.execute(
        'DELETE FROM campus_attendance_roster_accounts WHERE group_name=?',
        [actor.group],
      );
      for (const row of prepared) {
        await connection.execute(
          'INSERT INTO campus_attendance_roster ' +
          '(group_name,owner_key,display_name,active) VALUES (?,?,?,1) ' +
          'ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),active=1',
          [actor.group, row.ownerKey, row.displayName],
        );
        await connection.execute(
          'INSERT INTO campus_attendance_roster_accounts ' +
          '(group_name,owner_key,source_hash,login_hash) VALUES (?,?,?,?)',
          [actor.group, row.ownerKey, row.sourceHash, row.loginHash],
        );
      }
      await connection.execute(
        'INSERT INTO campus_attendance_roster_sync ' +
        '(group_name,actor_key,student_count) VALUES (?,?,?)',
        [actor.group, actor.ownerKey, prepared.length],
      );
      if (verifiedByServer) {
        await connection.execute(
          'INSERT INTO campus_attendance_roster_verified ' +
          '(group_name,source) VALUES (?,?) ON DUPLICATE KEY UPDATE ' +
          'source=VALUES(source),verified_at=CURRENT_TIMESTAMP',
          [actor.group, 'backend_bars_verified'],
        );
      } else {
        await connection.execute(
          'DELETE FROM campus_attendance_roster_verified WHERE group_name=?',
          [actor.group],
        );
      }
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


  /**
   * Correct an accidental N after a journal was already saved.
   * A separate endpoint avoids reopening the lesson or overwriting the
   * remaining students. Lock the lesson and row; require the status that
   * the starosta saw, so simultaneous changes cannot be lost silently.
   * The previous and new marks are written to the audit trail.
   */
  async correctClosedAttendance(
    actor: AttendanceIdentity, id: number, dto: AttendanceCorrectionDto,
  ) {
    this.starosta(actor);
    await this.lesson(actor, id);
    return this.db.withTransaction(async connection => {
      const [lessonRows] = await connection.execute(
        'SELECT state FROM campus_attendance_lessons ' +
        'WHERE id=? AND group_name=? FOR UPDATE', [id, actor.group],
      );
      const state = lessonRows as unknown as Array<{state: string}>;
      if (state.length !== 1 || state[0].state !== 'closed') {
        throw new ConflictException(
          'Исправлять отметки можно только в сохранённом журнале',
        );
      }
      const [entryRows] = await connection.execute(
        'SELECT e.status FROM campus_attendance_entries e ' +
        'INNER JOIN campus_attendance_lesson_roster r ' +
        'ON r.lesson_id=e.lesson_id AND r.owner_key=e.owner_key ' +
        'WHERE e.lesson_id=? AND e.owner_key=? FOR UPDATE',
        [id, dto.ownerKey],
      );
      const entries = entryRows as unknown as Array<{status: string}>;
      if (entries.length !== 1 ||
          !['present', 'absent'].includes(entries[0].status)) {
        throw new ConflictException(
          'Нет подтверждённой отметки этого студента в журнале',
        );
      }
      const previous = entries[0].status;
      if (previous !== dto.expectedStatus) {
        throw new ConflictException(
          'Отметка уже изменена. Обнови журнал перед исправлением',
        );
      }
      if (previous === dto.status) {
        return {status: previous, changed: false};
      }
      await connection.execute(
        'UPDATE campus_attendance_entries SET status=?,reviewer_key=?,' +
        'updated_at=CURRENT_TIMESTAMP WHERE lesson_id=? AND owner_key=?',
        [dto.status, actor.ownerKey, id, dto.ownerKey],
      );
      await this.auditTransaction(
        connection, id, actor.ownerKey, dto.ownerKey,
        'correct', previous, dto.status,
      );
      return {status: dto.status, changed: true};
    });
  }

  /** Resolve only the current authenticated student's BARS identity.
   * Multiple matches fail closed to prevent displaying somebody else's N.
   */
  private async ownRosterKey(actor: AttendanceIdentity): Promise<string | null> {
    if (!actor.rosterStudentHash && !actor.rosterLoginHash) return null;
    const rows = await this.db.query(
      'SELECT r.owner_key FROM campus_attendance_roster r ' +
      'INNER JOIN campus_attendance_roster_accounts a ' +
      'ON a.group_name=r.group_name AND a.owner_key=r.owner_key ' +
      'WHERE r.group_name=? AND r.active=1 AND ' +
      '((a.source_hash IS NOT NULL AND a.source_hash=?) OR ' +
      '(a.login_hash IS NOT NULL AND a.login_hash=?)) LIMIT 3',
      [actor.group, actor.rosterStudentHash ?? '',
        actor.rosterLoginHash ?? ''],
    ) as Array<{ owner_key: string }>;
    return rows.length === 1 ? rows[0].owner_key : null;
  }

  async myAbsences(
    actor: AttendanceIdentity, fromRaw: string, toRaw: string,
  ) {
    await this.ensureSchema();
    const from = this.date(fromRaw);
    const to = this.date(toRaw);
    const days = (Date.parse(to + 'T00:00:00Z') -
      Date.parse(from + 'T00:00:00Z')) / 86400000;
    if (days < 0 || days > 42) {
      throw new BadRequestException('Выбери период не больше 43 дней');
    }
    const mine = await this.ownRosterKey(actor);
    if (!mine) return [];
    const rows = await this.db.query(
      'SELECT l.lesson_date,l.lesson_time,l.subject,l.lesson_type,l.room ' +
      'FROM campus_attendance_lessons l ' +
      'INNER JOIN campus_attendance_entries e ON e.lesson_id=l.id ' +
      'INNER JOIN campus_attendance_lesson_roster s ' +
      'ON s.lesson_id=l.id AND s.owner_key=e.owner_key ' +
      "WHERE l.group_name=? AND l.state='closed' " +
      "AND e.owner_key=? AND e.status='absent' " +
      'AND l.lesson_date BETWEEN ? AND ? ORDER BY l.lesson_date,l.lesson_time',
      [actor.group, mine, from, to],
    ) as Array<{
      lesson_date: string; lesson_time: string; subject: string;
      lesson_type: string; room: string;
    }>;
    return rows.map(row => ({
      date: row.lesson_date, time: row.lesson_time,
      subject: row.subject,
      type: row.lesson_type, room: row.room,
    }));
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
    const ownKey = await this.ownRosterKey(actor);
    const mine = studentEntries.find(row =>
      row.ownerKey === ownKey || row.ownerKey === actor.ownerKey);
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
