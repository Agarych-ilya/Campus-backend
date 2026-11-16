import { ConflictException } from '@nestjs/common';
import { parseBarsStudents } from './bars-roster-fetcher.service';

const breadcrumb = '<ol class="breadcrumb"><li>Учебные группы</li>' +
  '<li>А-03-23. Студенты</li></ol>';
const row = (fio: string, address: string, status = 'обучается') =>
  `<tr><td>1</td><td><a href="/bars_web/ST/Student/Edit?studentID=${address.split('@')[0]}">${fio}</a></td>` +
  `<td>${address}</td><td>${status}</td></tr>`;
const table = (rows: string, footer = '') =>
  `<div class="dataTables_wrapper"><table><thead><tr><th>№</th>` +
  `<th>ФИО</th><th>Почта</th><th>Статус обучения</th></tr></thead>` +
  `<tbody>${rows}</tbody></table>${footer}</div>`;
const students = row('Иванов Иван Иванович', 'ivanovii@mpei.ru') +
  row('Петров Пётр Петрович', 'petrovpp@mpei.ru') +
  row('Сидоров Олег Николаевич', 'sidorovon@mpei.ru');

describe('backend BARS roster extraction', () => {
  test('reads only a complete, group-bound table from protected BARS HTML', () => {
    const result = parseBarsStudents(breadcrumb + table(students), 'А-03-23');
    expect(result.complete).toBe(true);
    expect(result.students.map(s => s.fullName)).toEqual([
      'Иванов Иван Иванович', 'Петров Пётр Петрович',
      'Сидоров Олег Николаевич',
    ]);
    expect(result.students[0].email).toBe('ivanovii@mpei.ru');
  });

  test('refuses a different group, even if student names are present', () => {
    expect(() => parseBarsStudents(breadcrumb + table(students), 'А-02-23'))
      .toThrow(ConflictException);
  });

  test('refuses partial pagination and duplicated student names', () => {
    const footer = '<div>Отображены 1–3 записей из 25</div>';
    expect(parseBarsStudents(breadcrumb + table(students, footer), 'А-03-23')
      .complete).toBe(false);
    const duplicated = students + row('Иванов Иван Иванович', 'x@mpei.ru');
    expect(() => parseBarsStudents(breadcrumb + table(duplicated), 'А-03-23'))
      .toThrow(ConflictException);
  });

  test('does not treat journal-staff or other tables as a student roster', () => {
    const wrong = '<table><tr><th>ФИО</th><th>Кафедра</th></tr>' +
      `<tr><td>Модератор</td></tr></table>`;
    expect(parseBarsStudents(breadcrumb + wrong, 'А-03-23').found).toBe(false);
    expect(() => parseBarsStudents(breadcrumb + table(students) + table(students),
      'А-03-23')).toThrow(ConflictException);
  });
});
