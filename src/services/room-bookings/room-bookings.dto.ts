import {
  IsIn, IsInt, IsString, Matches, Max, Min,
} from 'class-validator';

export const ROOM_CODE = 'М-307';
export const ROOM_BOOKING_SLOTS = [
  { id: '1', time: '09:20–10:55' },
  { id: '2', time: '11:10–12:45' },
  { id: '3', time: '13:45–15:20' },
  { id: '4', time: '15:35–17:10' },
  { id: '5', time: '17:20–18:55' },
  { id: '6', time: '19:05–20:40' },
] as const;

export type RoomBookingScope = { date: string; slot: string };

export class RoomBookingQueryDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @IsString()
  @IsIn(['1', '2', '3', '4', '5', '6'])
  slot!: string;
}

export class CreateRoomBookingDto extends RoomBookingQueryDto {
  @IsInt() @Min(1) @Max(3)
  row!: number;

  @IsInt() @Min(1) @Max(9)
  desk!: number;

  @IsInt() @Min(1) @Max(2)
  seat!: number;
}
