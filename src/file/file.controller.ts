import { Controller, Get, Post, Param, Delete, HttpException, UploadedFile, UseInterceptors, UseGuards, Req } from '@nestjs/common';
import { FileService } from './file.service';
import { FileInterceptor } from '@nestjs/platform-express';
import 'multer';
import { diskStorage } from 'multer';
import { basename, extname } from 'path';
import { SessionAuthGuard } from 'src/auth/guards/session-auth.guard';
import * as fs from 'fs';
import { join } from 'path';

@Controller('file')
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @Post('postFile')
  @UseGuards(SessionAuthGuard)
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: (req: any, file, callback) => {
        const user = req.session.user;
        if (!user){
          return callback(new Error('Forbidden: 403'), '');
        }
        const dir = `./cloud/${user.id}`;

        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        callback(null, dir);
      },
      filename: (req: any, file, callback) => {
        const user = req.session.user;
        if (!user) {
          return callback(new Error('Forbidden: 403'), '');
        }
      
        const dir = join(__dirname, '..', '..', 'cloud', String(user.id)); 
      
        const safeOriginalName = basename(file.originalname);
      
        const ext = extname(safeOriginalName);
        const withoutExt = basename(safeOriginalName, ext);
      
        let filename = safeOriginalName;
        let i = 1;
        const maxAttempts = 256;
    
        while (fs.existsSync(join(dir, filename))) {
          if (i > maxAttempts) {
            return callback(new Error('Too many files with the same name'), '');
          }
          filename = `${withoutExt} (${i})${ext}`;
          i++;
        }
      
        callback(null, filename);
      }
    }),
    limits: {
      fileSize: 1024 * 1024 * 15,
    }
  }))
  async postFile(@UploadedFile() file: Express.Multer.File, @Req() req: any) {
    return await this.fileService.postFile(file, req.session.user);
  }

  @Get('getFile/:id')
  @UseGuards(SessionAuthGuard)
  async getFile(@Param('id') id: string, @Req() req: any) {
    return await this.fileService.getFile(id);
  }

  @Delete('deleteFile/:id')
  @UseGuards(SessionAuthGuard)
  async deleteFile(@Param('id') id: string, @Req() req: any) {
    return await this.fileService.deleteFile(id, req.session.user);
  }

  @Get('searchFile/:name')
  async searchFile(@Param('name') name: string) {
    return await this.fileService.searchFile(name);
  }
}
