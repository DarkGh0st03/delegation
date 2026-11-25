#!/usr/bin/env bash
# Phase R E2E campaign: one fresh stack per run (Anvil + app restarted together),
# one discarded warm-up session, then one measured session.
# Usage: campaign.sh <plan-file>   (lines: "<label> <variant:batch|single> <k:5|15>")
set -u
S=/tmp/claude-0/-home-user/a156b812-e811-5573-98a6-c6009f1fb04e/scratchpad
OUT=$S/e2e2; cd /home/user/delegation
COMPOSE="docker compose -f compose.yaml -f $S/compose.phase-r.yaml"
req() { [ "$1" = 5 ] && echo "Ledger: record each change" || echo "Inventory: record each change"; }
while read -r label variant k; do
  [ -z "$label" ] && continue
  [ -f "$OUT/$label.json" ] && { echo "skip $label"; continue; }
  b=$([ "$variant" = batch ] && echo 1 || echo 0)
  echo "=== $label variant=$variant k=$k $(date -u +%H:%M:%S)"
  $COMPOSE down >/dev/null 2>&1
  DELEGATION_BATCH_READS=$b DELEGATION_SCRIPTED_PLAN_FILES=15 $COMPOSE up -d --no-build >/dev/null 2>&1
  for i in $(seq 1 150); do curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8700/ 2>/dev/null | grep -q 200 && break; sleep 2; done
  [ "$(docker exec delegation-app-1 printenv DELEGATION_BATCH_READS)" = "$b" ] || { echo "env mismatch"; exit 1; }
  (cd $S && timeout 1500 node run-e2e.mjs warmup-$label $OUT/warmup-$label.json batch-bench "Ledger: record each change" 2>&1 | tail -1)
  (cd $S && timeout 2400 node run-e2e.mjs $label $OUT/$label.json batch-bench "$(req $k)" 2>&1 | tail -1)
  docker logs delegation-app-1 2>&1 | grep adk_tool_timing > $OUT/$label.adk_tool_timing.jsonl
done < "$1"
$COMPOSE down >/dev/null 2>&1
echo "campaign done $(date -u +%H:%M:%S)"
