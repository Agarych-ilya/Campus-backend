import { BarsSessionVerifier } from './bars-session-verifier.service';

describe('BARS role group discovery cannot grant access from links', () => {
  const menu = '<nav><a href="/bars_web/SG/StudyGroup/ListStudyGroup">' +
    'Учебные группы</a></nav>';
  const group = (name:string, id:string) =>
    '<a href="/bars_web/SG/StudyGroup/EditStudyGroup?sgID=' +
    id + '">' + name + '</a>';
  const good = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  test('parses all protected same-origin study group links, not just first', async () => {
    const verifier = new BarsSessionVerifier();
    (verifier as any).fetchBars = jest.fn()
      .mockResolvedValueOnce(menu)
      .mockResolvedValueOnce(
        group('А-03-23',good) + group('Б-02-24',good) +
        group('А-03-23',good) +
        group('Посторонняя',good) +
        '<a href="https://evil.example/bars_web/SG/StudyGroup/' +
        'EditStudyGroup?sgID=' + good + '">Е-01-24</a>',
      );
    const groups = await verifier.discoverGroupCandidates('safe=cookie');
    expect(groups).toEqual(['А-03-23','Б-02-24']);
  });

  test('a group listing without the menu role never exposes candidates', async () => {
    const verifier = new BarsSessionVerifier();
    (verifier as any).fetchBars = jest.fn()
      .mockResolvedValueOnce('<a>Обычный студент</a>')
      .mockResolvedValueOnce(group('А-03-23',good));
    expect(await verifier.discoverGroupCandidates('safe=cookie')).toEqual([]);
  });

  test('missing or malformed group identifiers are discarded', async () => {
    const verifier = new BarsSessionVerifier();
    (verifier as any).fetchBars = jest.fn()
      .mockResolvedValueOnce(menu)
      .mockResolvedValueOnce(
        group('А-03-23','not-a-guid') +
        '<a href="/bars_web/SG/StudyGroup/EditStudyGroup?' +
        'sgID=' + good + '&returnTo=https://evil.example">Б-01-25</a>',
      );
    expect(await verifier.discoverGroupCandidates('safe=cookie')).toEqual([]);
  });
});
