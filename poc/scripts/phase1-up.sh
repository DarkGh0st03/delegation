#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INFRA_DIR="$ROOT_DIR/poc/infra"
ENV_FILE="${PHASE1_ENV_FILE:-$INFRA_DIR/.env}"
COMPOSE_FILE="$INFRA_DIR/docker-compose.yml"

export PATH="$HOME/.foundry/bin:$PATH"

for command_name in docker node curl forge cast; do
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

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

echo "Validating Docker Compose configuration..."
compose config >/dev/null

echo "Starting Gitea, OPA and Anvil..."
compose up -d gitea opa anvil

bash "$ROOT_DIR/poc/scripts/bootstrap-gitea.sh"

echo "Deploying local trust contracts with the pinned host Foundry toolchain..."
RPC_URL="http://127.0.0.1:${ANVIL_HOST_PORT:-8545}" \
CHAIN_ID="${ANVIL_CHAIN_ID:-31337}" \
ANVIL_DEPLOYER_PRIVATE_KEY="${ANVIL_DEPLOYER_PRIVATE_KEY}" \
bash "$ROOT_DIR/poc/scripts/bootstrap-trust.sh"

bash "$ROOT_DIR/poc/scripts/phase1-check.sh"

echo
echo "Phase 1 local infrastructure is ready."
echo "Gitea: http://127.0.0.1:${GITEA_HOST_PORT:-3000}"
echo "OPA:   http://127.0.0.1:${OPA_HOST_PORT:-8181}"
echo "Anvil: http://127.0.0.1:${ANVIL_HOST_PORT:-8545}"
echo
echo "Local runtime files are under poc/infra/runtime/ and are gitignored."
