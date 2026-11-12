/**
 * Project profile: what "the project's tests pass" means for ONE repository.
 *
 * Chosen by the Engineer in the console (never by an agent or a model) and
 * bound by digest to the Engineer's signed approval. It fixes:
 *   - the Docker image the Runner uses for the throw-away test container;
 *   - the ordered test phases (name + shell command) run on the exact commit;
 *   - where the Test agent may write test sources (folders + file suffixes).
 * The commands come from the Engineer-controlled profile, NOT from files on
 * the work branch, so agents cannot weaken the tests to obtain a PASS.
 */
import {createHash} from "node:crypto";
import {createTrustedProjectTestSourceProfile} from "./gitea-permission-containment.mjs";

export const PROJECT_PROFILE_VERSION = 1;
export const MAX_PROJECT_PHASES = 8;
const IMAGE = /^[a-z0-9][a-z0-9._/-]{0,150}(?::[A-Za-z0-9][A-Za-z0-9._-]{0,63})?(?:@sha256:[a-f0-9]{64})?$/u;
const PHASE_NAME = /^[a-z][a-z0-9_]{1,31}$/u;
/** A Runner phase name: a project-profile phase or the historical
 * researcher suite. The only rule every component shares for phase names. */
export function isRunnerPhaseName(value) {
  return typeof value === "string" && PHASE_NAME.test(value) && value !== "project_tests";
}
/** Reserved: historical researcher suite and the Runner's own bookkeeping. */
const RESERVED_PHASES = new Set(["researcher_acceptance", "project_tests"]);
const FAILURE_REPORTS = new Set(["vitest"]);

const fail = reason => { throw Error("Invalid project profile: " + reason); };
const plain = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).every(k => keys.includes(k));

/** Strict validation; returns the canonical, deeply frozen profile. */
export function validateProjectProfile(raw) {
  if (!plain(raw, ["version", "image", "phases", "test_sources"])) fail("unknown or missing fields");
  if (raw.version !== PROJECT_PROFILE_VERSION) fail("unsupported version");
  if (typeof raw.image !== "string" || !IMAGE.test(raw.image) ||
      !(/:[A-Za-z0-9]/u.test(raw.image.split("/").at(-1)) || raw.image.includes("@sha256:")) ||
      /:latest$/u.test(raw.image))
    fail("the Docker image needs an explicit version tag (not latest) or a sha256 digest");
  if (!Array.isArray(raw.phases) || raw.phases.length < 1 || raw.phases.length > MAX_PROJECT_PHASES)
    fail(`between 1 and ${MAX_PROJECT_PHASES} test phases are required`);
  const names = new Set();
  const phases = raw.phases.map(p => {
    if (!plain(p, ["name", "command", "failure_report"]) || typeof p.name !== "string" ||
        !PHASE_NAME.test(p.name) || RESERVED_PHASES.has(p.name) || names.has(p.name))
      fail("each phase needs a unique lowercase name (letters, digits, _)");
    names.add(p.name);
    if (typeof p.command !== "string" || !p.command.trim() || p.command.length > 4000 ||
        /[\x00]/u.test(p.command))
      fail(`phase ${p.name} needs a shell command (at most 4000 characters)`);
    if (p.failure_report !== undefined && !FAILURE_REPORTS.has(p.failure_report))
      fail(`phase ${p.name}: failure_report may only be "vitest"`);
    return Object.freeze({name: p.name, command: p.command,
      ...(p.failure_report ? {failure_report: p.failure_report} : {})});
  });
  if (!plain(raw.test_sources, ["roots", "suffixes"])) fail("test_sources needs roots and suffixes");
  let sources;
  try { sources = createTrustedProjectTestSourceProfile({roots: raw.test_sources.roots,
    suffixes: raw.test_sources.suffixes}); }
  catch { fail("test folders must be relative project paths and suffixes like .test.ts or .spec.js"); }
  return Object.freeze({
    version: PROJECT_PROFILE_VERSION,
    image: raw.image,
    phases: Object.freeze(phases),
    test_sources: Object.freeze({roots: Object.freeze([...sources.roots]),
      suffixes: Object.freeze([...sources.suffixes])})
  });
}

/** Canonical JSON (fixed key order) of a validated profile. */
export function canonicalProjectProfileJson(profile) {
  const p = validateProjectProfile(profile);
  return JSON.stringify({version: p.version, image: p.image,
    phases: p.phases.map(x => ({name: x.name, command: x.command,
      ...(x.failure_report ? {failure_report: x.failure_report} : {})})),
    test_sources: {roots: [...p.test_sources.roots], suffixes: [...p.test_sources.suffixes]}});
}

/** SHA-256 of the canonical profile: what the Engineer signs and the Runner reports. */
export function projectProfileDigest(profile) {
  return createHash("sha256").update(canonicalProjectProfileJson(profile)).digest("hex");
}

/** Trusted test-source rule (folders + suffixes) of a validated profile. */
export function testSourceProfileOf(profile) {
  const p = validateProjectProfile(profile);
  return createTrustedProjectTestSourceProfile({roots: [...p.test_sources.roots],
    suffixes: [...p.test_sources.suffixes]});
}

const WAIT_PORT = "wait_port() { for _ in $(seq 1 60); do (echo > /dev/tcp/127.0.0.1/\"$1\") >/dev/null 2>&1 && return 0; sleep 0.5; done; echo \"Timed out waiting for port $1\" >&2; return 1; }; ";

/** Profile of the example repository (the same commands the Runner always used). */
export const IAM_CONSOLE_PROJECT_PROFILE = validateProjectProfile({
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
      "npm run start -w @iam/backend >/tmp/runner-backend.log 2>&1 & backend_pid=$!; " +
      "npm run dev -w @iam/frontend -- --host 127.0.0.1 >/tmp/runner-frontend.log 2>&1 & frontend_pid=$!; " +
      "cleanup() { kill \"$backend_pid\" \"$frontend_pid\" 2>/dev/null || true; }; " +
      "trap cleanup EXIT; " + WAIT_PORT +
      "wait_port 3000; wait_port 5173; npm run test:e2e -- --workers=1"}
  ],
  test_sources: {roots: ["tests/backend", "tests/frontend"], suffixes: [".test.ts", ".test.tsx"]}
});
