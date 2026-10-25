<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Администрирование сообществ: назначение по логину

Администратором можно назначить **конкретный аккаунт бэкенда по логину**,
например `OgarkovIA`. ID из MySQL Workbench искать не требуется.

**Важно:** обычный вход в CampusApp через БАРС использует WebView и
сохраняет учебный профиль локально. Он НЕ подтверждает серверу личность
администратора. В панели «Группы → Управление» требуется отдельный
вход **логин + пароль аккаунта Campus-backend**.

### Первоначальная настройка

1. **Если аккаунт `OgarkovIA` уже зарегистрирован в таблице `users`**
   через `POST /auth/register`, переходи сразу к шагу 2.

   Если аккаунта ещё нет, зарегистрируй его **до включения админ-имени
   в `.env`**. Запрос требует `username`, `email`, `password`:

   ```powershell
   $login = 'OgarkovIA'
   $email = Read-Host 'Email для регистрации'
   $password = Read-Host 'Новый пароль' -AsSecureString
   $body = @{
     username = $login
     email = $email
     password = [System.Net.NetworkCredential]::new('', $password).Password
   } | ConvertTo-Json
   Invoke-RestMethod -Uri 'http://localhost:8000/auth/register' -Method Post -ContentType 'application/json' -Body $body
   Remove-Variable body, password
   ```

   Email нужен **только для регистрации аккаунта**. При входе
   администратора он больше не вводится и не проверяется.
   Не используй пароль БАРС: создай отдельный надёжный пароль.

2. В локальный `.env` бэкенда добавь:

   ```dotenv
   COMMUNITY_ADMIN_USERNAMES=OgarkovIA
   COOKIE_SECURE=false
   SESSION_SECRET=ВСТАВЬ_СВОЙ_СЛУЧАЙНЫЙ_СЕКРЕТ_ДЛИНОЙ_ОТ_32_СИМВОЛОВ
   ```

   Для генерации `SESSION_SECRET` в PowerShell:

   ```powershell
   $bytes = New-Object byte[] 48
   $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
   $rng.GetBytes($bytes)
   [Convert]::ToBase64String($bytes)
   $rng.Dispose()
   ```

   Вставь сгенерированную строку вместо примера. **Не добавляй `.env`
   в GitHub.** Нескольких администраторов можно указать через запятую:
   `COMMUNITY_ADMIN_USERNAMES=OgarkovIA,SecondAdmin`.
   Предыдущая настройка `COMMUNITY_ADMIN_USER_IDS` тоже работает,
   но больше не обязательна.

3. Перезапусти бэкенд и обнови Flutter. Открой
   **Сервисы → Группы → значок администратора**, введи логин
   `OgarkovIA` и пароль, с которым регистрировался аккаунт.

**Как это защищено:** сервер ищет по логину **ровно один** аккаунт,
проверяет bcrypt-хеш пароля, а затем сверяет логин с `.env`. Если
имя дублируется в базе, вход блокируется. После конфигурации имя
администратора нельзя заново зарегистрировать через публичный API.
Проверка прав и CSRF-токена выполняется на сервере для каждого
административного запроса. Одного написанного логина недостаточно.

### Что можно делать

- Проверять, подтверждать, отклонять и удалять пользовательские заявки.
- Менять названия, описания, категории, ссылки Telegram/VK и картинки.
- Удалять опубликованные сообщества; встроенные скрывать и восстанавливать.

Маршруты модерации: `GET /services/admin/groups`,
`PATCH /services/admin/submissions/:id`,
`PATCH /services/admin/groups/:id`,
`PATCH /services/admin/groups/:id/icon`,
`DELETE /services/admin/groups/:id`.
Все требуют серверную сессию, а изменения — `X-Community-CSRF`.

### Дополнительно

Таблицы `campus_communities`, `campus_community_icons`,
`campus_featured_overrides` и `campus_featured_icons` создаются
при первом запросе. Если MySQL не разрешает `CREATE TABLE`,
примени `migrations/20261025_campus_communities.sql`.

Для продакшена необходимы HTTPS и постоянное хранилище серверных
сессий; стандартный MemoryStore предназначен только для разработки.

```powershell
npm test -- --runInBand auth.service.spec.ts community-admin.guard.spec.ts community-admin.service.spec.ts
```

## Студенческие сообщества CampusApp

Ветка `feature/cloud` содержит API каталога сообществ МЭИ:

- `GET /services/groups` — возвращает встроенные и одобренные группы:
  описание, Telegram/VK, автоматически полученную численность
  `memberCount`, источник `memberCountSource` (`telegram`/`vk`),
  время `memberCountCheckedAt` и признак приблизительного значения
  `memberCountApproximate`. Пример: страница Telegram может показывать
  `12.1K subscribers`, и тогда число помечается как приблизительное.
- `POST /services/groups/submissions` — запрос `multipart/form-data`:
  название `title`, `description`, `category`, `iconKind` (тип
  резервной пиктограммы), `telegramUrl` и/или `vkUrl` и выбранная
  пользователем картинка `icon` (PNG/JPEG/WebP, до 700 КБ).
  Ответ `202 Accepted` и `{ "id": 123, "status": "pending" }`.
  Старое поле `memberCount` сохраняется в DTO только для совместимости
  с прежними клиентами, но **сервер его игнорирует**.
- `GET /services/groups/icons/:id` — выдаёт выбранную автором иконку,
  только если модератор одобрил соответствующее сообщество.

### Получение численности из соцсетей

Бэкенд регулярно обновляет статистику **при запросе каталога**, кешируя
её на 15 минут. Число нельзя указать вручную. Записи в каталоге остаются
доступными, даже если платформа не отдала число.

Для Telegram сервер пытается получить число из публичной страницы
`https://t.me/<username>` (доступность счётчика зависит от настроек
сообщества). Если в `.env` настроен `TELEGRAM_BOT_TOKEN`, дополнительно
используется официальный Bot API `getChatMemberCount`. Для закрытых
групп бот должен иметь необходимый доступ; некоторые чаты не отдают
численность без вступления бота.

Для VK сервер вызывает `groups.getById` с `fields=members_count`
через API ВКонтакте. Требуется действующий `VK_ACCESS_TOKEN` в
локальном `.env` бэкенда; токен **никогда не добавляй в GitHub и
не передавай во Flutter**. Когда у сообщества две ссылки, сначала
используется счётчик Telegram, затем VK при недоступности первого.

В `.env.example` добавлены необязательные переменные:
```dotenv
TELEGRAM_BOT_TOKEN=
VK_ACCESS_TOKEN=
```

### Хранение и модерация

Таблицы `campus_communities` и `campus_community_icons` создаются
при первом обращении к каталогу, если у пользователя MySQL есть право
`CREATE TABLE`. Если разрешения нет, примени SQL-файл
`migrations/20261025_campus_communities.sql` вручную.

Загруженные картинки хранятся отдельно в MySQL; публикуются только
после одобрения. Новые заявки всегда имеют `status = 'pending'`.
Для текущего MVP модератор проверяет их вручную в MySQL:

```sql
SELECT id, title, description, telegram_url, vk_url, created_at
FROM campus_communities
WHERE status = 'pending' ORDER BY created_at DESC;

UPDATE campus_communities
SET status = 'approved'
WHERE id = 123 AND status = 'pending';

-- Или отклонить:
UPDATE campus_communities
SET status = 'rejected'
WHERE id = 123 AND status = 'pending';
```

Проверяй описание, ссылки и изображения до публикации.
Сейчас реализовано простое ограничение по IP (одна заявка за 10 минут
в рамках одного процесса). Перед публичным релизом потребуется
авторизация заявок, постоянный rate limiter и панель модератора.

Тесты (запуск из папки бэкенда):

```powershell
npm test -- --runInBand services.service.spec.ts community-stats.service.spec.ts
```

## CampusApp services API

The backend exposes a read-only catalog used by the Flutter application's
**Services → Groups** section:

```http
GET /services/groups
```

Example response:

```json
[
  {
    "title": "Чат студентов МЭИ",
    "username": "mpeichat",
    "subtitle": "Telegram · общение студентов"
  },
  {
    "title": "Первый курс МЭИ",
    "username": "mpei_1kurs",
    "subtitle": "Telegram · первокурсники"
  },
  {
    "title": "Подслушано МЭИ",
    "username": "MPEImai",
    "subtitle": "Telegram · канал"
  }
]
```

The directory is deliberately public and read-only: it contains only
public Telegram usernames and never holds student credentials or NFC card IDs.
Edit `src/services/services.service.ts` to curate the catalog.
The Flutter client validates Telegram handles and falls back to its bundled
list when the server cannot be reached.

Run the backend with `npm run start:dev`, then test locally with
`curl http://localhost:8000/services/groups`.

## CampusApp schedule API

The `feature/cloud` branch also serves the app's weekly schedule:

```http
GET /health
GET /schedule?group=А-03-23&date=2026-10-19
```

The `date` parameter is ISO `YYYY-MM-DD`. The server normalizes to
Monday, searches for the selected group in the public MPEI RUZ service,
loads the weekly timetable and returns
`{ "group": "...", "date": "YYYY-MM-DD", "lessons": [...] }`.

If the group is not found, the server returns 404. If the upstream
RUZ lookup or MPEI timetable is unavailable, it returns 503 instead of
silently reporting no lessons. The backend must be running and reachable
from the Android emulator (`10.0.2.2:8000`) or an actual phone
(the PC's LAN address) for online scheduling.

PowerShell health check:

```powershell
curl.exe http://localhost:8000/health
```

Schedule lookup tests:

```bash
npm test -- --runInBand schedule.service.spec.ts
```

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
