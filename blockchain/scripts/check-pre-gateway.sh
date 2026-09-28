#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

: "${DID_REGISTRY_ADDRESS:?Set DID_REGISTRY_ADDRESS}"
: "${ENTERPRISE_TRUST_REGISTRY_ADDRESS:?Set ENTERPRISE_TRUST_REGISTRY_ADDRESS}"
: "${ISSUER_REGISTRY_ADDRESS:?Set ISSUER_REGISTRY_ADDRESS}"
: "${GOVERNANCE_PRIVATE_KEY:?Set GOVERNANCE_PRIVATE_KEY}"
: "${ROOT_PRIVATE_KEY:?Set ROOT_PRIVATE_KEY to a fresh local Anvil account}"
: "${HOLDER_PRIVATE_KEY:?Set HOLDER_PRIVATE_KEY to another fresh local Anvil account}"

export RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
export CHAIN_ID="${CHAIN_ID:-31337}"

CHAIN_HEX=$(printf '0x%x' "$CHAIN_ID")

if [[ -z "${ROOT_ID:-}" ]]; then
  ROOT_ADDRESS=$(cast wallet address --private-key "$ROOT_PRIVATE_KEY")
  export ROOT_ID="did:ethr:${CHAIN_HEX}:${ROOT_ADDRESS}"
fi

if [[ -z "${HOLDER_ID:-}" ]]; then
  HOLDER_ADDRESS=$(cast wallet address --private-key "$HOLDER_PRIVATE_KEY")
  export HOLDER_ID="did:ethr:${CHAIN_HEX}:${HOLDER_ADDRESS}"
fi

echo "============================================================"
echo "Pre-Gateway blockchain/integration validation"
echo "RPC_URL=$RPC_URL"
echo "CHAIN_ID=$CHAIN_ID"
echo "ROOT_ID=$ROOT_ID"
echo "HOLDER_ID=$HOLDER_ID"
echo "============================================================"
echo

echo "==> Rust formatting"
cargo fmt --check

echo
echo "==> Rust tests"
cargo test

echo
echo "==> Solidity tests"
(
  cd blockchain
  forge test
)

echo
echo "==> DID resolver dependencies"
if [[ ! -d blockchain/did-client/node_modules ]]; then
  (
    cd blockchain/did-client
    npm install
  )
else
  echo "node_modules already present; skipping npm install"
fi

echo
echo "==> Final live pre-Gateway integration"
cargo run --example live_pre_gateway_closure

echo
echo "============================================================"
echo "PRE-GATEWAY VALIDATION COMPLETED"
echo "============================================================"
