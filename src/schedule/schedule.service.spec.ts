import axios from 'axios';
import {
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { ScheduleService } from './schedule.service';

describe('ScheduleService: MPEI group lookup', () => {
  let service: ScheduleService;

  beforeEach(() => {
    service = new ScheduleService();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('chooses an exact group match instead of the first suggestion', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({
      data: [
        { id: 101, label: 'А-03-22' },
        { id: 202, label: 'А-03-23' },
      ],
    } as never);

    const id = await (service as any).getGroupId('А-03-23');

    expect(id).toBe('202');
  });

  it('retries official HTTP when the HTTPS search is unavailable', async () => {
    const get = jest.spyOn(axios, 'get');
    get.mockRejectedValueOnce(new Error('TLS handshake failed'));
    get.mockResolvedValueOnce({
      data: [{ id: 303, label: 'А-03-23' }],
    } as never);

    const id = await (service as any).getGroupId('А-03-23');

    expect(id).toBe('303');
    expect(String(get.mock.calls[0][0])).toContain('https://ts.mpei.ru/');
    expect(String(get.mock.calls[1][0])).toContain('http://ts.mpei.ru/');
  });

  it('returns a not-found response for an unknown group', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({
      data: [],
    } as never);

    await expect(
      (service as any).getGroupId('НЕСУЩЕСТВУЮЩАЯ-ГРУППА'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reports external RUZ outages as 503 instead of generic 500', async () => {
    jest.spyOn(axios, 'get').mockRejectedValue(
      new Error('RUZ offline'),
    );

    await expect(
      (service as any).getGroupId('А-03-23'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
