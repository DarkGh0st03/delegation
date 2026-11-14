/**
 * One-shot, idempotent Gitea preparation (replaces poc/scripts/bootstrap-gitea.sh
 * for the Compose deployment):
 *  - organization and example repository imported at the pinned baseline SHA;
 *  - default branch protected (no direct push, approvals required);
 *  - Gateway account = write collaborator, Runner account = read collaborator;
 *  - read-only team "staging-deploy" (all repositories) for the staging deployer;
 *  - repository-scoped API tokens for Gateway, Runner and deployer in /config/gitea.env.
 */
import {existsSync, readFileSync, writeFileSync, chmodSync} from "node:fs";
import {join} from "node:path";
import {parseEnvFile} from "../../poc/engineer-console/src/env.mjs";

const CONFIG = process.env.CONFIG_DIR ?? "/config";
const BASE = process.env.GITEA_URL ?? "http://gitea:3000";
const cfg = parseEnvFile(readFileSync(join(CONFIG, "local.env"), "utf8"));
const basic = (u, p) => "Basic " + Buffer.from(u + ":" + p).toString("base64");
const ADMIN = basic(cfg.GITEA_ADMIN_USER, cfg.GITEA_ADMIN_PASSWORD);
const ORG = cfg.GITEA_ORG, REPO = cfg.GITEA_REPOSITORY;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function call(method, path, {auth = ADMIN, body, ok = [200]} = {}) {
  const response = await fetch(BASE + "/api/v1" + path, {
    method, redirect: "error",
    headers: {authorization: auth, accept: "application/json",
      ...(body ? {"content-type": "application/json"} : {})},
    ...(body ? {body: JSON.stringify(body)} : {}),
    signal: AbortSignal.timeout(180_000)
  });
  if (!ok.includes(response.status))
    throw Error(`${method} ${path} -> HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const text = await response.text();
  return {status: response.status, json: text ? JSON.parse(text) : undefined};
}

for (let i = 0; ; i++) {
  try { if ((await fetch(BASE + "/api/healthz")).ok) break; } catch {}
  if (i > 90) throw Error("Gitea did not become ready");
  await sleep(1000);
}

if ((await call("GET", `/orgs/${ORG}`, {ok: [200, 404]})).status === 404) {
  console.log("Creating organization", ORG);
  await call("POST", "/orgs", {ok: [201], body: {username: ORG, full_name: "Thesis PoC",
    description: "Repositories protected by the delegated-authorization PoC", visibility: "private"}});
}

const repoPath = `/repos/${ORG}/${REPO}`;
let imported = false;
if ((await call("GET", repoPath, {ok: [200, 404]})).status === 404) {
  console.log("Importing", cfg.GITEA_SOURCE_REPO);
  imported = true;
  await call("POST", "/repos/migrate", {ok: [201], body: {
    clone_addr: cfg.GITEA_SOURCE_REPO, repo_owner: ORG, repo_name: REPO, service: "git",
    mirror: false, private: true, issues: false, labels: false, milestones: false,
    pull_requests: false, releases: false, wiki: false, lfs: false}});
}

let mainSha;
for (let i = 0; i < 90 && !mainSha; i++) {
  const branch = await call("GET", `${repoPath}/branches/main`, {ok: [200, 404]});
  mainSha = branch.json?.commit?.id;
  if (!mainSha) await sleep(2000);
}
// A fresh import must be exactly the pinned baseline. Later, main moves on
// only through pull requests the Engineer merged: the baseline must still
// be in its history (it is not replaced or force-pushed).
if (imported || mainSha === cfg.GITEA_BASELINE_SHA) {
  if (mainSha !== cfg.GITEA_BASELINE_SHA)
    throw Error(`Imported main is ${mainSha}, expected pinned baseline ${cfg.GITEA_BASELINE_SHA}`);
  console.log("Baseline verified:", mainSha);
} else {
  let found = false;
  for (let page = 1; page <= 100 && !found; page++) {
    const history = (await call("GET", `${repoPath}/commits?sha=main&limit=50&page=${page}` +
      "&stat=false&verification=false&files=false")).json ?? [];
    found = history.some(c => c.sha === cfg.GITEA_BASELINE_SHA);
    if (history.length < 50) break;
  }
  if (!found)
    throw Error(`main (${mainSha}) does not descend from the pinned baseline ${cfg.GITEA_BASELINE_SHA}`);
  console.log(`main is ${mainSha}: merged work on top of the pinned baseline (kept).`);
}

if ((await call("GET", `${repoPath}/branch_protections/main`, {ok: [200, 404]})).status === 404) {
  console.log("Protecting main");
  await call("POST", `${repoPath}/branch_protections`, {ok: [201], body: {
    branch_name: "main", enable_push: false, enable_force_push: false, required_approvals: 1,
    block_admin_merge_override: true, dismiss_stale_approvals: true, block_on_outdated_branch: true}});
}
await call("PUT", `${repoPath}/collaborators/${cfg.GITEA_GATEWAY_USER}`, {ok: [204], body: {permission: "write"}});
await call("PUT", `${repoPath}/collaborators/${cfg.GITEA_RUNNER_USER}`, {ok: [204], body: {permission: "read"}});

// Staging deployer: read-only on EVERY repository of the organisation
// (current and imported later) through a team, so imports need no extra step.
const teams = (await call("GET", `/orgs/${ORG}/teams?limit=50`)).json ?? [];
let deployTeam = teams.find(t => t.name === "staging-deploy");
if (!deployTeam) {
  console.log("Creating read-only team staging-deploy");
  deployTeam = (await call("POST", `/orgs/${ORG}/teams`, {ok: [201], body: {
    name: "staging-deploy", description: "Read-only: the staging deployer reads merged main",
    permission: "read", includes_all_repositories: true, can_create_org_repo: false,
    units_map: {"repo.code": "read"}}})).json;
}
await call("PUT", `/teams/${deployTeam.id}/members/${cfg.GITEA_DEPLOYER_USER}`, {ok: [204]});

const tokensPath = join(CONFIG, "gitea.env");
const previous = existsSync(tokensPath) ? parseEnvFile(readFileSync(tokensPath, "utf8")) : {};
async function token(user, password, scope, existing) {
  if (existing) {
    const probe = await fetch(BASE + "/api/v1/user", {headers: {authorization: "token " + existing}});
    if (probe.ok) return existing;
  }
  const created = await call("POST", `/users/${user}/tokens`, {ok: [201],
    auth: basic(user, password),
    body: {name: `${user}-local-${Date.now()}`, scopes: [scope, "read:user"]}});
  return created.json.sha1;
}
const gatewayToken = await token(cfg.GITEA_GATEWAY_USER, cfg.GITEA_GATEWAY_PASSWORD,
  "write:repository", previous.GITEA_GATEWAY_TOKEN);
const runnerToken = await token(cfg.GITEA_RUNNER_USER, cfg.GITEA_RUNNER_PASSWORD,
  "read:repository", previous.GITEA_RUNNER_TOKEN);
const deployerToken = await token(cfg.GITEA_DEPLOYER_USER, cfg.GITEA_DEPLOYER_PASSWORD,
  "read:repository", previous.GITEA_DEPLOYER_TOKEN);

writeFileSync(tokensPath, [
  "# Generated by deploy/bootstrap/gitea-bootstrap.mjs. Private.",
  `GITEA_BASE_URL=${BASE}`, `GITEA_OWNER=${ORG}`, `GITEA_REPOSITORY=${REPO}`,
  `GITEA_GATEWAY_USER=${cfg.GITEA_GATEWAY_USER}`, `GITEA_GATEWAY_TOKEN=${gatewayToken}`,
  `GITEA_RUNNER_USER=${cfg.GITEA_RUNNER_USER}`, `GITEA_RUNNER_TOKEN=${runnerToken}`,
  `GITEA_DEPLOYER_USER=${cfg.GITEA_DEPLOYER_USER}`, `GITEA_DEPLOYER_TOKEN=${deployerToken}`, ""
].join("\n"), {mode: 0o600});
chmodSync(tokensPath, 0o600);
console.log("Gitea bootstrap completed.");
