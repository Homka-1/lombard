# Этап 2 — Каркас проекта

- **Статус:** ✅ завершён
- **Дата:** 2026-11-03
- **Коммит:** `0ab669e`

## Учтено из прошлого этапа
- По заметкам `stage-01.md` расширен корневой `.gitignore`: venv, `__pycache__`, `*.db`,
  `backend/uploads/`, `.env*` (кроме `.env.example`), `frontend/dist`, кэши ruff/pytest.
- Регион — Казахстан: в настройках backend `currency = "KZT"`, `timezone = "Asia/Almaty"`,
  договорённость «суммы в тиынах, даты в UTC» записана в конфиге и README.
- Заглушка фронтенда сделана на цветах и радиусах из `design/tokens.json` (временное
  ручное подмножество CSS-переменных с теми же именами, что будут сгенерированы на этапе 9).
  Перед UI вызван скилл `frontend-design`.

## Что сделано
- **Backend** (`backend/`):
  - `pyproject.toml` — FastAPI, uvicorn, pydantic v2, pydantic-settings; dev — pytest, httpx, ruff.
    Остальные зависимости стека (SQLAlchemy, Alembic, JWT, Pillow) добавляются на своих этапах.
  - Структура пакетов по `CLAUDE.md`: `core/`, `api/`, `models/`, `schemas/`, `services/`, `storage/`.
  - `app/core/config.py` — `Settings` (префикс `LOMBARD_`, чтение `.env`): БД, каталог
    загрузок, параметры JWT, CORS, валюта/часовой пояс.
  - `app/main.py` — фабрика `create_app(settings)`; настройки кладутся в `app.state.settings`,
    эндпоинты получают их через зависимость `SettingsDep` (`app/core/deps.py`) — так тесты
    подменяют конфиг без глобального состояния.
  - `GET /api/health` — статус, версия, окружение, валюта, время UTC. Swagger — `/api/docs`.
  - Тесты: health, CORS для разрешённого/чужого источника, доступность OpenAPI.
  - `.env.example`.
- **Frontend** (`frontend/`):
  - Vite 6 + React 18 + TypeScript 5.8 (strict, `noUncheckedIndexedAccess`), React Router 6,
    TanStack Query 5.
  - Прокси `/api` → `http://127.0.0.1:8000` (меняется `VITE_BACKEND_URL`).
  - `src/api/client.ts` — минимальный клиент (`apiGet`, `ApiError`, `getHealth`).
  - Страница-заглушка в виде «залогового билета» (клеймо 585, линия отрыва) со статусом
    связи с API: загрузка / «Сервер на связи» / ошибка с подсказкой и кнопкой «Проверить снова».
  - ESLint 9 (flat config, typescript-eslint, react-hooks), Prettier, Vitest + Testing Library (jsdom).
- **Корень:** `README.md` (запуск, проверки, переменные окружения), `Makefile`
  (`install`, `backend`, `frontend`, `test`, `lint`, `build`), `.gitignore`.

## Как проверить
```bash
make install                      # или вручную, см. README
cd backend && .venv/bin/pytest && .venv/bin/ruff check . && .venv/bin/ruff format --check .
cd frontend && npm test && npm run lint && npm run format:check && npm run build
# запуск
make backend    # http://localhost:8000/api/docs
make frontend   # http://localhost:5173
```

## Результаты проверок
- pytest: 4 прошло, 0 упало.
- ruff check / ruff format --check: без замечаний.
- Vitest: 2 прошло (успешный ответ API; ошибка → повтор), 0 упало.
- ESLint, Prettier: без замечаний. `tsc -b && vite build`: сборка успешна (JS ~65 КБ gzip).
- Ручная проверка: backend и Vite запущены вместе, `/api/health` отвечает напрямую и через
  прокси; в Playwright страница показывает «Сервер на связи» на 1280 и 360 px, горизонтального
  скролла нет (на 360 px его давала линия отрыва — исправлено).

## Принятые решения
- Версии: React **18** (по стеку из `CLAUDE.md`, хотя актуальна 19), Vite 6 / Vitest 3,
  ESLint 9 — совместимая связка без конфликтов peer-зависимостей (`@eslint/js@10` требует ESLint 10).
- Все маршруты API под префиксом `/api`, включая Swagger (`/api/docs`) — один прокси на фронте.
- Конфиг — через фабрику приложения, а не глобальный `get_settings()` в зависимостях.
- Python-окружение — `backend/.venv` (игнорируется git); `Makefile` опирается на этот путь.

## Известные проблемы и техдолг
- Шрифты Spectral / Golos Text в заглушке не подключены — работают системные fallback
  (Georgia / system-ui). Подключить woff2 на этапе 9.
- CSS-переменные заглушки (`src/styles/global.css`) — ручное подмножество токенов; заменить
  генерацией из `design/tokens.json` на этапе 9.
- Starlette предупреждает, что для `TestClient` рекомендуется `httpx2`; установка пакета
  в этой сессии была заблокирована, предупреждение отфильтровано в `pyproject.toml`
  (на работу тестов не влияет).
- Docker-compose не делался (по плану — этап 12).

## Заметки для следующего этапа
- Этап 3: добавить в `pyproject.toml` `sqlalchemy>=2`, `alembic`; модели — в `app/models/`,
  сессия БД — новая зависимость рядом с `SettingsDep` в `app/core/deps.py`, URL брать из
  `settings.database_url`. В тестах использовать отдельную SQLite (in-memory/tmp) через
  фикстуру `settings` в `tests/conftest.py`.
- Деньги — `int` в тиынах; статусы заявки и подписи брать из `design/tokens.json` → `status`.
- Машину состояний держать чистыми функциями без БД (пригодится для демо на этапе 13).
- Seed: казахстанские телефоны (`+7 7XX …`), адреса Алматы/Астаны; демо-аккаунты всех ролей
  дописать в README (раздел «Демо-аккаунты»).
- Запускать проверки из `backend/` через `.venv/bin/...` или `make test` / `make lint`.
