#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INFRA_DIR="$ROOT_DIR/poc/infra"
ENV_FILE="${PHASE1_ENV_FILE:-$INFRA_DIR/.env}"
COMPOSE_FILE="$INFRA_DIR/docker-compose.yml"
RUNTIME_DIR="$INFRA_DIR/runtime"
GATEWAY_ENV="$RUNTIME_DIR/gateway.env"

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

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

http_code() {
  curl -sS -o /dev/null -w '%{http_code}' "$@"
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
  local admin_flag="$4"

  if [[ "$(http_code "$BASE_URL/api/v1/users/$username")" == "200" ]]; then
    echo "Gitea user already exists: $username"
    return 0
  fi

  echo "Creating Gitea user: $username"
  if [[ "$admin_flag" == "admin" ]]; then
    compose exec -T gitea gitea admin user create       --username "$username"       --password "$password"       --email "$email"       --admin       --must-change-password=false
  else
    compose exec -T gitea gitea admin user create       --username "$username"       --password "$password"       --email "$email"       --must-change-password=false
  fi
}

ensure_org() {
  if [[ "$(http_code -u "$ADMIN_AUTH" "$BASE_URL/api/v1/orgs/$GITEA_ORG")" == "200" ]]; then
    echo "Gitea organization already exists: $GITEA_ORG"
    return 0
  fi

  echo "Creating Gitea organization: $GITEA_ORG"
  curl -fsS -u "$ADMIN_AUTH"     -H 'Content-Type: application/json'     -X POST "$BASE_URL/api/v1/orgs"     --data "{"username":"$GITEA_ORG","full_name":"Thesis PoC","description":"Protected repository namespace for the delegated-authorization PoC","visibility":"private"}"     >/dev/null
}

ensure_repository() {
  if [[ "$(http_code -u "$ADMIN_AUTH" "$BASE_URL/api/v1/repos/$GITEA_ORG/$GITEA_REPOSITORY")" == "200" ]]; then
    echo "Gitea repository already exists: $GITEA_ORG/$GITEA_REPOSITORY"
    return 0
  fi

  echo "Importing protected baseline repository into Gitea..."
  curl -fsS -u "$ADMIN_AUTH"     -H 'Content-Type: application/json'     -X POST "$BASE_URL/api/v1/repos/migrate"     --data "{
      "clone_addr":"$GITEA_SOURCE_REPO",
      "repo_owner":"$GITEA_ORG",
      "repo_name":"$GITEA_REPOSITORY",
      "service":"git",
      "mirror":false,
      "private":true,
      "issues":false,
      "labels":false,
      "milestones":false,
      "pull_requests":false,
      "releases":false,
      "wiki":false,
      "lfs":false
    }" >/dev/null
}

wait_for_main_ref() {
  echo "Waiting for imported main ref..."
  for _ in $(seq 1 80); do
    if ref_json="$(curl -fsS -u "$ADMIN_AUTH" "$BASE_URL/api/v1/repos/$GITEA_ORG/$GITEA_REPOSITORY/git/refs/heads/main" 2>/dev/null)"; then
      observed_sha="$(printf '%s' "$ref_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.object?.sha ?? "")})')"
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

grant_gateway_write() {
  echo "Granting repository write permission to service user: $GITEA_GATEWAY_USER"
  curl -fsS -u "$ADMIN_AUTH"     -H 'Content-Type: application/json'     -X PUT "$BASE_URL/api/v1/repos/$GITEA_ORG/$GITEA_REPOSITORY/collaborators/$GITEA_GATEWAY_USER"     --data '{"permission":"write"}'     >/dev/null
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
  token_name="gateway-poc-$(date +%s)"
  response="$(curl -fsS -u "$GATEWAY_AUTH"     -H 'Content-Type: application/json'     -X POST "$BASE_URL/api/v1/users/$GITEA_GATEWAY_USER/tokens"     --data "{"name":"$token_name","scopes":["write:repository","read:user"]}")"

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

  curl -fsS     -H "Authorization: token $GITEA_GATEWAY_TOKEN"     "$BASE_URL/api/v1/repos/$GITEA_ORG/$GITEA_REPOSITORY"     >/dev/null

  ref_json="$(curl -fsS     -H "Authorization: token $GITEA_GATEWAY_TOKEN"     "$BASE_URL/api/v1/repos/$GITEA_ORG/$GITEA_REPOSITORY/git/refs/heads/main")"

  observed_sha="$(printf '%s' "$ref_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.object?.sha ?? "")})')"
  [[ "$observed_sha" == "$GITEA_BASELINE_SHA" ]] || {
    echo "Gateway credential sees unexpected main SHA: $observed_sha" >&2
    exit 1
  }

  echo "Gateway credential verified against $GITEA_ORG/$GITEA_REPOSITORY."
}

wait_for_gitea
ensure_user "$GITEA_ADMIN_USER" "$GITEA_ADMIN_PASSWORD" "$GITEA_ADMIN_EMAIL" admin
ensure_user "$GITEA_GATEWAY_USER" "$GITEA_GATEWAY_PASSWORD" "$GITEA_GATEWAY_EMAIL" user
ensure_org
ensure_repository
wait_for_main_ref
grant_gateway_write
ensure_gateway_token
verify_gateway_access

echo "Gitea bootstrap completed."
