import { Controller, Get, Post, Body, Patch, Param, Delete, ValidationPipe, UsePipes, HttpException, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileService } from './file.service';
import { FileInterceptor } from '@nestjs/platform-express';
import 'multer';
import { diskStorage } from 'multer';
import { extname } from 'path';

@Controller('file')
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @Post('postFile')
  @UsePipes(new ValidationPipe())
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: `./cloud`,
      filename: (req, file, callback) => {
        const ext = extname(file.originalname)
        const filename = `${Date.now()}${ext}`;
        callback(null, `${filename}`)
      },
    }),
  }))
  async postFile(@UploadedFile() file: Express.Multer.File) {
    return await this.fileService.postFile(file);
  }

  @Get('getFile/:id')
  async getFile(@Param('id') id: string) {
    if (!true){ // Требуется проверять сессии, временно отключено
      throw new HttpException('Forbidden', 403);
    }
    return await this.fileService.getFile(id);
  }

  @Delete('deleteFile/:id')
  async deleteFile(@Param('id') id: string) {
    if (!true){ // Требуется проверять сессии, временно отключено
      throw new HttpException('Forbidden', 403);
    }
    return await this.fileService.deleteFile(id);
  }
}
