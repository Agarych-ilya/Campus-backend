import {
  Controller,
  Get,
  Post,
  Param,
  Delete,
  UploadedFile,
  UseInterceptors,
  Res,
  GoneException,
} from '@nestjs/common';

import { FileService } from './file.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import type { Response } from 'express';

@Controller('file')
export class FileController {
  constructor(private readonly fileService: FileService) { }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './cloud',

        filename: (req, file, callback) => {
          const extension = extname(file.originalname);

          const filename =
            `${Date.now()}-${Math.round(Math.random() * 1E9)}${extension}`;

          callback(null, filename);
        },
      }),
    }),
  )
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (file?.path) {
      const fs = await import('node:fs/promises');
      await fs.unlink(file.path).catch(() => undefined);
    }
    throw new GoneException('Обнови CampusApp: загружай файлы через /cloud/upload');
  }

  @Get()
  async getFiles() {
    throw new GoneException('Старый каталог без авторизации отключён. Используй /cloud/files');
  }

  @Get(':id/download')
  async downloadFile(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    throw new GoneException('Старое публичное скачивание отключено. Используй /cloud/files');
  }

  @Delete(':id')
  async deleteFile(
    @Param('id') id: string,
  ) {
    throw new GoneException('Старое удаление без проверки владельца отключено');
  }
}