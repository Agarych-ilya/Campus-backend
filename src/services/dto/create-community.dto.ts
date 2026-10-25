import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const COMMUNITY_CATEGORIES = [
  'Студенческие чаты',
  'Первокурсникам',
  'Новости и мемы',
  'Клубы и интересы',
  'Учёба',
  'Мероприятия',
  'Другое',
] as const;

export const COMMUNITY_ICON_KINDS = [
  'chat',
  'campus',
  'news',
  'study',
  'club',
  'events',
] as const;

/** A user suggestion; only approved records appear in the public catalog. */
export class CreateCommunityDto {
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  title!: string;

  @IsString()
  @MinLength(15)
  @MaxLength(1200)
  description!: string;

  @IsIn(COMMUNITY_CATEGORIES)
  category!: string;

  @IsIn(COMMUNITY_ICON_KINDS)
  iconKind!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000000)
  memberCount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  telegramUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  vkUrl?: string;
}
