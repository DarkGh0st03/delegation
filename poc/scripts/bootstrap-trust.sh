#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="${TRUST_BOOTSTRAP_RUNTIME_DIR:-$ROOT_DIR/poc/infra/runtime}"
OUT_FILE="$RUNTIME_DIR/trust.env"

mkdir -p "$RUNTIME_DIR"

export RPC_URL="${RPC_URL:-http://anvil:8545}"
export CHAIN_ID="${CHAIN_ID:-31337}"
export ANVIL_DEPLOYER_PRIVATE_KEY="${ANVIL_DEPLOYER_PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"

# AUD-006: A second infra:up must not re-deploy three new registries to
# a running chain. Reuse only a complete, verified, previously recorded set.
read_recorded() {
  local key="$1"
  awk -F= -v key="$key" '$1 == key {value=substr($0,length(key)+2)} END {print value}' "$OUT_FILE"
}

is_address() { [[ "$1" =~ ^0x[0-9a-fA-F]{40}$ ]]; }

has_code() {
  local code
  code="$(cast code "$1" --rpc-url "$RPC_URL")" || return 1
  [[ -n "$code" && "$code" != "0x" ]]
}

expect_link() {
  local contract="$1" selector="$2" expected="$3"
  local observed
  observed="$(cast call "$contract" "$selector" --rpc-url "$RPC_URL")" || {
    echo "Cannot verify $selector at $contract; refusing trust reuse" >&2
    return 1
  }
  if [[ "${observed,,}" != "${expected,,}" ]]; then
    echo "Trust deployment mismatch for $selector at $contract; refusing reuse" >&2
    return 1
  fi
}

observed_chain="$(cast chain-id --rpc-url "$RPC_URL" | tr -d '\\r\\n ')"
if [[ "$observed_chain" != "$CHAIN_ID" ]]; then
  echo "Anvil chain ID mismatch: expected $CHAIN_ID, got $observed_chain" >&2
  exit 1
fi

if [[ -f "$OUT_FILE" ]]; then
  old_rpc="$(read_recorded RPC_URL)"
  old_chain="$(read_recorded CHAIN_ID)"
  old_governance="$(read_recorded GOVERNANCE_ADDRESS)"
  old_did="$(read_recorded DID_REGISTRY_ADDRESS)"
  old_enterprise="$(read_recorded ENTERPRISE_TRUST_REGISTRY_ADDRESS)"
  old_issuer="$(read_recorded ISSUER_REGISTRY_ADDRESS)"
  for address in "$old_did" "$old_enterprise" "$old_issuer" "$old_governance"; do
    if ! is_address "$address"; then
      echo "Incomplete local trust.env: refusing automatic redeployment" >&2
      exit 1
    fi
  done

  code_count=0
  for address in "$old_did" "$old_enterprise" "$old_issuer"; do
    if has_code "$address"; then
      code_count=$((code_count + 1))
    fi
  done

  if [[ "$code_count" == 3 ]]; then
    if [[ "$old_rpc" != "$RPC_URL" || "$old_chain" != "$CHAIN_ID" ]]; then
      echo "Existing trust contracts refer to another RPC/chain; refusing reuse" >&2
      exit 1
    fi
    expected_governance="$(cast wallet address --private-key "$ANVIL_DEPLOYER_PRIVATE_KEY")"
    if [[ "${old_governance,,}" != "${expected_governance,,}" ]]; then
      echo "Governance signer differs from the recorded deployment; refusing reuse" >&2
      exit 1
    fi
    expect_link "$old_enterprise" 'didRegistry()(address)' "$old_did"
    expect_link "$old_enterprise" 'governance()(address)' "$old_governance"
    expect_link "$old_issuer" 'didRegistry()(address)' "$old_did"
    expect_link "$old_issuer" 'trustRegistry()(address)' "$old_enterprise"
    echo "Reusing verified local trust contracts; no deployment transactions."
    exit 0
  fi

  if [[ "$code_count" != 0 ]]; then
    echo "Partially present trust contracts ($code_count/3); refusing redeployment" >&2
    exit 1
  fi
  # The previous local Anvil has been reset. Redeploy only on a provably empty
  # chain; never silently overwrite existing trust references on a live chain.
  current_block="$(cast block-number --rpc-url "$RPC_URL")"
  if [[ "$current_block" != "0" ]]; then
    echo "Recorded trust contracts are missing on a nonempty chain; refusing redeployment" >&2
    exit 1
  fi
  echo "Recorded contracts absent on fresh Anvil; deploying new local registries."
fi

# Avoid inheriting stale exports from a previous session on a fresh deployment.
unset DID_REGISTRY_ADDRESS ENTERPRISE_TRUST_REGISTRY_ADDRESS ISSUER_REGISTRY_ADDRESS GOVERNANCE_ADDRESS
echo "Deploying local trust contracts against $RPC_URL ..."

if ! deploy_output="$(bash "$ROOT_DIR/blockchain/scripts/deploy-local.sh" 2>&1)"; then
  printf '%s\n' "$deploy_output" >&2
  echo "Trust contract deployment failed." >&2
  exit 1
fi
printf '%s\n' "$deploy_output"

extract_value() {
  local key="$1"
  printf '%s\n' "$deploy_output" | awk -F= -v key="$key" '$1 == key {value=$2} END {print value}'
}

DID_REGISTRY_ADDRESS="$(extract_value DID_REGISTRY_ADDRESS)"
ENTERPRISE_TRUST_REGISTRY_ADDRESS="$(extract_value ENTERPRISE_TRUST_REGISTRY_ADDRESS)"
ISSUER_REGISTRY_ADDRESS="$(extract_value ISSUER_REGISTRY_ADDRESS)"
GOVERNANCE_ADDRESS="$(extract_value GOVERNANCE_ADDRESS)"

for address in "$DID_REGISTRY_ADDRESS" "$ENTERPRISE_TRUST_REGISTRY_ADDRESS" "$ISSUER_REGISTRY_ADDRESS"; do
  if [[ ! "$address" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
    echo "Invalid deployed contract address: $address" >&2
    exit 1
  fi
  code="$(cast code "$address" --rpc-url "$RPC_URL")"
  if [[ -z "$code" || "$code" == "0x" ]]; then
    echo "No bytecode found at deployed address $address" >&2
    exit 1
  fi
done

cat >"$OUT_FILE" <<EOF
# Generated by poc/scripts/bootstrap-trust.sh
# Public local PoC runtime values only. No private keys are written here.
RPC_URL=$RPC_URL
CHAIN_ID=$CHAIN_ID
GOVERNANCE_ADDRESS=$GOVERNANCE_ADDRESS
DID_REGISTRY_ADDRESS=$DID_REGISTRY_ADDRESS
ENTERPRISE_TRUST_REGISTRY_ADDRESS=$ENTERPRISE_TRUST_REGISTRY_ADDRESS
ISSUER_REGISTRY_ADDRESS=$ISSUER_REGISTRY_ADDRESS
EOF

echo "Trust bootstrap completed."
echo "Runtime public addresses written to $OUT_FILE"
