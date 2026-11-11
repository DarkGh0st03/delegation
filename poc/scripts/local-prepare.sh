#!/usr/bin/env bash
# One-time (or after Rust/dependency changes) local preparation, run from WSL:
#
#   bash poc/scripts/local-prepare.sh
#
# 1. checks the required tools;
# 2. installs pinned Node dependencies (poc workspace + DID client);
# 3. builds the two native Rust addons exactly as the native CI does and
#    copies them where the Engineer core and the Gateway verifier load them.
#
# It does NOT start Docker services (use poc/scripts/phase1-up.sh), does not
# create keys outside the gitignored runtime folders and never calls Gemini.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
export PATH="$HOME/.foundry/bin:$HOME/.cargo/bin:$PATH"

case "$ROOT_DIR" in
  /mnt/*)
    echo "ATTENZIONE: la repository è su un disco Windows ($ROOT_DIR)." >&2
    echo "Clonala nel filesystem Linux (es. ~/delegation): i permessi 0600 e i socket Unix non funzionano su /mnt/c." >&2
    exit 1;;
esac

echo "== 1/3 Strumenti"
missing=0
for tool in node npm cargo rustc docker forge cast anvil git; do
  if command -v "$tool" >/dev/null 2>&1; then
    printf '  %-7s %s\n' "$tool" "$("$tool" --version 2>/dev/null | head -1)"
  else
    echo "  $tool    MANCANTE" >&2; missing=1
  fi
done
if ! docker info >/dev/null 2>&1; then
  echo "  docker  il demone non risponde: avvia Docker Desktop e attiva l'integrazione WSL" >&2
  missing=1
fi
[[ "$missing" == 0 ]] || { echo "Installa gli strumenti mancanti e riprova." >&2; exit 1; }

echo "== 2/3 Dipendenze Node (versioni bloccate dai lockfile)"
npm --prefix poc ci --ignore-scripts --no-audit --no-fund
npm --prefix blockchain/did-client ci --ignore-scripts --no-audit --no-fund

echo "== 3/3 Moduli Rust nativi (può richiedere diversi minuti la prima volta)"
cargo build --release --manifest-path services/delegation-engineer-node/Cargo.toml
cargo build --release --manifest-path services/delegation-core-node/Cargo.toml
mkdir -p poc/packages/orchestrator-runtime/src/native poc/apps/gateway/src/native
cp services/delegation-engineer-node/target/release/libdelegation_engineer_node.so \
  poc/packages/orchestrator-runtime/src/native/delegation-engineer.node
cp services/delegation-core-node/target/release/libdelegation_core_node.so \
  poc/apps/gateway/src/native/delegation-core.node

echo
echo "Preparazione completata."
echo "Prossimo passo: bash poc/scripts/phase1-up.sh   (avvia Gitea, OPA, Anvil e i contratti)"
