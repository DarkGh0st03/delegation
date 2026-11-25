#!/usr/bin/env bash
# Phase 1b: reproducible run on a FRESH local trust layer.
# Starts a new Anvil (project image delegation-chain:local), deploys the three
# trust contracts with blockchain/scripts/deploy-local.sh, starts the RPC counting
# proxy and runs examples/multi_permission_benchmark_evm. Uses Anvil's public
# test mnemonic only; no secret is involved.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
OUT="${1:?usage: run_phase1b.sh <out-dir> [benchmark args...]}"; shift
WORK="$(mktemp -d)"
trap 'docker rm -f bench-anvil >/dev/null 2>&1 || true; kill "${PROXY_PID:-0}" 2>/dev/null || true; rm -rf "$WORK"' EXIT

docker rm -f bench-anvil >/dev/null 2>&1 || true
docker run -d --name bench-anvil --network host delegation-chain:local \
  anvil --host 127.0.0.1 --port 8545 --chain-id 31337 \
  --mnemonic "test test test test test test test test test test test junk" >/dev/null
for _ in $(seq 1 30); do
  docker run --rm --network host --entrypoint cast delegation-chain:local chain-id --rpc-url http://127.0.0.1:8545 >/dev/null 2>&1 && break
  sleep 1
done

mkdir -p "$WORK/chain" && cp -r "$REPO/blockchain/src" "$REPO/blockchain/scripts" "$REPO/blockchain/foundry.toml" "$WORK/chain/"
chmod -R a+rwX "$WORK"
docker run --rm --network host -v "$WORK/chain:/w" -w /w --entrypoint bash \
  -e ANVIL_DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  -e RPC_URL=http://127.0.0.1:8545 delegation-chain:local -c 'bash scripts/deploy-local.sh' > "$WORK/deploy.log" 2>&1
addr() { awk -F= -v k="$1" '$1==k {print $2}' "$WORK/deploy.log" | tail -1; }

python3 -I "$REPO/docs/experiments/multi-permission-verification/rpc_count_proxy.py" 8546 http://127.0.0.1:8545 &
PROXY_PID=$!
sleep 1

mkdir -p "$OUT"
export RPC_URL=http://127.0.0.1:8546 RPC_URL_DIRECT=http://127.0.0.1:8545 PROXY_CONTROL_URL=http://127.0.0.1:8546
export DID_REGISTRY_ADDRESS="$(addr DID_REGISTRY_ADDRESS)"
export ENTERPRISE_TRUST_REGISTRY_ADDRESS="$(addr ENTERPRISE_TRUST_REGISTRY_ADDRESS)"
export ISSUER_REGISTRY_ADDRESS="$(addr ISSUER_REGISTRY_ADDRESS)"
export DID_RESOLVER_SCRIPT="$REPO/blockchain/did-client/resolve-did-json.mjs"
export DID_PUBLISHER_SCRIPT="$REPO/blockchain/did-client/publish-ed25519.mjs"
export ARTIFACT_DIR="$WORK/artifacts"
{
  echo "DID_REGISTRY_ADDRESS=$DID_REGISTRY_ADDRESS"
  echo "ENTERPRISE_TRUST_REGISTRY_ADDRESS=$ENTERPRISE_TRUST_REGISTRY_ADDRESS"
  echo "ISSUER_REGISTRY_ADDRESS=$ISSUER_REGISTRY_ADDRESS"
  echo "anvil_image=$(docker image inspect delegation-chain:local --format '{{.Id}}')"
  echo "anvil_version=$(docker run --rm --entrypoint anvil delegation-chain:local --version | head -1)"
  echo "node=$(node --version)"
} > "$OUT/chain.env"
"$REPO/target/release/examples/multi_permission_benchmark_evm" --out "$OUT" "$@"
