#!/usr/bin/env bash
# One-shot: deploy (or verify and reuse) the local trust contracts on Anvil.
# Runs in the "chain" image. Reuses poc/scripts/bootstrap-trust.sh, writing the
# public contract addresses to /config/trust.env.
set -euo pipefail

config=/config/local.env
[[ -f "$config" ]] || { echo "Missing $config: the setup service must run first" >&2; exit 1; }
deployer_key="$(awk -F= '$1=="ANVIL_DEPLOYER_PRIVATE_KEY"{print $2}' "$config")"
[[ "$deployer_key" =~ ^0x[0-9a-fA-F]{64}$ ]] || { echo "Invalid deployer key in $config" >&2; exit 1; }

export RPC_URL="${RPC_URL:-http://anvil:8545}"
export CHAIN_ID="${CHAIN_ID:-31337}"
export ANVIL_DEPLOYER_PRIVATE_KEY="$deployer_key"
export TRUST_BOOTSTRAP_RUNTIME_DIR=/config

for _ in $(seq 1 60); do
  cast chain-id --rpc-url "$RPC_URL" >/dev/null 2>&1 && break
  sleep 1
done

bash /work/poc/scripts/bootstrap-trust.sh

# Fund every role identity on the local chain (Anvil restarts empty, so this
# runs on every start). Balances pay for DID and accumulator transactions.
grep -E '^ROLE_EVM_PRIVATE_KEY_[A-Z]+=' "$config" | while IFS='=' read -r name key; do
  address="$(cast wallet address --private-key "$key")"
  cast rpc --rpc-url "$RPC_URL" anvil_setBalance "$address" 0x56BC75E2D63100000 >/dev/null
  echo "Funded ${name#ROLE_EVM_PRIVATE_KEY_} identity $address"
done
