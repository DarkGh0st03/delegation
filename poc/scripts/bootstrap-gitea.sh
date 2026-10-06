#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INFRA_DIR="$ROOT_DIR/poc/infra"
ENV_FILE="${PHASE1_ENV_FILE:-$INFRA_DIR/.env}"
COMPOSE_FILE="$INFRA_DIR/docker-compose.yml"
RUNTIME_DIR="$INFRA_DIR/runtime"
GATEWAY_ENV="$RUNTIME_DIR/gateway.env"
RUNNER_ENV="$RUNTIME_DIR/runner.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Run: node poc/scripts/init-local-env.mjs" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

BASE_URL="http://127.0.0.1:${GITEA_HOST_PORT:-3000}"
ADMIN_AUTH="$GITEA_ADMIN_USER:$GITEA_ADMIN_PASSWORD"
GATEWAY_AUTH="$GITEA_GATEWAY_USER:$GITEA_GATEWAY_PASSWORD"
RUNNER_AUTH="$GITEA_RUNNER_USER:$GITEA_RUNNER_PASSWORD"

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

http_code() {
  curl -sS -o /dev/null -w '%{http_code}' "$@"
}

json_org_payload() {
  node -e '
    process.stdout.write(JSON.stringify({
      username: process.argv[1],
      full_name: "Thesis PoC",
      description: "Protected repository namespace for the delegated-authorization PoC",
      visibility: "private"
    }))
  ' "$GITEA_ORG"
}

json_migration_payload() {
  node -e '
    process.stdout.write(JSON.stringify({
      clone_addr: process.argv[1],
      repo_owner: process.argv[2],
      repo_name: process.argv[3],
      service: "git",
      mirror: false,
      private: true,
      issues: false,
      labels: false,
      milestones: false,
      pull_requests: false,
      releases: false,
      wiki: false,
      lfs: false
    }))
  ' "$GITEA_SOURCE_REPO" "$GITEA_ORG" "$GITEA_REPOSITORY"
}

json_token_payload() {
  node -e '
    process.stdout.write(JSON.stringify({
      name: process.argv[1],
      scopes: [process.argv[2], "read:user"]
    }))
  ' "$1" "$2"
}

wait_for_gitea() {
  echo "Waiting for Gitea..."
  for _ in $(seq 1 80); do
    if curl -fsS "$BASE_URL/api/healthz" >/dev/null 2>&1; then
      echo "Gitea is ready."
      return 0
    fi
    sleep 2
  done
  echo "Gitea did not become ready." >&2
  return 1
}

ensure_user() {
  local username="$1"
  local password="$2"
  local email="$3"
  local role="$4"

  if [[ "$(http_code "$BASE_URL/api/v1/users/$username")" == "200" ]]; then
    echo "Gitea user already exists: $username"
    return 0
  fi

  echo "Creating Gitea user: $username"
  if [[ "$role" == "admin" ]]; then
    compose exec -T --user 1000:1000 gitea gitea admin user create --username "$username" --password "$password" --email "$email" --admin --must-change-password=false
  else
    compose exec -T --user 1000:1000 gitea gitea admin user create --username "$username" --password "$password" --email "$email" --must-change-password=false
  fi
}

ensure_org() {
  if [[ "$(http_code -u "$ADMIN_AUTH" "$BASE_URL/api/v1/orgs/$GITEA_ORG")" == "200" ]]; then
    echo "Gitea organization already exists: $GITEA_ORG"
    return 0
  fi

  echo "Creating Gitea organization: $GITEA_ORG"
  local payload
  payload="$(json_org_payload)"
  curl -fsS -u "$ADMIN_AUTH" -H 'Content-Type: application/json' -X POST "$BASE_URL/api/v1/orgs" --data "$payload" >/dev/null
}

ensure_repository() {
  if [[ "$(http_code -u "$ADMIN_AUTH" "$BASE_URL/api/v1/repos/$GITEA_ORG/$GITEA_REPOSITORY")" == "200" ]]; then
    echo "Gitea repository already exists: $GITEA_ORG/$GITEA_REPOSITORY"
    return 0
  fi

  echo "Importing protected baseline repository into Gitea..."
  local payload
  payload="$(json_migration_payload)"
  curl -fsS -u "$ADMIN_AUTH" -H 'Content-Type: application/json' -X POST "$BASE_URL/api/v1/repos/migrate" --data "$payload" >/dev/null
}

wait_for_main_ref() {
  echo "Waiting for imported main ref..."
  for _ in $(seq 1 80); do
    if branch_json="$(curl -fsS -u "$ADMIN_AUTH" "$BASE_URL/api/v1/repos/$GITEA_ORG/$GITEA_REPOSITORY/branches/main" 2>/dev/null)"; then
      observed_sha="$(printf '%s' "$branch_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.commit?.id ?? "")})')"
      if [[ -n "$observed_sha" ]]; then
        if [[ "$observed_sha" != "$GITEA_BASELINE_SHA" ]]; then
          echo "Imported main SHA mismatch: expected $GITEA_BASELINE_SHA, got $observed_sha" >&2
          exit 1
        fi
        echo "Imported baseline SHA verified: $observed_sha"
        return 0
      fi
    fi
    sleep 2
  done

  echo "Imported repository main ref did not become available." >&2
  exit 1
}


ensure_main_branch_protection() {
  local protection_url payload code
  protection_url="$BASE_URL/api/v1/repos/$GITEA_ORG/$GITEA_REPOSITORY/branch_protections/main"
  code="$(http_code -u "$ADMIN_AUTH" "$protection_url")"

  if [[ "$code" == "200" ]]; then
    echo "Gitea main branch protection already exists."
    return 0
  fi

  if [[ "$code" != "404" ]]; then
    echo "Could not inspect Gitea main branch protection (HTTP $code)." >&2
    exit 1
  fi

  echo "Protecting Gitea main against direct push and unreviewed merge..."
  payload='{"branch_name":"main","enable_push":false,"enable_force_push":false,"required_approvals":1,"block_admin_merge_override":true,"dismiss_stale_approvals":true,"block_on_outdated_branch":true}'
  curl -fsS -u "$ADMIN_AUTH" -H 'Content-Type: application/json' -X POST     "$BASE_URL/api/v1/repos/$GITEA_ORG/$GITEA_REPOSITORY/branch_protections"     --data "$payload" >/dev/null
}

verify_main_branch_protection() {
  local protection_json
  protection_json="$(curl -fsS -u "$ADMIN_AUTH"     "$BASE_URL/api/v1/repos/$GITEA_ORG/$GITEA_REPOSITORY/branch_protections/main")"

  printf '%s' "$protection_json" | node -e '
    let s="";
    process.stdin.on("data",d=>s+=d).on("end",()=>{
      const p=JSON.parse(s);
      const ok=
        p.branch_name==="main" &&
        p.enable_push===false &&
        p.enable_force_push===false &&
        Number(p.required_approvals)>=1 &&
        p.block_admin_merge_override===true;
      if(!ok){
        console.error("Unexpected main branch protection:", JSON.stringify(p));
        process.exit(1);
      }
    })
  '

  echo "Gitea main branch protection verified."
}

grant_gateway_write() {
  echo "Granting repository write permission to service user: $GITEA_GATEWAY_USER"
  curl -fsS -u "$ADMIN_AUTH" -H 'Content-Type: application/json' -X PUT "$BASE_URL/api/v1/repos/$GITEA_ORG/$GITEA_REPOSITORY/collaborators/$GITEA_GATEWAY_USER" --data '{"permission":"write"}' >/dev/null
}

grant_runner_read() {
  echo "Granting repository read permission to service user: $GITEA_RUNNER_USER"
  curl -fsS -u "$ADMIN_AUTH" -H 'Content-Type: application/json' -X PUT "$BASE_URL/api/v1/repos/$GITEA_ORG/$GITEA_REPOSITORY/collaborators/$GITEA_RUNNER_USER" --data '{"permission":"read"}' >/dev/null
}

gateway_token_is_valid() {
  [[ -f "$GATEWAY_ENV" ]] || return 1
  # shellcheck disable=SC1090
  source "$GATEWAY_ENV"
  [[ -n "${GITEA_GATEWAY_TOKEN:-}" ]] || return 1
  curl -fsS -H "Authorization: token $GITEA_GATEWAY_TOKEN" "$BASE_URL/api/v1/user" >/dev/null 2>&1
}

ensure_gateway_token() {
  mkdir -p "$RUNTIME_DIR"

  if gateway_token_is_valid; then
    echo "Existing Gateway Gitea credential is still valid."
    return 0
  fi

  echo "Creating a repository-scoped Gateway access credential..."
  local token_name payload response token
  token_name="gateway-poc-$(date +%s)"
  payload="$(json_token_payload "$token_name" "write:repository")"
  response="$(curl -fsS -u "$GATEWAY_AUTH" -H 'Content-Type: application/json' -X POST "$BASE_URL/api/v1/users/$GITEA_GATEWAY_USER/tokens" --data "$payload")"

  token="$(printf '%s' "$response" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.sha1 ?? "")})')"
  if [[ -z "$token" ]]; then
    echo "Gitea did not return the new Gateway credential." >&2
    exit 1
  fi

  cat >"$GATEWAY_ENV" <<EOF
# Generated locally by poc/scripts/bootstrap-gitea.sh
# Keep this file private; it is gitignored.
GITEA_BASE_URL=http://gitea:3000
GITEA_HOST_BASE_URL=$BASE_URL
GITEA_OWNER=$GITEA_ORG
GITEA_REPOSITORY=$GITEA_REPOSITORY
GITEA_GATEWAY_USER=$GITEA_GATEWAY_USER
GITEA_GATEWAY_TOKEN=$token
EOF
  chmod 600 "$GATEWAY_ENV" 2>/dev/null || true
}

verify_gateway_access() {
  # shellcheck disable=SC1090
  source "$GATEWAY_ENV"

  curl -fsS -H "Authorization: token $GITEA_GATEWAY_TOKEN" "$BASE_URL/api/v1/repos/$GITEA_ORG/$GITEA_REPOSITORY" >/dev/null

  branch_json="$(curl -fsS -H "Authorization: token $GITEA_GATEWAY_TOKEN" "$BASE_URL/api/v1/repos/$GITEA_ORG/$GITEA_REPOSITORY/branches/main")"
  observed_sha="$(printf '%s' "$branch_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.commit?.id ?? "")})')"

  [[ "$observed_sha" == "$GITEA_BASELINE_SHA" ]] || {
    echo "Gateway credential sees unexpected main SHA: $observed_sha" >&2
    exit 1
  }

  echo "Gateway credential verified against $GITEA_ORG/$GITEA_REPOSITORY."
}

runner_token_is_valid() {
  [[ -f "$RUNNER_ENV" ]] || return 1
  # shellcheck disable=SC1090
  source "$RUNNER_ENV"
  [[ -n "${GITEA_RUNNER_TOKEN:-}" ]] || return 1
  curl -fsS -H "Authorization: token $GITEA_RUNNER_TOKEN" "$BASE_URL/api/v1/user" >/dev/null 2>&1
}

ensure_runner_token() {
  mkdir -p "$RUNTIME_DIR"

  if runner_token_is_valid; then
    echo "Existing Runner Gitea credential is still valid."
    return 0
  fi

  echo "Creating a read-only Runner access credential..."
  local token_name payload response token
  token_name="runner-poc-$(date +%s)"
  payload="$(json_token_payload "$token_name" "read:repository")"
  response="$(curl -fsS -u "$RUNNER_AUTH" -H 'Content-Type: application/json' -X POST "$BASE_URL/api/v1/users/$GITEA_RUNNER_USER/tokens" --data "$payload")"

  token="$(printf '%s' "$response" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.sha1 ?? "")})')"
  if [[ -z "$token" ]]; then
    echo "Gitea did not return the new Runner credential." >&2
    exit 1
  fi

  cat >"$RUNNER_ENV" <<EOF
# Generated locally by poc/scripts/bootstrap-gitea.sh
# Keep this file private; it is gitignored.
GITEA_RUNNER_BASE_URL=$BASE_URL
GITEA_OWNER=$GITEA_ORG
GITEA_REPOSITORY=$GITEA_REPOSITORY
GITEA_RUNNER_USER=$GITEA_RUNNER_USER
GITEA_RUNNER_TOKEN=$token
EOF
  chmod 600 "$RUNNER_ENV" 2>/dev/null || true
}

verify_runner_access() {
  # shellcheck disable=SC1090
  source "$RUNNER_ENV"

  repo_json="$(curl -fsS -H "Authorization: token $GITEA_RUNNER_TOKEN" "$BASE_URL/api/v1/repos/$GITEA_ORG/$GITEA_REPOSITORY")"
  read -r can_pull can_push < <(printf '%s' "$repo_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write(String(Boolean(j.permissions?.pull))+" "+String(Boolean(j.permissions?.push))+"\n")})')

  [[ "$can_pull" == "true" && "$can_push" == "false" ]] || {
    echo "Runner credential must be read-only (pull=true, push=false), observed pull=$can_pull push=$can_push" >&2
    exit 1
  }

  branch_json="$(curl -fsS -H "Authorization: token $GITEA_RUNNER_TOKEN" "$BASE_URL/api/v1/repos/$GITEA_ORG/$GITEA_REPOSITORY/branches/main")"
  observed_sha="$(printf '%s' "$branch_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.commit?.id ?? "")})')"
  [[ "$observed_sha" == "$GITEA_BASELINE_SHA" ]] || {
    echo "Runner credential sees unexpected main SHA: $observed_sha" >&2
    exit 1
  }

  echo "Runner read-only credential verified against $GITEA_ORG/$GITEA_REPOSITORY."
}

wait_for_gitea
ensure_user "$GITEA_ADMIN_USER" "$GITEA_ADMIN_PASSWORD" "$GITEA_ADMIN_EMAIL" admin
ensure_user "$GITEA_GATEWAY_USER" "$GITEA_GATEWAY_PASSWORD" "$GITEA_GATEWAY_EMAIL" user
ensure_user "$GITEA_RUNNER_USER" "$GITEA_RUNNER_PASSWORD" "$GITEA_RUNNER_EMAIL" user
ensure_org
ensure_repository
wait_for_main_ref
ensure_main_branch_protection
verify_main_branch_protection
grant_gateway_write
grant_runner_read
ensure_gateway_token
ensure_runner_token
verify_gateway_access
verify_runner_access

echo "Gitea bootstrap completed."
