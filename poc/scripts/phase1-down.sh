#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INFRA_DIR="$ROOT_DIR/poc/infra"
ENV_FILE="${PHASE1_ENV_FILE:-$INFRA_DIR/.env}"
COMPOSE_FILE="$INFRA_DIR/docker-compose.yml"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "No local Phase 1 environment found at $ENV_FILE; nothing to stop."
  exit 0
fi

args=(down)

if [[ "${1:-}" == "--volumes" ]]; then
  args+=(--volumes)
fi

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "${args[@]}"
