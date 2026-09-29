#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_SCRIPT="$ROOT_DIR/blockchain/scripts/deploy-local.sh"
CHECK_SCRIPT="$ROOT_DIR/blockchain/scripts/check-pre-gateway.sh"

export PATH="$HOME/.foundry/bin:$PATH"

export RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
export CHAIN_ID="${CHAIN_ID:-31337}"

# Standard deterministic Anvil mnemonic and accounts.
# These keys are public development keys and MUST NEVER be reused outside this local PoC.
ANVIL_MNEMONIC="test test test test test test test test test test test junk"
export ANVIL_DEPLOYER_PRIVATE_KEY="${ANVIL_DEPLOYER_PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
export GOVERNANCE_PRIVATE_KEY="${GOVERNANCE_PRIVATE_KEY:-$ANVIL_DEPLOYER_PRIVATE_KEY}"
export ROOT_PRIVATE_KEY="${ROOT_PRIVATE_KEY:-0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d}"
export HOLDER_PRIVATE_KEY="${HOLDER_PRIVATE_KEY:-0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a}"

for command_name in anvil forge cast cargo node npm; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command not found: $command_name" >&2
    exit 1
  fi
done

if cast chain-id --rpc-url "$RPC_URL" >/dev/null 2>&1; then
  echo "A JSON-RPC node is already responding at $RPC_URL." >&2
  echo "Stop the existing local node first so this script can validate against a fresh Anvil chain." >&2
  exit 1
fi

ANVIL_LOG="$(mktemp "${TMPDIR:-/tmp}/delegation-anvil.XXXXXX.log")"
ANVIL_PID=""

cleanup() {
  local exit_code=$?

  if [[ -n "${ANVIL_PID:-}" ]] && kill -0 "$ANVIL_PID" >/dev/null 2>&1; then
    kill "$ANVIL_PID" >/dev/null 2>&1 || true
    wait "$ANVIL_PID" >/dev/null 2>&1 || true
  fi

  if [[ "$exit_code" -eq 0 ]]; then
    rm -f "$ANVIL_LOG"
  else
    echo >&2
    echo "Automatic pre-Gateway validation failed." >&2
    echo "Anvil log: $ANVIL_LOG" >&2
    echo "Last Anvil log lines:" >&2
    tail -n 40 "$ANVIL_LOG" >&2 || true
  fi

  exit "$exit_code"
}
trap cleanup EXIT INT TERM

echo "============================================================"
echo "Delegation thesis - one-command pre-Gateway validation"
echo "============================================================"
echo "Starting fresh Anvil..."
anvil \
  --chain-id "$CHAIN_ID" \
  --mnemonic "$ANVIL_MNEMONIC" \
  >"$ANVIL_LOG" 2>&1 &
ANVIL_PID=$!

rpc_ready=false
for ((attempt = 1; attempt <= 50; attempt++)); do
  if ! kill -0 "$ANVIL_PID" >/dev/null 2>&1; then
    echo "Anvil terminated before becoming ready." >&2
    exit 1
  fi

  if cast chain-id --rpc-url "$RPC_URL" >/dev/null 2>&1; then
    rpc_ready=true
    break
  fi

  sleep 0.2
done

if [[ "$rpc_ready" != "true" ]]; then
  echo "Anvil did not become ready at $RPC_URL." >&2
  exit 1
fi

observed_chain_id="$(cast chain-id --rpc-url "$RPC_URL" | tr -d '\r\n ')"
if [[ "$observed_chain_id" != "$CHAIN_ID" ]]; then
  echo "Unexpected Anvil chain id: expected $CHAIN_ID, got $observed_chain_id" >&2
  exit 1
fi

echo "Anvil ready (PID=$ANVIL_PID, chainId=$observed_chain_id)."
echo
echo "Deploying local contracts..."

deploy_output="$(bash "$DEPLOY_SCRIPT" 2>&1)"
printf '%s\n' "$deploy_output"

extract_address() {
  local key="$1"
  local value

  value="$(
    printf '%s\n' "$deploy_output" |
      awk -F= -v key="$key" '$1 == key {value=$2} END {print value}'
  )"

  if [[ ! "$value" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
    echo "Could not extract a valid $key from deploy-local.sh output." >&2
    exit 1
  fi

  printf '%s' "$value"
}

export DID_REGISTRY_ADDRESS="$(extract_address DID_REGISTRY_ADDRESS)"
export ENTERPRISE_TRUST_REGISTRY_ADDRESS="$(extract_address ENTERPRISE_TRUST_REGISTRY_ADDRESS)"
export ISSUER_REGISTRY_ADDRESS="$(extract_address ISSUER_REGISTRY_ADDRESS)"

echo
echo "Automatically configured deployment:"
echo "DID_REGISTRY_ADDRESS=$DID_REGISTRY_ADDRESS"
echo "ENTERPRISE_TRUST_REGISTRY_ADDRESS=$ENTERPRISE_TRUST_REGISTRY_ADDRESS"
echo "ISSUER_REGISTRY_ADDRESS=$ISSUER_REGISTRY_ADDRESS"
echo
echo "Running complete pre-Gateway validation..."

bash "$CHECK_SCRIPT"

echo
echo "============================================================"
echo "ONE-COMMAND PRE-GATEWAY VALIDATION: SUCCESS"
echo "Fresh Anvil -> deploy -> configure -> validate completed."
echo "Anvil will now be stopped automatically."
echo "============================================================"
