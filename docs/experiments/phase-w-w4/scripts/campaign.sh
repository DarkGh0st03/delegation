#!/usr/bin/env bash
# Phase W4 campaign: one fresh stack per run, one discarded warm-up session
# (same variant), then one measured session. Scripted models only (no AI).
# Usage: campaign.sh <plan-file> <out-dir>   (plan lines: "<label> <base|ws> <2|4|8>")
set -u
S=$(cd "$(dirname "$0")" && pwd); OUT=$2; mkdir -p "$OUT"; cd /home/user/delegation
C="docker compose -f compose.yaml -f $S/compose.phase-w4.yaml"
req() { case $1 in 2) echo "Stock items: record each change";;
  4) echo "Orders returns transfers counts: record each change";;
  8) echo "Inventory: record each change";; esac; }
files() { [ "$1" = 8 ] && echo 8 || echo 15; }
while read -r label variant k; do
  [ -z "$label" ] && continue
  [ -f "$OUT/$label.json" ] && { echo "skip $label"; continue; }
  bw=$([ "$variant" = ws ] && echo 1 || echo 0)
  echo "=== $label variant=$variant k=$k $(date -u +%H:%M:%S)"
  $C down >/dev/null 2>&1
  DELEGATION_BATCH_WRITES=$bw DELEGATION_SCRIPTED_PLAN_FILES=$(files $k) $C up -d --no-build >/dev/null 2>&1
  for i in $(seq 1 150); do curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8700/ 2>/dev/null | grep -q 200 && break; sleep 2; done
  [ "$(docker exec delegation-app-1 printenv DELEGATION_BATCH_WRITES)" = "$bw" ] || { echo "env mismatch"; exit 1; }
  (cd "$S" && timeout 1500 node run-e2e.mjs warmup-$label "$OUT/warmup-$label.json" batch-bench "Stock items: record each change" 2>&1 | tail -1)
  (cd "$S" && timeout 2400 node run-e2e.mjs $label "$OUT/$label.json" batch-bench "$(req $k)" 2>&1 | tail -1)
  docker logs delegation-app-1 2>&1 | grep adk_tool_timing > "$OUT/$label.adk_tool_timing.jsonl"
done < "$1"
$C down >/dev/null 2>&1
echo "campaign done $(date -u +%H:%M:%S)"
