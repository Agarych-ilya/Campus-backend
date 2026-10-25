import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
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

  /** Anyone can suggest a group, but submissions are never published automatically. */
  @Post('groups/submissions')
  @HttpCode(HttpStatus.ACCEPTED)
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  submitGroup(@Body() dto: CreateCommunityDto, @Ip() ip: string) {
    return this.servicesService.submitCommunity(dto, ip);
  }
}
