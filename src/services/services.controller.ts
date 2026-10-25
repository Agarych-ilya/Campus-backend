import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseIntPipe,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CreateCommunityDto } from './dto/create-community.dto';
import { ServicesService } from './services.service';

@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  /** Built-in communities and moderator-approved student submissions. */
  @Get('groups')
  getGroups() {
    return this.servicesService.getGroups();
  }

  /** Only approved groups may expose uploaded icons. */
  @Get('groups/icons/:id')
  async getGroupIcon(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const icon = await this.servicesService.getPublicIcon(id);
    return res
      .status(200)
      .set({
        'Content-Type': icon.mime,
        'Cache-Control': 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(icon.data);
  }

  /** User-chosen PNG/JPEG/WebP image is kept private until moderation. */
  @Post('groups/submissions')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(
    FileInterceptor('icon', {
      limits: {
        fileSize: 700 * 1024,
        files: 1,
        fields: 12,
      },
    }),
  )
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  submitGroup(
    @Body() dto: CreateCommunityDto,
    @Ip() ip: string,
    @UploadedFile() icon?: Express.Multer.File,
  ) {
    return this.servicesService.submitCommunity(dto, ip, icon);
  }
}
