import { Type } from 'class-transformer';
import {
  IsArray, IsIn, IsNotEmpty, IsOptional, IsString,
  Matches, MaxLength, ArrayMinSize, ArrayMaxSize, ValidateNested,
} from 'class-validator';

export class AttendanceMemberDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  displayName!: string;
}

export class AttendanceDateDto {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;
}

export class AttendanceOpenLessonDto extends AttendanceDateDto {
  @IsString() @IsNotEmpty() @MaxLength(60)
  time!: string;

  @IsString() @IsNotEmpty() @MaxLength(180)
  subject!: string;

  @IsString() @MaxLength(60)
  type!: string;

  @IsString() @MaxLength(100)
  room!: string;
}

export class AttendanceDecisionDto {
  @IsString() @Matches(/^[a-f0-9]{64}$/)
  ownerKey!: string;

  @IsString()
  @IsIn(['present', 'absent', 'excused', 'rejected'])
  status!: 'present' | 'absent' | 'excused' | 'rejected';

  @IsOptional() @IsString() @MaxLength(300)
  note?: string;
}

export class BarsRosterStudentDto {
  @IsString() @IsNotEmpty() @MaxLength(120)
  fullName!: string;

  /** Opaque record ID from the current BARS student list, when available. */
  @IsOptional() @IsString() @MaxLength(120)
  sourceId?: string;
}

export class AttendanceRosterImportDto {
  @IsString() @Matches(/^[А-ЯЁA-Z0-9-]{3,40}$/)
  group!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(120)
  @ValidateNested({ each: true })
  @Type(() => BarsRosterStudentDto)
  students!: BarsRosterStudentDto[];
}

export class AttendanceAbsencesDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(120)
  @IsString({ each: true })
  @Matches(/^[a-f0-9]{64}$/, { each: true })
  rosterKeys!: string[];

  @IsArray() @ArrayMaxSize(120)
  @IsString({ each: true })
  @Matches(/^[a-f0-9]{64}$/, { each: true })
  absentKeys!: string[];
}

export class AttendanceCloseDto {
  @IsArray()
  @IsString({ each: true })
  @Matches(/^[a-f0-9]{64}$/, { each: true })
  acknowledgedStudentKeys!: string[];
}
