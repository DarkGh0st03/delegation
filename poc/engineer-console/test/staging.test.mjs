import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFileSync} from "node:child_process";
import {ConsoleAuth, hashPassword} from "../src/auth.mjs";
import {createConsoleHandler} from "../src/app.mjs";
import {ConsoleStore} from "../src/store.mjs";
import {StagingStore, defaultStagingProfile, stagingProfileDigest, validateStagingProfile} from "../src/staging.mjs";
import {StagingDeployer} from "../../../deploy/staging/deployer.mjs";

const SHA1 = "1".repeat(40), SHA2 = "2".repeat(40);
const PROFILE = {version: 1, enabled: true, image: "node:22.15.0-bookworm",
  build: "npm ci", start: "node server.js", port: 3000};
const tempDir = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "staging-test-"));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  return dir;
};

test("staging profile: explicit image version, both commands, valid port", () => {
  assert.equal(validateStagingProfile(PROFILE).port, 3000);
  for (const bad of [
    {...PROFILE, image: "node:latest"}, {...PROFILE, image: "node"},
    {...PROFILE, build: " "}, {...PROFILE, start: ""}, {...PROFILE, port: 0}, {...PROFILE, port: 70000},
    {...PROFILE, enabled: "yes"}, {...PROFILE, extra: 1}, {...PROFILE, version: 2}
  ]) assert.throws(() => validateStagingProfile(bad), /Profilo di staging non valido/u);
  // The example repository has a known default; others have none.
  assert.equal(defaultStagingProfile("iam-console-poc").port, 5173);
  assert.equal(defaultStagingProfile("other"), undefined);
  assert.notEqual(stagingProfileDigest(PROFILE), stagingProfileDigest({...PROFILE, port: 3001}));
});

test("staging store: default seeded once, saved profile kept, status read from the deployer", (t) => {
  const dir = tempDir(t);
  const store = new StagingStore(dir);
  assert.equal(store.profile("iam-console-poc").source, "default");
  store.ensureDefault("iam-console-poc");
  store.save("iam-console-poc", {...defaultStagingProfile("iam-console-poc"), enabled: false});
  store.ensureDefault("iam-console-poc");                 // does not overwrite
  assert.equal(store.profile("iam-console-poc").profile.enabled, false);
  assert.equal(store.summary("greeter").configured, false);
  assert.throws(() => store.save("../x", PROFILE), /Invalid repository name/u);
  store.save("greeter", PROFILE);
  writeFileSync(join(dir, "status.json"), JSON.stringify({heartbeat_at: new Date().toISOString(),
    repositories: {greeter: {state: "running", live_sha: SHA1, url: "http://127.0.0.1:8801/",
      message: "ok", injected: "<b>"}}}));
  const status = store.summary("greeter").status;
  assert.equal(status.url, "http://127.0.0.1:8801/");
  assert.equal(status.deployer_alive, true);
  assert.equal(status.injected, undefined);
  // A URL that is not a local http address is never shown.
  writeFileSync(join(dir, "status.json"), JSON.stringify({repositories: {greeter: {state: "running",
    url: "https://evil.example/"}}}));
  assert.equal(store.status("greeter").url, null);
  assert.equal(store.status("greeter").deployer_alive, false);
});

/** Fake Docker CLI + Gitea: records commands, simulates containers/images. */
function fakeWorld({buildExit = 0, readyFor = () => true} = {}) {
  const calls = [], containers = new Map(), images = new Set();
  let mainSha = SHA1, repoExists = true;
  const ok = (stdout = "") => ({code: 0, stdout, stderr: ""});
  const docker = async (args) => {
    calls.push(args.join(" "));
    const [cmd] = args;
    if (cmd === "inspect") {
      const c = containers.get(args.at(-1));
      return c ? ok(`${c.running} ${c.sha}`) : {code: 1, stdout: "", stderr: "No such object"};
    }
    if (cmd === "image" && args[1] === "inspect") return images.has(args.at(-1)) ? ok("sha256:x") : {code: 1, stdout: "", stderr: ""};
    if (cmd === "image" && args[1] === "ls") return ok([...images].filter(i => i.startsWith(args.at(-1) + ":")).join("\n"));
    if (cmd === "image" && args[1] === "rm") { images.delete(args.at(-1)); return ok(); }
    if (cmd === "rm") { containers.delete(args.at(-1)); return ok(); }
    if (cmd === "create") { containers.set(args[2], {running: false, sha: ""}); return ok("id"); }
    if (cmd === "cp") return ok();
    if (cmd === "start") return buildExit === 0 ? ok("built") : {code: buildExit, stdout: "npm ERR! missing script", stderr: ""};
    if (cmd === "commit") { images.add(args.at(-1)); return ok("sha256:img"); }
    if (cmd === "run") {
      const name = args[args.indexOf("--name") + 1];
      const sha = args.find(a => a.startsWith("org.delegation.staging.sha=")).split("=")[1];
      containers.set(name, {running: true, sha, image: args.at(-1)}); return ok("cid");
    }
    if (cmd === "logs") return ok("Error: listen EADDRINUSE");
    return ok();
  };
  // A real tar.gz with one top-level folder, like Gitea's archive.
  const src = mkdtempSync(join(tmpdir(), "staging-archive-"));
  execFileSync("mkdir", ["-p", join(src, "repo")]);
  writeFileSync(join(src, "repo", "server.js"), "// app\n");
  execFileSync("tar", ["-czf", join(src, "a.tgz"), "-C", src, "repo"]);
  const archive = readFileSync(join(src, "a.tgz"));
  rmSync(src, {recursive: true, force: true});
  const requests = [];
  const fetchFn = async (url, init) => {
    requests.push({url, auth: init?.headers?.authorization});
    const json = body => ({ok: true, status: 200, json: async () => body});
    if (url.startsWith("http://delegation-staging-")) {
      if (readyFor(containers.get(new URL(url).hostname)?.sha)) return {ok: true, status: 200};
      throw Error("ECONNREFUSED");
    }
    if (!repoExists) return {ok: false, status: 404};
    if (/\/repos\/thesis\/[^/]+$/u.test(url)) return json({default_branch: "main"});
    if (url.endsWith("/branches/main")) return json({commit: {id: mainSha}});
    if (url.includes("/archive/")) return {ok: true, status: 200, arrayBuffer: async () => archive};
    return {ok: false, status: 404};
  };
  return {docker, fetchFn, calls, containers, images, requests,
    setMain(sha) { mainSha = sha; }, deleteRepo() { repoExists = false; }};
}

function deployerFor(t, world, dir) {
  return new StagingDeployer({stagingDir: dir, gitea: {baseUrl: "http://gitea:3000", org: "thesis", token: "deploy-token"},
    docker: world.docker, fetchFn: world.fetchFn, log: () => {}, readyTimeoutMs: 50, sleep: async () => {}});
}

test("deployer: merged main is built from the exact commit and published on 127.0.0.1", async (t) => {
  const dir = tempDir(t), world = fakeWorld();
  new StagingStore(dir).save("greeter", PROFILE);
  const deployer = deployerFor(t, world, dir);
  await deployer.tick();
  const entry = deployer.status.repositories.greeter;
  assert.equal(entry.state, "running");
  assert.equal(entry.live_sha, SHA1);
  assert.equal(entry.url, "http://127.0.0.1:8801/");
  assert.ok(world.requests.some(r => r.url.endsWith(`/archive/${SHA1}.tar.gz`) && r.auth === "token deploy-token"));
  const run = world.calls.find(c => c.startsWith("run "));
  assert.match(run, /--network delegation-staging/u);
  assert.match(run, /-p 127\.0\.0\.1:8801:3000/u);
  assert.match(run, /--cap-drop ALL/u);
  assert.doesNotMatch(world.calls.join("\n"), /deploy-token/u, "the token never reaches a container");
  // Nothing changes while main is the same.
  const before = world.calls.length;
  await deployer.tick();
  assert.equal(world.calls.filter((c, i) => i >= before && /^(create|run|commit)/u.test(c)).length, 0);
  // A merge (new main) triggers a new build; the old image is pruned later.
  world.setMain(SHA2);
  await deployer.tick();
  assert.equal(deployer.status.repositories.greeter.live_sha, SHA2);
  assert.equal(deployer.status.repositories.greeter.url, "http://127.0.0.1:8801/", "same port after redeploy");
  const status = JSON.parse(readFileSync(join(dir, "status.json"), "utf8"));
  assert.equal(status.repositories.greeter.live_sha, SHA2);
  assert.ok(status.heartbeat_at);
});

test("deployer: a failed build keeps the running version and is not retried in a loop", async (t) => {
  const dir = tempDir(t), world = fakeWorld();
  new StagingStore(dir).save("greeter", PROFILE);
  const deployer = deployerFor(t, world, dir);
  await deployer.tick();
  world.setMain(SHA2);
  const broken = fakeWorld({buildExit: 1});
  // Same containers/images, failing build.
  const deployer2 = new StagingDeployer({stagingDir: dir, gitea: {baseUrl: "http://gitea:3000", org: "thesis", token: "t"},
    docker: async (args) => args[0] === "start" ? broken.docker(args) : world.docker(args),
    fetchFn: world.fetchFn, log: () => {}, readyTimeoutMs: 50, sleep: async () => {}});
  await deployer2.tick();
  const entry = deployer2.status.repositories.greeter;
  assert.equal(entry.state, "failed");
  assert.equal(entry.live_sha, SHA1, "the previous version stays online");
  assert.match(entry.message, /Build non riuscita/u);
  assert.match(entry.log, /missing script/u);
  assert.equal(world.containers.get("delegation-staging-greeter").sha, SHA1);
  const builds = world.calls.filter(c => c.startsWith("commit")).length;
  await deployer2.tick();
  assert.equal(world.calls.filter(c => c.startsWith("create")).length, 2, "no rebuild of the same failed commit");
  assert.equal(world.calls.filter(c => c.startsWith("commit")).length, builds);
  // Saving the profile again in the console is the explicit retry.
  await new Promise(r => setTimeout(r, 5));
  new StagingStore(dir).save("greeter", PROFILE);
  await deployer2.tick();
  assert.equal(world.calls.filter(c => c.startsWith("create")).length, 3, "retried after the save");
});

test("deployer: a new version that does not answer is rolled back to the previous one", async (t) => {
  const dir = tempDir(t), world = fakeWorld({readyFor: sha => sha === SHA1});
  new StagingStore(dir).save("greeter", PROFILE);
  const deployer = deployerFor(t, world, dir);
  await deployer.tick();
  world.setMain(SHA2);
  await deployer.tick();
  const entry = deployer.status.repositories.greeter;
  assert.equal(entry.state, "failed");
  assert.match(entry.message, /ripristinata la versione 1111111/u);
  assert.equal(world.containers.get("delegation-staging-greeter").sha, SHA1);
  assert.match(entry.log, /EADDRINUSE/u);
});

test("deployer: disabling staging or deleting the repository stops the app", async (t) => {
  const dir = tempDir(t), world = fakeWorld();
  const store = new StagingStore(dir);
  store.save("greeter", PROFILE);
  const deployer = deployerFor(t, world, dir);
  await deployer.tick();
  assert.ok(world.containers.has("delegation-staging-greeter"));
  // An unreadable profile file leaves the running app untouched.
  writeFileSync(join(dir, "profiles", "greeter.json"), "{not json");
  await deployer.tick();
  assert.equal(world.containers.get("delegation-staging-greeter").running, true);
  store.delete("greeter");
  await deployer.tick();
  assert.equal(world.containers.has("delegation-staging-greeter"), false);
  assert.equal(deployer.status.repositories.greeter, undefined);
  assert.equal([...world.images].length, 0);
});

test("deployer: after a stack restart the built image starts again without a rebuild", async (t) => {
  const dir = tempDir(t), world = fakeWorld();
  new StagingStore(dir).save("greeter", PROFILE);
  const first = deployerFor(t, world, dir);
  await first.tick();
  await first.shutdown();
  assert.equal(world.containers.has("delegation-staging-greeter"), false);
  const second = deployerFor(t, world, dir);
  await second.tick();
  assert.equal(world.calls.filter(c => c.startsWith("commit")).length, 1);
  assert.equal(second.status.repositories.greeter.state, "running");
  assert.equal(world.containers.get("delegation-staging-greeter").running, true);
});

test("console API: App column, staging profile edit, delete removes the profile", async (t) => {
  const dir = tempDir(t);
  const staging = new StagingStore(join(dir, "staging"));
  const gitea = {org: "thesis", deleted: [],
    async listRepositories() { return [{owner: "thesis", name: "iam-console-poc", default_branch: "main"}]; },
    async repositoryDetail(name) {
      if (name !== "iam-console-poc") { const e = Error("missing"); e.status = 404; throw e; }
      return {owner: "thesis", name, default_branch: "main", head_sha: SHA1, protected_branches: ["main"]};
    },
    async deleteRepository(name) { this.deleted.push(name); }};
  let handler;
  const server = createServer((req, res) => handler(req, res));
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const port = server.address().port;
  handler = createConsoleHandler({auth: new ConsoleAuth({users: {engineer: hashPassword("correct-horse")}}),
    gitea, store: new ConsoleStore(join(dir, "console")), health: async () => ({}), port, staging});
  const call = (method, path, body, cookie) => fetch(`http://127.0.0.1:${port}${path}`, {method,
    headers: {...(body ? {"content-type": "application/json"} : {}), ...(method === "GET" ? {} : {"x-console-request": "1"}),
      ...(cookie ? {cookie} : {})}, ...(body ? {body: JSON.stringify(body)} : {})});
  const login = await call("POST", "/api/login", {username: "engineer", password: "correct-horse"});
  const cookie = login.headers.get("set-cookie").split(";")[0];
  assert.equal((await call("GET", "/api/repos/iam-console-poc/staging")).status, 401);

  const repos = await (await call("GET", "/api/repos", undefined, cookie)).json();
  assert.equal(repos.staging_available, true);
  assert.equal(repos.repositories[0].staging.enabled, true, "known default seeded");
  assert.equal(staging.profile("iam-console-poc").source, "saved");

  const bad = await call("PUT", "/api/repos/iam-console-poc/staging", {...PROFILE, image: "node:latest"}, cookie);
  assert.equal(bad.status, 400);
  const saved = await (await call("PUT", "/api/repos/iam-console-poc/staging", PROFILE, cookie)).json();
  assert.equal(saved.profile.start, "node server.js");
  assert.equal((await call("PUT", "/api/repos/unknown/staging", PROFILE, cookie)).status, 404);

  assert.equal((await call("DELETE", "/api/repos/iam-console-poc", undefined, cookie)).status, 200);
  assert.equal(staging.profile("iam-console-poc").source, "default", "saved profile removed with the repository");
});

test("deployer: several repositories run side by side, each on its own port and image", async (t) => {
  const dir = tempDir(t), world = fakeWorld();
  const store = new StagingStore(dir);
  store.save("greeter", PROFILE);
  store.save("py-dashboard", {...PROFILE, image: "python:3.12.7-slim", build: "pip install -r requirements.txt",
    start: "python -m flask --app app run --host 0.0.0.0 --port 8000", port: 8000});
  const deployer = deployerFor(t, world, dir);
  await deployer.tick();
  const {greeter, "py-dashboard": py} = deployer.status.repositories;
  assert.equal(greeter.state, "running"); assert.equal(py.state, "running");
  assert.deepEqual([greeter.url, py.url].sort(), ["http://127.0.0.1:8801/", "http://127.0.0.1:8802/"]);
  assert.ok(world.containers.get("delegation-staging-greeter").running);
  assert.ok(world.containers.get("delegation-staging-py-dashboard").running);
  assert.ok(world.calls.some(c => /^create .* python:3\.12\.7-slim sh -c/u.test(c)), "any image/language");
  assert.ok(world.calls.some(c => /-p 127\.0\.0\.1:880[12]:8000/u.test(c)));
  // Removing one leaves the other running.
  store.delete("greeter");
  await deployer.tick();
  assert.equal(world.containers.has("delegation-staging-greeter"), false);
  assert.ok(world.containers.get("delegation-staging-py-dashboard").running);
});
