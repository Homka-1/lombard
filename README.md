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
| `LOMBARD_UPLOAD_DIR` | `./uploads` | Каталог для фото изделий (с этапа 5) |
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
