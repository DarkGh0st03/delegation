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
  deleted = [];
  async importRepository(input) {
    validateCloneUrl(input.cloneUrl); validateRepoName(input.name);
    this.imported.push(input); return structuredClone(REPO);
  }
  async deleteRepository(name) { validateRepoName(name); this.deleted.push(name); }
}
class FakeGitHub {
  configured = true; owner = "DarkGh0st03";
  cloneCredentials = undefined;
  async listRepositories() { return [{name: "iam-console-poc", private: false}, {name: "greeter-lib", private: false}]; }
  async cloneUrlFor(name) {
    if (!(await this.listRepositories()).some(r => r.name === name)) throw Error("not one of the owner's repositories");
    return `https://github.com/${this.owner}/${name}.git`;
  }
}

async function startConsole(t, {sessions, github = new FakeGitHub(), staging} = {}) {
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
    health: async () => ({ready: true, checks: []}), port, sessions, github, staging});
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

test("repositories are imported ONLY from the configured GitHub account", async (t) => {
  const {call, login, gitea} = await startConsole(t);
  const cookie = await login();
  const list = await (await call("GET", "/api/github/repos", {cookie})).json();
  assert.equal(list.owner, "DarkGh0st03");
  assert.deepEqual(list.repositories.map(r => r.name), ["iam-console-poc", "greeter-lib"]);
  // A repository of another account, a URL or a traversal name is refused.
  for (const body of [{github_repo: "someone-else-repo"}, {clone_url: "https://github.com/a/b.git"},
    {github_repo: "../iam-console-poc"}]) {
    const r = await call("POST", "/api/repos/import", {cookie, body});
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  const ok = await call("POST", "/api/repos/import", {cookie, body: {github_repo: "greeter-lib"}});
  assert.equal(ok.status, 201);
  assert.deepEqual(gitea.imported.map(i => [i.cloneUrl, i.name]),
    [["https://github.com/DarkGh0st03/greeter-lib.git", "greeter-lib"]]);
  // Without GITHUB_OWNER the import is disabled.
  const off = await startConsole(t, {github: {configured: false}});
  const offCookie = await off.login();
  assert.equal((await off.call("POST", "/api/repos/import", {cookie: offCookie,
    body: {github_repo: "greeter-lib"}})).status, 409);
});

test("a repository can be deleted, except while a session is running on it", async (t) => {
  const busy = {list: () => [{repository: {name: "iam-console-poc"}, phase: "executing"}]};
  const {call, login, gitea} = await startConsole(t, {sessions: busy});
  const cookie = await login();
  assert.equal((await call("DELETE", "/api/repos/iam-console-poc", {cookie})).status, 409);
  assert.equal((await call("DELETE", "/api/repos/greeter-lib", {cookie})).status, 200);
  assert.equal((await call("DELETE", "/api/repos/..%2Fx", {cookie})).status, 400);
  assert.deepEqual(gitea.deleted, ["greeter-lib"]);
});

test("the console starts only Gemini sessions (free modes are test-only)", async (t) => {
  const started = [];
  const sessions = {list: () => [], start: (input) => { started.push(input.mode); return {id: "s-" + "a".repeat(12)}; }};
  const {call, login} = await startConsole(t, {sessions});
  const cookie = await login();
  const request = await (await call("POST", "/api/requests", {cookie,
    body: {repository: "iam-console-poc", requirement: "Allow searching users by name"}})).json();
  const previous = process.env.DELEGATION_FREE_MODES;
  delete process.env.DELEGATION_FREE_MODES;
  t.after(() => { if (previous !== undefined) process.env.DELEGATION_FREE_MODES = previous; });
  const scripted = await call("POST", "/api/requests/" + request.request.id + "/planning",
    {cookie, body: {mode: "scripted"}});
  assert.equal(scripted.status, 400);
  const gemini = await call("POST", "/api/requests/" + request.request.id + "/planning",
    {cookie, body: {mode: "gemini", gemini_consent: true}});
  assert.equal(gemini.status, 202);
  assert.deepEqual(started, ["gemini"]);
});

test("old sessions are archived (moved, never deleted), keeping the newest", async (t) => {
  const {mkdirSync, writeFileSync, existsSync} = await import("node:fs");
  const {archiveSessions} = await import("../scripts/archive-sessions.mjs");
  const dir = mkdtempSync(join(tmpdir(), "archive-test-"));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const add = (id, at, phase) => { mkdirSync(join(dir, "sessions", id), {recursive: true});
    writeFileSync(join(dir, "sessions", id, "session.json"), JSON.stringify({created_at: at, phase})); };
  add("s-000000000001", "2026-11-13T10:00:00Z", "failed");
  add("s-000000000002", "2026-11-13T11:00:00Z", "completed");
  add("s-000000000003", "2026-11-13T12:00:00Z", "completed");
  add("s-000000000004", "2026-11-13T12:30:00Z", "executing");
  add("s-000000000005", "2026-11-12T09:00:00Z", "executing"); // console restarted long ago
  const result = archiveSessions({stateDir: dir, keep: 2, nowMs: Date.parse("2026-11-13T13:00:00Z")});
  assert.deepEqual(result.archived.sort(), ["s-000000000001", "s-000000000002", "s-000000000005"]);
  assert.ok(existsSync(join(dir, "sessions-archive", "s-000000000001", "session.json")));
  assert.ok(existsSync(join(dir, "sessions", "s-000000000004")), "a running session is never archived");
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
    body: {github_repo: "greeter-lib"}});
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /Esiste già/u);
});

test("Gitea 422 on import becomes an actionable message", async (t) => {
  const {call, login, gitea} = await startConsole(t);
  gitea.importRepository = async () => { const e = Error("Gitea POST /repos/migrate failed with HTTP 422"); e.status = 422; throw e; };
  const cookie = await login();
  const r = await call("POST", "/api/repos/import", {cookie,
    body: {github_repo: "greeter-lib"}});
  assert.equal(r.status, 422);
  assert.match((await r.json()).error, /GITHUB_TOKEN/u);
});

test("each native process gets only its own secrets: Engineer core and one wallet per role", async () => {
  const {nativeEnvironment, walletEnvironment, WALLET_ROLES} = await import("../src/trusted-core.mjs");
  const local = {ANVIL_DEPLOYER_PRIVATE_KEY: "0x" + "a".repeat(64), ADAPTER_CALLER_GATEWAY: "g"};
  for (const role of ["ENGINEER", "ORCHESTRATOR", "BACKEND", "FRONTEND", "DOCS", "DATA", "DEVOPS", "TEST"]) {
    local[`ROLE_EVM_PRIVATE_KEY_${role}`] = "0x" + role.length.toString(16).padStart(64, "0") + role;
    local[`ROLE_DID_${role}`] = "did:ethr:0x7a69:0x" + role.length.toString(16).padStart(40, "0");
    local[`ADAPTER_CALLER_${role}`] = "token-" + role;
  }
  const trust = {DID_REGISTRY_ADDRESS: "0x1", ENTERPRISE_TRUST_REGISTRY_ADDRESS: "0x2",
    ISSUER_REGISTRY_ADDRESS: "0x3"};
  const secretsIn = env => Object.entries(local)
    .filter(([key]) => key.startsWith("ROLE_EVM_PRIVATE_KEY_") || key.startsWith("ADAPTER_CALLER_") ||
      key === "ANVIL_DEPLOYER_PRIVATE_KEY")
    .filter(([, value]) => Object.values(env).includes(value)).map(([key]) => key).sort();

  // Engineer core: Engineer key, governance key, Engineer and Gateway tokens only.
  const core = nativeEnvironment({local, trust, anvilUrl: "http://anvil:8545"});
  assert.equal(core.ADAPTER_SIGNING_ROLE, "engineer");
  assert.equal(core.ENGINEER_CORE_NATIVE_MODE, "1");
  assert.deepEqual(secretsIn(core), ["ADAPTER_CALLER_ENGINEER", "ADAPTER_CALLER_GATEWAY",
    "ANVIL_DEPLOYER_PRIVATE_KEY", "ROLE_EVM_PRIVATE_KEY_ENGINEER"]);
  assert.equal(core.ADAPTER_ID_BACKEND, local.ROLE_DID_BACKEND, "other roles are known by public DID");
  assert.ok(core.ADAPTER_ENGINEER_NATIVE_SOCKET.length <= 100);
  for (const role of WALLET_ROLES) assert.match(core[`DELEGATION_WALLET_SOCKET_${role}`], /wallet-/u);

  // Each wallet: ONLY its own EVM key and token; no governance key.
  for (const role of WALLET_ROLES) {
    const wallet = walletEnvironment({local, trust, anvilUrl: "http://anvil:8545", role});
    assert.equal(wallet.ADAPTER_SIGNING_ROLE, role.toLowerCase());
    assert.deepEqual(secretsIn(wallet), [`ADAPTER_CALLER_${role}`, `ROLE_EVM_PRIVATE_KEY_${role}`]);
    assert.equal(wallet.DELEGATION_WALLET_SOCKET, core[`DELEGATION_WALLET_SOCKET_${role}`]);
    assert.equal(wallet.GOVERNANCE_PRIVATE_KEY, undefined);
  }
  assert.deepEqual(WALLET_ROLES, ["ORCHESTRATOR", "BACKEND", "FRONTEND", "DOCS", "DATA", "DEVOPS", "TEST"],
    "one wallet for the Orchestrator and for every specialist of the registry");
  assert.throws(() => walletEnvironment({local, trust, anvilUrl: "x", role: "ENGINEER"}), /wallet non valido/u);
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

test("approval needs the Engineer password again and forwards only permission IDs", async (t) => {
  const calls = [];
  const sessions = {
    async approve(input) { calls.push(["approve", input]); return {id: input.id, phase: "operational"}; },
    async stop(id) { calls.push(["stop", id]); return {id, phase: "stopped"}; }
  };
  const {call, login} = await startConsole(t, {sessions});
  const cookie = await login();
  const path = "/api/sessions/s-0123456789ab/";
  const wrong = await call("POST", path + "approve", {cookie,
    body: {password: "not-the-password", permission_ids: ["permission-1"]}});
  assert.equal(wrong.status, 403);
  assert.equal(calls.length, 0, "a wrong password never reaches the signer");
  const ok = await call("POST", path + "approve", {cookie,
    body: {password: "correct-horse", permission_ids: ["permission-1", "permission-3"]}});
  assert.equal(ok.status, 200);
  assert.deepEqual(calls[0], ["approve", {id: "s-0123456789ab", password: "correct-horse",
    permissionIds: ["permission-1", "permission-3"]}]);
  const stop = await call("POST", path + "stop", {cookie, body: {}});
  assert.equal(stop.status, 200);
  assert.deepEqual(calls[1], ["stop", "s-0123456789ab"]);
  // Without a console session nothing is signed or stopped.
  assert.equal((await call("POST", path + "stop", {body: {}})).status, 401);
  assert.equal(calls.length, 2);
});

test("simulated execution plans only from APPROVED permissions, one Task per read+update file", async () => {
  const {simulatedExecutionPlan, roleForPath, simulatedMarker, lastReadContent, ScriptedDecisionModel} =
    await import("../src/scripted-execution-models.mjs");
  const repo = "gitea://gitea.local/thesis/iam-console-poc";
  const file = path => `${repo}/branches/feature%2Fs-1/files/${path.split("/").map(encodeURIComponent).join("/")}`;
  const approved = [
    {operation: "create_branch", resource: repo},
    {operation: "run_tests", resource: `${repo}/branches/feature%2Fs-1`},
    {operation: "read_file", resource: file("apps/backend/src/a.ts")},
    {operation: "update_file", resource: file("apps/backend/src/a.ts")},
    {operation: "read_file", resource: file("apps/frontend/src/B.tsx")},
    {operation: "update_file", resource: file("apps/frontend/src/B.tsx")},
    // read without update: never becomes a write Task
    {operation: "read_file", resource: file("tests/backend/c.test.ts")}
  ];
  const plan = simulatedExecutionPlan(approved, "s-1");
  assert.deepEqual(plan.tasks.map(t => [t.task_id, t.agent_id, t.path ?? null]), [
    ["t01-backend", "backend", "apps/backend/src/a.ts"],
    ["t02-frontend", "frontend", "apps/frontend/src/B.tsx"],
    ["t99-test", "test", null]]);
  assert.equal(plan.pullRequest, undefined, "no PR permission approved, none planned");
  assert.deepEqual(plan.tasks[0].permissions.map(p => p.operation), ["read_file", "update_file"]);
  assert.equal(roleForPath("tests/backend/x.test.ts"), "test");
  // The Test role may not create/update e2e specs: a file specialist does.
  assert.equal(roleForPath("tests/e2e/x.spec.ts"), "frontend");
  assert.match(simulatedMarker("a.css", "s-1"), /^\/\* .*SIMULATA.* \*\/$/u);
  assert.match(simulatedMarker("a.ts", "s-1"), /^\/\/ \[delegation s-1\]/u);
  // The worker rewrites what the Gateway actually returned.
  assert.equal(lastReadContent({contents: [{parts: [{functionResponse: {name: "read_file",
    response: {result: JSON.stringify({content: "old body\n"})}}}]}]}), "old body\n");
  // Decisions: delegate in order, then stop honestly on a verified FAIL.
  const model = new ScriptedDecisionModel({plan, branchTaskId: "branch"});
  const next = async (request = {}) => {
    for await (const e of model.generateContentAsync(request)) return JSON.parse(e.content.parts[0].text);
  };
  const completed = ids => ({contents: [{parts: [{text: JSON.stringify(
    {independently_gateway_completed_tasks: ids.map(task_id => ({task_id}))})}]}]});
  assert.deepEqual((await next(completed(["branch"]))).task.depends_on, ["branch"]);
  assert.deepEqual((await next(completed(["branch", "t01-backend"]))).task.depends_on, ["t01-backend"]);
  assert.equal((await next()).task.agent_id, "test");
  assert.equal((await next({contents: [{parts: [{text: JSON.stringify(
    {independent_runner_failure: {failed_phase: "backend_tests"}})}]}]})).action, "blocked");
});

test("execution errors from the canonical fail-closed stops are explained in plain words", async () => {
  const {friendlyExecutionError} = await import("../src/sessions.mjs");
  assert.match(friendlyExecutionError(Error("Native D1 failure preflight NO-GO: original Runner FAIL is not independently actionable")),
    /ambiente di test/u);
  assert.match(friendlyExecutionError(Error("ENOENT: no such file or directory, open '/x/runnerFailureReceipts/a.runner-fail.json'")),
    /esito verificabile/u);
  assert.equal(friendlyExecutionError(Error("other")), "other");
});

test("simulated Orchestrator asks for a PR only after a verified completed Test Task", async () => {
  const {ScriptedDecisionModel} = await import("../src/scripted-execution-models.mjs");
  const plan = {runsTests: true, tasks: [{task_id: "t99-test", agent_id: "test", permissions: [], instruction: "x"}]};
  const ask = async (request) => {
    const model = new ScriptedDecisionModel({plan, branchTaskId: "branch"});
    for await (const _ of model.generateContentAsync({})) break; // delegate the test
    for await (const e of model.generateContentAsync(request)) return JSON.parse(e.content.parts[0].text);
  };
  // Runner unavailable: the Test Task never completed -> honest stop, no PR.
  assert.equal((await ask({contents: [{parts: [{text: JSON.stringify(
    {independently_gateway_completed_tasks: [{task_id: "branch"}]})}]}]})).action, "blocked");
  assert.equal((await ask({contents: [{parts: [{text: JSON.stringify(
    {independently_gateway_completed_tasks: [{task_id: "branch"}, {task_id: "t99-test"}]})}]}]})).action,
    "ready_for_pr");
});

test("scripted planner understands Italian requirements against English paths", async () => {
  const {selectPlanningFiles} = await import("../src/scripted-planner-model.mjs");
  assert.deepEqual(selectPlanningFiles(["apps/backend/src/users/user.service.ts", "docs/x.ts",
    "packages/shared/src/account-status.ts"], "Sospendere e riattivare un account utente"),
  ["apps/backend/src/users/user.service.ts", "packages/shared/src/account-status.ts"]);
});

test("Gemini preflight is free and explains key/model problems without leaking the key", async () => {
  const {preflightGemini} = await import("../src/gemini-models.mjs");
  const key = "AIza" + "x".repeat(35);
  const reply = (status, body) => async (url, init) => {
    assert.equal(init.headers["x-goog-api-key"], key, "key in a header, never in the URL");
    assert.doesNotMatch(String(url), /AIza/u);
    return new Response(body, {status});
  };
  assert.deepEqual(await preflightGemini({apiKey: key, model: "gemini-3.8-flash", fetchFn: reply(200, "{}")}),
    {model: "gemini-3.8-flash"});
  await assert.rejects(preflightGemini({apiKey: key, model: "gemini-3.8-flash",
    fetchFn: reply(400, `{"error":"API key not valid ${key}"}`)}),
    e => /rifiutata/u.test(e.message) && !e.message.includes(key));
  await assert.rejects(preflightGemini({apiKey: key, model: "gemini-3.8-flash", fetchFn: reply(404, "")}), /non esiste/u);
  // Only the validated model is accepted, before any network call.
  await assert.rejects(preflightGemini({apiKey: key, model: "gemini-9",
    fetchFn: async () => { throw Error("must not be called"); }}), /non supportato/u);
  await assert.rejects(preflightGemini({apiKey: key, model: "gemini-3.8-flash",
    fetchFn: async () => { throw Object.assign(Error("fetch failed"), {cause: {code: "ENOTFOUND"}}); }}),
    /non raggiungibile.*ENOTFOUND/u);
  await assert.rejects(preflightGemini({apiKey: "", model: "gemini-3.8-flash"}), /non configurata/u);
});

test("paid models are budgeted and every call (or discard) is recorded for the Engineer", async () => {
  const {BaseLlm} = await import("@google/adk");
  const {createSessionGeminiModels} = await import("../src/gemini-models.mjs");
  const answers = [
    {content: {role: "model", parts: [{text: "{\"ok\":true}"}]}, finishReason: "STOP",
      usageMetadata: {promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120}},
    {content: {role: "model", parts: [{text: "troncata"}]}, finishReason: "MAX_TOKENS",
      usageMetadata: {promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150}}];
  class FakeGemini extends BaseLlm {
    constructor() { super({model: "gemini-3.8-flash"}); }
    async *generateContentAsync() { yield answers.shift(); }
  }
  const records = [];
  const g = await createSessionGeminiModels({apiKey: "unused", model: "gemini-3.8-flash",
    record: r => records.push(r), createProvider: () => new FakeGemini()});
  const planner = g.planning();
  assert.equal(planner.model, "gemini-3.8-flash", "model name kept: canonical timeouts depend on it");
  const out = [];
  for await (const r of planner.generateContentAsync({})) out.push(r);
  assert.equal(out.length, 1);
  assert.deepEqual([records[0].ok, records[0].total_tokens, records[0].finish, records[0].preview],
    [true, 120, "STOP", "{\"ok\":true}"]);
  // A truncated answer is observed, then DISCARDED by the canonical budget layer.
  await assert.rejects(async () => { for await (const _ of planner.generateContentAsync({})); });
  assert.equal(records[1].finish, "MAX_TOKENS");
  assert.deepEqual([records[2].ok, records[2].layer], [false, "budget"]);
  assert.equal(g.summary().calls_started, 2);
});

test("free modes: app work, then ONE Test Task reads the changed app files and edits the test, then run_tests", async () => {
  const {simulatedExecutionPlan, ScriptedWorkerModel} = await import("../src/scripted-execution-models.mjs");
  const base = "gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Fs-1";
  const rw = path => [{operation: "read_file", resource: `${base}/files/${path}`},
    {operation: "update_file", resource: `${base}/files/${path}`}];
  const plan = simulatedExecutionPlan([...rw("apps/backend/src/a.ts"), ...rw("apps/frontend/src/B.tsx"),
    ...rw("tests/backend/a.test.ts"), {operation: "run_tests", resource: base}], "s-1");
  assert.deepEqual(plan.tasks.map(t => [t.task_id, t.op ?? "run", t.path ?? null]), [
    ["t01-backend", "update", "apps/backend/src/a.ts"],
    ["t02-frontend", "update", "apps/frontend/src/B.tsx"],
    ["t03-test", "update", "tests/backend/a.test.ts"],
    ["t99-test", "run", null]]);
  // N signed reads (changed app files + the edited test) and ONE write.
  assert.deepEqual(plan.tasks[2].permissions.map(p => [p.operation, p.resource.split("/files/")[1]]), [
    ["read_file", "apps/backend/src/a.ts"], ["read_file", "apps/frontend/src/B.tsx"],
    ["read_file", "tests/backend/a.test.ts"], ["update_file", "tests/backend/a.test.ts"]]);
  // The worker reads every context file once, the edited file last, then writes.
  const t = plan.tasks[2];
  const worker = new ScriptedWorkerModel({role: "test", branch: "feature/s-1", sessionId: "s-1",
    files: [{path: t.path, op: t.op, reads: t.reads}]});
  const calls = [];
  const reply = content => ({contents: [{parts: [{functionResponse: {name: "read_file",
    response: {result: JSON.stringify({content})}}}]}]});
  for (let i = 0; i < 5; i++) for await (const e of worker.generateContentAsync(reply("old test\n")))
    calls.push(e.content.parts[0].functionCall ?? {text: e.content.parts[0].text});
  assert.deepEqual(calls.slice(0, 4).map(c => [c.name, c.args?.path]), [
    ["read_file", "apps/backend/src/a.ts"], ["read_file", "apps/frontend/src/B.tsx"],
    ["read_file", "tests/backend/a.test.ts"], ["update_file", "tests/backend/a.test.ts"]]);
  assert.match(calls[3].args.content, /^old test\n\/\/ \[delegation s-1\]/u);
  assert.match(calls[4].text, /Aggiornato tests\/backend\/a\.test\.ts/u);
});

test("free modes: a CREATED test reads the changed files in the same Task (reads + one create)", async () => {
  const {simulatedExecutionPlan} = await import("../src/scripted-execution-models.mjs");
  const base = "gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Fs-1";
  const plan = simulatedExecutionPlan([
    {operation: "read_file", resource: `${base}/files/apps/backend/src/a.ts`},
    {operation: "update_file", resource: `${base}/files/apps/backend/src/a.ts`},
    {operation: "create_file", resource: `${base}/files/tests/backend/a.test.ts`},
    {operation: "run_tests", resource: base}], "s-1");
  assert.deepEqual(plan.tasks.map(t => [t.task_id, t.op ?? "run"]), [
    ["t01-backend", "update"], ["t02-test", "create"], ["t99-test", "run"]]);
  assert.deepEqual(plan.tasks[1].reads, ["apps/backend/src/a.ts"]);
  assert.deepEqual(plan.tasks[1].permissions.map(p => p.operation), ["read_file", "create_file"]);
});

test("budgeted Gemini accepts a proposed write on the session branch, never on another", async () => {
  const {BaseLlm} = await import("@google/adk");
  const {createSessionGeminiModels} = await import("../src/gemini-models.mjs");
  const write = branch => ({content: {role: "model", parts: [{functionCall: {name: "update_file",
    args: {branch, path: "packages/shared/src/account-status.ts", content: "export const x = 1;\n"}}}]},
    finishReason: "STOP", usageMetadata: {promptTokenCount: 1271, candidatesTokenCount: 124, totalTokenCount: 1963}});
  const answers = [write("feature/s-520705307cbd"), write("feature/other")];
  class FakeGemini extends BaseLlm {
    constructor() { super({model: "gemini-3.8-flash"}); }
    async *generateContentAsync() { yield answers.shift(); }
  }
  const records = [];
  const g = await createSessionGeminiModels({apiKey: "unused", model: "gemini-3.8-flash",
    workBranch: "feature/s-520705307cbd", record: r => records.push(r), createProvider: () => new FakeGemini()});
  const backend = g.execution().backend;
  const out = [];
  for await (const r of backend.generateContentAsync({})) out.push(r);
  assert.equal(out[0].content.parts[0].functionCall.name, "update_file", "today's real case now passes");
  const frontend = g.execution().frontend;
  await assert.rejects(async () => { for await (const _ of frontend.generateContentAsync({})); }, /NO-GO/u);
});

test("policy v2 carries the project profile; v1 policies migrate to the repository default", async () => {
  const {validatePolicy, defaultPolicy, toOpaRepositoryConfig, NPM_PROJECT_PROFILE_TEMPLATE} =
    await import("../src/policy.mjs");
  const {IAM_CONSOLE_PROJECT_PROFILE} = await import("../../packages/plan-contracts/src/project-profile.mjs");
  const example = {owner: "thesis", name: "iam-console-poc", default_branch: "main"};
  const other = {owner: "thesis", name: "todo-api", default_branch: "main"};
  assert.deepEqual(defaultPolicy(example).project_profile.phases.map(p => p.name),
    IAM_CONSOLE_PROJECT_PROFILE.phases.map(p => p.name));
  assert.deepEqual(defaultPolicy(other).project_profile.phases.map(p => p.command),
    NPM_PROJECT_PROFILE_TEMPLATE.phases.map(p => p.command));
  // A policy saved by the previous version keeps working (same commands as before).
  const {project_profile: _p, ...v1} = defaultPolicy(example);
  const migrated = validatePolicy({...v1, version: 1, runner_profile: "poc-default"}, example);
  assert.equal(migrated.version, 2);
  assert.deepEqual(migrated.project_profile, defaultPolicy(example).project_profile);
  // OPA never receives commands: only the contract label.
  assert.deepEqual(Object.keys(toOpaRepositoryConfig(migrated)).includes("project_profile"), false);
  assert.equal(toOpaRepositoryConfig(migrated).runner_profile, "poc-default");
  const bad = defaultPolicy(other); bad.project_profile.image = "node:latest";
  assert.throws(() => validatePolicy(bad, other), /Profilo di test non valido/u);
});

test("Cronologia shows each failed test with its error message, bounded", async () => {
  const {failedTestLines} = await import("../src/sessions.mjs");
  assert.deepEqual(failedTestLines({status: "pass"}), []);
  const lines = failedTestLines({status: "fail", test_failures: [
    {file: "tests/backend/user.routes.test.ts", test: "GET /api/users > filters by department",
     message: "AssertionError: expected 4 to be 2\n- Expected\n+ Received\n- 2\n+ 4"}]});
  assert.deepEqual(lines, ["Test fallito: tests/backend/user.routes.test.ts › " +
    "GET /api/users > filters by department — AssertionError: expected 4 to be 2 · - Expected · + Received"]);
  const many = Array.from({length: 20}, (_, i) => ({file: "f.test.ts", test: "t" + i, message: "m".repeat(900)}));
  const bounded = failedTestLines({test_failures: many});
  assert.equal(bounded.length, 8);
  assert.ok(bounded.every(line => line.length < 500));
});

test("simulated Orchestrator: depends on the last COMPLETED Task and reads the failure FIELD only", async () => {
  const {ScriptedDecisionModel} = await import("../src/scripted-execution-models.mjs");
  const plan = {runsTests: true, tasks: [{task_id: "t01-backend"}, {task_id: "t02-test"}, {task_id: "t03-frontend"},
    {task_id: "t99-test"}].map(t => ({...t, agent_id: "backend", permissions: [], instruction: "x"}))};
  const model = new ScriptedDecisionModel({plan, branchTaskId: "branch"});
  const ask = async completed => {
    const request = {system: "independent_runner_failure.failed_tests lists each failed test",
      contents: [{parts: [{text: JSON.stringify({independently_gateway_completed_tasks:
        completed.map(task_id => ({task_id}))})}]}]};
    for await (const r of model.generateContentAsync(request)) return JSON.parse(r.content.parts[0].text);
  };
  assert.deepEqual((await ask(["branch"])).task.depends_on, ["branch"]);
  assert.deepEqual((await ask(["branch", "t01-backend"])).task.depends_on, ["t01-backend"]);
  // t02-test ended as a verified "no change needed": not completed, skipped.
  assert.deepEqual((await ask(["branch", "t01-backend"])).task.depends_on, ["t01-backend"]);
  await ask(["branch", "t01-backend", "t03-frontend"]);
  // The prompt mentions independent_runner_failure, but no FAIL field exists.
  assert.equal((await ask(["branch", "t01-backend", "t03-frontend", "t99-test"])).action, "ready_for_pr");
});

test("console explains an exhausted repair budget and shows compiler errors", async () => {
  const {friendlyExecutionError, failedTestLines} = await import("../src/sessions.mjs");
  assert.match(friendlyExecutionError(Error("Test run did not pass after the repair budget of 4 verified Test failures was used: x")),
    /dopo 4 tentativi di riparazione/u);
  assert.deepEqual(failedTestLines({typecheck_errors: [{file: "apps/backend/src/a.ts", line: 3, code: "TS2339",
    message: "Property 'workEmail' does not exist on type 'UserSummary'."}]}),
    ["Errore di compilazione: apps/backend/src/a.ts:3 TS2339 — Property 'workEmail' does not exist on type 'UserSummary'."]);
});
