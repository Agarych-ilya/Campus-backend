import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNotEmpty,
  IsString, Matches, Max, MaxLength, Min, MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PublicStudyCardDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  id!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  term!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1200)
  definition!: string;
}

export class PublishStudyDeckDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,100}$/)
  localDeckId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  title!: string;

  @IsString()
  @MaxLength(300)
  description!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(60)
  authorName!: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PublicStudyCardDto)
  cards!: PublicStudyCardDto[];
}

export class RateStudyDeckDto {
  @IsInt()
  @Min(1)
  @Max(5)
  stars!: number;
}
