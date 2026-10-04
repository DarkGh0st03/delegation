import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(here, "..", "..");

const required = [
  "poc/package.json",
  "poc/apps",
  "poc/packages",
  "poc/opa",
  "poc/runner/acceptance",
  "poc/infra/gitea",
  "poc/infra/env",
  "poc/infra/docker-compose.yml",
  "poc/scripts/init-local-env.mjs",
  "poc/scripts/bootstrap-gitea.sh",
  "poc/scripts/bootstrap-trust.sh",
  "poc/scripts/phase1-up.sh",
  "poc/scripts/phase1-check.sh",
  "poc/scripts/phase1-down.sh",
  "services/delegation-adapter",
  "docs/IMPLEMENTATION_STATE.md",
  "docs/ARCHITECTURE_DECISIONS.md"
];

const missing = required.filter((path) => !existsSync(resolve(root, path)));

if (missing.length > 0) {
  console.error("Scaffold check failed. Missing:");
  for (const path of missing) console.error(`- ${path}`);
  process.exit(1);
}

console.log("PoC scaffold check passed.");
