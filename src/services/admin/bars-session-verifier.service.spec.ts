import axios from 'axios';
import { UnauthorizedException } from '@nestjs/common';
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

  it('fetches protected BARS pages itself and verifies the same record book', async () => {
    await expect(verifier.verify('ASP.NET_SessionId=abc123'))
      .resolves.toEqual({ recordBook: '123456' });

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
    get.mockRejectedValueOnce(new Error('302 Found'));
    await expect(verifier.verify('ASP.NET_SessionId=expired'))
      .rejects.toBeInstanceOf(UnauthorizedException);
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
