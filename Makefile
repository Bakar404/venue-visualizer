.PHONY: setup dev dev-lan doctor api worker web test schema sample
setup:
	cd services && uv sync
	pnpm install
# Everything binds to 127.0.0.1: the API trusts Next's loopback proxy only because nothing else can reach it.
dev:
	@echo "Starting api (8000), worker, web (3000) on 127.0.0.1"
	(cd services && uv run uvicorn api.main:app --reload --host 127.0.0.1 --port 8000) & \
	(cd services && uv run python -m api.worker) & \
	pnpm --filter web dev --hostname 127.0.0.1; wait
# Opt-in: open the app from a phone on the same Wi-Fi (pairing code required; see docs/onboarding-and-mobile.md).
# Only this target binds to the network and loads the client-address attestation shim into Next.js.
# LAN mode needs both VV_LAN=1 and this per-run proxy key; settings can't turn it on.
dev-lan: export VV_LAN = 1
dev-lan:
	@VV_LAN_PROXY_KEY=$$(node -p 'require("node:crypto").randomBytes(32).toString("hex")') && \
	export VV_LAN_PROXY_KEY && \
	bind=$$(cd services && uv run python -m api.lan) && \
	echo "Starting api (8000), worker, web (3000) on $$bind" || exit 1; \
	(cd services && uv run uvicorn api.main:app --no-proxy-headers --reload --host 127.0.0.1 --port 8000) & \
	(cd services && uv run python -m api.worker) & \
	VV_API_URL="$${VV_API_URL:-http://127.0.0.1:8000}" \
		NODE_OPTIONS="$${NODE_OPTIONS:+$$NODE_OPTIONS }--require=\"$(CURDIR)/services/api/lan_proxy.cjs\"" \
		pnpm --filter web dev --hostname "$$bind"; wait
doctor:
	cd services && uv run python -m api.doctor
api:
	cd services && uv run uvicorn api.main:app --reload --host 127.0.0.1 --port 8000
worker:
	cd services && uv run python -m api.worker
web:
	pnpm --filter web dev --hostname 127.0.0.1
test:
	cd services && uv run pytest -q
	pnpm --filter web test --if-present
schema:
	pnpm schema
	cd services && uv run python -m pipeline.schema_gen
sample:
	cd services && uv run python ../samples/run_sample.py
