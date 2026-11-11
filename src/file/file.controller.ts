import {
  Controller, Delete, Get, GoneException, Param, Post,
} from '@nestjs/common';

/**
 * Old /file routes never had ownership checks. Refuse them BEFORE parsing
 * multipart bodies, rather than silently exposing legacy students' files.
 * The authenticated replacement lives at /cloud.
 */
@Controller('file')
export class FileController {
  @Post('upload')
  uploadFile() {
    throw new GoneException('Обнови CampusApp: загрузка теперь через /cloud/upload');
  }

  @Get()
  getFiles() {
    throw new GoneException('Старый общий каталог отключён. Используй /cloud/files');
  }

  @Get(':id/download')
  downloadFile(@Param('id') _id: string) {
    throw new GoneException('Старое публичное скачивание отключено');
  }

  @Delete(':id')
  deleteFile(@Param('id') _id: string) {
    throw new GoneException('Старое удаление без проверки владельца отключено');
  }
}
