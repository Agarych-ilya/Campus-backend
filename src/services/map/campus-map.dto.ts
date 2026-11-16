import { IsIn, IsNumber, Max, Min, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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

  @IsNumber() @Min(-90) @Max(90)
  latitude!: number;

  @IsNumber() @Min(-180) @Max(180)
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

  @IsOptional() @IsNumber() @Min(-90) @Max(90)
  latitude?: number;

  @IsOptional() @IsNumber() @Min(-180) @Max(180)
  longitude?: number;
}
