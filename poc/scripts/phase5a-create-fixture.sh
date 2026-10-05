#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${PHASE1_ENV_FILE:-$ROOT_DIR/poc/infra/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

BASE_URL="http://127.0.0.1:${GITEA_HOST_PORT:-3000}"
ADMIN_AUTH="$GITEA_ADMIN_USER:$GITEA_ADMIN_PASSWORD"
API="$BASE_URL/api/v1/repos/$GITEA_ORG/$GITEA_REPOSITORY"

status="$(curl -sS -o /tmp/phase5a-branch.json -w '%{http_code}' -u "$ADMIN_AUTH" "$API/branches/feature%2Faccount-suspension")"

if [[ "$status" == "404" ]]; then
  curl -fsS -u "$ADMIN_AUTH" \
    -H 'Content-Type: application/json' \
    -X POST "$API/branches" \
    --data '{"new_branch_name":"feature/account-suspension","old_branch_name":"main"}' \
    >/tmp/phase5a-branch.json
elif [[ "$status" != "200" ]]; then
  echo "Unexpected branch lookup status: $status" >&2
  exit 1
fi

observed_sha="$(node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync("/tmp/phase5a-branch.json","utf8"));process.stdout.write(j.commit?.id ?? "")')"

if [[ "$observed_sha" != "$GITEA_BASELINE_SHA" ]]; then
  echo "Fixture SHA mismatch: expected $GITEA_BASELINE_SHA, got $observed_sha" >&2
  exit 1
fi

echo "Phase 5A fixture branch ready at $observed_sha."
