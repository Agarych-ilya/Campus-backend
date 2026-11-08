import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DbService } from '../../db.service';
import {
  CreateRoomBookingDto, ROOM_BOOKING_SLOTS, ROOM_CODE, RoomBookingScope,
  normalizeBookingRoom,
} from './room-bookings.dto';

type SeatRow = {
  row_num: number;
  desk_num: number;
  seat_num: number;
  owner_key: string;
};

@Injectable()
export class RoomBookingsService {
  constructor(private readonly db: DbService) {}

  private schemaPromise?: Promise<void>;

  private ensureSchema(): Promise<void> {
    if (!this.schemaPromise) {
      this.schemaPromise = this.db.query(
        'CREATE TABLE IF NOT EXISTS campus_room_seat_bookings (' +
        'id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, ' +
        'room_code VARCHAR(12) NOT NULL, ' +
        'booking_date VARCHAR(10) NOT NULL, ' +
        'slot_id VARCHAR(4) NOT NULL, ' +
        'row_num TINYINT UNSIGNED NOT NULL, ' +
        'desk_num TINYINT UNSIGNED NOT NULL, ' +
        'seat_num TINYINT UNSIGNED NOT NULL, ' +
        'owner_key CHAR(64) NOT NULL, ' +
        'created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, ' +
        'UNIQUE KEY uq_room_seat ' +
        '(room_code,booking_date,slot_id,row_num,desk_num,seat_num), ' +
        'UNIQUE KEY uq_room_owner_slot ' +
        '(room_code,booking_date,slot_id,owner_key)' +
        ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
      ).then(() => undefined).catch((error: unknown) => {
        this.schemaPromise = undefined;
        throw error;
      });
    }
    return this.schemaPromise;
  }

  private roomCode(input: RoomBookingScope): string {
    let room: string;
    try {
      room = normalizeBookingRoom(input.room);
    } catch (_) {
      throw new BadRequestException('Некорректный номер аудитории');
    }
    if (room !== ROOM_CODE) {
      throw new BadRequestException(
        'Тестовое бронирование доступно только для аудитории М-307',
      );
    }
    return room;
  }

  private validateScope(input: RoomBookingScope): void {
    this.roomCode(input);
    const { date, slot } = input;
    if (typeof date !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Выбери корректную дату');
    }
    const timestamp = Date.parse(date + 'T00:00:00Z');
    if (!Number.isFinite(timestamp) ||
        new Date(timestamp).toISOString().slice(0, 10) !== date) {
      throw new BadRequestException('Некорректная дата бронирования');
    }
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(),
        now.getUTCDate());
    const daysAhead = (timestamp - today) / 86400000;
    if (daysAhead < 0 || daysAhead > 60) {
      throw new BadRequestException('Доступно бронирование на ближайшие 60 дней');
    }
    if (!ROOM_BOOKING_SLOTS.some((item) => item.id === slot)) {
      throw new BadRequestException('Неизвестный учебный интервал');
    }
  }

  private validateSeat(input: CreateRoomBookingDto): void {
    if (!Number.isInteger(input.row) || input.row < 1 || input.row > 3 ||
        !Number.isInteger(input.desk) || input.desk < 1 || input.desk > 9 ||
        !Number.isInteger(input.seat) || input.seat < 1 || input.seat > 2) {
      throw new BadRequestException('Выбрано несуществующее место в аудитории');
    }
  }

  async availability(scope: RoomBookingScope, ownerKey?: string) {
    this.validateScope(scope);
    const room = this.roomCode(scope);
    await this.ensureSchema();
    const rows = await this.db.query(
      'SELECT row_num,desk_num,seat_num,owner_key ' +
      'FROM campus_room_seat_bookings ' +
      'WHERE room_code=? AND booking_date=? AND slot_id=? ' +
      'ORDER BY row_num,desk_num,seat_num',
      [room, scope.date, scope.slot],
    ) as SeatRow[];
    const occupied = rows.map((item) => ({
      row: Number(item.row_num),
      desk: Number(item.desk_num),
      seat: Number(item.seat_num),
      mine: !!ownerKey && item.owner_key === ownerKey,
    }));
    return {
      room,
      rows: 3,
      desksPerRow: 9,
      seatsPerDesk: 2,
      capacity: 54,
      date: scope.date,
      slot: scope.slot,
      slots: ROOM_BOOKING_SLOTS,
      occupied,
      available: 54 - occupied.length,
      mine: occupied.find((item) => item.mine) ?? null,
      // Only M-307 has a configured 3x9x2 test seating layout.
      // These are CampusApp demo reservations, not official MPEI data.
      testMode: true,
    };
  }

  async reserve(input: CreateRoomBookingDto, ownerKey: string) {
    this.validateScope(input);
    this.validateSeat(input);
    const room = this.roomCode(input);
    await this.ensureSchema();

    try {
      // Atomic uniqueness is enforced by MySQL, not a racy availability check.
      await this.db.query(
        'INSERT INTO campus_room_seat_bookings ' +
        '(room_code,booking_date,slot_id,row_num,desk_num,seat_num,owner_key) ' +
        'VALUES (?,?,?,?,?,?,?)',
        [room, input.date, input.slot,
          input.row, input.desk, input.seat, ownerKey],
      );
    } catch (error) {
      const sqlError = error as { code?: string; errno?: number };
      if (sqlError.code === 'ER_DUP_ENTRY' || sqlError.errno === 1062) {
        throw new ConflictException(
          'Это место уже занято или у тебя есть бронь на этот интервал',
        );
      }
      throw error;
    }
    return this.availability(input, ownerKey);
  }

  async cancel(scope: RoomBookingScope, ownerKey: string) {
    this.validateScope(scope);
    const room = this.roomCode(scope);
    await this.ensureSchema();
    const result = await this.db.query(
      'DELETE FROM campus_room_seat_bookings ' +
      'WHERE room_code=? AND booking_date=? AND slot_id=? AND owner_key=?',
      [room, scope.date, scope.slot, ownerKey],
    ) as { affectedRows: number };
    if (!result.affectedRows) {
      throw new NotFoundException('Бронирование на этот интервал не найдено');
    }
    return this.availability(scope, ownerKey);
  }
}
