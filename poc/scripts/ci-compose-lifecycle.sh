#!/usr/bin/env bash
# GitHub-hosted coordinator E2E: never tear down infrastructure we did not start.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${RUNNER_TEMP:?Requires isolated GitHub-hosted runner}"
: "${GITHUB_RUN_ID:?Missing GitHub Actions run ID}"
: "${GITHUB_RUN_ATTEMPT:?Missing GitHub Actions run attempt}"
MARKER="$RUNNER_TEMP/delegation-compose-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.owned"
COMPOSE=(docker compose --env-file "$ROOT_DIR/poc/infra/.env" -f "$ROOT_DIR/poc/infra/docker-compose.yml")

case "${1:-}" in
  start)
    if [[ -e "$MARKER" ]]; then
      echo "Compose resources already claimed by this job" >&2
      exit 1
    fi
    docker info >/dev/null 2>&1 || {
      echo "Docker daemon unavailable; refusing startup" >&2
      exit 1
    }
    "${COMPOSE[@]}" config --quiet
    # Refuse to adopt any unrelated local infrastructure.
    for container in delegation-poc-gitea delegation-poc-opa delegation-poc-anvil; do
      if docker container inspect "$container" >/dev/null 2>&1; then
        echo "Pre-existing container $container; refusing bootstrap" >&2
        exit 1
      fi
    done
    if docker volume inspect delegation-poc-gitea-data >/dev/null 2>&1; then
      echo "Pre-existing Gitea volume; refusing bootstrap" >&2
      exit 1
    fi
    for network in delegation-poc-infra delegation-poc-agent; do
      if docker network inspect "$network" >/dev/null 2>&1; then
        echo "Pre-existing network $network; refusing bootstrap" >&2
        exit 1
      fi
    done
    # Claim cleanup before invoking Compose: partial startup is also cleaned.
    mkdir -- "$MARKER"
    "${COMPOSE[@]}" up -d gitea opa anvil
    ;;
  cleanup)
    if [[ ! -d "$MARKER" ]]; then
      echo "No Compose resources claimed; skipping cleanup"
      exit 0
    fi
    "${COMPOSE[@]}" down --volumes
    rmdir -- "$MARKER"
    ;;
  *)
    echo "Usage: $0 start|cleanup" >&2
    exit 2
    ;;
esac
