import axios from 'axios';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { BarsSessionVerifier } from './bars-session-verifier.service';

describe('BarsSessionVerifier', () => {
  const verifier = new BarsSessionVerifier();
  let get: jest.SpyInstance;

  const studentList = [
    '<table id="tbl__PartialListStudent"><tbody>',
    '<tr><td><a href="/bars_web/ST/Student/Main?studentID=12345">',
    'Студент</a></td><td>123456</td>',
    '<td>Информация</td><td>А-03-23</td></tr>',
    '</tbody></table>',
  ].join('');

  const studentPage = [
    '<div id="div-FormHeader">',
    '<span class="fw-bold">Студент (№ЗК: 123456)</span>',
    '</div>',
  ].join('');

  beforeEach(() => {
    get = jest.spyOn(axios, 'get');
    get.mockResolvedValueOnce({ status: 200, data: studentList })
      .mockResolvedValueOnce({ status: 200, data: studentPage });
  });

  afterEach(() => jest.restoreAllMocks());

  const groupGuid = '11111111-2222-4333-8444-555555555555';
  const starostaMenu =
    '<nav><a id="ddMessage"><span class="d-none d-md-inline">' +
    'public\\PetrovPS</span></a></nav>';
  const groupsHtml =
    '<a href="/bars_web/SG/StudyGroup/EditStudyGroup?sgID=' +
    groupGuid + '">А-03-23</a>';
  const starostaPage =
    '<div class="row"><label>Староста</label>' +
    '<div><input value="Петров Пётр Сергеевич (А-03-23)"></div></div>' +
    '<table><tbody><tr>' +
    '<td>public\\PetrovPS</td><td>Петров</td><td>Пётр</td>' +
    '<td>Сергеевич</td><td><a href="mailto:PetrovPS@mpei.ru">' +
    'Почта</a></td></tr></tbody></table>';

  it('grants starosta status only when authenticated BARS account matches ' +
     'the official group starosta field and responsible person', async () => {
    get.mockReset();
    get.mockResolvedValueOnce({status: 200, data: starostaMenu})
      .mockResolvedValueOnce({status: 200, data: groupsHtml})
      .mockResolvedValueOnce({status: 200, data: starostaPage});
    await expect(verifier.verifyStarosta(
      'ASP.NET_SessionId=abc123', 'А-03-23',
    )).resolves.toBe(true);
    expect(get).toHaveBeenCalledTimes(3);
    expect(get.mock.calls[2][0]).toBe(
      'https://bars.mpei.ru/bars_web/SG/StudyGroup/EditStudyGroup?sgID=' +
      groupGuid,
    );
  });

  it('does not grant the role to a journal maintainer who is not starosta',
      async () => {
    get.mockReset();
    get.mockResolvedValueOnce({status: 200, data: starostaMenu})
      .mockResolvedValueOnce({status: 200, data: groupsHtml})
      .mockResolvedValueOnce({
        status: 200,
        data: starostaPage.replace(
          'value="Петров Пётр Сергеевич (А-03-23)"',
          'value="Иванова Елена Петровна (А-03-23)"',
        ),
      });
    await expect(verifier.verifyStarosta(
      'ASP.NET_SessionId=abc123', 'А-03-23',
    )).resolves.toBe(false);
  });

  it('does not grant the role from a forged student-supplied BARS group link',
      async () => {
    get.mockReset();
    get.mockResolvedValueOnce({status: 200, data: starostaMenu})
      .mockResolvedValueOnce({status: 200, data:
        groupsHtml.replace('/bars_web/SG/StudyGroup/EditStudyGroup',
          'https://another.example/SG/StudyGroup/EditStudyGroup')});
    await expect(verifier.verifyStarosta(
      'ASP.NET_SessionId=abc123', 'А-03-23',
    )).resolves.toBe(false);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('reads verified account login only from authenticated BARS menu', async () => {
    get.mockReset();
    get.mockResolvedValueOnce({status: 200, data: starostaMenu});
    await expect(verifier.verifyAccountLogin('ASP.NET_SessionId=abc123'))
      .resolves.toBe('petrovps');
    expect(get.mock.calls[0][0]).toBe(
      'https://bars.mpei.ru/bars_web/Auth/Menu',
    );
  });

  it('fetches protected BARS pages itself and verifies the same record book', async () => {
    await expect(verifier.verify('ASP.NET_SessionId=abc123'))
      .resolves.toMatchObject({ recordBook: '123456', group: 'А-03-23' });

    expect(get).toHaveBeenCalledTimes(2);
    const [url, options] = get.mock.calls[0];
    expect(url).toBe(
      'https://bars.mpei.ru/bars_web/ST/Student/ListStudent',
    );
    expect(options.headers.Cookie).toBe('ASP.NET_SessionId=abc123');
    expect(options.maxRedirects).toBe(0);
    expect(options.timeout).toBeLessThanOrEqual(10000);
    expect(get.mock.calls[1][0]).toBe(
      'https://bars.mpei.ru/bars_web/ST/Student/Main?studentID=12345',
    );
  });


  it.each([
    ['/ST/Student/Main?studentID=12345',
      'https://bars.mpei.ru/ST/Student/Main?studentID=12345'],
    ['/bars_web/ST/Student/Main?foo=bar&StudentID=12345',
      'https://bars.mpei.ru/bars_web/ST/Student/Main?studentID=12345'],
    ['Main?studentID=12345',
      'https://bars.mpei.ru/bars_web/ST/Student/Main?studentID=12345'],
    ['/bars_web/ST/Student/Main?studentID=bf3c6758-a323-4d8d-9b0c-62aefc6e3340',
      'https://bars.mpei.ru/bars_web/ST_Study/Main/Main?studentID=bf3c6758-a323-4d8d-9b0c-62aefc6e3340'],
    ['/bars_web/ST/Student/Main?studentID=BF3C6758A3234D8D9B0C62AEFC6E3340',
      'https://bars.mpei.ru/bars_web/ST_Study/Main/Main?studentID=BF3C6758A3234D8D9B0C62AEFC6E3340'],
  ])('accepts BARS student-link format %s after checking both pages',
    async (href, expectedUrl) => {
      get.mockReset();
      const html = studentList.replace(
        '/bars_web/ST/Student/Main?studentID=12345', href,
      );
      get.mockResolvedValueOnce({ status: 200, data: html });
      get.mockResolvedValueOnce({ status: 200, data: studentPage });

      await expect(verifier.verify('ASP.NET_SessionId=abc123'))
        .resolves.toMatchObject({ recordBook: '123456', group: 'А-03-23' });
      expect(get.mock.calls[1][0]).toBe(expectedUrl);
    },
  );

  it('verifies a GUID profile using the BARS study page header format', async () => {
    get.mockReset();
    const id = 'bf3c6758-a323-4d8d-9b0c-62aefc6e3340';
    get.mockResolvedValueOnce({
      status: 200,
      data: studentList.replace('studentID=12345', 'studentID=' + id),
    });
    get.mockResolvedValueOnce({
      status: 200,
      data: '<div id="div-FormHeader"><div><span class="fw-bold">' +
        'Тестовый Студент (№ЗК - 123456)</span>' +
        '<span class="fw-bold">А-03-23</span></div></div>',
    });
    await expect(verifier.verify('ASP.NET_SessionId=abc123'))
      .resolves.toMatchObject({ recordBook: '123456', group: 'А-03-23' });
    expect(get.mock.calls[1][0]).toBe(
      'https://bars.mpei.ru/bars_web/ST_Study/Main/Main?studentID=' + id,
    );
  });

  it('accepts multiple profile links when they identify the same student', async () => {
    get.mockReset();
    const html = studentList.replace(
      'Студент</a>',
      'Студент</a><a href="/ST/Student/Main?StudentID=12345">Сведения</a>',
    );
    get.mockResolvedValueOnce({ status: 200, data: html });
    get.mockResolvedValueOnce({ status: 200, data: studentPage });
    await expect(verifier.verify('ASP.NET_SessionId=abc123'))
      .resolves.toMatchObject({ recordBook: '123456', group: 'А-03-23' });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('does not grant a group privilege if BARS pages disagree', async () => {
    get.mockReset();
    get.mockResolvedValueOnce({status: 200, data: studentList});
    get.mockResolvedValueOnce({
      status: 200,
      data: '<div id="div-FormHeader">' +
        '<span class="fw-bold">Студент (№ЗК: 123456)</span>' +
        '<span class="fw-bold">А-09-23</span></div>',
    });
    await expect(verifier.verify('ASP.NET_SessionId=abc123'))
      .resolves.toMatchObject({recordBook: '123456', group: undefined});
  });

  it('never trusts an unrecognized group format for notes', async () => {
    get.mockReset();
    get.mockResolvedValueOnce({status: 200,
      data: studentList.replace('<td>А-03-23</td>', '<td>Неизвестно</td>')});
    get.mockResolvedValueOnce({status: 200, data: studentPage});
    await expect(verifier.verify('ASP.NET_SessionId=abc123'))
      .resolves.toMatchObject({recordBook: '123456', group: undefined});
  });

  it('rejects multiple profile links referring to different students', async () => {
    get.mockReset();
    const html = studentList.replace(
      'Студент</a>',
      'Студент</a><a href="/ST/Student/Main?studentID=99999">Другой</a>',
    );
    get.mockResolvedValueOnce({ status: 200, data: html });
    await expect(verifier.verify('ASP.NET_SessionId=abc123'))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('rejects an untrusted second profile link even if the first is valid', async () => {
    get.mockReset();
    const html = studentList.replace(
      'Студент</a>',
      'Студент</a><a href="//untrusted.example/ST/Student/Main?studentID=12345">Другой</a>',
    );
    get.mockResolvedValueOnce({ status: 200, data: html });
    await expect(verifier.verify('ASP.NET_SessionId=abc123'))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('rejects an unsupported student ID instead of forwarding it', async () => {
    get.mockReset();
    get.mockResolvedValueOnce({
      status: 200,
      data: studentList.replace('studentID=12345', 'studentID=not-a-valid-id'),
    });
    await expect(verifier.verify('ASP.NET_SessionId=abc123'))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('refuses duplicated studentID even for a BARS URL', async () => {
    get.mockReset();
    get.mockResolvedValueOnce({
      status: 200,
      data: studentList.replace('studentID=12345',
        'studentID=12345&studentID=9999'),
    });
    await expect(verifier.verify('ASP.NET_SessionId=abc123'))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('refuses a different record book on the second page', async () => {
    get.mockReset();
    get.mockResolvedValueOnce({ status: 200, data: studentList });
    get.mockResolvedValueOnce({
      status: 200,
      data: '<div id="div-FormHeader">' +
        '<span class="fw-bold">Студент (№ЗК: 999999)</span></div>',
    });

    await expect(verifier.verify('ASP.NET_SessionId=abc123'))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a list with more than one student', async () => {
    get.mockReset();
    get.mockResolvedValueOnce({
      status: 200,
      data: studentList.replace('</tbody>',
        '<tr><td><a href="/bars_web/ST/Student/Main?studentID=4444">' +
        'Другой</a></td><td>444444</td><td></td><td>А-03-23</td></tr></tbody>'),
    });

    await expect(verifier.verify('ASP.NET_SessionId=abc123'))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('rejects injected headers or an empty cookie without HTTP requests', async () => {
    await expect(verifier.verify('ASP.NET_SessionId=abc\r\nHost: other'))
      .rejects.toBeInstanceOf(UnauthorizedException);
    await expect(verifier.verify(''))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(get).not.toHaveBeenCalled();
  });

  it('rejects expired sessions that redirect to the login page', async () => {
    get.mockReset();
    get.mockRejectedValueOnce({
      isAxiosError: true, code: 'ERR_BAD_RESPONSE',
      response: {status: 302},
    });
    await expect(verifier.verify('ASP.NET_SessionId=expired'))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('distinguishes temporary BARS outage from an expired student session',
      async () => {
    get.mockReset();
    get.mockRejectedValueOnce({
      isAxiosError: true, code: 'ERR_BAD_RESPONSE',
      response: {status: 503},
    });
    await expect(verifier.verify('ASP.NET_SessionId=abc123'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('returns a service error when the BARS host cannot be reached', async () => {
    get.mockReset();
    get.mockRejectedValueOnce({
      isAxiosError: true, code: 'ETIMEDOUT',
    });
    await expect(verifier.verify('ASP.NET_SessionId=abc123'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('refuses a public login page even when it responds with HTTP 200', async () => {
    get.mockReset();
    get.mockResolvedValueOnce({ status: 200, data: '<input name="password">' });
    await expect(verifier.verify('ASP.NET_SessionId=expired'))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('never follows links or identifiers from untrusted domains', async () => {
    get.mockReset();
    get.mockResolvedValueOnce({
      status: 200,
      data: studentList.replace(
        '/bars_web/ST/Student/Main?studentID=12345',
        '//attacker.test/ST/Student/Main?studentID=12345',
      ),
    });
    await expect(verifier.verify('ASP.NET_SessionId=abc123'))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });
});
