#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INFRA_DIR="$ROOT_DIR/poc/infra"
ENV_FILE="${PHASE1_ENV_FILE:-$INFRA_DIR/.env}"
COMPOSE_FILE="$INFRA_DIR/docker-compose.yml"
RUNTIME_DIR="$INFRA_DIR/runtime"

export PATH="$HOME/.foundry/bin:$PATH"

for command_name in docker node curl cast; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command not found: $command_name" >&2
    exit 1
  fi
done

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

GATEWAY_ENV="$RUNTIME_DIR/gateway.env"
TRUST_ENV="$RUNTIME_DIR/trust.env"

[[ -f "$GATEWAY_ENV" ]] || { echo "Missing $GATEWAY_ENV" >&2; exit 1; }
[[ -f "$TRUST_ENV" ]] || { echo "Missing $TRUST_ENV" >&2; exit 1; }

# shellcheck disable=SC1090
source "$GATEWAY_ENV"
# shellcheck disable=SC1090
source "$TRUST_ENV"

GITEA_HOST_URL="http://127.0.0.1:${GITEA_HOST_PORT:-3000}"
OPA_HOST_URL="http://127.0.0.1:${OPA_HOST_PORT:-8181}"
ANVIL_HOST_URL="http://127.0.0.1:${ANVIL_HOST_PORT:-8545}"

echo "Checking Gitea health..."
curl -fsS "$GITEA_HOST_URL/api/healthz" >/dev/null

echo "Checking OPA health and loaded thesis policy..."
curl -fsS "$OPA_HOST_URL/health?plugins" >/dev/null
policy_version="$(curl -fsS "$OPA_HOST_URL/v1/data/thesis/gateway/policy_version" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.result ?? "")})')"
[[ "$policy_version" == "phase4a-v1" ]] || {
  echo "Unexpected or missing OPA thesis policy version: $policy_version" >&2
  exit 1
}

echo "Checking Anvil JSON-RPC..."
observed_chain_id="$(cast chain-id --rpc-url "$ANVIL_HOST_URL" | tr -d '\r\n ')"
[[ "$observed_chain_id" == "${ANVIL_CHAIN_ID:-31337}" ]] || {
  echo "Unexpected Anvil chain id: expected ${ANVIL_CHAIN_ID:-31337}, got $observed_chain_id" >&2
  exit 1
}

echo "Checking imported protected repository..."
branch_json="$(curl -fsS \
  -H "Authorization: token $GITEA_GATEWAY_TOKEN" \
  "$GITEA_HOST_URL/api/v1/repos/$GITEA_ORG/$GITEA_REPOSITORY/branches/main")"
observed_sha="$(printf '%s' "$branch_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.commit?.id ?? "")})')"
[[ "$observed_sha" == "$GITEA_BASELINE_SHA" ]] || {
  echo "Protected repository baseline mismatch: expected $GITEA_BASELINE_SHA, got $observed_sha" >&2
  exit 1
}

echo "Checking deployed trust contracts..."
for address in "$DID_REGISTRY_ADDRESS" "$ENTERPRISE_TRUST_REGISTRY_ADDRESS" "$ISSUER_REGISTRY_ADDRESS"; do
  code="$(cast code "$address" --rpc-url "$ANVIL_HOST_URL")"
  if [[ -z "$code" || "$code" == "0x" ]]; then
    echo "No bytecode found for trust contract $address" >&2
    exit 1
  fi
done

echo "Checking network separation declaration..."
compose_json="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --format json)"
printf '%s' "$compose_json" | node -e '
let s="";
process.stdin.on("data",d=>s+=d).on("end",()=>{
  const j=JSON.parse(s);
  const giteaNetworks=j.services?.gitea?.networks ?? {};
  if (!("infra" in giteaNetworks)) throw new Error("Gitea is not attached to infra network");
  if ("agent" in giteaNetworks) throw new Error("Gitea must not be attached to agent network");
});
'

if ! awk '
  /^  agent:/ { in_agent=1; next }
  in_agent && /^  [^ ]/ { in_agent=0 }
  in_agent && /internal:[[:space:]]*true/ { found=1 }
  END { exit(found ? 0 : 1) }
' "$COMPOSE_FILE"; then
  echo "Agent network must be declared internal in docker-compose.yml" >&2
  exit 1
fi

echo "PHASE1_CHECK=PASS"
echo "giteaBaselineSha=$observed_sha"
echo "anvilChainId=$observed_chain_id"
echo "trustContracts=DEPLOYED"
echo "providerNetworkBoundary=DECLARED"
