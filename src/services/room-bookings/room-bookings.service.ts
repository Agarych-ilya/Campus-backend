import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DbService } from '../../db.service';
import {
  CreateRoomBookingDto, ROOM_BOOKING_SLOTS, AMPHITHEATER_ROOM_CODE,
  RoomBookingScope, normalizeBookingRoom,
} from './room-bookings.dto';
import { makeInitialRoomLayouts, RoomLayout } from './room-layouts';

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
  private layoutSchemaPromise?: Promise<void>;

  /** Database is the source of truth for rooms and their actual seats. */
  private ensureLayoutSchema(): Promise<void> {
    if (!this.layoutSchemaPromise) {
      this.layoutSchemaPromise = (async () => {
        await this.db.query(
          'CREATE TABLE IF NOT EXISTS campus_room_layouts (' +
          'room_code VARCHAR(12) NOT NULL PRIMARY KEY, ' +
          'university VARCHAR(120) NOT NULL, ' +
          'building VARCHAR(12) NOT NULL, ' +
          'name VARCHAR(120) NOT NULL, ' +
          'description VARCHAR(250) NOT NULL, ' +
          'enabled TINYINT(1) NOT NULL DEFAULT 1, ' +
          'layout_json JSON NOT NULL, ' +
          'updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ' +
          'ON UPDATE CURRENT_TIMESTAMP' +
          ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
        );
        // Seed once only. Editing a layout in MySQL does not get overwritten.
        for (const layout of makeInitialRoomLayouts()) {
          await this.db.query(
            'INSERT IGNORE INTO campus_room_layouts ' +
            '(room_code,university,building,name,description,layout_json) ' +
            'VALUES (?,?,?,?,?,?)',
            [layout.room, layout.university, layout.building, layout.name,
              layout.description, JSON.stringify(layout)],
          );
        }
      })().catch((error: unknown) => {
        this.layoutSchemaPromise = undefined;
        throw error;
      });
    }
    return this.layoutSchemaPromise;
  }

  async rooms() {
    await this.ensureLayoutSchema();
    return this.db.query(
      'SELECT room_code AS room, university, building, name, description ' +
      'FROM campus_room_layouts WHERE enabled=1 ORDER BY room_code',
    );
  }

  async getRoomLayout(rawRoom: string | undefined): Promise<RoomLayout> {
    let room: string;
    try {
      room = normalizeBookingRoom(rawRoom);
    } catch (_) {
      throw new BadRequestException('Некорректный номер аудитории');
    }
    await this.ensureLayoutSchema();
    const records = await this.db.query(
      'SELECT layout_json FROM campus_room_layouts ' +
      'WHERE room_code=? AND enabled=1', [room],
    ) as Array<{ layout_json: unknown }>;
    if (!records.length) {
      throw new BadRequestException('Для этой аудитории схема пока не настроена');
    }
    const raw = records[0].layout_json;
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!data || typeof data !== 'object' ||
        !Array.isArray((data as RoomLayout).seats) ||
        !Array.isArray((data as RoomLayout).elements) ||
        (data as RoomLayout).room !== room) {
      throw new BadRequestException('Схема аудитории повреждена');
    }
    return data as RoomLayout;
  }

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

  private validateSeat(input: CreateRoomBookingDto, layout: RoomLayout): void {
    const { row, desk, seat } = input;
    const exists = Number.isInteger(row) && Number.isInteger(desk) &&
      Number.isInteger(seat) &&
      layout.seats.some((position) =>
        position.row === row && position.desk === desk &&
        position.seat === seat);
    if (!exists) {
      throw new BadRequestException('Выбрано несуществующее место в аудитории');
    }
  }

  async availability(scope: RoomBookingScope, ownerKey?: string) {
    this.validateScope(scope);
    const room = this.roomCode(scope);
    await this.ensureSchema();
    const layout = await this.getRoomLayout(room);
    const rows = await this.db.query(
      'SELECT row_num,desk_num,seat_num,owner_key ' +
      'FROM campus_room_seat_bookings ' +
      'WHERE room_code=? AND booking_date=? AND slot_id=? ' +
      'ORDER BY row_num,desk_num,seat_num',
      [room, scope.date, scope.slot],
    ) as SeatRow[];
    const amphitheater = room === AMPHITHEATER_ROOM_CODE;
    const capacity = layout.seats.length;
    const occupied = rows.map((item) => ({
      row: Number(item.row_num),
      desk: Number(item.desk_num),
      seat: Number(item.seat_num),
      mine: !!ownerKey && item.owner_key === ownerKey,
    }));
    return {
      room,
      layoutType: amphitheater ? 'amphitheater' : 'desks',
      rows: Math.max(0, ...layout.seats.map((seat) => seat.row)),
      desksPerRow: Math.max(0, ...layout.seats.map((seat) => seat.desk)),
      seatsPerDesk: Math.max(0, ...layout.seats.map((seat) => seat.seat)),
      capacity,
      layout,
      date: scope.date,
      slot: scope.slot,
      slots: ROOM_BOOKING_SLOTS,
      occupied,
      available: capacity - occupied.length,
      mine: occupied.find((item) => item.mine) ?? null,
      // Both layouts are test configurations. В-308 uses the supplied
      // amphitheater sketch, not an official venue seating plan.
      testMode: true,
    };
  }

  async reserve(input: CreateRoomBookingDto, ownerKey: string) {
    this.validateScope(input);
    const room = this.roomCode(input);
    await this.ensureSchema();
    const layout = await this.getRoomLayout(room);
    this.validateSeat(input, layout);

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
    await this.getRoomLayout(room);
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
