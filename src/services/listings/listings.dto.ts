import {
  IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches,
  Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export const LISTING_KINDS = ['market', 'lost', 'found'] as const;
export const MARKET_CATEGORIES = [
  'Учебники', 'Техника', 'Одежда', 'Аксессуары', 'Другое',
] as const;
export const LOST_CATEGORIES = [
  'Документы', 'Электроника', 'Ключи', 'Одежда', 'Другое',
] as const;

export class CreateListingDto {
  @IsIn(LISTING_KINDS)
  kind!: 'market' | 'lost' | 'found';

  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(1500)
  description!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(40)
  category!: string;

  @IsOptional()
  @Transform(({ value }) =>
    value === '' || value === null ? undefined : Number(value))
  @IsInt()
  @Min(0)
  @Max(10000000)
  price?: number;

  @IsOptional()
  @IsIn(['new', 'good', 'used'])
  condition?: 'new' | 'good' | 'used';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(60)
  authorName!: string;

  @IsString()
  @Matches(/^@?[a-zA-Z][a-zA-Z0-9_]{4,31}$/)
  telegram!: string;
}

export class UpdateListingDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(1500)
  description?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  category?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000000)
  price?: number;

  @IsOptional()
  @IsIn(['new', 'good', 'used'])
  condition?: 'new' | 'good' | 'used';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  authorName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^@?[a-zA-Z][a-zA-Z0-9_]{4,31}$/)
  telegram?: string;

  @IsOptional()
  @IsIn(['active', 'closed'])
  status?: 'active' | 'closed';
}

export class ListingReportDto {
  @IsIn(['spam', 'fraud', 'privacy', 'other'])
  reason!: 'spam' | 'fraud' | 'privacy' | 'other';
}

export class BarsListingLoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(8192)
  cookieHeader!: string;
}
