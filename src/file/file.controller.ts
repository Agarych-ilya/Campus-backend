import {
  Controller,
  Get,
  Post,
  Param,
  Delete,
  UploadedFile,
  UseInterceptors,
  Res,
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
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.fileService.postFile(file);
  }

  @Get()
  async getFiles() {
    return this.fileService.getFiles();
  }

  @Get(':id/download')
  async downloadFile(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const file = await this.fileService.getFile(id);

    return res.download(
      file.path,
      file.name,
    );
  }

  @Delete(':id')
  async deleteFile(
    @Param('id') id: string,
  ) {
    return this.fileService.deleteFile(id);
  }
}