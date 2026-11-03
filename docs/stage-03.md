# Этап 3 — Модель данных и БД

- **Статус:** ✅ завершён
- **Дата:** 2026-11-03
- **Коммит:** `COMMIT_SHA`

## Учтено из прошлого этапа
- По заметкам `stage-02.md`: в `pyproject.toml` добавлены `sqlalchemy>=2`, `alembic`;
  модели — в `app/models/`; сессия БД — зависимость `SessionDep` рядом с `SettingsDep`
  в `app/core/deps.py`, URL берётся из `settings.database_url`.
- Тесты используют отдельную SQLite во временном каталоге через фикстуры
  `db_url` / `settings` / `engine` / `session` в `tests/conftest.py`.
- Деньги — `int` в тиынах; статусы и русские подписи сверяются тестом с
  `design/tokens.json` → `status`.
- Машина состояний — чистые функции без БД (`app/domain/state_machine.py`), пригодна для
  переноса в демо (этап 13).
- Seed: казахстанские телефоны, города Алматы/Астана; демо-аккаунты дописаны в README.

## Что сделано
- **Домен** (`app/domain/`, без зависимостей от БД и FastAPI):
  - `enums.py` — `Role`, `Actor` (роли + `SYSTEM`), `ApplicationStatus` (21 статус),
    `Metal`, `ItemCondition`, `AppraisalKind` (AUTO/EXPERT/INSPECTION), `OfferStatus`,
    `CourierTaskKind`/`CourierTaskStatus`, `LoanStatus`, `PaymentKind`/`PaymentStatus`,
    `NotificationChannel`.
  - `state_machine.py` — таблица переходов `(из, в) → кто может`, `can_transition`,
    `allowed_targets`, `ensure_transition` (ошибки `InvalidTransitionError` /
    `TransitionForbiddenError` с русским текстом), `TERMINAL_STATUSES`, `STATUS_LABELS`.
- **БД** (`app/core/db.py`): фабрика движка (для SQLite — `check_same_thread=False` и
  `PRAGMA foreign_keys=ON`), фабрика сессий; движок создаётся в `create_app` и хранится в
  `app.state`. `/api/health` теперь проверяет БД (`database: ok|error`).
- **Модели** (`app/models/`): `User`, `Category`, `MetalPrice`, `Application`, `Photo`,
  `StatusHistory`, `Appraisal`, `Offer`, `CourierTask`, `Loan`, `Payment`, `Notification`.
  - Тип `UTCDateTime` — даты всегда с часовым поясом UTC (в т. ч. на SQLite), наивные
    `datetime` запрещены.
  - Перечисления хранятся как VARCHAR + CHECK (переносимо SQLite ↔ PostgreSQL).
  - Соглашение об именах ограничений (нужно Alembic batch-режиму на SQLite).
  - CHECK-ограничения: LTV 1–100, сроки, проба ≤ 999, диапазон оценки `min ≤ value ≤ max`,
    уверенность 0–100, положительные суммы, `total_to_repay ≥ loan_amount`, слот курьера.
  - Каскадное удаление дочерних записей заявки; один займ на заявку (unique).
  - `Application.number` — номер вида `Л-000042`.
- **Сервис** `app/services/status.py`: `change_status()` — проверяет переход по машине
  состояний и роли пользователя (`None` = система), пишет `StatusHistory`, ставит
  `submitted_at`; `record_created()` — первая запись истории.
- **Пароли** (`app/core/security.py`): `hash_password` / `verify_password` на `bcrypt`
  (нужны seed-данным; JWT — на этапе 4).
- **Alembic**: `alembic.ini`, `alembic/env.py` (URL из `LOMBARD_DATABASE_URL` или
  `sqlalchemy.url`; `render_as_batch`, `compare_type`), шаблон миграции в современном
  стиле, первая миграция `initial schema`.
- **Seed** (`python -m app.seed`, идемпотентный): 5 категорий, цены 4 металлов, 6 демо-
  пользователей всех ролей (пароль `demo1234`), черновик заявки у демо-клиента;
  `--reset-passwords`.
- `Makefile`: цели `db`, `migrate`, `seed`. README: разделы «База данных» и
  «Демо-аккаунты». `CLAUDE.md`: команды миграций/seed.

### Переходы машины состояний
| Из → в | Кто |
|--------|-----|
| DRAFT → SUBMITTED | клиент |
| SUBMITTED → PRE_ESTIMATED | система |
| PRE_ESTIMATED → UNDER_REVIEW | эксперт |
| UNDER_REVIEW → OFFER_SENT / REJECTED / NEED_INFO | эксперт |
| NEED_INFO → SUBMITTED | клиент |
| OFFER_SENT → OFFER_ACCEPTED | клиент |
| OFFER_SENT → OFFER_DECLINED | клиент, система (истёк срок оферты) |
| OFFER_ACCEPTED → COURIER_SCHEDULED | клиент, админ |
| COURIER_SCHEDULED → COURIER_EN_ROUTE → ITEM_PICKED_UP → ITEM_DELIVERED | курьер |
| ITEM_DELIVERED → INSPECTED | эксперт |
| INSPECTED → FUNDS_ISSUED | система, админ |
| FUNDS_ISSUED → LOAN_ACTIVE, EXTENDED → LOAN_ACTIVE | система |
| LOAN_ACTIVE → EXTENDED | клиент |
| LOAN_ACTIVE → REPAID | клиент, система |
| LOAN_ACTIVE → OVERDUE | система, админ |
| OVERDUE → REPAID / EXTENDED | клиент (в льготный период); REPAID — также система |
| OVERDUE → FORFEITED | система, админ |
| REPAID → ITEM_RETURNED | курьер |

Конечные статусы: REJECTED, OFFER_DECLINED, ITEM_RETURNED, FORFEITED.

## Как проверить
```bash
cd backend
.venv/bin/pip install -e ".[dev]"
rm -f lombard.db && .venv/bin/alembic upgrade head && .venv/bin/python -m app.seed
.venv/bin/python -m app.seed          # повторно: «изменений нет»
.venv/bin/alembic check               # модели и миграции совпадают
.venv/bin/alembic downgrade base && .venv/bin/alembic upgrade head
.venv/bin/pytest && .venv/bin/ruff check . && .venv/bin/ruff format --check .
# или из корня: make db && make test && make lint
```

## Результаты проверок
- pytest: **45 прошло**, 0 упало (машина состояний — 30, модели — 10, миграции и seed — 6…
  включая health/CORS из этапа 2).
- ruff check / ruff format --check: без замечаний.
- `alembic upgrade head` на чистой БД, `alembic check` («No new upgrade operations»),
  `downgrade base` → `upgrade head` — успешно (вручную и в тестах).
- Seed: первый запуск создаёт 5 категорий, 4 цены, 6 пользователей, 1 заявку; второй —
  без изменений.
- Ручная проверка: `uvicorn` на засеянной БД, `GET /api/health` → `"database": "ok"`.
- Frontend на этом этапе не менялся.

## Принятые решения
- **Единицы хранения:** деньги — тиыны (`int`), вес — миллиграммы (`weight_mg`), ставка —
  базисные пункты в день (`daily_rate_bp`, 25 = 0,25 %/день), LTV — целые проценты, цены
  металлов — тиыны за грамм металла 999 пробы (стоимость = вес × проба/1000 × цена).
- **Enum как строка + CHECK**, а не нативный ENUM PostgreSQL — проще миграции и SQLite.
- **`Actor.SYSTEM`** — автоматические переходы (предоценка, просрочка, выдача средств)
  отделены от ролей пользователей; в истории система — `actor_id/actor_role = NULL`.
- Админ не «суперпользователь» в машине состояний: ему разрешены только операционные
  переходы (назначить курьера, выдача, просрочка/изъятие). Так проще аудит.
- Статусы курьерской задачи (`CourierTask.status`) ведутся отдельно от статуса заявки:
  возврат изделия (RETURN) идёт подстатусами задачи, заявка остаётся `REPAID` до
  `ITEM_RETURNED`.
- `passlib` не используется (не поддерживается и конфликтует с bcrypt ≥ 4) — напрямую `bcrypt`.
- В ruff отключены RUF001–003 (предупреждения о «похожих» кириллических буквах) —
  в проекте с русским интерфейсом они ложные; для автосгенерированных миграций
  отключены E501/W291.
- Цены и ставки в seed — учебные, не рыночные котировки.

## Известные проблемы и техдолг
- PostgreSQL не проверялся (драйвер не установлен); схема рассчитана на переносимость.
- Номер залогового билета (`Loan.ticket_number`) формируется на этапе 8 — формат пока
  не зафиксирован (в тестах `ЗБ-000001`).
- `Offer.expires_at` и автопереход `OFFER_SENT → OFFER_DECLINED` (система) — логика
  истечения оферты будет на этапе 6.
- Starlette-предупреждение про `httpx2` по-прежнему отфильтровано (см. этап 2).

## Заметки для следующего этапа
- Этап 4: `hash_password` / `verify_password` уже есть в `app/core/security.py` — добавить
  туда JWT (access + refresh, `settings.secret_key`, TTL из настроек). Пакет JWT добавить
  в `pyproject.toml`.
- Сессия БД в эндпоинтах — `SessionDep` (`app/core/deps.py`); коммит делает сам эндпоинт/
  сервис (`session_scope` только откатывает при ошибке и закрывает).
- Демо-пользователи и пароль `demo1234` — в `app/seed.py` (`DEMO_USERS`, `DEMO_PASSWORD`),
  их удобно использовать в тестах входа: фикстура `session` + `run_seed(session)`.
- Поле `User.last_login_at` уже есть — обновлять при входе. `User.is_active=False` →
  запрет входа.
- Для `require_role(...)` использовать `app.domain.enums.Role`; для переходов статусов —
  `change_status(session, app, target, user=current_user)`, он сам переводит роль в `Actor`
  и бросает `TransitionForbiddenError` (→ HTTP 403) / `InvalidTransitionError` (→ HTTP 409).
- Тестовая БД — файл SQLite в `tmp_path`; для API-тестов фикстура `client` уже создаёт
  таблицы через `Base.metadata.create_all`.
