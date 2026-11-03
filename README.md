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

Linux/macOS: `make install`, затем в двух терминалах `make backend` и `make frontend`.
Или вручную:

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
cp .env.example .env               # необязательно: значения по умолчанию подходят для разработки
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
| `LOMBARD_DATABASE_URL` | `sqlite:///./lombard.db` | База данных (с этапа 3) |
| `LOMBARD_UPLOAD_DIR` | `./uploads` | Каталог для фото изделий (с этапа 5) |
| `LOMBARD_SECRET_KEY` | `change-me-in-production` | Ключ подписи JWT (с этапа 4) |
| `LOMBARD_CORS_ORIGINS` | `["http://localhost:5173","http://127.0.0.1:5173"]` | Разрешённые источники (JSON-список) |

Регион — Казахстан: валюта KZT, суммы хранятся в тиынах, даты — в UTC.

## Демо-аккаунты

Появятся на этапе 3 (seed-данные).
