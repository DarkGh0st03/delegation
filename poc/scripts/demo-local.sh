#!/usr/bin/env bash
set -euo pipefail

# Local thesis demonstration helper.
# Kept on demo-local so the frozen thesis main branch remains untouched.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INFRA_DIR="$ROOT_DIR/poc/infra"
ENV_FILE="${PHASE1_ENV_FILE:-$INFRA_DIR/.env}"
COMPOSE_FILE="$INFRA_DIR/docker-compose.yml"
RUNTIME_DIR="$INFRA_DIR/runtime/demo-local"
RESULT_FILE="$RUNTIME_DIR/phase10b-result.json"
EXPECTED_BASELINE="405748b1e77992b6bd8630a3ab6f990658d32f6b"
GITEA_AMD64_DIGEST="sha256:ac83af429cdb44c89253ea05c666030d5433e9e3672f11b839acceecc6e19b16"

export PATH="$HOME/.foundry/bin:$PATH"
mkdir -p "$RUNTIME_DIR"

banner() {
  printf '\n============================================================\n'
  printf ' Thesis demo — delegated authorization for software agents\n'
  printf '============================================================\n\n'
}

step() { printf '\n[%s] %s\n' "$1" "$2"; }
ok() { printf '  OK  %s\n' "$1"; }
fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

load_base_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    node "$ROOT_DIR/poc/scripts/init-local-env.mjs"
  fi
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
}

load_runtime_envs() {
  load_base_env
  for file in \
    "$INFRA_DIR/runtime/trust.env" \
    "$INFRA_DIR/runtime/gateway.env" \
    "$INFRA_DIR/runtime/runner.env"; do
    [[ -f "$file" ]] || fail "Missing runtime file: $file. Run '$0 up' first."
    set -a
    # shellcheck disable=SC1090
    source "$file"
    set +a
  done
}

wait_http() {
  local url="$1"
  local label="$2"
  local attempts="${3:-120}"
  local i
  for ((i=1; i<=attempts; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      ok "$label"
      return 0
    fi
    sleep 0.5
  done
  fail "$label did not become ready at $url"
}

stop_pidfile() {
  local file="$1"
  if [[ -f "$file" ]]; then
    local pid
    pid="$(cat "$file" 2>/dev/null || true)"
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      for _ in {1..20}; do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.1
      done
      kill -KILL "$pid" 2>/dev/null || true
    fi
    rm -f "$file"
  fi
}

stop_application_processes() {
  stop_pidfile "$RUNTIME_DIR/gateway.pid"
  stop_pidfile "$RUNTIME_DIR/runner.pid"
  stop_pidfile "$RUNTIME_DIR/adapter.pid"

  # Compatibility with the manual/npm/cargo commands used while preparing this
  # workstation. Those wrappers can leave the real child process alive.
  stop_pidfile /tmp/phase10b-gateway.pid
  stop_pidfile /tmp/phase10b-runner.pid
  stop_pidfile /tmp/phase10b-adapter.pid
  stop_pidfile /tmp/phase10a-adapter.pid

  pkill -f 'node --experimental-strip-types ./src/main.ts' 2>/dev/null || true
  pkill -f "$ROOT_DIR/poc/apps/gateway/src/main.ts" 2>/dev/null || true
  pkill -f "$ROOT_DIR/poc/apps/test-runner-controller/src/main.ts" 2>/dev/null || true
  pkill -f 'services/delegation-adapter/target/debug/delegation-adapter' 2>/dev/null || true
  pkill -f "$ROOT_DIR/services/delegation-adapter/target/debug/delegation-adapter" 2>/dev/null || true
  sleep 0.3
}

stop_native_anvil() {
  stop_pidfile "$RUNTIME_DIR/anvil.pid"
  stop_pidfile /tmp/delegation-anvil.pid
}

ensure_gitea_image() {
  local image="${GITEA_IMAGE:-docker.gitea.com/gitea:28.0.0}"
  if docker run --rm --platform linux/amd64 --entrypoint /bin/sh "$image" -c 'exit 0' >/dev/null 2>&1; then
    return 0
  fi

  [[ "$image" == "docker.gitea.com/gitea:28.0.0" ]] \
    || fail "Gitea image $image is not executable and no repair digest is pinned for it."

  printf '  Repairing local Gitea image with the pinned linux/amd64 manifest...\n'
  docker pull "docker.gitea.com/gitea@$GITEA_AMD64_DIGEST" >/dev/null
  docker tag "docker.gitea.com/gitea@$GITEA_AMD64_DIGEST" "$image"
  docker run --rm --platform linux/amd64 --entrypoint /bin/sh "$image" -c 'exit 0' >/dev/null 2>&1 \
    || fail "Pinned Gitea linux/amd64 image still cannot execute."
  ok "Gitea image repaired"
}

start_native_anvil() {
  local rpc="http://127.0.0.1:${ANVIL_HOST_PORT:-8545}"
  local expected="${ANVIL_CHAIN_ID:-31337}"
  local observed
  observed="$(cast chain-id --rpc-url "$rpc" 2>/dev/null || true)"
  if [[ "$observed" == "$expected" ]]; then
    ok "Anvil already listening (chain $expected)"
    return 0
  fi

  nohup anvil \
    --host 127.0.0.1 \
    --chain-id "$expected" \
    --mnemonic "${ANVIL_MNEMONIC:-test test test test test test test test test test test junk}" \
    > "$RUNTIME_DIR/anvil.log" 2>&1 &
  echo $! > "$RUNTIME_DIR/anvil.pid"

  for _ in {1..80}; do
    observed="$(cast chain-id --rpc-url "$rpc" 2>/dev/null || true)"
    if [[ "$observed" == "$expected" ]]; then
      ok "Anvil native WSL (chain $expected)"
      return 0
    fi
    sleep 0.5
  done
  cat "$RUNTIME_DIR/anvil.log" >&2 || true
  fail "Anvil did not become ready"
}

demo_private_key() {
  printf '0x%064x' "$1"
}

prepare_evm_identities() {
  export ADAPTER_TRUST_PROFILE=evm
  export ADAPTER_BIND_ADDR=127.0.0.1:8090
  export DELEGATION_ADAPTER_URL=http://127.0.0.1:8090
  export ADAPTER_ID_GATEWAY=urn:thesis:service:gateway
  export GOVERNANCE_PRIVATE_KEY="$ANVIL_DEPLOYER_PRIVATE_KEY"

  # Deterministic local-only test identities; generated at runtime rather than
  # stored as credential material in the repository.
  export ADAPTER_EVM_PRIVATE_KEY_ENGINEER="$(demo_private_key 1)"
  export ADAPTER_EVM_PRIVATE_KEY_ORCHESTRATOR="$(demo_private_key 2)"
  export ADAPTER_EVM_PRIVATE_KEY_BACKEND="$(demo_private_key 3)"
  export ADAPTER_EVM_PRIVATE_KEY_FRONTEND="$(demo_private_key 4)"
  export ADAPTER_EVM_PRIVATE_KEY_TEST="$(demo_private_key 5)"

  local chain_hex
  chain_hex="$(printf '0x%x' "$CHAIN_ID")"
  export ADAPTER_ID_ENGINEER="did:ethr:${chain_hex}:$(cast wallet address --private-key "$ADAPTER_EVM_PRIVATE_KEY_ENGINEER")"
  export ADAPTER_ID_ORCHESTRATOR="did:ethr:${chain_hex}:$(cast wallet address --private-key "$ADAPTER_EVM_PRIVATE_KEY_ORCHESTRATOR")"
  export ADAPTER_ID_BACKEND="did:ethr:${chain_hex}:$(cast wallet address --private-key "$ADAPTER_EVM_PRIVATE_KEY_BACKEND")"
  export ADAPTER_ID_FRONTEND="did:ethr:${chain_hex}:$(cast wallet address --private-key "$ADAPTER_EVM_PRIVATE_KEY_FRONTEND")"
  export ADAPTER_ID_TEST="did:ethr:${chain_hex}:$(cast wallet address --private-key "$ADAPTER_EVM_PRIVATE_KEY_TEST")"

  local role pk_var pk address
  for role in ENGINEER ORCHESTRATOR BACKEND FRONTEND TEST; do
    pk_var="ADAPTER_EVM_PRIVATE_KEY_${role}"
    pk="${!pk_var}"
    address="$(cast wallet address --private-key "$pk")"
    cast rpc --rpc-url "$RPC_URL" anvil_setBalance "$address" 0x56BC75E2D63100000 >/dev/null
  done
}

start_adapter() {
  cargo build --manifest-path "$ROOT_DIR/services/delegation-adapter/Cargo.toml" \
    > "$RUNTIME_DIR/adapter-build.log" 2>&1
  "$ROOT_DIR/services/delegation-adapter/target/debug/delegation-adapter" \
    > "$RUNTIME_DIR/adapter.log" 2>&1 &
  echo $! > "$RUNTIME_DIR/adapter.pid"
  sleep 0.3
  kill -0 "$(cat "$RUNTIME_DIR/adapter.pid")" 2>/dev/null || {
    cat "$RUNTIME_DIR/adapter.log" >&2 || true
    fail "Delegation Adapter exited during startup"
  }
  wait_http http://127.0.0.1:8090/health "Delegation Adapter (EVM)"
  local health
  health="$(curl -fsS http://127.0.0.1:8090/health)"
  [[ "$health" == *'"trust_profile":"evm"'* ]] \
    || fail "Adapter is healthy but not using the EVM trust profile."
}

start_runner() {
  export TEST_RUNNER_GATEWAY_TOKEN="phase10b-gateway-runner-secret"
  export TEST_RUNNER_BIND_ADDR="127.0.0.1:8091"
  export TEST_RUNNER_URL="http://127.0.0.1:8091"
  export TEST_RUNNER_TIMEOUT_MS="900000"
  export TEST_RUNNER_DOCKER_IMAGE="node:22.15.0-bookworm"
  export TEST_RUNNER_PHASE_TIMEOUT_MS="600000"
  export TEST_RUNNER_ACCEPTANCE_ENABLED="true"
  export EXPECTED_GITEA_REVISION="$EXPECTED_BASELINE"

  node --experimental-strip-types \
    "$ROOT_DIR/poc/apps/test-runner-controller/src/main.ts" \
    > "$RUNTIME_DIR/runner.log" 2>&1 &
  echo $! > "$RUNTIME_DIR/runner.pid"
  sleep 0.3
  kill -0 "$(cat "$RUNTIME_DIR/runner.pid")" 2>/dev/null || {
    cat "$RUNTIME_DIR/runner.log" >&2 || true
    fail "Controlled Test Runner exited during startup"
  }
  wait_http http://127.0.0.1:8091/health "Controlled Test Runner"
}

start_gateway() {
  export GATEWAY_BIND_ADDR="127.0.0.1:8080"
  export GATEWAY_AUDIENCE="cloud-access-gateway"
  export GATEWAY_REQUEST_TTL_MS="120000"
  export GATEWAY_RESOURCE_AUTHORITY="gitea.local"
  export GATEWAY_PROVIDER_MODE="gitea"
  export GITEA_BASE_URL="$GITEA_HOST_BASE_URL"
  export DELEGATION_ADAPTER_URL="http://127.0.0.1:8090"
  export OPA_URL="http://127.0.0.1:8181"
  export OPA_TIMEOUT_MS="2000"
  export GITEA_TIMEOUT_MS="3000"
  export TEST_RUNNER_URL="http://127.0.0.1:8091"
  export TEST_RUNNER_GATEWAY_TOKEN="phase10b-gateway-runner-secret"

  node --experimental-strip-types \
    "$ROOT_DIR/poc/apps/gateway/src/main.ts" \
    > "$RUNTIME_DIR/gateway.log" 2>&1 &
  echo $! > "$RUNTIME_DIR/gateway.pid"
  sleep 0.3
  kill -0 "$(cat "$RUNTIME_DIR/gateway.pid")" 2>/dev/null || {
    cat "$RUNTIME_DIR/gateway.log" >&2 || true
    fail "Cloud Access Gateway exited during startup"
  }
  wait_http http://127.0.0.1:8080/health "Cloud Access Gateway"
}

assert_fresh_scenario() {
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' \
    -H "Authorization: token $GITEA_GATEWAY_TOKEN" \
    "$GITEA_HOST_BASE_URL/api/v1/repos/$GITEA_OWNER/$GITEA_REPOSITORY/branches/feature%2Faccount-suspension")"
  if [[ "$code" == "200" ]]; then
    fail "feature/account-suspension already exists. Run '$0 reset' and '$0 up' before another demo run."
  fi
}

cmd_reset() {
  banner
  step "RESET 1/3" "Stopping demo processes"
  stop_application_processes
  stop_native_anvil
  docker ps -aq --filter 'name=delegation-runner-' | xargs -r docker rm -f >/dev/null 2>&1 || true
  ok "Application processes stopped"

  load_base_env
  step "RESET 2/3" "Removing local infrastructure containers"
  compose down --remove-orphans >/dev/null 2>&1 || true
  ok "Compose services stopped"

  step "RESET 3/3" "Resetting only the local Gitea demo state"
  docker volume rm -f delegation-poc-gitea-data >/dev/null 2>&1 || true
  rm -f "$INFRA_DIR/runtime/gateway.env" "$INFRA_DIR/runtime/runner.env" "$INFRA_DIR/runtime/trust.env" "$RESULT_FILE"
  ok "Pristine demo state restored"
  printf '\nNext: %s up\n' "$0"
}

cmd_up() {
  banner
  for command_name in docker node npm cargo curl forge cast anvil; do
    require_cmd "$command_name"
  done
  docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required."

  load_base_env
  stop_application_processes

  step "1/6" "Starting protected provider and policy engine"
  ensure_gitea_image
  compose up -d gitea opa >/dev/null
  wait_http "http://127.0.0.1:${GITEA_HOST_PORT:-3000}/api/healthz" "Gitea protected provider"
  wait_http "http://127.0.0.1:${OPA_HOST_PORT:-8181}/health" "OPA policy engine"

  step "2/6" "Bootstrapping protected repository and least-privilege service identities"
  if ! bash "$ROOT_DIR/poc/scripts/bootstrap-gitea.sh" > "$RUNTIME_DIR/bootstrap-gitea.log" 2>&1; then
    cat "$RUNTIME_DIR/bootstrap-gitea.log" >&2 || true
    fail "Gitea bootstrap failed"
  fi
  ok "iam-console-poc imported at frozen baseline and main protected"

  step "3/6" "Starting local EVM trust layer"
  start_native_anvil
  if ! RPC_URL="http://127.0.0.1:${ANVIL_HOST_PORT:-8545}" \
       CHAIN_ID="${ANVIL_CHAIN_ID:-31337}" \
       ANVIL_DEPLOYER_PRIVATE_KEY="$ANVIL_DEPLOYER_PRIVATE_KEY" \
       bash "$ROOT_DIR/poc/scripts/bootstrap-trust.sh" > "$RUNTIME_DIR/bootstrap-trust.log" 2>&1; then
    cat "$RUNTIME_DIR/bootstrap-trust.log" >&2 || true
    fail "Trust contract deployment failed"
  fi
  set -a
  # shellcheck disable=SC1090
  source "$INFRA_DIR/runtime/trust.env"
  set +a
  ok "DID, Enterprise Trust and Issuer registries deployed"

  step "4/6" "Preparing EVM-backed agent identities"
  prepare_evm_identities
  ok "Engineer, Orchestrator, Backend, Frontend and Test DIDs prepared"

  step "5/6" "Starting authorization and controlled-execution services"
  set -a
  # shellcheck disable=SC1090
  source "$INFRA_DIR/runtime/runner.env"
  # shellcheck disable=SC1090
  source "$INFRA_DIR/runtime/gateway.env"
  set +a
  start_adapter
  start_runner
  start_gateway

  step "6/6" "Validating the complete local infrastructure"
  bash "$ROOT_DIR/poc/scripts/phase1-check.sh"

  printf '\nDEMO ENVIRONMENT: READY\n'
  printf '  Gitea   http://127.0.0.1:%s\n' "${GITEA_HOST_PORT:-3000}"
  printf '  OPA     http://127.0.0.1:%s\n' "${OPA_HOST_PORT:-8181}"
  printf '  Anvil   http://127.0.0.1:%s\n' "${ANVIL_HOST_PORT:-8545}"
  printf '  Adapter http://127.0.0.1:8090\n'
  printf '  Runner  http://127.0.0.1:8091\n'
  printf '  Gateway http://127.0.0.1:8080\n'
  printf '\nBefore running the workflow, show Gitea main at baseline %s.\n' "$EXPECTED_BASELINE"
  printf 'Then run: %s run\n' "$0"
}

cmd_run() {
  banner
  load_runtime_envs
  prepare_evm_identities

  step "1/4" "Checking demo services"
  wait_http http://127.0.0.1:8090/health "Delegation Adapter" 4
  wait_http http://127.0.0.1:8091/health "Controlled Test Runner" 4
  wait_http http://127.0.0.1:8080/health "Cloud Access Gateway" 4
  wait_http "http://127.0.0.1:${GITEA_HOST_PORT:-3000}/api/healthz" "Gitea" 4
  wait_http "http://127.0.0.1:${OPA_HOST_PORT:-8181}/health" "OPA" 4

  step "2/4" "Confirming a pristine Account Suspension scenario"
  assert_fresh_scenario
  ok "main is the only implementation branch"

  step "3/4" "Running delegated Backend -> Frontend -> Test workflow"
  export GATEWAY_SMOKE_URL=http://127.0.0.1:8080
  export GITEA_SMOKE_BASE_URL="$GITEA_HOST_BASE_URL"
  export ORCHESTRATOR_ROOT_CREDENTIAL_ID="urn:phase10b:orchestrator-root"
  export PHASE10B_RESULT_FILE="$RESULT_FILE"
  export EXPECTED_GITEA_REVISION="$EXPECTED_BASELINE"
  export TEST_RUNNER_GATEWAY_TOKEN="phase10b-gateway-runner-secret"
  export TEST_RUNNER_URL=http://127.0.0.1:8091

  node --experimental-strip-types "$ROOT_DIR/poc/scripts/phase10b-positive-e2e.mjs"

  step "4/4" "Demo result"
  [[ -f "$RESULT_FILE" ]] || fail "The E2E script did not write its result file."
  cat "$RESULT_FILE"
  printf '\nNow refresh Gitea and open Pull Requests -> #1.\n'
  printf 'Expected: feature/account-suspension -> main, with main still unchanged.\n'
}

cmd_status() {
  banner
  load_runtime_envs

  step "STATUS" "Service health"
  printf '  Gitea   '; curl -fsS "http://127.0.0.1:${GITEA_HOST_PORT:-3000}/api/healthz" || true; echo
  printf '  OPA     '; curl -fsS "http://127.0.0.1:${OPA_HOST_PORT:-8181}/health" || true; echo
  printf '  Adapter '; curl -fsS http://127.0.0.1:8090/health || true; echo
  printf '  Runner  '; curl -fsS http://127.0.0.1:8091/health || true; echo
  printf '  Gateway '; curl -fsS http://127.0.0.1:8080/health || true; echo
  printf '  Anvil   chainId=%s\n' "$(cast chain-id --rpc-url "http://127.0.0.1:${ANVIL_HOST_PORT:-8545}" 2>/dev/null || echo DOWN)"

  local auth="Authorization: token $GITEA_GATEWAY_TOKEN"
  local repo_url="$GITEA_HOST_BASE_URL/api/v1/repos/$GITEA_OWNER/$GITEA_REPOSITORY"
  local main_json main_sha feature_code feature_json feature_sha pr_code pr_json pr_state
  main_json="$(curl -fsS -H "$auth" "$repo_url/branches/main")"
  main_sha="$(printf '%s' "$main_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).commit?.id??""))')"
  printf '\n  main SHA: %s\n' "$main_sha"

  feature_code="$(curl -sS -o "$RUNTIME_DIR/feature.json" -w '%{http_code}' -H "$auth" "$repo_url/branches/feature%2Faccount-suspension")"
  if [[ "$feature_code" == "200" ]]; then
    feature_json="$(cat "$RUNTIME_DIR/feature.json")"
    feature_sha="$(printf '%s' "$feature_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).commit?.id??""))')"
    printf '  feature/account-suspension SHA: %s\n' "$feature_sha"
  else
    printf '  feature/account-suspension: not created yet\n'
  fi

  pr_code="$(curl -sS -o "$RUNTIME_DIR/pr.json" -w '%{http_code}' -H "$auth" "$repo_url/pulls/1")"
  if [[ "$pr_code" == "200" ]]; then
    pr_json="$(cat "$RUNTIME_DIR/pr.json")"
    pr_state="$(printf '%s' "$pr_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write(`${j.state??"?"} ${j.head?.ref??"?"} -> ${j.base?.ref??"?"}`)})')"
    printf '  Pull Request #1: %s\n' "$pr_state"
  else
    printf '  Pull Request #1: not created yet\n'
  fi

  if [[ -f "$RESULT_FILE" ]]; then
    printf '\nLast positive E2E result:\n'
    cat "$RESULT_FILE"
  fi
}

cmd_down() {
  banner
  step "DOWN" "Stopping demo services while preserving Gitea state"
  stop_application_processes
  stop_native_anvil
  docker ps -aq --filter 'name=delegation-runner-' | xargs -r docker rm -f >/dev/null 2>&1 || true
  if [[ -f "$ENV_FILE" ]]; then
    load_base_env
    compose down --remove-orphans >/dev/null 2>&1 || true
  fi
  ok "Demo services stopped"
  printf '  Gitea volume was preserved. Use "%s reset" for a pristine rerun.\n' "$0"
}

usage() {
  cat <<EOF_USAGE
Usage: $0 <command>

Commands:
  reset   Stop services and erase only the local Gitea demo state.
  up      Start Gitea, OPA, native Anvil, Adapter, Runner and Gateway.
  run     Execute the positive Account Suspension end-to-end workflow.
  status  Show service health, main/feature SHAs and PR #1 state.
  down    Stop services but preserve the current Gitea demo state.
  all     reset -> up -> run -> status (useful for rehearsal).

Recommended professor demo:
  $0 reset
  $0 up
  # show Gitea main baseline in the browser
  $0 run
  $0 status
  # show feature branch and Pull Request #1 in Gitea
EOF_USAGE
}

case "${1:-}" in
  reset) cmd_reset ;;
  up) cmd_up ;;
  run) cmd_run ;;
  status) cmd_status ;;
  down) cmd_down ;;
  all)
    cmd_reset
    cmd_up
    cmd_run
    cmd_status
    ;;
  *) usage; exit 1 ;;
esac
