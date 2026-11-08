import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class LessonNoteScopeDto {
  @IsString() @IsNotEmpty() @MaxLength(60)
  group!: string;

  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @IsString() @IsNotEmpty() @MaxLength(60)
  time!: string;

  @IsString() @IsNotEmpty() @MaxLength(180)
  subject!: string;
}

export class CreateGroupLessonNoteDto extends LessonNoteScopeDto {
  @IsString() @IsNotEmpty() @MaxLength(1500)
  content!: string;
}
