import { HttpException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DbService } from '../db.service';
import * as fs from 'fs';

@Injectable()
export class FileService {
  constructor(private db: DbService) {}
  
  async postFile(file: Express.Multer.File, user: any){
    if (!file || !user){
      throw new BadRequestException('Empty request');
    }
    await this.db.query(
      'INSERT INTO cloud (name, path, user) VALUES (?, ?, ?)',
      [file.filename, file.path, user.id]
    );

    return {
      filename: file.filename,
      path: file.path,
      user: user.id
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

  async deleteFile(id: string, user: any){
    const result = await this.db.query(
      'SELECT * FROM cloud WHERE id = ? AND user = ? LIMIT 1',
      [id, user.id]
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

  async searchFile(name: string){
    const redactedName = `%${name}%`
    const result = await this.db.query(
      'SELECT * FROM cloud WHERE filename LIKE ?',
      [redactedName]
    ) as any[];

    return(result);
  }
}
