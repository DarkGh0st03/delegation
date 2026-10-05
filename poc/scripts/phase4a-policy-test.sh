#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OPA_IMAGE="${OPA_IMAGE:-openpolicyagent/opa:1.21.1}"

echo "Checking Rego parseability..."
docker run --rm \
  -v "$ROOT_DIR/poc/opa:/policy:ro" \
  "$OPA_IMAGE" fmt /policy/policy.rego /policy/policy_test.rego >/dev/null

echo "Running Phase 4A OPA policy tests..."
docker run --rm \
  -v "$ROOT_DIR/poc/opa:/policy:ro" \
  "$OPA_IMAGE" test /policy -v

echo "PHASE4A_POLICY_TEST=PASS"
