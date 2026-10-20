import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DbService } from '../db.service';
import { existsSync } from 'fs';

@Injectable()
export class FileService {
  constructor(private readonly db: DbService) { }

  async postFile(file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Файл не передан');
    }

    const result: any = await this.db.query(
      'INSERT INTO cloud (name, path) VALUES (?, ?)',
      [file.originalname, file.path],
    );

    return {
      id: result.insertId,
      name: file.originalname,
      size: file.size,
    };
  }

  async getFiles() {
    const files = (await this.db.query(
      'SELECT id, name, path FROM cloud ORDER BY id DESC',
    )) as any[];

    return files.map((file) => ({
      id: file.id,
      name: file.name,
      available: existsSync(file.path),
    }));
  }

  async getFile(id: string) {
    const files = (await this.db.query(
      'SELECT * FROM cloud WHERE id = ? LIMIT 1',
      [id],
    )) as any[];

    const file = files[0];

    if (!file) {
      throw new NotFoundException(`Файл ${id} не найден`);
    }

    if (!existsSync(file.path)) {
      throw new NotFoundException('Файл отсутствует на диске');
    }

    return file;
  }

  async deleteFile(id: string) {
    const file = await this.getFile(id);

    const fs = await import('fs/promises');

    if (existsSync(file.path)) {
      await fs.unlink(file.path);
    }

    await this.db.query(
      'DELETE FROM cloud WHERE id = ?',
      [id],
    );

    return {
      message: 'Файл удалён',
    };
  }
}