#!/usr/bin/env bash
set -euo pipefail

RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
PRIVATE_KEY="${ANVIL_DEPLOYER_PRIVATE_KEY:?Set ANVIL_DEPLOYER_PRIVATE_KEY to a local Anvil account private key}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLOCKCHAIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$BLOCKCHAIN_DIR"

if [[ -z "${GOVERNANCE_ADDRESS:-}" ]]; then
  WALLET_OUTPUT=$(cast wallet address --private-key "$PRIVATE_KEY" 2>&1 || true)
  GOVERNANCE_ADDRESS=$(printf '%s\n' "$WALLET_OUTPUT" | grep -Eo '0x[0-9a-fA-F]{40}' | tail -n 1)
fi

if [[ ! "${GOVERNANCE_ADDRESS:-}" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "Could not derive a valid GOVERNANCE_ADDRESS from ANVIL_DEPLOYER_PRIVATE_KEY." >&2
  echo "Set GOVERNANCE_ADDRESS explicitly and rerun." >&2
  exit 1
fi

deploy() {
  local label="$1"
  shift

  echo >&2
  echo "==> Deploying $label" >&2

  local output
  output=$(forge create --broadcast --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" "$@" 2>&1)
  echo "$output" >&2

  local address
  address=$(printf '%s\n' "$output" | awk '/Deployed to:/ {print $3}' | tail -n 1)

  if [[ ! "$address" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
    echo "Could not determine a valid deployed address for $label" >&2
    exit 1
  fi

  printf '%s' "$address"
}

has_code() {
  local address="$1"
  local code
  code=$(cast code "$address" --rpc-url "$RPC_URL" 2>/dev/null || true)
  [[ -n "$code" && "$code" != "0x" ]]
}

echo "Building blockchain contracts..."
forge build

if [[ -n "${DID_REGISTRY_ADDRESS:-}" ]] && has_code "$DID_REGISTRY_ADDRESS"; then
  echo
  echo "==> Reusing EthereumDIDRegistry at $DID_REGISTRY_ADDRESS"
else
  DID_REGISTRY_ADDRESS=$(deploy "EthereumDIDRegistry" src/vendor/EthereumDIDRegistry.sol:EthereumDIDRegistry)
fi

if [[ -n "${ENTERPRISE_TRUST_REGISTRY_ADDRESS:-}" ]] && has_code "$ENTERPRISE_TRUST_REGISTRY_ADDRESS"; then
  echo
  echo "==> Reusing EnterpriseTrustRegistry at $ENTERPRISE_TRUST_REGISTRY_ADDRESS"
else
  ENTERPRISE_TRUST_REGISTRY_ADDRESS=$(deploy \
    "EnterpriseTrustRegistry" \
    src/EnterpriseTrustRegistry.sol:EnterpriseTrustRegistry \
    --constructor-args "$DID_REGISTRY_ADDRESS" "$GOVERNANCE_ADDRESS")
fi

if [[ -n "${ISSUER_REGISTRY_ADDRESS:-}" ]] && has_code "$ISSUER_REGISTRY_ADDRESS"; then
  echo
  echo "==> Reusing IssuerRegistry at $ISSUER_REGISTRY_ADDRESS"
else
  ISSUER_REGISTRY_ADDRESS=$(deploy \
    "IssuerRegistry" \
    src/IssuerRegistry.sol:IssuerRegistry \
    --constructor-args "$DID_REGISTRY_ADDRESS" "$ENTERPRISE_TRUST_REGISTRY_ADDRESS")
fi

echo
echo "============================================================"
echo "Local deployment completed"
echo "RPC_URL=$RPC_URL"
echo "GOVERNANCE_ADDRESS=$GOVERNANCE_ADDRESS"
echo "DID_REGISTRY_ADDRESS=$DID_REGISTRY_ADDRESS"
echo "ENTERPRISE_TRUST_REGISTRY_ADDRESS=$ENTERPRISE_TRUST_REGISTRY_ADDRESS"
echo "ISSUER_REGISTRY_ADDRESS=$ISSUER_REGISTRY_ADDRESS"
echo "============================================================"
echo
echo "Copy these exports into the terminal used for Rust integration:"
echo "export RPC_URL=$RPC_URL"
echo "export DID_REGISTRY_ADDRESS=$DID_REGISTRY_ADDRESS"
echo "export ENTERPRISE_TRUST_REGISTRY_ADDRESS=$ENTERPRISE_TRUST_REGISTRY_ADDRESS"
echo "export ISSUER_REGISTRY_ADDRESS=$ISSUER_REGISTRY_ADDRESS"
