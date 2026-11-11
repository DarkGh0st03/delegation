import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdtempSync, rmSync, statSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ConsoleAuth, hashPassword, readUserFile, writeUserFile} from "../src/auth.mjs";
import {createConsoleHandler} from "../src/app.mjs";
import {parseEnvFile} from "../src/env.mjs";
import {validateCloneUrl, validateRepoName} from "../src/gitea.mjs";
import {checkEnvironment} from "../src/health.mjs";
import {defaultPolicy, validatePolicy} from "../src/policy.mjs";
import {ConsoleStore} from "../src/store.mjs";

const REPO = {owner: "thesis", name: "iam-console-poc", default_branch: "main",
  head_sha: "a".repeat(40), protected_branches: ["main"]};

class FakeGitea {
  org = "thesis";
  imported = [];
  async listRepositories() { return [{owner: "thesis", name: REPO.name, default_branch: "main"}]; }
  async repositoryDetail(name) {
    if (name !== REPO.name) { const e = Error("missing"); e.status = 404; throw e; }
    return structuredClone(REPO);
  }
  async importRepository(input) {
    validateCloneUrl(input.cloneUrl); validateRepoName(input.name);
    this.imported.push(input); return structuredClone(REPO);
  }
}

async function startConsole(t) {
  const dir = mkdtempSync(join(tmpdir(), "console-test-"));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const users = {engineer: hashPassword("correct-horse")};
  const gitea = new FakeGitea();
  let handler;
  const server = createServer((req, res) => handler(req, res));
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const port = server.address().port;
  handler = createConsoleHandler({auth: new ConsoleAuth({users}), gitea,
    store: new ConsoleStore(join(dir, "console")),
    health: async () => ({ready: true, checks: []}), port});
  const base = `http://127.0.0.1:${port}`;
  const call = (method, path, {body, cookie, headers = {}} = {}) => fetch(base + path, {
    method, redirect: "manual",
    headers: {...(body ? {"content-type": "application/json"} : {}),
      ...(method === "GET" ? {} : {"x-console-request": "1"}),
      ...(cookie ? {cookie} : {}), ...headers},
    ...(body ? {body: JSON.stringify(body)} : {})
  });
  const login = async () => {
    const r = await call("POST", "/api/login", {body: {username: "engineer", password: "correct-horse"}});
    assert.equal(r.status, 200);
    return r.headers.get("set-cookie").split(";")[0];
  };
  return {call, login, gitea, dir, port};
}

test("API refuses access without a session and accepts the right password", async (t) => {
  const {call, login} = await startConsole(t);
  assert.equal((await call("GET", "/api/health")).status, 401);
  assert.equal((await call("GET", "/api/repos")).status, 401);
  const bad = await call("POST", "/api/login", {body: {username: "engineer", password: "wrong-pass"}});
  assert.equal(bad.status, 401);
  assert.equal(bad.headers.get("set-cookie"), null);
  const cookie = await login();
  assert.match(cookie, /^engineer_console_session=/u);
  assert.equal((await call("GET", "/api/health", {cookie})).status, 200);
  const me = await (await call("GET", "/api/me", {cookie})).json();
  assert.equal(me.username, "engineer");
});

test("session cookie is HttpOnly and SameSite=Strict; logout invalidates it", async (t) => {
  const {call} = await startConsole(t);
  const r = await call("POST", "/api/login", {body: {username: "engineer", password: "correct-horse"}});
  const header = r.headers.get("set-cookie");
  assert.match(header, /HttpOnly/u);
  assert.match(header, /SameSite=Strict/u);
  const cookie = header.split(";")[0];
  assert.equal((await call("POST", "/api/logout", {cookie})).status, 200);
  assert.equal((await call("GET", "/api/repos", {cookie})).status, 401);
});

test("state-changing requests need the console header and same origin", async (t) => {
  const {call, login, port} = await startConsole(t);
  const cookie = await login();
  const noHeader = await fetch(`http://127.0.0.1:${port}/api/requests`, {method: "POST",
    headers: {cookie, "content-type": "application/json"},
    body: JSON.stringify({repository: REPO.name, requirement: "Add a suspension feature"})});
  assert.equal(noHeader.status, 403);
  const foreign = await call("POST", "/api/requests", {cookie,
    headers: {origin: "https://evil.example"},
    body: {repository: REPO.name, requirement: "Add a suspension feature"}});
  assert.equal(foreign.status, 403);
});

test("login is locked after five failed attempts", async (t) => {
  const {call} = await startConsole(t);
  for (let i = 0; i < 5; i++)
    await call("POST", "/api/login", {body: {username: "engineer", password: "nope-nope"}});
  const locked = await call("POST", "/api/login", {body: {username: "engineer", password: "correct-horse"}});
  assert.equal(locked.status, 401);
  assert.match((await locked.json()).error, /Too many attempts/u);
});

test("static files are served from a fixed allow-list only", async (t) => {
  const {call} = await startConsole(t);
  const index = await call("GET", "/");
  assert.equal(index.status, 200);
  assert.match(index.headers.get("content-security-policy"), /default-src 'self'/u);
  for (const path of ["/../src/auth.mjs", "/public/app.js", "/%2e%2e/package.json", "/server.mjs"])
    assert.equal((await call("GET", path)).status, 404, path);
});

test("default policy protects the main branch and forbids agent merges", () => {
  const p = defaultPolicy(REPO);
  assert.deepEqual(p.protected_branches, ["main"]);
  assert.equal(p.work_branch_prefix, "feature/");
  assert.equal(p.agents_may_merge, false);
  assert.deepEqual(validatePolicy(p, REPO), p);
});

test("policy validation refuses weakening or malformed parameters", () => {
  const base = defaultPolicy(REPO);
  const cases = [
    {...base, agents_may_merge: true},
    {...base, protected_branches: ["develop"]},
    {...base, work_branch_prefix: "main"},
    {...base, work_branch_prefix: "ma/", protected_branches: ["main", "ma/x"]},
    // Well-formed, but Planning still derives work branches as "feature/<id>".
    {...base, work_branch_prefix: "agent/"},
    {...base, forbidden_path_prefixes: ["../etc/"]},
    {...base, forbidden_path_prefixes: ["/abs/"]},
    {...base, base_branch: "develop"},
    {...base, repository: {owner: "other", name: REPO.name}},
    {...base, extra: true}
  ];
  for (const c of cases) assert.throws(() => validatePolicy(c, REPO), undefined, JSON.stringify(c));
});

test("policy and requirement are stored for the selected repository", async (t) => {
  const {call, login} = await startConsole(t);
  const cookie = await login();
  const policy = {...defaultPolicy(REPO), forbidden_path_prefixes: [".github/", "security/", "infra/"]};
  const saved = await call("PUT", `/api/repos/${REPO.name}/policy`, {cookie, body: policy});
  assert.equal(saved.status, 200);
  const detail = await (await call("GET", `/api/repos/${REPO.name}`, {cookie})).json();
  assert.equal(detail.policy_source, "saved");
  assert.deepEqual(detail.policy.forbidden_path_prefixes, [".github/", "security/", "infra/"]);
  const weak = await call("PUT", `/api/repos/${REPO.name}/policy`, {cookie,
    body: {...policy, agents_may_merge: true}});
  assert.equal(weak.status, 400);

  const created = await call("POST", "/api/requests", {cookie,
    body: {repository: REPO.name, requirement: "  Allow an admin to suspend users.  "}});
  assert.equal(created.status, 201);
  const {request} = await created.json();
  assert.equal(request.base_sha, REPO.head_sha);
  assert.equal(request.requirement, "Allow an admin to suspend users.");
  assert.equal(request.created_by, "engineer");
  const list = await (await call("GET", "/api/requests", {cookie})).json();
  assert.equal(list.requests.length, 1);
  const tooShort = await call("POST", "/api/requests", {cookie,
    body: {repository: REPO.name, requirement: "short"}});
  assert.equal(tooShort.status, 400);
  const unknown = await call("POST", "/api/requests", {cookie,
    body: {repository: "missing-repo", requirement: "A valid requirement text"}});
  assert.equal(unknown.status, 404);
});

test("repository import accepts only plain https URLs and valid names", async (t) => {
  const {call, login, gitea} = await startConsole(t);
  const cookie = await login();
  for (const clone_url of ["http://github.com/a/b.git", "https://user:pw@github.com/a/b.git",
    "file:///etc/passwd", "https://github.com/a/b.git?x=1",
    "https://github.com/a/b/tree/feature/x", "https://github.com/a/b/blob/main/README.md",
    "https://github.com/onlyowner"]) {
    const r = await call("POST", "/api/repos/import", {cookie, body: {clone_url, name: "b"}});
    assert.equal(r.status, 400, clone_url);
  }
  const badName = await call("POST", "/api/repos/import", {cookie,
    body: {clone_url: "https://github.com/a/b.git", name: "../b"}});
  assert.equal(badName.status, 400);
  const ok = await call("POST", "/api/repos/import", {cookie,
    body: {clone_url: "https://github.com/a/b.git", name: "b"}});
  assert.equal(ok.status, 201);
  assert.equal(gitea.imported.length, 1);
});

test("user file is written owner-only and stores no plaintext password", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "console-users-"));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const path = join(dir, "users.json");
  writeUserFile(path, {engineer: hashPassword("correct-horse")});
  assert.equal(statSync(path).mode & 0o777, 0o600);
  const users = readUserFile(path);
  assert.ok(!JSON.stringify(users).includes("correct-horse"));
  assert.ok(new ConsoleAuth({users}).login("engineer", "correct-horse"));
});

test("env parser reads quoted values and ignores comments", () => {
  const env = parseEnvFile("# c\nA_B=1\nMNEMONIC=\"test test junk\"\nbad line\nlower=x\n");
  assert.equal(env.A_B, "1");
  assert.equal(env.MNEMONIC, "test test junk");
  assert.equal(env.lower, undefined);
});

test("environment check reports every missing component with a hint", async () => {
  const config = {infraEnvPresent: false, giteaUrl: "http://x", opaUrl: "http://y",
    anvilUrl: "http://z", chainId: 31337, didRegistryAddress: "", trustRegistryAddress: "",
    issuerRegistryAddress: "", nativeGatewayAddon: "/none", nativeEngineerAddon: "/none"};
  const result = await checkEnvironment(config, {
    fetchFn: async () => { throw Error("connection refused"); }, fileExists: () => false,
    loadAddon: async () => ({ok: true})});
  assert.equal(result.ready, false);
  assert.equal(result.checks.length, 7);
  assert.ok(result.checks.every(c => !c.ok && c.hint.length > 0));
});

test("Compose mode reads private files from CONFIG_DIR and service URLs from env", async (t) => {
  const {writeFileSync} = await import("node:fs");
  const {loadLocalConfig} = await import("../src/env.mjs");
  const dir = mkdtempSync(join(tmpdir(), "console-config-"));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  writeFileSync(join(dir, "local.env"), "GITEA_ADMIN_USER=thesis-admin\nGITEA_ADMIN_PASSWORD=pw\nGITEA_ORG=thesis\n");
  writeFileSync(join(dir, "trust.env"), "DID_REGISTRY_ADDRESS=0x" + "1".repeat(40) + "\n");
  const config = loadLocalConfig({CONFIG_DIR: dir, GITEA_URL: "http://gitea:3000",
    OPA_URL: "http://opa:8181", ANVIL_URL: "http://anvil:8545", ENGINEER_CONSOLE_HOST: "0.0.0.0"});
  assert.equal(config.composeMode, true);
  assert.equal(config.infraEnvPresent, true);
  assert.equal(config.giteaUrl, "http://gitea:3000");
  assert.equal(config.giteaAdminPassword, "pw");
  assert.equal(config.didRegistryAddress, "0x" + "1".repeat(40));
  assert.equal(config.usersPath, join(dir, "console-users.json"));
  assert.equal(config.stateDir, "/state");
  assert.equal(config.consoleHost, "0.0.0.0");
  const dev = loadLocalConfig({});
  assert.equal(dev.composeMode, false);
  assert.equal(dev.consoleHost, "127.0.0.1");
});

test("a native addon that exists but cannot be loaded is reported as not ready", async (t) => {
  const {writeFileSync} = await import("node:fs");
  const {loadAddonInChild} = await import("../src/health.mjs");
  const dir = mkdtempSync(join(tmpdir(), "console-addon-"));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const fake = join(dir, "broken.node");
  writeFileSync(fake, "not a shared library");
  const result = await loadAddonInChild(fake);
  assert.equal(result.ok, false);
  assert.ok(result.detail.length > 0);
});

test("importing a repository name that already exists returns a clear 409", async (t) => {
  const {call, login, gitea} = await startConsole(t);
  gitea.importRepository = async () => { const e = Error("Gitea POST /repos/migrate failed with HTTP 409"); e.status = 409; throw e; };
  const cookie = await login();
  const r = await call("POST", "/api/repos/import", {cookie,
    body: {clone_url: "https://github.com/a/b.git", name: "b"}});
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /Esiste già/u);
});

test("Gitea 422 on import becomes an actionable message", async (t) => {
  const {call, login, gitea} = await startConsole(t);
  gitea.importRepository = async () => { const e = Error("Gitea POST /repos/migrate failed with HTTP 422"); e.status = 422; throw e; };
  const cookie = await login();
  const r = await call("POST", "/api/repos/import", {cookie,
    body: {clone_url: "https://github.com/a/b.git", name: "b"}});
  assert.equal(r.status, 422);
  assert.match((await r.json()).error, /indirizzo di clonazione/u);
});

test("native environment maps every role identity and refuses missing configuration", async () => {
  const {nativeEnvironment} = await import("../src/trusted-core.mjs");
  const local = {ANVIL_DEPLOYER_PRIVATE_KEY: "0x" + "a".repeat(64), ADAPTER_CALLER_GATEWAY: "g"};
  for (const role of ["ENGINEER", "ORCHESTRATOR", "BACKEND", "FRONTEND", "TEST"]) {
    local[`ROLE_EVM_PRIVATE_KEY_${role}`] = "0x" + role.length.toString(16).padStart(64, "0");
    local[`ROLE_DID_${role}`] = "did:ethr:0x7a69:0x" + role.length.toString(16).padStart(40, "0");
    local[`ADAPTER_CALLER_${role}`] = "token-" + role;
  }
  const trust = {DID_REGISTRY_ADDRESS: "0x1", ENTERPRISE_TRUST_REGISTRY_ADDRESS: "0x2",
    ISSUER_REGISTRY_ADDRESS: "0x3"};
  const env = nativeEnvironment({local, trust, anvilUrl: "http://anvil:8545"});
  assert.equal(env.ENGINEER_CORE_NATIVE_MODE, "1");
  assert.equal(env.ADAPTER_TRUST_PROFILE, "evm");
  assert.equal(env.ADAPTER_ID_BACKEND, local.ROLE_DID_BACKEND);
  assert.equal(env.ADAPTER_EVM_PRIVATE_KEY_TEST, local.ROLE_EVM_PRIVATE_KEY_TEST);
  assert.equal(env.GOVERNANCE_PRIVATE_KEY, local.ANVIL_DEPLOYER_PRIVATE_KEY);
  assert.equal(env.CORE_RUST_DID_REGISTRY_ADDRESS, "0x1");
  assert.ok(env.ADAPTER_ENGINEER_NATIVE_SOCKET.length <= 100);
  const {ROLE_DID_TEST: _drop, ...incomplete} = local;
  assert.throws(() => nativeEnvironment({local: incomplete, trust, anvilUrl: "x"}), /ROLE_DID_TEST/u);
});

test("saving a policy publishes the parameters to OPA as data, keyed by repository URI", async (t) => {
  const {OpaPolicyPublisher, opaDocument} = await import("../src/opa.mjs");
  const calls = [];
  const fakeOpa = new OpaPolicyPublisher({opaUrl: "http://opa:8181", fetchFn: async (url, init) => {
    calls.push({url, init}); return new Response(null, {status: 204});
  }});
  const dir = mkdtempSync(join(tmpdir(), "console-opa-"));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  let handler;
  const server = createServer((req, res) => handler(req, res));
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const port = server.address().port;
  handler = createConsoleHandler({auth: new ConsoleAuth({users: {engineer: hashPassword("correct-horse")}}),
    gitea: new FakeGitea(), store: new ConsoleStore(join(dir, "c")), opa: fakeOpa,
    health: async () => ({}), port});
  const base = `http://127.0.0.1:${port}`;
  const login = await fetch(base + "/api/login", {method: "POST",
    headers: {"content-type": "application/json", "x-console-request": "1"},
    body: JSON.stringify({username: "engineer", password: "correct-horse"})});
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const policy = {...defaultPolicy(REPO), forbidden_path_prefixes: ["security/"]};
  const r = await fetch(base + `/api/repos/${REPO.name}/policy`, {method: "PUT",
    headers: {"content-type": "application/json", "x-console-request": "1", cookie},
    body: JSON.stringify(policy)});
  const body = await r.json();
  assert.equal(body.opa_published, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://opa:8181/v1/data/thesis/console_repositories");
  const sent = JSON.parse(calls[0].init.body);
  assert.deepEqual(Object.keys(sent), ["gitea://gitea.local/thesis/iam-console-poc"]);
  assert.deepEqual(sent["gitea://gitea.local/thesis/iam-console-poc"], {
    base_branch: "main", protected_branches: ["main"], work_branch_prefix: "feature/",
    forbidden_path_prefixes: ["security/"], runner_profile: "poc-default", allow_pull_request: true});
  assert.ok(!("agents_may_merge" in sent["gitea://gitea.local/thesis/iam-console-poc"]));
  assert.deepEqual(opaDocument([]), {});
});

test("OPA document comparison ignores key order", async () => {
  const {canonicalJson} = await import("../src/opa.mjs");
  assert.equal(canonicalJson({b: 1, a: [{d: 2, c: 3}]}), canonicalJson({a: [{c: 3, d: 2}], b: 1}));
  assert.notEqual(canonicalJson({a: [1, 2]}), canonicalJson({a: [2, 1]}));
});

test("password re-check for signing creates no session and shares the lockout", () => {
  const auth = new ConsoleAuth({users: {engineer: hashPassword("correct-horse")}});
  assert.equal(auth.verifyPassword("engineer", "correct-horse"), true);
  assert.equal(auth.verifyPassword("engineer", "wrong-one"), false);
  assert.deepEqual(Object.keys(auth.userRecord("engineer")).sort(), ["hash", "salt"]);
  assert.equal(auth.userRecord("nobody"), undefined);
});

test("scripted planner selects files by requirement keywords and declares itself simulated", async () => {
  const {selectPlanningFiles, scriptedProposal} = await import("../src/scripted-planner-model.mjs");
  const files = ["README.md", "apps/backend/src/users/user.service.ts",
    "apps/backend/src/users/account-status.ts", "apps/frontend/src/pages/UserDetailPage.tsx",
    "docs/guide.md", "packages/shared/src/index.ts"];
  const chosen = selectPlanningFiles(files, "Allow an administrator to suspend and reactivate an account");
  assert.deepEqual(chosen, ["apps/backend/src/users/account-status.ts"]);
  assert.deepEqual(selectPlanningFiles(files, "Suspend a user account"), [
    "apps/backend/src/users/account-status.ts", "apps/backend/src/users/user.service.ts",
    "apps/frontend/src/pages/UserDetailPage.tsx"]);
  const proposal = scriptedProposal(chosen);
  assert.equal(proposal.requested_permissions.length, 5);
  assert.match(proposal.assumptions[0], /SIMULATA/u);
  const fallback = selectPlanningFiles(files, "Improve something vague");
  assert.ok(fallback.length > 0 && fallback.every(f => !f.endsWith(".md")));
});
