import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { DbService } from '../../db.service';
import { CreateGroupLessonNoteDto, LessonNoteScopeDto } from './lesson-notes.dto';
import { normalizedStudyGroup } from './lesson-group-normalizer';

type NoteRow = {
  id: number | string;
  group_name: string;
  lesson_date: string | Date;
  lesson_time: string;
  lesson_subject: string;
  content: string;
  owner_key: string;
  created_at: Date | string;
};

@Injectable()
export class LessonNotesService {
  constructor(private readonly db: DbService) {}

  private schema?: Promise<void>;
  private async ensureSchema(): Promise<void> {
    if (!this.schema) {
      this.schema = this.db.query(
        'CREATE TABLE IF NOT EXISTS campus_group_lesson_notes (' +
        'id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, ' +
        'group_name VARCHAR(60) NOT NULL, ' +
        'lesson_date VARCHAR(10) NOT NULL, ' +
        'lesson_time VARCHAR(60) NOT NULL, ' +
        'lesson_subject VARCHAR(180) NOT NULL, ' +
        'owner_key CHAR(64) NOT NULL, ' +
        'content VARCHAR(1500) NOT NULL, ' +
        'created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, ' +
        'INDEX idx_lesson (group_name, lesson_date, lesson_time, lesson_subject(80)), ' +
        'INDEX idx_owner (owner_key)' +
        ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
      ).then(() => undefined).catch(error => {
        this.schema = undefined;
        throw error;
      });
    }
    await this.schema;
  }

  private normalize(scope: LessonNoteScopeDto) {
    const group = normalizedStudyGroup(scope.group);
    const subject = scope.subject.replace(/\s+/g, ' ').trim();
    const time = scope.time.replace(/\s+/g, ' ').trim();
    const date = scope.date;
    if (!group || !subject || !time ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date + 'T00:00:00Z')) ||
        new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) {
      throw new BadRequestException('Некорректные данные пары');
    }
    return { group, subject, time, date };
  }

  private present(row: NoteRow, ownerKey?: string) {
    return {
      id: Number(row.id),
      content: row.content,
      isMine: !!ownerKey && row.owner_key === ownerKey,
      author: 'Студент',
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  async list(scope: LessonNoteScopeDto, ownerKey?: string) {
    const key = this.normalize(scope);
    await this.ensureSchema();
    const rows = await this.db.query(
      'SELECT id, owner_key, content, created_at FROM campus_group_lesson_notes ' +
      'WHERE group_name=? AND lesson_date=? AND lesson_time=? AND lesson_subject=? ' +
      'ORDER BY created_at DESC, id DESC LIMIT 100',
      [key.group, key.date, key.time, key.subject],
    ) as NoteRow[];
    return rows.map(row => this.present(row, ownerKey));
  }

  async create(dto: CreateGroupLessonNoteDto, ownerKey: string) {
    const key = this.normalize(dto);
    const content = dto.content.trim();
    if (!content || content.length > 1500) {
      throw new BadRequestException('Заметка должна содержать от 1 до 1500 символов');
    }
    await this.ensureSchema();
    const count = await this.db.query(
      'SELECT COUNT(*) AS total FROM campus_group_lesson_notes ' +
      'WHERE group_name=? AND lesson_date=? AND lesson_time=? ' +
      'AND lesson_subject=? AND owner_key=?',
      [key.group, key.date, key.time, key.subject, ownerKey],
    ) as Array<{total: string | number}>;
    if (Number(count[0]?.total ?? 0) >= 20) {
      throw new BadRequestException('Не более 20 заметок к паре');
    }
    const result = await this.db.query(
      'INSERT INTO campus_group_lesson_notes ' +
      '(group_name, lesson_date, lesson_time, lesson_subject, owner_key, content) ' +
      'VALUES (?,?,?,?,?,?)',
      [key.group, key.date, key.time, key.subject, ownerKey, content],
    ) as { insertId: number };
    const rows = await this.db.query(
      'SELECT id, owner_key, content, created_at ' +
      'FROM campus_group_lesson_notes WHERE id=? LIMIT 1',
      [result.insertId],
    ) as NoteRow[];
    return this.present(rows[0], ownerKey);
  }

  async remove(id: number, ownerKey: string, verifiedGroup: string) {
    await this.ensureSchema();
    const rows = await this.db.query(
      'SELECT owner_key, group_name FROM campus_group_lesson_notes WHERE id=? LIMIT 1',
      [id],
    ) as Array<{owner_key: string; group_name: string}>;
    if (!rows.length) throw new NotFoundException('Заметка не найдена');
    if (rows[0].owner_key !== ownerKey ||
      normalizedStudyGroup(rows[0].group_name) !== normalizedStudyGroup(verifiedGroup)) {
      throw new ForbiddenException('Удалить заметку может только её автор');
    }
    await this.db.query(
      'DELETE FROM campus_group_lesson_notes WHERE id=? AND owner_key=?',
      [id, ownerKey],
    );
    return { success: true };
  }
}
