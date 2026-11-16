import { IsIn, IsLatitude, IsLongitude, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const MAP_MARKER_KINDS = ['building', 'library', 'sports', 'culture', 'service', 'other'] as const;
export type MapMarkerKind = (typeof MAP_MARKER_KINDS)[number];

export class CreateMapMarkerDto {
  @IsString() @MinLength(2) @MaxLength(100)
  name!: string;

  @IsString() @MaxLength(400)
  description!: string;

  @IsString() @MaxLength(200)
  address!: string;

  @IsIn(MAP_MARKER_KINDS)
  kind!: MapMarkerKind;

  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;
}

export class UpdateMapMarkerDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100)
  name?: string;

  @IsOptional() @IsString() @MaxLength(400)
  description?: string;

  @IsOptional() @IsString() @MaxLength(200)
  address?: string;

  @IsOptional() @IsIn(MAP_MARKER_KINDS)
  kind?: MapMarkerKind;

  @IsOptional() @IsLatitude()
  latitude?: number;

  @IsOptional() @IsLongitude()
  longitude?: number;
}
