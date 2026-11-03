# Shortcuts for Linux/macOS; on Windows use the commands from README directly.
PY ?= python3

.PHONY: install backend frontend test lint build

install:
	$(PY) -m venv backend/.venv
	backend/.venv/bin/pip install -e "backend[dev]"
	cd frontend && npm install

backend:
	cd backend && .venv/bin/uvicorn app.main:app --reload

frontend:
	cd frontend && npm run dev

test:
	cd backend && .venv/bin/pytest
	cd frontend && npm test

lint:
	cd backend && .venv/bin/ruff check . && .venv/bin/ruff format --check .
	cd frontend && npm run lint && npm run format:check

build:
	cd frontend && npm run build
