import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import { FileService } from './file.service';

@Controller('file')
export class FileController {
  constructor(private readonly fileService: FileService) { }

  @Post('postFile')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 50 * 1024 * 1024,
      },
    }),
  )
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Файл не передан');
    }

    const savedFile = await this.fileService.saveFile(file);

    return {
      message: 'Файл успешно загружен',
      file: savedFile,
    };
  }

  @Get('list')
  async getFiles() {
    const files = await this.fileService.getFiles();

    return {
      message: 'Success',
      files,
    };
  }

  @Get('info/:id')
  async getFileInfo(@Param('id', ParseIntPipe) id: number) {
    const file = await this.fileService.getFileInfo(id);

    return {
      message: 'Success',
      file,
    };
  }

  @Get('getFile/:id')
  async downloadFile(
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const fileData = await this.fileService.getFileForDownload(id);

    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader(
      'Content-Disposition',
      this.getContentDisposition(fileData.name),
    );

    return new StreamableFile(fileData.stream);
  }

  @Delete('deleteFile/:id')
  async deleteFile(@Param('id', ParseIntPipe) id: number) {
    await this.fileService.deleteFile(id);

    return {
      message: 'Файл успешно удалён',
    };
  }

  private getContentDisposition(fileName: string): string {
    const safeFileName = fileName.replace(/"/g, '');

    return `attachment; filename="${safeFileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
  }
}