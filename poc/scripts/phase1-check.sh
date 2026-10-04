#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INFRA_DIR="$ROOT_DIR/poc/infra"
ENV_FILE="${PHASE1_ENV_FILE:-$INFRA_DIR/.env}"
COMPOSE_FILE="$INFRA_DIR/docker-compose.yml"
RUNTIME_DIR="$INFRA_DIR/runtime"

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

echo "Checking OPA health..."
curl -fsS "$OPA_HOST_URL/health?plugins" >/dev/null

echo "Checking Anvil JSON-RPC..."
rpc_response="$(curl -fsS   -H 'Content-Type: application/json'   --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'   "$ANVIL_HOST_URL")"
chain_id_hex="$(printf '%s' "$rpc_response" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.result ?? "")})')"
expected_hex="$(node -e 'process.stdout.write("0x"+Number(process.argv[1]).toString(16))' "${ANVIL_CHAIN_ID:-31337}")"
[[ "$chain_id_hex" == "$expected_hex" ]] || {
  echo "Unexpected Anvil chain id: expected $expected_hex, got $chain_id_hex" >&2
  exit 1
}

echo "Checking imported protected repository..."
branch_json="$(curl -fsS   -H "Authorization: token $GITEA_GATEWAY_TOKEN"   "$GITEA_HOST_URL/api/v1/repos/$GITEA_ORG/$GITEA_REPOSITORY/branches/main")"
observed_sha="$(printf '%s' "$branch_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.commit?.id ?? "")})')"
[[ "$observed_sha" == "$GITEA_BASELINE_SHA" ]] || {
  echo "Protected repository baseline mismatch: expected $GITEA_BASELINE_SHA, got $observed_sha" >&2
  exit 1
}

echo "Checking deployed trust contracts..."
for address in "$DID_REGISTRY_ADDRESS" "$ENTERPRISE_TRUST_REGISTRY_ADDRESS" "$ISSUER_REGISTRY_ADDRESS"; do
  code_response="$(curl -fsS     -H 'Content-Type: application/json'     --data "{"jsonrpc":"2.0","id":1,"method":"eth_getCode","params":["$address","latest"]}"     "$ANVIL_HOST_URL")"
  code="$(printf '%s' "$code_response" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.result ?? "")})')"
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
  const agentInternal=j.networks?.agent?.internal;
  if (!("infra" in giteaNetworks)) throw new Error("Gitea is not attached to infra network");
  if ("agent" in giteaNetworks) throw new Error("Gitea must not be attached to agent network");
  if (agentInternal !== true) throw new Error("Agent network must be internal");
});
'

echo "PHASE1_CHECK=PASS"
echo "giteaBaselineSha=$observed_sha"
echo "anvilChainId=$chain_id_hex"
echo "trustContracts=DEPLOYED"
echo "providerNetworkBoundary=DECLARED"
