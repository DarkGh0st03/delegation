#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INFRA_DIR="$ROOT_DIR/poc/infra"
ENV_FILE="${PHASE1_ENV_FILE:-$INFRA_DIR/.env}"
COMPOSE_FILE="$INFRA_DIR/docker-compose.yml"

for command_name in docker node curl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command not found: $command_name" >&2
    exit 1
  fi
done

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required." >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  node "$ROOT_DIR/poc/scripts/init-local-env.mjs"
fi

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

echo "Validating Docker Compose configuration..."
compose config >/dev/null

echo "Starting Gitea, OPA and Anvil..."
compose up -d gitea opa anvil

bash "$ROOT_DIR/poc/scripts/bootstrap-gitea.sh"

echo "Deploying local trust contracts..."
compose --profile bootstrap run --rm trust-bootstrap

bash "$ROOT_DIR/poc/scripts/phase1-check.sh"

echo
echo "Phase 1 local infrastructure is ready."
echo "Gitea: http://127.0.0.1:3000"
echo "OPA:   http://127.0.0.1:8181"
echo "Anvil: http://127.0.0.1:8545"
echo
echo "Local runtime files are under poc/infra/runtime/ and are gitignored."
