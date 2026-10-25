import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  COMMUNITY_CATEGORIES,
  COMMUNITY_ICON_KINDS,
} from '../dto/create-community.dto';

export class UpdateCommunityDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(15)
  @MaxLength(1200)
  description?: string;

  @IsOptional()
  @IsIn(COMMUNITY_CATEGORIES)
  category?: string;

  @IsOptional()
  @IsIn(COMMUNITY_ICON_KINDS)
  iconKind?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  @MaxLength(512)
  telegramUrl?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  @MaxLength(512)
  vkUrl?: string | null;

  @IsOptional()
  @IsBoolean()
  hidden?: boolean;
}

/** Credentials for an existing Campus-backend account, not BARS. */
export class CommunityAdminLoginDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  username!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(100)
  password!: string;
}

/**
 * BARS cookies are a short-lived proof submitted by the WebView only.
 * The server must independently retrieve and verify the user's BARS page.
 */
export class BarsSessionLoginDto {
  @IsString()
  @MinLength(5)
  @MaxLength(8192)
  cookieHeader!: string;
}

export class ReviewCommunityDto {
  @IsIn(['approved', 'rejected'])
  status!: 'approved' | 'rejected';
}
