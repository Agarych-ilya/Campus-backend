import {
  IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min,
} from 'class-validator';

export const ROOM_CODE = 'М-307';
export const AMPHITHEATER_ROOM_CODE = 'В-308';
// Four upper rows with 10 seats per bank; six lower rows with 8.
export const AMPHITHEATER_CAPACITY = 4 * 10 * 2 + 6 * 8 * 2;
export const ROOM_BOOKING_SLOTS = [
  { id: '1', time: '09:20–10:55' },
  { id: '2', time: '11:10–12:45' },
  { id: '3', time: '13:45–15:20' },
  { id: '4', time: '15:35–17:10' },
  { id: '5', time: '17:20–18:55' },
  { id: '6', time: '19:05–20:40' },
] as const;

/** Legacy clients without a room still use the original M-307 demo. */
export type RoomBookingScope = { date: string; slot: string; room?: string };

export function normalizeBookingRoom(raw: string | undefined): string {
  const input = (raw ?? ROOM_CODE).trim().toUpperCase()
    .replace(/[–—−]/g, '-').replace(/\s+/g, '');
  if (!/^[A-ZА-ЯЁ]{1,3}-\d{1,4}$/.test(input)) {
    throw new Error('Некорректный номер аудитории');
  }
  const [building, number] = input.split('-');
  const map: Record<string, string> = {
    M: 'М', C: 'С', A: 'А', K: 'К', P: 'Р',
    T: 'Т', H: 'Н', B: 'В', V: 'В', E: 'Е', O: 'О', X: 'Х',
  };
  const normalized = building.split('').map(ch => map[ch] ?? ch).join('');
  return normalized + '-' + number;
}

export class RoomBookingQueryDto {
  @IsOptional() @IsString() @MaxLength(48)
  room?: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @IsString()
  @IsIn(['1', '2', '3', '4', '5', '6'])
  slot!: string;
}

export class CreateRoomBookingDto extends RoomBookingQueryDto {
  @IsInt() @Min(1) @Max(100)
  row!: number;

  @IsInt() @Min(1) @Max(100)
  desk!: number;

  @IsInt() @Min(1) @Max(20)
  seat!: number;
}
