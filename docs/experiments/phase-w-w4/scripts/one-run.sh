#!/usr/bin/env bash
# Phase W4: one fresh stack, one scripted session (no AI, no paid API).
# Usage: one-run.sh <label> <out-dir> <batch_writes 0|1> <plan_files> <requirement> [probe] [approve]
set -u
label=$1 out=$2 bw=$3 files=$4 req=$5 probe=${6:-} approve=${7:-}
S=$(cd "$(dirname "$0")" && pwd); cd /home/user/delegation
C="docker compose -f compose.yaml -f $S/compose.phase-w4.yaml"
$C down >/dev/null 2>&1
DELEGATION_BATCH_WRITES=$bw DELEGATION_SCRIPTED_PLAN_FILES=$files DELEGATION_W4_PROBE=$probe $C up -d --no-build >/dev/null 2>&1
for i in $(seq 1 150); do curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8700/ 2>/dev/null | grep -q 200 && break; sleep 2; done
[ "$(docker exec delegation-app-1 printenv DELEGATION_BATCH_WRITES)" = "$bw" ] || { echo "env mismatch"; exit 1; }
(cd "$S" && APPROVE=$approve timeout 1500 node run-e2e.mjs "$label" "$out/$label.json" batch-bench "$req" 2>&1 | tail -1)
docker logs delegation-app-1 2>&1 | grep adk_tool_timing > "$out/$label.adk_tool_timing.jsonl"
