import { ServicesService } from './services.service';

describe('ServicesService', () => {
  let service: ServicesService;

  beforeEach(() => {
    service = new ServicesService();
  });

  it('returns the three public Telegram groups for CampusApp', () => {
    const groups = service.getTelegramGroups();

    expect(groups.map((group) => group.username)).toEqual([
      'mpeichat',
      'mpei_1kurs',
      'MPEImai',
    ]);
    expect(groups).toHaveLength(3);
  });

  it('returns valid Telegram usernames and readable labels', () => {
    const groups = service.getTelegramGroups();

    for (const group of groups) {
      expect(group.username).toMatch(/^[a-zA-Z0-9_]{5,32}$/);
      expect(group.title.trim()).not.toBe('');
      expect(group.subtitle.trim()).not.toBe('');
    }
  });
});
