# Shortcuts for Linux/macOS; on Windows use the commands from README directly.
PY ?= python3

.PHONY: install db migrate seed backend frontend test lint build e2e demo demo-check e2e-demo up

install:
	$(PY) -m venv backend/.venv
	backend/.venv/bin/pip install -e "backend[dev]"
	cd frontend && npm install

# Apply migrations and load reference data + demo accounts (idempotent).
db: migrate seed

migrate:
	cd backend && .venv/bin/alembic upgrade head

seed:
	cd backend && .venv/bin/python -m app.seed

backend:
	cd backend && .venv/bin/uvicorn app.main:app --reload

frontend:
	cd frontend && npm run dev

test:
	cd backend && .venv/bin/pytest
	cd frontend && npm test

lint:
	cd backend && .venv/bin/ruff check . && .venv/bin/ruff format --check .
	cd frontend && npm run lint && npm run format:check && npm run design:check && npm run demo:check

build:
	cd frontend && npm run build

# Browser smoke test: starts its own backend (fresh DB) and Vite.
e2e:
	cd frontend && npm run e2e

# Dependency-free demo (demo/index.html, opens from disk): rebuild, verify, smoke-test.
demo:
	cd frontend && npm run build:demo

demo-check:
	cd frontend && npm run demo:check

e2e-demo:
	cd frontend && npm run e2e:demo

up:
	docker compose up --build
