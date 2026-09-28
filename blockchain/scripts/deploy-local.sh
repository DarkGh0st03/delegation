#!/usr/bin/env bash
set -euo pipefail

RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
PRIVATE_KEY="${ANVIL_DEPLOYER_PRIVATE_KEY:?Set ANVIL_DEPLOYER_PRIVATE_KEY to a local Anvil account private key}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLOCKCHAIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$BLOCKCHAIN_DIR"

GOVERNANCE_ADDRESS="${GOVERNANCE_ADDRESS:-$(cast wallet address --private-key "$PRIVATE_KEY")}"

deploy() {
  local label="$1"
  shift

  echo
  echo "==> Deploying $label" >&2

  local output
  output=$(forge create --broadcast --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" "$@" 2>&1)
  echo "$output" >&2

  local address
  address=$(printf '%s\n' "$output" | awk '/Deployed to:/ {print $3}' | tail -n 1)

  if [[ -z "$address" ]]; then
    echo "Could not determine deployed address for $label" >&2
    exit 1
  fi

  printf '%s' "$address"
}

echo "Building blockchain contracts..."
forge build

DID_REGISTRY_ADDRESS=$(deploy   "EthereumDIDRegistry"   src/vendor/EthereumDIDRegistry.sol:EthereumDIDRegistry)

ENTERPRISE_TRUST_REGISTRY_ADDRESS=$(deploy   "EnterpriseTrustRegistry"   src/EnterpriseTrustRegistry.sol:EnterpriseTrustRegistry   --constructor-args "$DID_REGISTRY_ADDRESS" "$GOVERNANCE_ADDRESS")

ISSUER_REGISTRY_ADDRESS=$(deploy   "IssuerRegistry"   src/IssuerRegistry.sol:IssuerRegistry   --constructor-args "$DID_REGISTRY_ADDRESS" "$ENTERPRISE_TRUST_REGISTRY_ADDRESS")

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
