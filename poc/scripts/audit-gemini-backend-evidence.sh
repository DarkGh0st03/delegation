#!/usr/bin/env bash
# Independent post-run evaluation. The Backend Agent never invokes this script.
set -Eeuo pipefail
OUT="$GEMINI_EVIDENCE_DIR"
mkdir -p "$OUT"
RESULT="$OUT/audit-result.json"
INSTALL="not_run"
TYPECHECK="not_run"
TESTS="not_run"
SETUP="not_run"
write_report() {
  node - "$RESULT" "$SETUP" "$INSTALL" "$TYPECHECK" "$TESTS" <<'NODE'
const fs=require("node:fs");
const [file,setup,install,typecheck,tests]=process.argv.slice(2);
const passed=setup==="pass"&&install==="pass"&&typecheck==="pass"&&tests==="pass";
fs.writeFileSync(file,JSON.stringify({
  independent_backend_audit:passed?"pass":"fail_or_skipped",
  source:"pinned_baseline_plus_four_agent_written_files",
  test_origin:"researcher_owned_not_agent_writable",
  setup,install,typecheck,backend_functional_tests:tests,
  scope:"backend_only_no_frontend_or_e2e"
},null,2)+"\n",{mode:0o600});
if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
  "\n### Gemini Backend independent code review\n"+
  "Setup: "+setup+"; dependencies: "+install+
  "; TypeScript typecheck: "+typecheck+
  "; backend functional tests: "+tests+"\n"+
  "Review source and detailed logs in the run's evidence artifact.\n");
NODE
}
trap write_report EXIT
if [[ ! -f "$OUT/manifest.json" ]]; then
  echo "No Gitea snapshot manifest; cannot evaluate generated code."
  exit 1
fi
read -r STATUS SNAPSHOT_SHA < <(node - "$OUT/manifest.json" <<'NODE'
const fs=require("node:fs");
const m=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
console.log(m.capture_status+" "+(m.feature_sha||"none"));
NODE
)
if [[ "$STATUS" != "complete" || ! "$EXPECTED_GITEA_REVISION" =~ ^[a-f0-9]{40}$ ]]; then
  echo "Complete four-file snapshot or expected baseline revision missing."
  exit 1
fi

# Fetch pinned public baseline without credentials or model-generated source.
TMP="$(mktemp -d)"
trap 'write_report; rm -rf "$TMP"' EXIT
APP="$TMP/iam-console-poc"
mkdir -p "$APP"
git -C "$APP" init -q
if ! GIT_TERMINAL_PROMPT=0 git -C "$APP" fetch --quiet --depth 1 \
  https://github.com/DarkGh0st03/iam-console-poc.git "$EXPECTED_GITEA_REVISION" \
  >"$OUT/baseline-fetch.log" 2>&1; then
  echo "Unable to fetch pinned source baseline."
  exit 1
fi
git -C "$APP" -c advice.detachedHead=false checkout --detach -q FETCH_HEAD
if [[ "$(git -C "$APP" rev-parse HEAD)" != "$EXPECTED_GITEA_REVISION" ]]; then
  echo "Unexpected source baseline SHA."
  exit 1
fi
SETUP="pass"
# No application source has been changed yet, and lifecycle scripts are disabled.
if (cd "$APP" && timeout 240 npm ci --ignore-scripts --no-audit --no-fund) \
  >"$OUT/install.log" 2>&1; then
  INSTALL="pass"
else
  INSTALL="fail"
  echo "Dependency installation failed; see install.log."
  exit 1
fi

for path in \
  packages/shared/src/account-status.ts \
  apps/backend/src/users/user.service.ts \
  apps/backend/src/users/user.controller.ts \
  apps/backend/src/users/user.routes.ts
do
  if [[ ! -f "$OUT/generated/$path" || -L "$OUT/generated/$path" ]]; then
    echo "An expected generated file is unavailable."
    exit 1
  fi
  cp -- "$OUT/generated/$path" "$APP/$path"
done
# Inject independent researcher-owned tests into this disposable copy only.
cp -- poc/scripts/review-tests/backend-generated-audit.test.ts \
  "$APP/tests/backend/generated.audit.test.ts"

IMAGE="$TEST_RUNNER_DOCKER_IMAGE"
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  docker pull "$IMAGE" >"$OUT/docker-image.log" 2>&1
fi
docker_audit() {
  timeout 180 docker run --rm --network none --cap-drop ALL \
    --security-opt no-new-privileges \
    --pids-limit 128 --memory 1500m --cpus 2 \
    --user "$(id -u):$(id -g)" \
    --env HOME=/tmp \
    --mount "type=bind,source=$APP,target=/workspace" \
    --workdir /workspace "$IMAGE" "$@"
}
if docker_audit sh -c "npm run typecheck -w @iam/shared && npm run typecheck -w @iam/backend" >"$OUT/typecheck.log" 2>&1; then
  TYPECHECK="pass"
else
  TYPECHECK="fail"
fi
if docker_audit ./node_modules/.bin/vitest run \
  tests/backend/generated.audit.test.ts >"$OUT/backend-tests.log" 2>&1; then
  TESTS="pass"
else
  TESTS="fail"
fi
echo "Independent Backend audit: typecheck=$TYPECHECK, functional_tests=$TESTS, feature_sha=$SNAPSHOT_SHA"
[[ "$TYPECHECK" == "pass" && "$TESTS" == "pass" ]]