import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Post,
  Query, Req, UseGuards, UsePipes, ValidationPipe,
} from '@nestjs/common';
import { ListingsOwnerGuard } from '../listings/listings-owner.guard';
import { LessonGroupGuard } from './lesson-group.guard';
import { CreateGroupLessonNoteDto, LessonNoteScopeDto } from './lesson-notes.dto';
import { LessonNotesService } from './lesson-notes.service';

const validate = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

@Controller('services/schedule-notes')
export class LessonNotesController {
  constructor(private readonly notes: LessonNotesService) {}


  @Get()
  @UseGuards(LessonGroupGuard)
  @UsePipes(validate)
  list(@Query() scope: LessonNoteScopeDto, @Req() req: any) {
    return this.notes.list(scope, req.session.listingOwnerKey);
  }

  @Post()
  @UseGuards(ListingsOwnerGuard, LessonGroupGuard)
  @UsePipes(validate)
  create(@Body() dto: CreateGroupLessonNoteDto, @Req() req: any) {
    return this.notes.create(dto, req.session.listingOwnerKey);
  }

  @Delete(':id')
  @UseGuards(ListingsOwnerGuard, LessonGroupGuard)
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.notes.remove(id, req.session.listingOwnerKey, req.session.listingGroup);
  }
}
