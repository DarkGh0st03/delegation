#!/usr/bin/env bash
# No LLM / API calls. Re-run the unmodified 11 files from run 38144628266.
set -euo pipefail
EVIDENCE="$(realpath "$1")"
TARGET="$(realpath "$2")"
LOGS="$(realpath "$3")"
ACCEPTANCE="$(realpath "$4")"
mkdir -p "$LOGS"

python3 - "$EVIDENCE" "$TARGET" "$LOGS" <<'PY'
import json,hashlib,pathlib,subprocess,sys
e,t,l=map(pathlib.Path,sys.argv[1:])
m=json.loads((e/"manifest.json").read_text())
baseline="405748b1e77992b6bd8630a3ab6f990658d32f6b"
feature="e99536f5ef170981a8d6bbddef42cde9ba5e37c0"
paths={
"packages/shared/src/account-status.ts",
"apps/backend/src/users/user.service.ts",
"apps/backend/src/users/user.controller.ts",
"apps/backend/src/users/user.routes.ts",
"apps/frontend/src/api/users-api.ts",
"apps/frontend/src/pages/UserDetailPage.tsx",
"apps/frontend/src/styles.css",
"tests/backend/user.service.test.ts",
"tests/backend/user.routes.test.ts",
"tests/frontend/UserDetailPage.test.tsx",
"tests/e2e/account-suspension.spec.ts"}
assert m["github_run_id"]=="38144628266" and m["capture_status"]=="complete"
assert m["mode"]=="all" and m["baseline_sha"]==m["main_sha"]==baseline
assert m["feature_sha"]==feature and set(m["changed_paths"])==paths
assert set(f["path"] for f in m["files"])==paths
assert m["created_paths"]==["tests/e2e/account-suspension.spec.ts"]
assert len(m["role_changes"]["backend"])==4
assert len(m["role_changes"]["frontend"])==3
assert len(m["role_changes"]["test"])==4
assert subprocess.check_output(["git","-C",str(t),"rev-parse","HEAD"],text=True).strip()==baseline
def blob(data):return hashlib.sha1(("blob %d\0"%len(data)).encode()+data).hexdigest()
for f in m["files"]:
    p=f["path"]; dst=t/p; new=(e/"generated"/p).read_bytes()
    assert blob(new)==f["generated_blob_sha"],p
    if f["created"]:
        assert not dst.exists() and f["baseline_blob_sha"] is None,p
    else:
        old=dst.read_bytes()
        assert blob(old)==f["baseline_blob_sha"],p
        assert old==(e/"baseline"/p).read_bytes(),p
    dst.parent.mkdir(parents=True,exist_ok=True)
    dst.write_bytes(new)
(l/"provenance.json").write_text(json.dumps({
"source_run":38144628266,"baseline_sha":baseline,"feature_sha":feature,
"verified_generated_files":11,"mode":"offline_no_LLM",
"docker_image":"node:22.15.0-bookworm"},indent=2)+"\n")
print("Original Git baseline and 11 generated blob SHA hashes verified.")
PY

NAME="thesis-replay-$RANDOM-$RANDOM"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
docker create --name "$NAME" --workdir /workspace \
  --tmpfs /tmp:rw,nosuid,nodev --pids-limit 512 --memory 3g --cpus 2 \
  -e CI=1 \
  --mount "type=bind,src=$ACCEPTANCE,dst=/workspace/.researcher-acceptance,readonly" \
  node:22.15.0-bookworm sleep infinity >/dev/null
docker cp "$TARGET/." "$NAME:/workspace"
docker start "$NAME" >/dev/null

: > "$LOGS/phases.tsv"
failed=0
for phase in dependency_install typecheck backend_tests frontend_tests build playwright_e2e researcher_acceptance; do
  if [ "$failed" -ne 0 ]; then
    printf '%s\tskipped\n' "$phase" >> "$LOGS/phases.tsv"
    continue
  fi
  case "$phase" in
    dependency_install) cmd="npm ci && npx playwright install --with-deps chromium";;
    typecheck) cmd="npm run typecheck";;
    backend_tests) cmd="npx vitest run tests/backend";;
    frontend_tests) cmd="npx vitest run tests/frontend";;
    build) cmd="npm run build";;
    playwright_e2e)
      cmd='set -euo pipefail; npm run start -w @iam/backend >/tmp/runner-backend.log 2>&1 & backend_pid=$!; npm run dev -w @iam/frontend -- --host 127.0.0.1 >/tmp/runner-frontend.log 2>&1 & frontend_pid=$!; cleanup() { kill "$backend_pid" "$frontend_pid" 2>/dev/null || true; }; trap cleanup EXIT; wait_port() { for _ in $(seq 1 60); do (echo > /dev/tcp/127.0.0.1/"$1") >/dev/null 2>&1 && return 0; sleep 0.5; done; echo "Timed out waiting for port $1" >&2; return 1; }; wait_port 3000; wait_port 5173; npm run test:e2e';;
    researcher_acceptance)
      cmd='set -euo pipefail; npm run start -w @iam/backend >/tmp/runner-acceptance-backend.log 2>&1 & backend_pid=$!; npm run dev -w @iam/frontend -- --host 127.0.0.1 >/tmp/runner-acceptance-frontend.log 2>&1 & frontend_pid=$!; cleanup() { kill "$backend_pid" "$frontend_pid" 2>/dev/null || true; }; trap cleanup EXIT; wait_port() { for _ in $(seq 1 60); do (echo > /dev/tcp/127.0.0.1/"$1") >/dev/null 2>&1 && return 0; sleep 0.5; done; echo "Timed out waiting for port $1" >&2; return 1; }; wait_port 3000; wait_port 5173; npx playwright test --config .researcher-acceptance/playwright.config.ts';;
  esac
  echo "::group::Replay $phase"
  if timeout 600 docker exec "$NAME" bash -lc "$cmd" >"$LOGS/$phase.stdout.log" 2>"$LOGS/$phase.stderr.log"; then
    printf '%s\tpass\n' "$phase" >> "$LOGS/phases.tsv"
    echo "PASS $phase"
  else
    ec="$?"
    printf '%s\tfail\t%s\n' "$phase" "$ec" >> "$LOGS/phases.tsv"
    echo "FAIL $phase; exit=$ec"
    tail -n 65 "$LOGS/$phase.stdout.log" || true
    tail -n 65 "$LOGS/$phase.stderr.log" || true
    failed=1
  fi
  echo "::endgroup::"
done
python3 - "$LOGS" <<'PY'
import json,pathlib,sys
p=pathlib.Path(sys.argv[1])
items=[]
for line in (p/"phases.tsv").read_text().splitlines():
    f=line.split("\t")
    items.append({"phase":f[0],"status":f[1],"exit_code":int(f[2]) if len(f)>2 else None})
(p/"replay-verdict.json").write_text(json.dumps({
    "result":"fail" if any(i["status"]=="fail" for i in items) else "pass",
    "phases":items},indent=2)+"\n")
print((p/"replay-verdict.json").read_text())
PY
# Preserve evidence before a separate workflow step enforces the result.
exit 0
