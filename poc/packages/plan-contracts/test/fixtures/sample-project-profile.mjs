import {validateProjectProfile} from "../../src/project-profile.mjs";

const WAIT_PORT = "wait_port() { for _ in $(seq 1 60); do (echo > /dev/tcp/127.0.0.1/\"$1\") >/dev/null 2>&1 && return 0; sleep 0.5; done; echo \"Timed out waiting for port $1\" >&2; return 1; }; ";

/** Profile of a sample npm workspace with backend, frontend and browser tests. */
export const SAMPLE_PROJECT_PROFILE = validateProjectProfile({
  version: 1,
  image: "node:22.15.0-bookworm",
  phases: [
    {name: "dependency_install", command: "npm ci && npx playwright install --with-deps chromium"},
    {name: "typecheck", command: "npm run typecheck"},
    {name: "backend_tests", command: "npx vitest run tests/backend", failure_report: "vitest"},
    {name: "frontend_tests", command: "npx vitest run tests/frontend", failure_report: "vitest"},
    {name: "build", command: "npm run build"},
    {name: "playwright_e2e", command:
      "set -euo pipefail; " +
      "npm run start -w @sample/backend >/tmp/runner-backend.log 2>&1 & backend_pid=$!; " +
      "npm run dev -w @sample/frontend -- --host 127.0.0.1 >/tmp/runner-frontend.log 2>&1 & frontend_pid=$!; " +
      "cleanup() { kill \"$backend_pid\" \"$frontend_pid\" 2>/dev/null || true; }; " +
      "trap cleanup EXIT; " + WAIT_PORT +
      "wait_port 3000; wait_port 5173; npm run test:e2e -- --workers=1"}
  ],
  test_sources: {roots: ["tests/backend", "tests/frontend"], suffixes: [".test.ts", ".test.tsx"]}
});

