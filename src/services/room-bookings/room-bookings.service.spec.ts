import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DbService } from '../../db.service';
import { RoomBookingsService } from './room-bookings.service';

describe('RoomBookingsService', () => {
  let service: RoomBookingsService;
  let query: jest.Mock;
  const owner = 'a'.repeat(64);
  const other = 'b'.repeat(64);
  const date = new Date().toISOString().slice(0, 10);
  const scope = { date, slot: '1' };

  beforeEach(() => {
    query = jest.fn().mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT')) return [];
      if (sql.startsWith('DELETE')) return { affectedRows: 1 };
      return {};
    });
    service = new RoomBookingsService({ query } as unknown as DbService);
  });

  it('exposes exactly 54 seats in 3x9 two-person desks', async () => {
    const data = await service.availability(scope);
    expect(data.room).toBe('М-307');
    expect(data.rows).toBe(3);
    expect(data.desksPerRow).toBe(9);
    expect(data.seatsPerDesk).toBe(2);
    expect(data.capacity).toBe(54);
    expect(data.available).toBe(54);
    expect(data.occupied).toEqual([]);
    expect(data.testMode).toBe(true);
    const schema = query.mock.calls.find(([sql]) =>
      (sql as string).startsWith('CREATE TABLE'))?.[0] as string;
    expect(schema).toContain('UNIQUE KEY uq_room_seat');
    expect(schema).toContain('UNIQUE KEY uq_room_owner_slot');
  });

  it('shows occupied seats but only reveals a mine flag to the owner', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT')) {
        return [{ row_num: 2, desk_num: 5, seat_num: 1, owner_key: owner }];
      }
      return {};
    });
    const publicView = await service.availability(scope);
    expect(publicView.occupied[0].mine).toBe(false);
    expect(publicView.mine).toBeNull();
    const myView = await service.availability(scope, owner);
    expect(myView.available).toBe(53);
    expect(myView.mine).toEqual({
      row: 2, desk: 5, seat: 1, mine: true,
    });
    const someoneElse = await service.availability(scope, other);
    expect(someoneElse.mine).toBeNull();
  });

  it('rejects other rooms for availability, booking and cancellation', async () => {
    const otherRoom = { ...scope, room: 'C-401' };
    await expect(service.availability(otherRoom, owner))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.reserve({
      ...otherRoom, row: 1, desk: 1, seat: 1,
    }, owner)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.cancel(otherRoom, owner))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(query.mock.calls.some(([sql]) =>
      (sql as string).startsWith('INSERT'))).toBe(false);
  });

  it('still accepts the configured classroom in Latin or Cyrillic spelling', async () => {
    const data = await service.availability({ ...scope, room: 'M-307' }, owner);
    expect(data.room).toBe('М-307');
  });

  it('rejects bogus room names instead of booking an arbitrary default', async () => {
    await expect(service.availability({ ...scope, room: 'ЭО и ДОТ' }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.reserve({
      ...scope, room: 'М-307;DROP TABLE', row: 1, desk: 1, seat: 1,
    }, owner)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reserves a specific one of the 54 seats under verified identity', async () => {
    await service.reserve({ ...scope, row: 3, desk: 9, seat: 2 }, owner);
    const insert = query.mock.calls.find(([sql]) =>
      (sql as string).startsWith('INSERT'));
    expect(insert?.[1]).toEqual(['М-307', date, '1', 3, 9, 2, owner]);
  });

  it('converts a database unique constraint violation to a conflict', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('INSERT')) throw { code: 'ER_DUP_ENTRY' };
      if (sql.startsWith('SELECT')) return [];
      return {};
    });
    await expect(
      service.reserve({ ...scope, row: 1, desk: 1, seat: 1 }, other),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects invalid seats, dates and time slots', async () => {
    await expect(
      service.reserve({ ...scope, row: 4, desk: 1, seat: 1 }, owner),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.reserve({ ...scope, row: 1, desk: 10, seat: 1 }, owner),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.availability({ date: '2026-02-30', slot: '1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.availability({ date, slot: '99' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cancels only the verified owner reservation for this slot', async () => {
    await service.cancel(scope, owner);
    const del = query.mock.calls.find(([sql]) =>
      (sql as string).startsWith('DELETE'));
    expect(del?.[1]).toEqual(['М-307', date, '1', owner]);
  });

  it('cannot cancel a booking that is not its own', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('DELETE')) return { affectedRows: 0 };
      return {};
    });
    await expect(service.cancel(scope, other))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});
