.PHONY: setup dev api worker web test schema sample
setup:
	cd services && uv sync
	pnpm install
dev:
	@echo "Starting api (8000), worker, web (3000)"; \
	(cd services && uv run uvicorn api.main:app --reload --port 8000) & \
	(cd services && uv run python -m api.worker) & \
	pnpm dev:web; wait
api:
	cd services && uv run uvicorn api.main:app --reload --port 8000
worker:
	cd services && uv run python -m api.worker
web:
	pnpm dev:web
test:
	cd services && uv run pytest -q
	pnpm --filter web test --if-present
schema:
	pnpm schema
	cd services && uv run python -m pipeline.schema_gen
sample:
	cd services && uv run python ../samples/run_sample.py
