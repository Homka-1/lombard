# Ломбард онлайн

Учебный проект: онлайн-ломбард — оценка залога по фото, оферта эксперта, вызов курьера
за изделием и выдача займа в тенге (₸). План и правила разработки — в [`CLAUDE.md`](CLAUDE.md),
ход работ — в [`docs/STATUS.md`](docs/STATUS.md).

## Состав репозитория

| Каталог | Что внутри |
|---------|-----------|
| `backend/` | API на FastAPI (Python 3.12+) |
| `frontend/` | Веб-интерфейс на React 18 + TypeScript + Vite |
| `design/` | Макет: токены, сценарий Adobe Illustrator, PNG-превью экранов |
| `docs/` | Статус и отчёты по этапам |

## Требования

- Python 3.12 или новее
- Node.js 20 или новее (с npm)

## Быстрый старт

Linux/macOS: `make install`, `make db` (миграции + демо-данные), затем в двух терминалах
`make backend` и `make frontend`.
Или вручную:

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
cp .env.example .env               # необязательно: значения по умолчанию подходят для разработки
alembic upgrade head               # создать/обновить схему БД (SQLite: backend/lombard.db)
python -m app.seed                 # справочники и демо-аккаунты (можно запускать повторно)
uvicorn app.main:app --reload
```

- Проверка: <http://localhost:8000/api/health>
- Документация API (Swagger): <http://localhost:8000/api/docs>

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Откройте <http://localhost:5173>. Dev-сервер проксирует запросы `/api/*` на backend
(`http://127.0.0.1:8000`, адрес меняется переменной `VITE_BACKEND_URL`). Если backend
запущен, на странице появится «Сервер на связи».

## Проверки

```bash
cd backend && pytest && ruff check . && ruff format --check .
cd frontend && npm test && npm run lint && npm run format:check && npm run build
```

Или из корня: `make test`, `make lint`, `make build`.

## Настройки backend

Переменные окружения с префиксом `LOMBARD_` (см. `backend/.env.example`):

| Переменная | По умолчанию | Назначение |
|-----------|--------------|-----------|
| `LOMBARD_ENVIRONMENT` | `development` | Название окружения |
| `LOMBARD_DATABASE_URL` | `sqlite:///./lombard.db` | База данных (SQLAlchemy URL) |
| `LOMBARD_DB_ECHO` | `false` | Печатать SQL-запросы в лог |
| `LOMBARD_UPLOAD_DIR` | `./uploads` | Каталог для фото изделий |
| `LOMBARD_MAX_PHOTOS` | `6` | Максимум фото в заявке |
| `LOMBARD_MAX_PHOTO_MB` | `10` | Максимальный размер одного фото, МБ |
| `LOMBARD_PHOTO_URL_TTL_SECONDS` | `3600` | Срок действия подписанных ссылок на фото |
| `LOMBARD_OFFER_TTL_HOURS` | `72` | Сколько часов клиент может принять предложение эксперта |
| `LOMBARD_GRACE_PERIOD_DAYS` | `30` | Льготный период после срока займа, затем изделие переходит ломбарду |
| `LOMBARD_MAX_LOAN_EXTENSIONS` | `5` | Сколько раз можно продлить займ |
| `LOMBARD_TIME_TRAVEL` | — | «Перемотка времени» для демо; по умолчанию только в `development`/`test` |
| `LOMBARD_SECRET_KEY` | `dev-insecure-secret-…` | Ключ подписи JWT; вне `development`/`test` обязателен свой (32+ символа) |
| `LOMBARD_ACCESS_TOKEN_TTL_MINUTES` | `30` | Время жизни access-токена |
| `LOMBARD_REFRESH_TOKEN_TTL_DAYS` | `14` | Время жизни refresh-токена |
| `LOMBARD_CORS_ORIGINS` | `["http://localhost:5173","http://127.0.0.1:5173"]` | Разрешённые источники (JSON-список) |

Регион — Казахстан: валюта KZT, суммы хранятся в тиынах, даты — в UTC.

## База данных

- Схема — миграции Alembic (`backend/alembic/versions/`). Новая миграция после изменения
  моделей: `cd backend && alembic revision --autogenerate -m "описание"`, затем проверить
  файл и `alembic upgrade head`. `alembic check` — убедиться, что модели и миграции совпадают.
- Начать с чистой БД: удалить `backend/lombard.db` и выполнить `make db`.
- Деньги хранятся целыми числами в тиынах (1 ₸ = 100 тиын), вес — в миллиграммах,
  ставка — в базисных пунктах в день (25 = 0,25 % в день), даты — в UTC.

## Аутентификация

JWT: короткий access-токен (`Authorization: Bearer …`) и долгий refresh-токен.

| Метод | Путь | Назначение |
|-------|------|-----------|
| POST | `/api/auth/register` | Регистрация (всегда роль «Клиент»), сразу возвращает токены |
| POST | `/api/auth/login` | Вход, JSON `{email, password}` → токены + профиль |
| POST | `/api/auth/token` | То же в виде OAuth2-формы — для кнопки **Authorize** в Swagger (`username` = e-mail) |
| POST | `/api/auth/refresh` | `{refresh_token}` → новая пара токенов |
| GET / PATCH | `/api/auth/me` | Профиль текущего пользователя (имя, телефон, город) |
| POST | `/api/auth/me/password` | Смена пароля |
| GET / PATCH | `/api/admin/users` | Администратор: список пользователей, смена роли и блокировка |

В Swagger (`/api/docs`) нажмите **Authorize**, введите e-mail демо-аккаунта и `demo1234`.
Телефоны принимаются в любом привычном виде (`8 701 123 45 67`, `+7 (701) 123-45-67`) и
хранятся в формате E.164 (`+77011234567`).

## Заявки, фото и предоценка

| Метод | Путь | Назначение |
|-------|------|-----------|
| GET | `/api/catalog/categories`, `/metals`, `/conditions` | Справочники для мастера заявки (без входа): категории с LTV, пробы и цены металлов, состояния |
| GET / POST | `/api/applications` | Список заявок (клиент — свои, эксперт/админ — все; фильтр `?status=`), создание черновика |
| GET / PATCH / DELETE | `/api/applications/{id}` | Карточка (фото, предоценка, история статусов), изменение параметров, удаление черновика |
| POST | `/api/applications/{id}/photos` | Загрузка фото (multipart, поле `files`, JPEG/PNG/WebP, до 6 шт. по 10 МБ) |
| DELETE | `/api/applications/{id}/photos/{photo_id}` | Удалить фото |
| PUT | `/api/applications/{id}/photos/order` | Порядок фото `{photo_ids: [...]}`; первое — обложка |
| POST | `/api/applications/{id}/submit` | Отправить: `DRAFT/NEED_INFO → SUBMITTED → PRE_ESTIMATED` с автоматической предоценкой |
| GET | `/api/photos/{id}/{full\|thumb}?exp=…&sig=…` | Файл фото по подписанной ссылке (ссылки приходят в ответах API, живут ~1 ч) |

Менять заявку и фото клиент может только в статусах «Черновик» и «Нужны фото». Все суммы — в
тиынах (`13690000` = 136 900 ₸), вес в API — в граммах (`weight_g`, до 0,001 г).

**Фото** перекодируются в JPEG (до 2560 px, превью 480 px): поворот по EXIF, удаление
метаданных (в т. ч. GPS), отсев не-изображений и «бомб» по разрешению. Хранятся в
`LOMBARD_UPLOAD_DIR` (по умолчанию `backend/uploads/`, в git не попадает).

**Предоценка** (`app/domain/pricing.py`, мок-анализ фото — `app/services/photo_appraiser.py`):
- металлы: `вес × проба / 1000 × цена 999 за грамм` × премия ювелирного бренда × состояние;
- часы и электроника: базовая цена сегмента бренда × коэффициент состояния (у золотых часов
  стоимость металла — нижняя граница);
- уверенность = 65 % полнота параметров + 35 % качество фото (резкость, экспозиция,
  контраст, разрешение, число разных ракурсов); чем ниже уверенность, тем шире диапазон;
- в `details` — шаги расчёта, замечания по фото и ориентир суммы займа (стоимость × LTV).

Сценарий в Swagger: **Authorize** как `client@lombard.kz` → `GET /api/applications` (готовый
черновик) → `POST …/photos` (1–6 фото) → `POST …/submit` → в ответе `pre_estimate`.

## Экспертная оценка, предложение и калькулятор

| Метод | Путь | Кто | Назначение |
|-------|------|-----|-----------|
| GET | `/api/expert/queue?scope=new\|mine\|all` | эксперт, админ (просмотр) | Очередь: `new` — ждут эксперта (старые первыми), `mine` — мои в работе, `all` — весь этап оценки |
| POST | `/api/expert/applications/{id}/take` | эксперт | Взять в работу: `PRE_ESTIMATED → UNDER_REVIEW` |
| POST | `/api/expert/applications/{id}/quote` | эксперт | Живой калькулятор условий (ничего не сохраняет) |
| POST | `/api/expert/applications/{id}/offer` | эксперт | Экспертная оценка + условия займа → `OFFER_SENT` |
| POST | `/api/expert/applications/{id}/need-info` | эксперт | Запросить фото/сведения → `NEED_INFO` (`{comment}`) |
| POST | `/api/expert/applications/{id}/reject` | эксперт | Отклонить → `REJECTED` (`{reason}`) |
| POST | `/api/applications/{id}/offer/accept` | клиент | Принять предложение → `OFFER_ACCEPTED` |
| POST | `/api/applications/{id}/offer/decline` | клиент | Отказаться → `OFFER_DECLINED` (`{reason}` — необязательно) |
| POST | `/api/calculator` | все | Публичный калькулятор: категория + стоимость **или** параметры изделия, срок |

Действовать по заявке в работе может только взявший её эксперт (другим — 403), админ видит
очередь, но не ставит оценки. В карточке заявки — `offer`, `expert_appraisal`, `expert`,
`client` и `actions` (что может сделать текущий пользователь — для кнопок UI).

**Калькулятор займа** (`app/domain/loan_calc.py`, чистые функции): сумма = рыночная стоимость
× LTV, округление **вниз** до 100 ₸; проценты = сумма × ставка в день × дни (простые, с
округлением до тиына); займ гасится одним платежом, «график» — сколько вернуть на 1, 7, 14, …
день и в дату возврата; после срока — 30 дней льготного периода. Эксперт выбирает LTV
не выше категории, ставку не выше ставки категории, срок в пределах категории. Предложение
действует `LOMBARD_OFFER_TTL_HOURS` часов, затем истекает (заявка → `OFFER_DECLINED`).
Календарные даты займа — по времени Казахстана (UTC+5).

Сценарий в Swagger: клиент отправляет заявку → **Authorize** как `expert@lombard.kz` →
`GET /api/expert/queue` → `POST …/take` → `POST …/offer`
(`{"market_value": 11900000, "term_days": 30}`) → снова как клиент → `POST …/offer/accept`.

## Курьер и осмотр

| Метод | Путь | Кто | Назначение |
|-------|------|-----|-----------|
| GET | `/api/delivery/cities` | все с входом | Города, где есть активные курьеры |
| GET | `/api/delivery/slots?city=Алматы` | все с входом | Слоты визита по 2 ч (10:00–20:00 по времени Казахстана), `capacity`/`free`/`available` |
| POST | `/api/applications/{id}/courier` | клиент, админ | Вызвать курьера: `{city, address, contact_phone?, slot_start, comment?}` → `COURIER_SCHEDULED`; курьер назначается автоматически |
| PUT | `/api/applications/{id}/courier` | клиент, админ | Перенести визит (пока курьер не выехал) |
| GET | `/api/courier/tasks?scope=day\|active\|done\|all&day=…` | курьер (свои), админ (все) | Выезды; по умолчанию — на сегодня |
| GET | `/api/courier/tasks/{id}` | курьер, админ | Выезд: адрес, слот, клиент и телефон, `actions` |
| POST | `/api/courier/tasks/{id}/start` · `/pick-up` · `/deliver` | курьер | «Выехал» → «Забрал изделие» → «Доставил в ломбард» |
| GET | `/api/admin/couriers?city=` | админ | Курьеры и загрузка (незавершённые выезды, выезды на сегодня) |
| GET | `/api/admin/courier-tasks?scope=&courier_id=&unassigned=` | админ | Все выезды |
| POST | `/api/admin/courier-tasks/{id}/assign` | админ | Переназначить курьера `{courier_id}` (пока он не выехал) |
| GET | `/api/expert/queue?scope=inspection` | эксперт | Доставленные изделия, ждут осмотра |
| POST | `/api/expert/applications/{id}/inspection/quote` | эксперт | Расчёт итоговой суммы без сохранения |
| POST | `/api/expert/applications/{id}/inspection` | эксперт | Осмотр → `INSPECTED`: `{market_value?, loan_amount?, hallmark_confirmed?, weight_g?, comment?}` |

**Назначение курьера** — автоматически: среди активных курьеров города, свободных в этом
слоте, — наименее загруженный (меньше незавершённых выездов). Вместимость слота = число
курьеров города; если все заняты — 409. **Осмотр**: эксперт подтверждает сумму или
уменьшает её (не выше принятой клиентом и не выше LTV новой оценки; причина обязательна);
итоговые условия — в `inspection.details` карточки заявки. В карточке также `courier_visit`.

Сценарий в Swagger: клиент принял предложение → `GET /api/delivery/slots?city=Алматы` →
`POST /api/applications/{id}/courier` → **Authorize** как `courier@lombard.kz` →
`GET /api/courier/tasks?scope=active` → `start` → `pick-up` → `deliver` → как
`expert@lombard.kz` → `POST /api/expert/applications/{id}/inspection` (`{}`).

## Займ: выдача, погашение, продление, возврат

| Метод | Путь | Кто | Назначение |
|-------|------|-----|-----------|
| POST | `/api/applications/{id}/payout` | клиент, админ | После осмотра: `{card_number}` → перевод на карту (мок) → `FUNDS_ISSUED` → `LOAN_ACTIVE`, залоговый билет |
| GET | `/api/loans?status=` | клиент (свои), админ (все) | Займы с суммами «на сегодня» |
| GET | `/api/loans/{id}` | клиент, админ | Займ: к оплате сегодня, срок, льготный период, продление, платежи, `actions` |
| GET | `/api/loans/{id}/ticket[?download=true]` | клиент, админ | Залоговый билет — HTML для печати (PDF — «Сохранить как PDF» в браузере) |
| GET | `/api/loans/{id}/extension?term_days=` | клиент, админ | Сколько стоит продление |
| POST | `/api/loans/{id}/repay` | клиент | Погасить полностью `{card_number}` → `REPAID` |
| POST | `/api/loans/{id}/extend` | клиент | Оплатить проценты, новый срок от сегодня `{card_number, term_days?}` → `EXTENDED` → `LOAN_ACTIVE` |
| POST | `/api/applications/{id}/return` | клиент, админ | После погашения: курьер везёт изделие (`VisitCreate`); курьер `start` → `deliver` → `ITEM_RETURNED` |
| GET | `/api/notifications[?unread=true]` · `/unread-count` | все с входом | Уведомления личного кабинета |
| POST | `/api/notifications/{id}/read` · `/read-all` | все с входом | Отметить прочитанными |

**Расчёт.** Проценты — простые, за каждый начатый день по времени Казахстана с даты выдачи
или последнего продления (не меньше одного дня), ставка из оферты. Вернуть — до конца дня
срока; после него займ `OVERDUE`, проценты продолжают начисляться, 30 дней льготного
периода можно погасить или продлить, затем — `FORFEITED` (изделие переходит ломбарду).
Статус займа пересчитывается при каждом чтении и фоновой задачей.

**Мок-банк** (`app/services/payments.py`, интерфейс `PaymentGateway`): любая карта с
верной контрольной суммой проходит, например `4400 4301 2345 6789`;
`4000 0000 0000 0002` — «Банк отклонил операцию», `4000 0000 0000 9995` — «Недостаточно
средств» (для списаний). Неудачные списания сохраняются как `FAILED`-платежи (ответ 402).
**SMS и e-mail** не отправляются: мок пишет их в журнал (`GET /api/admin/messages`).

### Администратор

| Метод | Путь | Назначение |
|-------|------|-----------|
| GET · POST · PATCH | `/api/admin/categories[/{id}]` | Категории: LTV, ставка, сроки, активность |
| GET · POST | `/api/admin/metal-prices` | История цен металлов, новая цена (с `effective_from`) |
| GET · PATCH | `/api/admin/users[/{id}]` | Пользователи, роль, блокировка |
| POST | `/api/admin/users` | Создать сотрудника (курьеру нужен город) |
| GET | `/api/admin/stats` | Дашборд: заявки по статусам и воронка, портфель, выдано/погашено, проценты, курьеры |
| POST | `/api/admin/jobs/run` | Фоновые задачи: истечение офферов, просрочка, изъятие залога |
| GET · POST · DELETE | `/api/admin/clock` | «Перемотать время» `{days, hours, run_jobs}` / вернуть реальное |
| GET | `/api/admin/messages?channel=SMS\|EMAIL` | Журнал мок-SMS и e-mail |

**Перемотка времени** — для показа продления и просрочки без ожидания: смещение часов
приложения хранится в памяти процесса (сбрасывается при перезапуске, нужен один воркер
uvicorn), работает только в `development`/`test` (или `LOMBARD_TIME_TRAVEL=true`).

Сценарий в Swagger: после осмотра как клиент — `POST /api/applications/{id}/payout`
(`{"card_number": "4400 4301 2345 6789"}`) → `GET /api/loans/{loan_id}` → как админ
`POST /api/admin/clock` (`{"days": 10}`) → как клиент `POST /api/loans/{loan_id}/repay` →
`GET /api/delivery/slots?city=Алматы` → `POST /api/applications/{id}/return` → как курьер
`start` → `deliver`. Просрочка: `{"days": 31}`, изъятие: `{"days": 61}`.

## Демо-аккаунты

Создаются командой `python -m app.seed` (или `make seed`). Пароль у всех — **`demo1234`**
(`python -m app.seed --reset-passwords` вернёт его, если поменяли).

| Роль | E-mail | Имя | Телефон | Город |
|------|--------|-----|---------|-------|
| Клиент | `client@lombard.kz` | Айгерим Садыкова | +7 701 123-45-67 | Алматы |
| Клиент | `client2@lombard.kz` | Данияр Ахметов | +7 777 123-45-68 | Астана |
| Эксперт | `expert@lombard.kz` | Ерлан Касымов | +7 705 222-33-44 | Алматы |
| Курьер | `courier@lombard.kz` | Нурлан Жумабаев | +7 747 555-66-77 | Алматы |
| Курьер | `courier2@lombard.kz` | Асель Нурланова | +7 775 888-99-00 | Астана |
| Администратор | `admin@lombard.kz` | Гульнара Беккожина | +7 727 300-10-20 | Алматы |

Вход через API — см. раздел «Аутентификация». У клиента `client@lombard.kz` есть черновик заявки.
Справочники: 5 категорий (золото 80 %, серебро 70 %, платина 75 %, часы 60 %, электроника 50 %)
и учебные цены металлов 999 пробы за грамм.
