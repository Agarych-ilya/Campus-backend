import {
  BadRequestException, ConflictException, ForbiddenException, Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import { basename, resolve, sep } from 'node:path';
import { DbService } from '../db.service';

export type CloudScope = 'private' | 'group' | 'public';
export type CloudViewer = { key?: string; group?: string };
type FileRow = {
  id: number; owner_key: string; name: string; path: string;
  mime: string; size_bytes: number; folder_id: number | null;
  visibility: CloudScope; group_code: string | null;
  share_hash: string | null; created_at: Date | string;
  saved_by_me?: number; saved_folder_id?: number | null;
};
type FolderRow = {
  id: number; owner_key: string; name: string;
  visibility: CloudScope; group_code: string | null;
  created_at: Date | string;
};

@Injectable()
export class CampusCloudService {
  constructor(private readonly db: DbService) {}
  private ready?: Promise<void>;
  private readonly storage = resolve(
    process.env.CAMPUS_CLOUD_STORAGE_DIR || 'cloud-private',
  );

  private ensure(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        await fs.mkdir(this.storage, { recursive: true });
        await this.db.query(
          'CREATE TABLE IF NOT EXISTS campus_cloud_folders (' +
          'id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, ' +
          'owner_key CHAR(64) NOT NULL, name VARCHAR(160) NOT NULL, ' +
          "visibility ENUM('private','group','public') NOT NULL DEFAULT 'private', " +
          'group_code VARCHAR(60) NULL, ' +
          'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, ' +
          'INDEX idx_cloud_folder_owner (owner_key)' +
          ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
        );
        await this.db.query(
          'CREATE TABLE IF NOT EXISTS campus_cloud_files (' +
          'id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, ' +
          'owner_key CHAR(64) NOT NULL, name VARCHAR(200) NOT NULL, ' +
          'path VARCHAR(500) NOT NULL, mime VARCHAR(120) NOT NULL, ' +
          'size_bytes BIGINT UNSIGNED NOT NULL, folder_id BIGINT UNSIGNED NULL, ' +
          "visibility ENUM('private','group','public') NOT NULL DEFAULT 'private', " +
          'group_code VARCHAR(60) NULL, share_hash CHAR(64) NULL, ' +
          'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, ' +
          'INDEX idx_cloud_owner (owner_key), ' +
          'INDEX idx_cloud_scope (visibility,group_code), ' +
          'INDEX idx_cloud_folder (folder_id), ' +
          'UNIQUE KEY uq_cloud_share (share_hash)' +
          ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
        );
        await this.db.query(
          'CREATE TABLE IF NOT EXISTS campus_cloud_folder_links (' +
          'folder_id BIGINT UNSIGNED NOT NULL PRIMARY KEY, ' +
          'share_hash CHAR(64) NOT NULL UNIQUE' +
          ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
        );
        await this.db.query(
          'CREATE TABLE IF NOT EXISTS campus_cloud_saved (' +
          'owner_key CHAR(64) NOT NULL, file_id BIGINT UNSIGNED NOT NULL, ' +
          'folder_id BIGINT UNSIGNED NULL, ' +
          'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, ' +
          'PRIMARY KEY (owner_key,file_id), INDEX idx_saved_file (file_id)' +
          ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
        );
      })().catch((error) => { this.ready = undefined; throw error; });
    }
    return this.ready;
  }

  private owner(viewer: CloudViewer): string {
    if (!viewer.key) throw new ForbiddenException('Для облака войди через БАРС');
    return viewer.key;
  }
  private group(viewer: CloudViewer): string {
    if (!viewer.group) {
      throw new ForbiddenException('БАРС не подтвердил твою учебную группу');
    }
    return viewer.group;
  }
  private name(value: unknown): string {
    const text = String(value ?? '').normalize('NFC').trim();
    if (!text || text.length > 160 || /[\x00-\x1f\x7f/\\]/.test(text) ||
        text === '.' || text === '..') {
      throw new BadRequestException('Некорректное название');
    }
    return text;
  }
  /** Multer/Busboy can decode multipart filename bytes as Latin-1.
   * Restore UTF-8 Cyrillic without corrupting names already decoded by a
   * client that supplies the correct Unicode filename.
   */
  private uploadName(raw: string): string {
    if (!raw) throw new BadRequestException('Файл без имени');
    let decoded = raw;
    if (/[ÐÑÃÂ]/.test(raw)) {
      const restored = Buffer.from(raw, 'latin1').toString('utf8');
      if (!restored.includes('\uFFFD') && restored !== raw) {
        decoded = restored;
      }
    }
    return this.name(decoded);
  }

  private scope(value: unknown): CloudScope {
    if (value !== 'private' && value !== 'group' && value !== 'public') {
      throw new BadRequestException('Выбери уровень доступа');
    }
    return value;
  }
  private id(value: unknown): number {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 1) {
      throw new BadRequestException('Некорректный идентификатор');
    }
    return n;
  }
  private canRead(row: FileRow | FolderRow, viewer: CloudViewer): boolean {
    return (Boolean(viewer.key) && row.owner_key === viewer.key) ||
      row.visibility === 'public' ||
      (row.visibility === 'group' && Boolean(viewer.group) &&
        row.group_code === viewer.group);
  }
  private async fileRow(id: number): Promise<FileRow> {
    await this.ensure();
    const rows = await this.db.query(
      'SELECT * FROM campus_cloud_files WHERE id=? LIMIT 1', [id],
    ) as FileRow[];
    if (!rows.length) throw new NotFoundException('Файл не найден');
    return rows[0];
  }
  private async folderRow(id: number): Promise<FolderRow> {
    await this.ensure();
    const rows = await this.db.query(
      'SELECT * FROM campus_cloud_folders WHERE id=? LIMIT 1', [id],
    ) as FolderRow[];
    if (!rows.length) throw new NotFoundException('Папка не найдена');
    return rows[0];
  }
  private async ownedFolder(value: unknown, viewer: CloudViewer): Promise<number | null> {
    if (value === null || value === undefined || value === '') return null;
    const id = this.id(value);
    const folder = await this.folderRow(id);
    if (folder.owner_key !== this.owner(viewer)) {
      throw new ForbiddenException('Нельзя использовать чужую папку');
    }
    return id;
  }
  private present(row: FileRow, viewer: CloudViewer) {
    const mine = Boolean(viewer.key) && row.owner_key === viewer.key;
    return {
      id: Number(row.id), name: row.name,
      mime: row.mime, size: Number(row.size_bytes),
      available: existsSync(row.path),
      folderId: mine ? row.folder_id : row.saved_folder_id ?? null,
      visibility: row.visibility, group: row.visibility === 'group' ?
        row.group_code : null,
      mine, saved: Boolean(row.saved_by_me),
      image: /^image\/(png|jpeg|webp|gif)$/.test(row.mime),
      createdAt: row.created_at,
    };
  }

  // Limits are enforced on upload and folder creation, not just in the UI.
  static readonly MAX_FILE_BYTES = 20 * 1024 * 1024;
  static readonly MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  static readonly MAX_STORAGE_BYTES = 500 * 1024 * 1024;
  static readonly MAX_FILES = 500;
  static readonly MAX_FOLDERS = 100;

  async quota(viewer: CloudViewer) {
    const owner = this.owner(viewer);
    await this.ensure();
    const [fileRows, folderRows] = await Promise.all([
      this.db.query(
        'SELECT COUNT(*) AS count,COALESCE(SUM(size_bytes),0) AS bytes ' +
        'FROM campus_cloud_files WHERE owner_key=?', [owner],
      ),
      this.db.query(
        'SELECT COUNT(*) AS count FROM campus_cloud_folders WHERE owner_key=?',
        [owner],
      ),
    ]);
    const files = fileRows as Array<{
      count: number | string; bytes: number | string;
    }>;
    const folders = folderRows as Array<{ count: number | string }>;
    return {
      usedBytes: Number(files[0]?.bytes ?? 0),
      usedFiles: Number(files[0]?.count ?? 0),
      usedFolders: Number(folders[0]?.count ?? 0),
      limits: {
        fileBytes: CampusCloudService.MAX_FILE_BYTES,
        imageBytes: CampusCloudService.MAX_IMAGE_BYTES,
        totalBytes: CampusCloudService.MAX_STORAGE_BYTES,
        files: CampusCloudService.MAX_FILES,
        folders: CampusCloudService.MAX_FOLDERS,
      },
    };
  }

  async folders(viewer: CloudViewer, mode = 'mine', rawQuery = '') {
    await this.ensure();
    const q = String(rawQuery).trim();
    if (q.length > 100) {
      throw new BadRequestException('Слишком длинный поиск');
    }
    if (mode === 'all') {
      const owner = this.owner(viewer);
      const params: unknown[] = [owner, viewer.group ?? ''];
      const filter = q
        ? ' AND LOWER(name) LIKE ?'
        : '';
      if (q) {
        const escaped = q.toLowerCase().replace(/[\\%_]/g, '\\$&');
        params.push('%' + escaped + '%');
      }
      const rows = await this.db.query(
        "SELECT * FROM campus_cloud_folders WHERE (owner_key=? " +
        "OR visibility='public' " +
        "OR (visibility='group' AND group_code=?)) " +
        filter + ' ORDER BY id DESC LIMIT 150',
        params,
      ) as FolderRow[];
      return rows.map(row => ({
        id: Number(row.id), name: row.name,
        visibility: row.visibility, group: row.group_code,
        mine: row.owner_key === owner,
      }));
    }
    if (mode !== 'mine' && mode !== 'discover') {
      throw new BadRequestException('Неверный каталог папок');
    }
    const own = mode === 'mine';
    if (own) {
      const owner = this.owner(viewer);
      const rows = await this.db.query(
        'SELECT * FROM campus_cloud_folders WHERE owner_key=? ORDER BY id DESC',
        [owner],
      ) as FolderRow[];
      return rows.map(row => ({
        id: Number(row.id), name: row.name,
        visibility: row.visibility, group: row.group_code,
        mine: true,
      }));
    }
    const rows = await this.db.query(
      "SELECT * FROM campus_cloud_folders WHERE visibility='public' " +
      "OR (visibility='group' AND group_code=?) ORDER BY id DESC LIMIT 80",
      [viewer.group ?? ''],
    ) as FolderRow[];
    return rows.map(row => ({
      id: Number(row.id), name: row.name,
      visibility: row.visibility, group: row.group_code,
      mine: Boolean(viewer.key) && viewer.key === row.owner_key,
    }));
  }

  async list(viewer: CloudViewer, query: {
    mode?: string; q?: string; folderId?: string;
  }) {
    await this.ensure();
    const mode = query.mode ?? 'mine';
    if (!['mine', 'discover', 'search'].includes(mode)) {
      throw new BadRequestException('Неверный раздел облака');
    }
    const q = String(query.q ?? '').trim();
    if (q.length > 100) throw new BadRequestException('Слишком длинный поиск');
    const owner = mode === 'mine' ? this.owner(viewer) : viewer.key ?? '';
    const group = viewer.group ?? '';
    const conditions: string[] = [];
    const params: unknown[] = [viewer.key ?? ''];
    const visibility = "(f.visibility='public' OR " +
      "(f.visibility='group' AND f.group_code=?) OR f.owner_key=?)";
    if (mode === 'mine') {
      conditions.push('(f.owner_key=? OR (s.owner_key IS NOT NULL AND ' +
        visibility + '))');
      params.push(owner, group, owner);
    } else {
      conditions.push(visibility);
      params.push(group, owner);
      if (mode === 'discover') {
        conditions.push('f.owner_key<>?');
        params.push(owner);
      }
    }
    if (q) {
      conditions.push('LOWER(f.name) LIKE ?');
      params.push('%' + q.toLowerCase().replace(/[%_\\]/g, '\\$&') + '%');
    }
    // In the default root view show folders rather than flattening their files.
    // A saved foreign file without a personal folder is a root-level bookmark.
    if (!q && mode === 'search' &&
        (query.folderId === undefined || query.folderId === '')) {
      conditions.push(
        '(f.folder_id IS NULL OR ' +
        '(s.owner_key IS NOT NULL AND s.folder_id IS NULL))',
      );
    }
    if (query.folderId !== undefined && query.folderId !== '') {
      const folderId = this.id(query.folderId);
      const folder = await this.folderRow(folderId);
      if (mode === 'mine' && folder.owner_key !== owner) {
        throw new ForbiddenException('Чужая папка');
      }
      if (mode !== 'mine' && !this.canRead(folder, viewer)) {
        throw new NotFoundException('Папка недоступна');
      }
      if (mode === 'mine') {
        conditions.push(
          'COALESCE(IF(f.owner_key=?, f.folder_id, s.folder_id),0)=?',
        );
        params.push(owner, folderId);
      } else if (folder.owner_key === viewer.key) {
        // The user's folder can also contain bookmarks of accessible files.
        conditions.push(
          '(f.folder_id=? OR (s.owner_key IS NOT NULL AND s.folder_id=?))',
        );
        params.push(folderId, folderId);
      } else {
        conditions.push('f.folder_id=?');
        params.push(folderId);
      }
    }
    const rows = await this.db.query(
      'SELECT f.*, IF(s.owner_key IS NULL,0,1) AS saved_by_me, ' +
      's.folder_id AS saved_folder_id FROM campus_cloud_files f ' +
      'LEFT JOIN campus_cloud_saved s ON s.file_id=f.id AND s.owner_key=? ' +
      'WHERE ' + conditions.join(' AND ') +
      ' ORDER BY f.id DESC LIMIT 150',
      params,
    ) as FileRow[];
    return rows.map(row => this.present(row, viewer));
  }

  async createFolder(viewer: CloudViewer, body: any) {
    await this.ensure();
    const owner = this.owner(viewer);
    const visibility = this.scope(body?.visibility ?? 'private');
    const group = visibility === 'group' ? this.group(viewer) : null;
    const name = this.name(body?.name);
    const existing = await this.db.query(
      'SELECT COUNT(*) AS count FROM campus_cloud_folders WHERE owner_key=?',
      [owner],
    ) as Array<{ count: number }>;
    if (Number(existing[0]?.count ?? 0) >= CampusCloudService.MAX_FOLDERS) {
      throw new BadRequestException('Не больше 100 папок на пользователя');
    }
    const result = await this.db.query(
      'INSERT INTO campus_cloud_folders ' +
      '(owner_key,name,visibility,group_code) VALUES (?,?,?,?)',
      [owner, name, visibility, group],
    ) as { insertId: number };
    return { id: Number(result.insertId), name, visibility, group };
  }

  /**
   * Manifest for a private on-device copy. Bookmarks are copied too, but
   * foreign originals are never deleted by this user's migration.
   */
  private readonly migrationQuery =
    'SELECT f.id,f.name,f.size_bytes,f.path,f.owner_key,f.visibility,' +
    'f.group_code FROM campus_cloud_files f WHERE ' +
    '(f.owner_key=? AND f.folder_id=?) OR EXISTS (' +
    'SELECT 1 FROM campus_cloud_saved s WHERE s.file_id=f.id ' +
    'AND s.owner_key=? AND s.folder_id=?) ' +
    'ORDER BY f.id LIMIT 501';

  private validateMigrationRows(rows: Array<{
    id: number | string; owner_key: string;
    visibility: CloudScope; group_code: string | null;
    size_bytes: number | string; name: string; path: string;
  }>, viewer: CloudViewer) {
    if (rows.length > 500) {
      throw new BadRequestException('В папке слишком много файлов для переноса');
    }
    for (const file of rows) {
      if (!this.canRead({
        ...file, id: Number(file.id), folder_id: null,
        mime: '', share_hash: null, created_at: '',
        size_bytes: Number(file.size_bytes),
      }, viewer)) {
        throw new ConflictException(
          'Некоторые сохранённые материалы больше не доступны. ' +
          'Удали недоступные ярлыки из папки и повтори перенос',
        );
      }
    }
  }

  async migrationManifest(viewer: CloudViewer, id: number) {
    const folder = await this.folderRow(id);
    if (folder.owner_key !== this.owner(viewer)) {
      throw new ForbiddenException('Перенести можно только свою папку');
    }
    const rows = await this.db.query(this.migrationQuery,
      [viewer.key, id, viewer.key, id]) as Array<{
      id: number | string; name: string; size_bytes: number | string;
      path: string; owner_key: string; visibility: CloudScope;
      group_code: string | null;
    }>;
    this.validateMigrationRows(rows, viewer);
    return {
      folderId: id,
      name: folder.name,
      files: rows.map(file => ({
        id: Number(file.id), name: file.name,
        size: Number(file.size_bytes),
        owned: file.owner_key === viewer.key,
      })),
    };
  }

  /**
   * Finalize only after Flutter has verified *every* local copy. The exact
   * server IDs must still match the manifest; otherwise nothing is deleted.
   * All DB revocations, bookmarks and file metadata are removed together.
   */
  async finishFolderMigration(viewer: CloudViewer, id: number, body: any) {
    const owner = this.owner(viewer);
    await this.ensure();
    const received: unknown = body?.fileIds;
    if (!Array.isArray(received) || received.length > 500 ||
        received.some(value => !Number.isSafeInteger(value) || value < 1) ||
        new Set(received).size !== received.length) {
      throw new BadRequestException('Некорректный список перенесённых файлов');
    }
    const requestedIds = (received as number[]).slice()
      .sort((a, b) => a - b);
    const pathsToClean = await this.db.withTransaction(async connection => {
      const [folderResult] = await connection.execute(
        'SELECT owner_key FROM campus_cloud_folders ' +
        'WHERE id=? FOR UPDATE', [id],
      );
      const folders = folderResult as Array<{owner_key: string}>;
      if (!folders.length) {
        throw new NotFoundException('Папка уже недоступна');
      }
      if (folders[0].owner_key !== owner) {
        throw new ForbiddenException('Чужая папка');
      }
      const [fileResult] = await connection.execute(
        this.migrationQuery, [owner, id, owner, id],
      );
      const rows = fileResult as Array<{
        id: number | string; name: string; size_bytes: number | string;
        path: string; owner_key: string; visibility: CloudScope;
        group_code: string | null;
      }>;
      this.validateMigrationRows(rows, viewer);
      const currentIds = rows.map(row => Number(row.id))
        .sort((a,b) => a-b);
      if (currentIds.length !== requestedIds.length ||
          currentIds.some((item, index) => item !== requestedIds[index])) {
        throw new ConflictException(
          'Состав папки изменился. Обнови её и повтори перенос без удаления файлов',
        );
      }

      const owned = rows.filter(row => row.owner_key === owner);
      const ownIds = owned.map(row => Number(row.id));
      // Remove bookmarks inside this folder, including foreign-file links.
      const [removedBookmarkResult] = await connection.execute(
        'DELETE FROM campus_cloud_saved WHERE owner_key=? AND folder_id=?',
        [owner, id],
      );
      const bookmarkCount = rows.filter(row => row.owner_key !== owner).length;
      if ((removedBookmarkResult as {affectedRows: number}).affectedRows !==
          bookmarkCount) {
        throw new ConflictException(
          'Состав сохранённых файлов изменился. Повтори перенос',
        );
      }
      if (ownIds.length) {
        const placeholders = ownIds.map(() => '?').join(',');
        // Invalidate any other student's bookmarks of the owner's files.
        await connection.execute(
          'DELETE FROM campus_cloud_saved WHERE file_id IN (' +
          placeholders + ')', ownIds,
        );
      }
      // Deleting files invalidates individual share URLs immediately.
      const [removedFilesResult] = await connection.execute(
        'DELETE FROM campus_cloud_files ' +
        'WHERE owner_key=? AND folder_id=?', [owner, id],
      );
      if ((removedFilesResult as {affectedRows: number}).affectedRows !==
          owned.length) {
        throw new ConflictException(
          'Состав файлов изменился во время переноса. Повтори операцию',
        );
      }
      // The folder token must be revoked in the same DB transaction.
      await connection.execute(
        'DELETE FROM campus_cloud_folder_links WHERE folder_id=?', [id],
      );
      await connection.execute(
        'DELETE FROM campus_cloud_folders WHERE id=? AND owner_key=?',
        [id, owner],
      );
      return owned.map(row => row.path);
    });

    // Physical content is not exposed by the API after the transaction.
    // A filesystem failure leaves an orphan to clean, never an accessible file.
    for (const path of pathsToClean) {
      const full = resolve(path);
      if (full.startsWith(this.storage + sep)) {
        await fs.unlink(full).catch(() => undefined);
      }
    }
    return {
      migrated: true, deleted: pathsToClean.length,
      revoked: true,
    };
  }

  async updateFolder(viewer: CloudViewer, id: number, body: any) {
    const folder = await this.folderRow(id);
    if (folder.owner_key !== this.owner(viewer)) {
      throw new ForbiddenException('Чужая папка');
    }
    const visibility = body?.visibility !== undefined
      ? this.scope(body.visibility) : folder.visibility;
    const group = visibility === 'group' ? this.group(viewer) : null;
    const name = body?.name === undefined ? folder.name : this.name(body.name);
    // Folder ACL and ALL owned child file ACLs change in one transaction.
    // A partial DB failure must never leave private files shared or vice versa.
    if (visibility !== folder.visibility || group !== folder.group_code) {
      await this.db.withTransaction(async connection => {
        if (visibility !== 'private') {
          // Saved foreign bookmarks belong to their original authors. A
          // folder's owner cannot override those file permissions.
          const [linkedResult] = await connection.execute(
            'SELECT COUNT(*) AS total FROM campus_cloud_saved ' +
            'WHERE owner_key=? AND folder_id=?',
            [viewer.key, id],
          );
          const linkedRows = linkedResult as Array<{ total: number | string }>;
          if (Number(linkedRows[0]?.total ?? 0) > 0) {
            throw new BadRequestException(
              'В папке есть сохранённые чужие материалы. ' +
              'Убери их из папки перед изменением доступа',
            );
          }
        }
        await connection.execute(
          'UPDATE campus_cloud_folders SET name=?,visibility=?,group_code=? ' +
          'WHERE id=? AND owner_key=?',
          [name, visibility, group, id, viewer.key],
        );
        await connection.execute(
          'UPDATE campus_cloud_files SET visibility=?,group_code=?,share_hash=NULL ' +
          'WHERE owner_key=? AND folder_id=?',
          [visibility, group, viewer.key, id],
        );
        if (visibility === 'private') {
          await connection.execute(
            'DELETE FROM campus_cloud_folder_links WHERE folder_id=?', [id],
          );
        }
      });
    } else if (name !== folder.name) {
      await this.db.query(
        'UPDATE campus_cloud_folders SET name=? WHERE id=? AND owner_key=?',
        [name, id, viewer.key],
      );
    }
    return { id, name, visibility, group };
  }

  async deleteFolder(viewer: CloudViewer, id: number) {
    const folder = await this.folderRow(id);
    if (folder.owner_key !== this.owner(viewer)) {
      throw new ForbiddenException('Чужая папка');
    }
    const files = await this.db.query(
      'SELECT id FROM campus_cloud_files WHERE folder_id=? LIMIT 1', [id],
    ) as Array<{ id: number }>;
    if (files.length) {
      throw new BadRequestException('Сначала перемести файлы из папки');
    }
    await this.db.query(
      'UPDATE campus_cloud_saved SET folder_id=NULL WHERE folder_id=? AND owner_key=?',
      [id, viewer.key],
    );
    await this.db.query(
      'DELETE FROM campus_cloud_folder_links WHERE folder_id=?', [id],
    );
    await this.db.query('DELETE FROM campus_cloud_folders WHERE id=?', [id]);
    return { deleted: true };
  }

  async upload(viewer: CloudViewer, uploaded: Express.Multer.File, body: any) {
    try {
      await this.ensure();
      if (!uploaded || !uploaded.size || uploaded.size > CampusCloudService.MAX_FILE_BYTES) {
        throw new BadRequestException('Файл должен быть не больше 20 МБ');
      }
      const owner = this.owner(viewer);
      const usage = await this.db.query(
        'SELECT COUNT(*) AS count,COALESCE(SUM(size_bytes),0) AS bytes ' +
        'FROM campus_cloud_files WHERE owner_key=?', [owner],
      ) as Array<{ count: number; bytes: number }>;
      if (Number(usage[0]?.count ?? 0) >= CampusCloudService.MAX_FILES ||
          Number(usage[0]?.bytes ?? 0) + uploaded.size >
            CampusCloudService.MAX_STORAGE_BYTES) {
        throw new BadRequestException('Лимит облака: 500 файлов или 500 МБ');
      }
      const name = this.uploadName(uploaded.originalname);
      const folderId = await this.ownedFolder(body?.folderId, viewer);
      const folder = folderId ? await this.folderRow(folderId) : null;
      const visibility = folder ? folder.visibility
        : this.scope(body?.visibility ?? 'private');
      const group = visibility === 'group' ? this.group(viewer) : null;
      const mime = this.sniffMime(await fs.readFile(uploaded.path), uploaded.mimetype);
      if (mime.startsWith('image/') && uploaded.size > CampusCloudService.MAX_IMAGE_BYTES) {
        throw new BadRequestException('Изображения — максимум 5 МБ');
      }
      const result = await this.db.query(
        'INSERT INTO campus_cloud_files ' +
        '(owner_key,name,path,mime,size_bytes,folder_id,visibility,group_code) ' +
        'VALUES (?,?,?,?,?,?,?,?)',
        [owner, name, uploaded.path, mime, uploaded.size,
          folderId, visibility, group],
      ) as { insertId: number };
      return {
        id: Number(result.insertId), name, size: uploaded.size,
        visibility, folderId,
      };
    } catch (error) {
      if (uploaded?.path) await fs.unlink(uploaded.path).catch(() => undefined);
      throw error;
    }
  }

  private sniffMime(bytes: Buffer, claimed: string): string {
    if (bytes.length >= 8 &&
        bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
      return 'image/png';
    if (bytes.length >= 3 && bytes[0] === 0xff &&
        bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes.length >= 12 && bytes.toString('ascii',0,4) === 'RIFF' &&
        bytes.toString('ascii',8,12) === 'WEBP') return 'image/webp';
    if (bytes.length >= 6 && ['GIF87a','GIF89a'].includes(
      bytes.toString('ascii',0,6))) return 'image/gif';
    // Reject spoofed image MIME types; all other types download as attachments.
    if (claimed?.startsWith('image/')) return 'application/octet-stream';
    return /^[\w.+-]+\/[\w.+-]+$/.test(claimed ?? '') ?
      claimed : 'application/octet-stream';
  }

  async read(id: number, viewer: CloudViewer) {
    const row = await this.fileRow(id);
    if (!this.canRead(row, viewer)) throw new NotFoundException('Файл недоступен');
    return this.diskFile(row);
  }
  private diskFile(row: FileRow) {
    const full = resolve(row.path);
    if (!full.startsWith(this.storage + sep) ||
        basename(full).length < 10 || !existsSync(full)) {
      throw new NotFoundException('Файл отсутствует на сервере');
    }
    return { path: full, name: row.name, mime: row.mime };
  }
  async preview(id: number, viewer: CloudViewer) {
    const row = await this.fileRow(id);
    if (!this.canRead(row, viewer)) throw new NotFoundException('Файл недоступен');
    if (!/^image\/(png|jpeg|webp|gif)$/.test(row.mime)) {
      throw new BadRequestException('Превью доступно только для изображений');
    }
    return this.diskFile(row);
  }

  async save(viewer: CloudViewer, id: number, body: any) {
    const owner = this.owner(viewer);
    const file = await this.fileRow(id);
    if (file.owner_key === owner) return { saved: true, alreadyMine: true };
    if (!this.canRead(file, viewer)) throw new NotFoundException('Файл недоступен');
    const folderId = await this.ownedFolder(body?.folderId, viewer);
    await this.db.query(
      'INSERT INTO campus_cloud_saved (owner_key,file_id,folder_id) VALUES (?,?,?) ' +
      'ON DUPLICATE KEY UPDATE folder_id=VALUES(folder_id)',
      [owner, id, folderId],
    );
    return { saved: true };
  }
  async unsave(viewer: CloudViewer, id: number) {
    const owner = this.owner(viewer);
    await this.db.query(
      'DELETE FROM campus_cloud_saved WHERE owner_key=? AND file_id=?',
      [owner, id],
    );
    return { saved: false };
  }

  async move(viewer: CloudViewer, id: number, body: any) {
    const owner = this.owner(viewer);
    const file = await this.fileRow(id);
    const folderId = await this.ownedFolder(body?.folderId, viewer);
    if (file.owner_key === owner) {
      const folder = folderId ? await this.folderRow(folderId) : null;
      const visibility = folder?.visibility ?? file.visibility;
      const group = folder
        ? visibility === 'group' ? this.group(viewer) : null : file.group_code;
      await this.db.query(
        'UPDATE campus_cloud_files SET folder_id=?,visibility=?,group_code=?,share_hash=NULL ' +
        'WHERE id=? AND owner_key=?',
        [folderId, visibility, group, id, owner],
      );
    } else {
      if (folderId != null) {
        const target = await this.folderRow(folderId);
        if (target.visibility !== 'private') {
          throw new BadRequestException(
            'Чужие сохранённые файлы нельзя перемещать в общую папку',
          );
        }
      }
      const saved = await this.db.query(
        'SELECT file_id FROM campus_cloud_saved ' +
        'WHERE file_id=? AND owner_key=? LIMIT 1', [id, owner],
      ) as Array<{ file_id: number }>;
      if (!saved.length || !this.canRead(file, viewer)) {
        throw new NotFoundException('Файл не сохранён');
      }
      await this.db.query(
        'UPDATE campus_cloud_saved SET folder_id=? ' +
        'WHERE file_id=? AND owner_key=?', [folderId, id, owner],
      );
    }
    return { moved: true };
  }

  async renameFile(viewer: CloudViewer, id: number, body: any) {
    const owner = this.owner(viewer);
    const file = await this.fileRow(id);
    if (file.owner_key !== owner) {
      throw new ForbiddenException('Переименовать файл может только владелец');
    }
    const nextName = this.name(body?.name);
    const ext = (name: string) => {
      const index = name.lastIndexOf('.');
      return index < 0 ? '' : name.slice(index).toLowerCase();
    };
    if (ext(file.name) !== ext(nextName)) {
      throw new BadRequestException('Расширение файла менять нельзя');
    }
    await this.db.query(
      'UPDATE campus_cloud_files SET name=? WHERE id=? AND owner_key=?',
      [nextName, id, owner],
    );
    return { id, name: nextName };
  }

  async createFolderLink(viewer: CloudViewer, rawId: number) {
    const folder = await this.folderRow(rawId);
    if (folder.owner_key !== this.owner(viewer)) {
      throw new ForbiddenException('Ссылку создаёт только владелец папки');
    }
    if (folder.visibility === 'private') {
      throw new ForbiddenException('Личная папка не доступна по ссылке');
    }
    const token = randomBytes(32).toString('base64url');
    await this.db.query(
      'INSERT INTO campus_cloud_folder_links (folder_id,share_hash) ' +
      'VALUES (?,?) ON DUPLICATE KEY UPDATE share_hash=VALUES(share_hash)',
      [rawId, this.hash(token)],
    );
    return { token };
  }

  async revokeFolderLink(viewer: CloudViewer, rawId: number) {
    const folder = await this.folderRow(rawId);
    if (folder.owner_key !== this.owner(viewer)) {
      throw new ForbiddenException('Отозвать ссылку может только владелец');
    }
    await this.db.query(
      'DELETE FROM campus_cloud_folder_links WHERE folder_id=?', [rawId],
    );
    return { revoked: true };
  }

  private async sharedFolder(token: string): Promise<FolderRow> {
    if (!/^[A-Za-z0-9_-]{35,80}$/.test(token)) {
      throw new NotFoundException('Ссылка на папку недействительна');
    }
    await this.ensure();
    const rows = await this.db.query(
      'SELECT f.* FROM campus_cloud_folders f ' +
      'JOIN campus_cloud_folder_links l ON l.folder_id=f.id ' +
      'WHERE l.share_hash=? LIMIT 1', [this.hash(token)],
    ) as FolderRow[];
    if (!rows.length) {
      throw new NotFoundException('Ссылка на папку отозвана');
    }
    return rows[0];
  }

  async listSharedFolder(token: string) {
    const folder = await this.sharedFolder(token);
    const files = await this.db.query(
      'SELECT id,name,size_bytes FROM campus_cloud_files ' +
      'WHERE folder_id=? AND owner_key=? ORDER BY name LIMIT 500',
      [folder.id, folder.owner_key],
    ) as Array<{ id: number; name: string; size_bytes: number }>;
    return {
      name: folder.name,
      files: files.map(item => ({
        id: Number(item.id),
        name: item.name,
        size: Number(item.size_bytes),
      })),
    };
  }

  async readSharedFolderFile(token: string, rawId: number) {
    const folder = await this.sharedFolder(token);
    const file = await this.fileRow(rawId);
    if (Number(file.folder_id) !== Number(folder.id) ||
        file.owner_key !== folder.owner_key) {
      throw new NotFoundException('Файл отсутствует в этой папке');
    }
    return this.diskFile(file);
  }

  async changeVisibility(viewer: CloudViewer, id: number, body: any) {
    const owner = this.owner(viewer);
    const file = await this.fileRow(id);
    if (file.owner_key !== owner) {
      throw new ForbiddenException('Нельзя менять доступ к чужому файлу');
    }
    const visibility = this.scope(body?.visibility);
    if (file.folder_id != null) {
      throw new BadRequestException(
        'Файл находится в папке. Меняй доступ для всей папки',
      );
    }
    const group = visibility === 'group' ? this.group(viewer) : null;
    // A visibility change invalidates any previously distributed secret link.
    await this.db.query(
      'UPDATE campus_cloud_files SET visibility=?,group_code=?,share_hash=NULL ' +
      'WHERE id=? AND owner_key=?', [visibility, group, id, owner],
    );
    return { visibility, group };
  }

  async createLink(viewer: CloudViewer, id: number) {
    const owner = this.owner(viewer);
    const file = await this.fileRow(id);
    if (file.owner_key !== owner) {
      throw new ForbiddenException('Ссылку создаёт только владелец файла');
    }
    if (file.visibility === 'private') {
      throw new ForbiddenException('Личный файл не доступен по ссылке');
    }
    const token = randomBytes(32).toString('base64url');
    await this.db.query(
      'UPDATE campus_cloud_files SET share_hash=? WHERE id=? AND owner_key=?',
      [this.hash(token), id, owner],
    );
    return { token };
  }
  async revokeLink(viewer: CloudViewer, id: number) {
    const owner = this.owner(viewer);
    const file = await this.fileRow(id);
    if (file.owner_key !== owner) {
      throw new ForbiddenException('Ссылку отзывает только владелец');
    }
    await this.db.query(
      'UPDATE campus_cloud_files SET share_hash=NULL WHERE id=? AND owner_key=?',
      [id, owner],
    );
    return { revoked: true };
  }
  private hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
  async readLink(token: string) {
    if (!/^[A-Za-z0-9_-]{35,80}$/.test(token)) {
      throw new NotFoundException('Ссылка не найдена');
    }
    await this.ensure();
    const rows = await this.db.query(
      'SELECT * FROM campus_cloud_files WHERE share_hash=? LIMIT 1',
      [this.hash(token)],
    ) as FileRow[];
    if (!rows.length) throw new NotFoundException('Ссылка недействительна');
    return this.diskFile(rows[0]);
  }

  async remove(viewer: CloudViewer, id: number) {
    const owner = this.owner(viewer);
    const file = await this.fileRow(id);
    if (file.owner_key !== owner) {
      return this.unsave(viewer, id);
    }
    // DB changes before physical deletion mean a failed unlink cannot
    // accidentally expose metadata. The orphan can be cleaned up later.
    await this.db.query(
      'DELETE FROM campus_cloud_saved WHERE file_id=?', [id],
    );
    await this.db.query(
      'DELETE FROM campus_cloud_files WHERE id=? AND owner_key=?',
      [id, owner],
    );
    const full = resolve(file.path);
    if (full.startsWith(this.storage + sep)) {
      await fs.unlink(full).catch(() => undefined);
    }
    return { deleted: true };
  }
}
