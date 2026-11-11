import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DbService } from '../../db.service';
import { RoomBookingsService } from './room-bookings.service';
import { makeInitialRoomLayouts } from './room-layouts';

describe('RoomBookingsService', () => {
  let service: RoomBookingsService;
  let query: jest.Mock;
  const owner = 'a'.repeat(64);
  const other = 'b'.repeat(64);
  const date = new Date().toISOString().slice(0, 10);
  const scope = { date, slot: '1' };
  const seededLayouts = makeInitialRoomLayouts();
  const layoutRows = (params?: unknown[]) => {
    const layout = seededLayouts.find((item) => item.room === params?.[0]);
    return layout ? [{ layout_json: JSON.stringify(layout) }] : [];
  };

  beforeEach(() => {
    query = jest.fn().mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.startsWith('SELECT layout_json')) return layoutRows(params);
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
    query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.startsWith('SELECT layout_json')) return layoutRows(params);
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
      (sql as string).startsWith('INSERT INTO campus_room_seat_bookings'))).toBe(false);
  });

  it('still accepts the configured classroom in Latin or Cyrillic spelling', async () => {
    const data = await service.availability({ ...scope, room: 'M-307' }, owner);
    expect(data.room).toBe('М-307');
  });

  it('offers 176 seats in В-308: four red and six blue rows per bank', async () => {
    const roomScope = { ...scope, room: 'V-308' };
    const result = await service.availability(roomScope, owner);
    expect(result.room).toBe('В-308');
    expect(result.capacity).toBe(176);
    expect(result.available).toBe(176);
    expect(result.layout.seats).toHaveLength(176);
    expect(result.layout.elements.some((e) => e.id === 'lower-block')).toBe(true);
    expect(result.rows).toBe(10);

    await service.reserve(
      { ...roomScope, row: 4, desk: 10, seat: 2 }, owner,
    );
    const insert = query.mock.calls.find(([sql]) =>
      (sql as string).startsWith('INSERT INTO campus_room_seat_bookings'));
    expect(insert?.[1]).toEqual([
      'В-308', date, '1', 4, 10, 2, owner,
    ]);
  });

  it('limits В-308 blue rows to eight seats per side', async () => {
    const place = (row: number, desk: number) => ({
      ...scope, room: 'В-308', row, desk, seat: 1,
    });
    await service.reserve(place(5, 8), owner);
    await service.reserve(place(10, 8), owner);
    await expect(service.reserve(place(5, 9), owner))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.reserve(place(10, 10), owner))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.reserve(place(11, 1), owner))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.reserve(place(1, 11), owner))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps В-308 and М-307 occupancy separate and cancels by room', async () => {
    query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.startsWith('SELECT layout_json')) return layoutRows(params);
      if (sql.startsWith('SELECT')) {
        return params?.[0] === 'В-308'
          ? [{ row_num: 5, desk_num: 8, seat_num: 2, owner_key: owner }]
          : [];
      }
      if (sql.startsWith('DELETE')) return { affectedRows: 1 };
      return {};
    });
    const large = await service.availability({...scope, room: 'В-308'}, owner);
    const small = await service.availability({...scope, room: 'М-307'}, owner);
    expect(large.available).toBe(175);
    expect(large.mine).toEqual({ row: 5, desk: 8, seat: 2, mine: true });
    expect(small.available).toBe(54);
    await service.cancel({...scope, room: 'В-308'}, owner);
    const remove = query.mock.calls.find(([sql]) =>
      (sql as string).startsWith('DELETE'));
    expect(remove?.[1]).toEqual(['В-308', date, '1', owner]);
  });

  it('serves a room catalogue from MySQL with editable layouts', async () => {
    query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.startsWith('SELECT room_code AS room')) {
        return seededLayouts.map((item) => ({
          room: item.room, university: item.university,
          building: item.building, name: item.name,
          description: item.description,
        }));
      }
      if (sql.startsWith('SELECT layout_json')) return layoutRows(params);
      return {};
    });
    const rooms = await service.rooms() as Array<{room: string}>;
    expect(rooms.map((room) => room.room)).toEqual(['М-307', 'В-308']);
    const layout = await service.getRoomLayout('М-307');
    expect(layout.seats).toHaveLength(54);
    expect(layout.elements.filter((item) => item.type === 'outlet'))
      .toHaveLength(2);
  });

  it('uses seats from the stored layout, not fixed per-room dimensions', async () => {
    query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.startsWith('SELECT layout_json')) {
        const stored = seededLayouts.find((item) => item.room === params?.[0])!;
        return [{ layout_json: JSON.stringify({
          ...stored, seats: [stored.seats[0]],
        }) }];
      }
      if (sql.startsWith('SELECT')) return [];
      return {};
    });
    const data = await service.availability(scope);
    expect(data.capacity).toBe(1);
    const allowed = seededLayouts[0].seats[0];
    await service.reserve({
      ...scope, row: allowed.row, desk: allowed.desk, seat: allowed.seat,
    }, owner);
    await expect(service.reserve({
      ...scope, row: 3, desk: 9, seat: 2,
    }, owner)).rejects.toBeInstanceOf(BadRequestException);
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
      (sql as string).startsWith('INSERT INTO campus_room_seat_bookings'));
    expect(insert?.[1]).toEqual(['М-307', date, '1', 3, 9, 2, owner]);
  });

  it('converts a database unique constraint violation to a conflict', async () => {
    query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.startsWith('SELECT layout_json')) return layoutRows(params);
      if (sql.startsWith('INSERT INTO campus_room_seat_bookings'))
        throw { code: 'ER_DUP_ENTRY' };
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
    query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.startsWith('SELECT layout_json')) return layoutRows(params);
      if (sql.startsWith('DELETE')) return { affectedRows: 0 };
      return {};
    });
    await expect(service.cancel(scope, other))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});
