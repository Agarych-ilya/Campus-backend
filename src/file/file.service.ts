import { HttpException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DbService } from '../../db.service';
import * as fs from 'fs';

@Injectable()
export class FileService {
  constructor(private db: DbService) {}
  
  async postFile(file: Express.Multer.File){
    if (!file){
      throw new BadRequestException('Empty request');
    }
    await this.db.query(
      'INSERT INTO cloud (name, path) VALUES (?, ?)',
      [file.filename, file.path]
    );

    return {
      filename: file.filename,
      path: file.path
    };
  }

  async getFile(id: string){
    const files = await this.db.query(
      'SELECT * FROM cloud WHERE id = ? LIMIT 1',
      [id]
    ) as any[];

    if (!files[0]){
      throw new NotFoundException(`Not found (${id})`);
    }

    return {
      message: 'Success!',
      path: files[0].path
    };
  }

  async deleteFile(id: string){
    const result = await this.db.query(
      'SELECT * FROM cloud WHERE id = ? LIMIT 1',
      [id]
    ) as any[];

    if (!result[0]){
      throw new NotFoundException(`Not found (${id})`);
    }

    const path = result[0].path;

    if (fs.existsSync(path)){
      fs.unlinkSync(path);
    }

    await this.db.query(
      'DELETE FROM cloud WHERE id = ?',
      [id]
    );

    return {
      message: 'Success!'
    };
  }
}
