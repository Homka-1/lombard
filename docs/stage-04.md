# Этап 4 — Аутентификация и роли

- **Статус:** ✅ завершён
- **Дата:** 2026-11-04
- **Коммит:** `d6342f1`

## Учтено из прошлого этапа
- По заметкам `stage-03.md`: JWT добавлен в существующий `app/core/security.py` рядом с
  `hash_password` / `verify_password`; TTL и ключ — из `Settings`; пакет `pyjwt` — в
  `pyproject.toml`.
- Эндпоинты используют `SessionDep` и сами делают `commit`.
- При входе обновляется `User.last_login_at`; `is_active=False` → вход запрещён (403),
  а уже выданные токены перестают работать (401), т. к. пользователь читается из БД на
  каждом запросе.
- `require_role(...)` принимает `app.domain.enums.Role`; исключения машины состояний
  теперь глобально отображаются в HTTP: `TransitionForbiddenError` → 403,
  `InvalidTransitionError` → 409 (`app/api/errors.py`).
- В тестах входа используются демо-пользователи из seed (`seeded`, пароль `demo1234`).

## Что сделано
- **JWT** (`app/core/security.py`): `create_token` / `decode_token`, HS256, claims
  `sub, role, type (access|refresh), iss, iat, exp, jti`; проверка подписи, срока,
  издателя и типа токена; `alg=none` и чужой ключ отклоняются. Ошибки — `TokenError` с
  русским текстом. Защита от перебора e-mail по времени ответа (`verify_password_dummy`).
- **Настройки**: `jwt_issuer`; секрет по умолчанию разрешён только в `development`/`test`,
  иначе приложение не стартует без собственного ключа ≥ 32 символов.
- **Телефоны Казахстана** (`app/domain/phone.py`): нормализация `8 701 …`, `+7 (701) …`,
  `7011234567` → E.164 `+77011234567`, проверка префикса `+7 7…`, форматирование
  `+7 701 123-45-67`, признак мобильного кода (700–708, 747, 771, 775–778).
- **Схемы** (`app/schemas/auth.py`, `user.py`): `RegisterRequest` (e-mail в нижнем
  регистре, пароль 8–128 символов с буквой и цифрой, телефон, город), `LoginRequest`,
  `RefreshRequest`, `TokenPair`, `AuthResponse`, `UserRead` (+ вычисляемое
  `phone_display`), `UserUpdateMe`, `PasswordChange`, `AdminUserUpdate`.
- **Зависимости** (`app/core/deps.py`): `get_current_user` / `CurrentUser`
  (OAuth2 Bearer, 401 c `WWW-Authenticate: Bearer`), `require_role(*roles)` (403), готовые
  алиасы `ClientUser`, `ExpertUser` (эксперт или админ), `CourierUser` (курьер или админ),
  `AdminUser`.
- **API** (`app/api/auth.py`): `POST /auth/register` (только роль CLIENT, поле `role`
  игнорируется), `POST /auth/login` (JSON), `POST /auth/token` (OAuth2-форма для Swagger
  Authorize), `POST /auth/refresh` (новая пара; роль перечитывается из БД),
  `GET/PATCH /auth/me`, `POST /auth/me/password`.
- **Админ** (`app/api/admin_users.py`): `GET /admin/users` (фильтр `role`, поиск `q`),
  `PATCH /admin/users/{id}` (роль, блокировка, город); нельзя разжаловать/заблокировать себя.
- **Ошибки валидации 422** — русские сообщения для частых типов ошибок
  (`app/api/errors.py`), сообщения наших валидаторов — без префикса «Value error,».
- Тесты: `test_security.py`, `test_phone.py`, `test_auth.py`, `test_roles.py` (матрица
  ролей через пробные маршруты, маппинг ошибок машины состояний, админ-эндпоинты).
  Фикстуры `seeded`, `auth_headers(who)`, хелпер `login()` в `tests/conftest.py`;
  в тестах bcrypt работает с `rounds=4` (весь набор ~6 с).
- README: раздел «Аутентификация», новые переменные окружения.

## Как проверить
```bash
cd backend && pip install -e ".[dev]"
pytest && ruff check . && ruff format --check .
alembic upgrade head && python -m app.seed && uvicorn app.main:app --reload
# http://localhost:8000/api/docs → Authorize → admin@lombard.kz / demo1234 → GET /api/auth/me
```

## Результаты проверок
- Тесты: **88 passed** (было 45; +43 новых), ~6 с.
- `ruff check .` — без замечаний; `ruff format --check .` — всё отформатировано.
- `alembic check` — «No new upgrade operations detected» (модели не менялись, новой
  миграции не нужно).
- Смоук вручную через uvicorn + curl: `/auth/token` → `/auth/me` → `/admin/users?role=COURIER`
  отвечают корректно, регистрация с плохими данными → 422 с русскими сообщениями.
- Frontend на этом этапе не менялся.

## Принятые решения
- **Stateless JWT без хранения refresh-токенов в БД.** Отзыв доступа обеспечивается
  проверкой `is_active` и чтением роли из БД на каждом запросе: блокировка и смена роли
  действуют сразу, а не после истечения токена. Ротация с «чёрным списком» refresh — техдолг.
- **Нет неявного обхода для админа** в `require_role`: роли перечисляются явно. Для
  удобства алиасы `ExpertUser` / `CourierUser` уже включают ADMIN.
- Самостоятельная регистрация создаёт только клиентов; эксперт/курьер/админ назначаются
  администратором.
- Два входа: JSON `/login` для фронтенда и форма `/token` для Swagger (`tokenUrl`
  относительный — `auth/token`, Swagger на `/api/docs` разрешает его в `/api/auth/token`).
- Неверный e-mail и неверный пароль дают одинаковый ответ 401 «Неверный e-mail или пароль».
- Dev-секрет по умолчанию удлинён до 32+ символов (убирает предупреждение PyJWT
  `InsecureKeyLengthWarning`).

## Известные проблемы и техдолг
- Нет ограничения частоты попыток входа (rate limiting) и блокировки после N ошибок.
- Нет отзыва refresh-токенов (logout на сервере), подтверждения e-mail/телефона и
  восстановления пароля (для учебного проекта — моки на этапе 8, если понадобятся).
- `PATCH /auth/me` с `"full_name": null` молча игнорирует поле.
- Русифицированы только частые типы ошибок 422; остальные остаются на английском.

## Заметки для следующего этапа
- Защита эндпоинтов: `user: ClientUser` / `ExpertUser` / `CourierUser` / `AdminUser` из
  `app/core/deps.py` или `Depends(require_role(...))`. Владелец заявки проверяется вручную
  (`application.client_id == user.id`, иначе 404, чтобы не раскрывать чужие заявки).
- Переходы статусов — `change_status(session, app, target, user=user)`; ошибки сами
  превращаются в 403/409, ловить их в эндпоинтах не нужно.
- В тестах: `def test_x(client, auth_headers): client.get(..., headers=auth_headers("client"))`
  (доступны `client`, `client2`, `expert`, `courier`, `admin`); `seeded` даёт сессию с
  seed-данными (там есть черновик заявки клиента `client@lombard.kz`).
- Загрузка файлов (этап 5): `python-multipart` уже в зависимостях.
- Импорт хелперов в тестах: `from tests.conftest import login` (в pytest включён
  `pythonpath = ["."]`, `tests/` — пакет).
