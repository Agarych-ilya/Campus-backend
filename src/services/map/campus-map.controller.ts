import {
  Body, Controller, Delete, Get, Param, Patch, Post,
  UseGuards, UsePipes, ValidationPipe,
} from '@nestjs/common';
import { CommunityAdminGuard } from '../admin/community-admin.guard';
import { CampusMapService } from './campus-map.service';
import { CreateMapMarkerDto, UpdateMapMarkerDto } from './campus-map.dto';

const validate = new ValidationPipe({
  whitelist: true, forbidNonWhitelisted: true, transform: true,
});

/** Public read, server-verified administrator writes. */
@Controller('services/map')
export class CampusMapController {
  constructor(private readonly service: CampusMapService) {}

  @Get('markers')
  list() {
    return this.service.list();
  }

  @Post('markers')
  @UseGuards(CommunityAdminGuard)
  @UsePipes(validate)
  create(@Body() dto: CreateMapMarkerDto) {
    return this.service.create(dto);
  }

  @Patch('markers/:id')
  @UseGuards(CommunityAdminGuard)
  @UsePipes(validate)
  update(@Param('id') id: string, @Body() dto: UpdateMapMarkerDto) {
    return this.service.update(id, dto);
  }

  @Delete('markers/:id')
  @UseGuards(CommunityAdminGuard)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
