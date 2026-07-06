import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { createReadStream, existsSync } from 'fs';
import { mkdir, stat, unlink, writeFile } from 'fs/promises';
import { basename, extname, resolve } from 'path';

import { DbService } from '../db.service';

type CloudFileRow = {
  id: number;
  name: string;
  path: string;
};

type SavedFile = {
  id: number;
  name: string;
  path: string;
};

type FileInfo = {
  id: number;
  name: string;
  path: string;
  size: number;
};

@Injectable()
export class FileService {
  private readonly cloudFolder = resolve(process.cwd(), 'cloud');

  constructor(private readonly dbService: DbService) { }

  async saveFile(file: Express.Multer.File): Promise<SavedFile> {
    await this.ensureCloudFolderExists();

    const originalName = this.getSafeFileName(file.originalname);
    const savedName = this.createSavedFileName(originalName);
    const absolutePath = resolve(this.cloudFolder, savedName);
    const relativePath = `cloud/${savedName}`;

    await writeFile(absolutePath, file.buffer);

    const result = await this.dbService.query(
      'INSERT INTO cloud (name, path) VALUES (?, ?)',
      [originalName, relativePath],
    );

    const id = this.getInsertId(result);

    return {
      id,
      name: originalName,
      path: relativePath,
    };
  }

  async getFiles(): Promise<FileInfo[]> {
    const rows = await this.getCloudRows(
      'SELECT id, name, path FROM cloud ORDER BY id DESC',
      [],
    );

    const files: FileInfo[] = [];

    for (const row of rows) {
      const absolutePath = this.getAbsolutePath(row.path);

      let size = 0;

      if (existsSync(absolutePath)) {
        const fileStat = await stat(absolutePath);
        size = fileStat.size;
      }

      files.push({
        id: row.id,
        name: row.name,
        path: row.path,
        size,
      });
    }

    return files;
  }

  async getFileInfo(id: number): Promise<FileInfo> {
    const file = await this.getFileRowById(id);
    const absolutePath = this.getAbsolutePath(file.path);

    if (!existsSync(absolutePath)) {
      throw new NotFoundException('Файл отсутствует на диске');
    }

    const fileStat = await stat(absolutePath);

    return {
      id: file.id,
      name: file.name,
      path: file.path,
      size: fileStat.size,
    };
  }

  async getFileForDownload(id: number) {
    const file = await this.getFileRowById(id);
    const absolutePath = this.getAbsolutePath(file.path);

    if (!existsSync(absolutePath)) {
      throw new NotFoundException('Файл отсутствует на диске');
    }

    return {
      name: file.name,
      stream: createReadStream(absolutePath),
    };
  }

  async deleteFile(id: number): Promise<void> {
    const file = await this.getFileRowById(id);
    const absolutePath = this.getAbsolutePath(file.path);

    if (existsSync(absolutePath)) {
      await unlink(absolutePath);
    }

    await this.dbService.query(
      'DELETE FROM cloud WHERE id = ?',
      [id],
    );
  }

  private async getFileRowById(id: number): Promise<CloudFileRow> {
    const rows = await this.getCloudRows(
      'SELECT id, name, path FROM cloud WHERE id = ? LIMIT 1',
      [id],
    );

    if (rows.length === 0) {
      throw new NotFoundException('Файл не найден');
    }

    return rows[0];
  }

  private async getCloudRows(
    query: string,
    params: unknown[],
  ): Promise<CloudFileRow[]> {
    const result = await this.dbService.query(query, params);

    if (Array.isArray(result) && Array.isArray(result[0])) {
      return result[0] as CloudFileRow[];
    }

    if (Array.isArray(result)) {
      return result as CloudFileRow[];
    }

    return [];
  }

  private getInsertId(result: unknown): number {
    if (
      typeof result === 'object' &&
      result !== null &&
      'insertId' in result &&
      typeof result.insertId === 'number'
    ) {
      return result.insertId;
    }

    if (
      Array.isArray(result) &&
      result.length > 0 &&
      typeof result[0] === 'object' &&
      result[0] !== null &&
      'insertId' in result[0] &&
      typeof result[0].insertId === 'number'
    ) {
      return result[0].insertId;
    }

    return 0;
  }

  private async ensureCloudFolderExists(): Promise<void> {
    await mkdir(this.cloudFolder, {
      recursive: true,
    });
  }

  private getSafeFileName(fileName: string): string {
    const onlyName = basename(fileName);

    const cleanedName = onlyName
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanedName) {
      return 'file';
    }

    return cleanedName;
  }

  private createSavedFileName(originalName: string): string {
    const extension = extname(originalName);
    const nameWithoutExtension = originalName.slice(
      0,
      originalName.length - extension.length,
    );

    const datePrefix = Date.now();
    const randomPart = Math.round(Math.random() * 1000000);

    return `${datePrefix}_${randomPart}_${nameWithoutExtension}${extension}`;
  }

  private getAbsolutePath(relativePath: string): string {
    const absolutePath = resolve(process.cwd(), relativePath);

    if (!absolutePath.startsWith(this.cloudFolder)) {
      throw new InternalServerErrorException('Некорректный путь файла');
    }

    return absolutePath;
  }
}