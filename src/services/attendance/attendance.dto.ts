import {
  IsArray, IsIn, IsNotEmpty, IsOptional, IsString,
  Matches, MaxLength,
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

export class AttendanceCloseDto {
  @IsArray()
  @IsString({ each: true })
  @Matches(/^[a-f0-9]{64}$/, { each: true })
  acknowledgedStudentKeys!: string[];
}
