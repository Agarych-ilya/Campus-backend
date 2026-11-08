import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Post,
  Query, Req, UseGuards, UsePipes, ValidationPipe,
} from '@nestjs/common';
import { ListingsOwnerGuard } from '../listings/listings-owner.guard';
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

  private reader(req: any): string | undefined {
    const session = req.session;
    const verifiedAt = session?.listingVerifiedAt;
    return typeof verifiedAt === 'number' &&
        verifiedAt <= Date.now() &&
        Date.now() - verifiedAt < 24 * 60 * 60 * 1000 &&
        /^[a-f0-9]{64}$/.test(session?.listingOwnerKey ?? '')
      ? session.listingOwnerKey
      : undefined;
  }

  // These are shared notes, visible to anyone viewing the group's schedule.
  @Get()
  @UsePipes(validate)
  list(@Query() scope: LessonNoteScopeDto, @Req() req: any) {
    return this.notes.list(scope, this.reader(req));
  }

  @Post()
  @UseGuards(ListingsOwnerGuard)
  @UsePipes(validate)
  create(@Body() dto: CreateGroupLessonNoteDto, @Req() req: any) {
    return this.notes.create(dto, req.session.listingOwnerKey);
  }

  @Delete(':id')
  @UseGuards(ListingsOwnerGuard)
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.notes.remove(id, req.session.listingOwnerKey);
  }
}
