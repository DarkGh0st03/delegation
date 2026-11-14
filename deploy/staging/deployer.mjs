/**
 * Staging deployer: a small continuous-deployment loop for the local stack.
 *
 * For every repository with an enabled staging profile it watches the head
 * of the default branch in Gitea (read-only "deployer" account). When main
 * changes (a human merged a pull request) or the profile changes, it:
 *   1. downloads the exact commit archive from Gitea;
 *   2. builds it in a throw-away container (profile "build" command) and
 *      commits the result as image delegation-staging/<repo>:<sha12>;
 *   3. replaces the running app container (profile "start" command) on the
 *      isolated staging network, published on 127.0.0.1:<host port>;
 *   4. waits until the app answers HTTP; if the new version does not start,
 *      the previous version is put back.
 * A failed build never touches the running version.
 *
 * The app containers never receive a token and are not on the
 * infrastructure network: they cannot reach Gitea, OPA or the console.
 */
import {spawn} from "node:child_process";
import {mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {StagingStore, stagingProfileDigest} from "../../poc/engineer-console/src/staging.mjs";

export const CONTAINER_PREFIX = "delegation-staging-";
export const IMAGE_REPOSITORY = "delegation-staging/";
const LABEL = "org.delegation.staging";
const MAX_LOG = 4000;

/** Run a command; resolves {code, stdout, stderr} (output tails capped). */
export function runCommand(command, args, {timeoutMs = 120_000, input} = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, {stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"]});
    let stdout = "", stderr = "", timedOut = false;
    const keep = (current, chunk) => (current + chunk.toString("utf8")).slice(-64_000);
    child.stdout.on("data", c => { stdout = keep(stdout, c); });
    child.stderr.on("data", c => { stderr = keep(stderr, c); });
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.on("error", error => { clearTimeout(timer); resolve({code: 127, stdout, stderr: String(error.message)}); });
    child.on("close", code => { clearTimeout(timer); resolve({code: timedOut ? 124 : (code ?? 1), stdout, stderr, timed_out: timedOut}); });
    if (input !== undefined) child.stdin.end(input);
  });
}

const tail = text => String(text ?? "").replace(/\x1b\[[0-9;]*[A-Za-z]/gu, "").slice(-MAX_LOG);
const shellQuote = value => "'" + String(value).replace(/'/gu, "'\\''") + "'";

export class StagingDeployer {
  #store; #gitea; #docker; #fetch; #now; #log; #bind; #ports; #network; #buildEnv; #extraCa;
  #readyTimeoutMs; #buildTimeoutMs; #status = {repositories: {}}; #busy = false; #sleep;

  constructor({stagingDir, gitea, docker = (args, options) => runCommand("docker", args, options),
    fetchFn = fetch, now = () => new Date(), log = line => process.stdout.write(line + "\n"),
    bindAddress = "127.0.0.1", hostPorts = [8801, 8899], network = "delegation-staging",
    buildEnv = {}, extraCaPath, readyTimeoutMs = 180_000, buildTimeoutMs = 20 * 60_000,
    sleep = ms => new Promise(r => setTimeout(r, ms))}) {
    this.#store = new StagingStore(stagingDir, {create: false});
    this.#gitea = gitea;               // {baseUrl, org, token}
    this.#docker = docker; this.#fetch = fetchFn; this.#now = now; this.#log = log;
    this.#bind = bindAddress; this.#ports = hostPorts; this.#network = network;
    this.#buildEnv = buildEnv; this.#extraCa = extraCaPath;
    this.#readyTimeoutMs = readyTimeoutMs; this.#buildTimeoutMs = buildTimeoutMs; this.#sleep = sleep;
    try {
      const previous = JSON.parse(readFileSync(join(stagingDir, "status.json"), "utf8"));
      if (previous && typeof previous.repositories === "object") this.#status = previous;
    } catch { /* first start */ }
  }

  get status() { return structuredClone(this.#status); }

  #save() {
    this.#status.heartbeat_at = this.#now().toISOString();
    const path = join(this.#store.directory, "status.json"), tmp = path + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.#status, null, 2) + "\n");
    renameSync(tmp, path);
  }

  #set(name, patch) {
    const entry = {...(this.#status.repositories[name] ?? {}), ...patch, updated_at: this.#now().toISOString()};
    this.#status.repositories[name] = entry;
    this.#save();
    return entry;
  }

  async #docker_(args, options) {
    const result = await this.#docker(args, options);
    if (result.code !== 0) {
      const error = Error(`docker ${args[0]} non riuscito: ${tail(result.stderr || result.stdout).slice(-600)}`);
      error.output = tail((result.stdout ?? "") + "\n" + (result.stderr ?? ""));
      throw error;
    }
    return result.stdout.trim();
  }

  async #gitea_(path, {binary = false} = {}) {
    const response = await this.#fetch(this.#gitea.baseUrl + "/api/v1" + path, {
      headers: {authorization: "token " + this.#gitea.token, accept: binary ? "*/*" : "application/json"},
      redirect: "error", signal: AbortSignal.timeout(binary ? 300_000 : 20_000)
    });
    if (response.status === 404) return undefined;
    if (!response.ok) throw Error(`Gitea ${path} -> HTTP ${response.status}`);
    return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
  }

  async #mainSha(name) {
    const base = `/repos/${encodeURIComponent(this.#gitea.org)}/${encodeURIComponent(name)}`;
    const repo = await this.#gitea_(base);
    if (!repo) return undefined;
    const branch = await this.#gitea_(`${base}/branches/${encodeURIComponent(repo.default_branch)}`);
    const sha = branch?.commit?.id;
    return typeof sha === "string" && /^[a-f0-9]{40}$/u.test(sha) ? sha : undefined;
  }

  /** Stable host port per repository, from the configured range. */
  #hostPort(name) {
    const entry = this.#status.repositories[name];
    if (Number.isInteger(entry?.host_port)) return entry.host_port;
    const used = new Set(Object.values(this.#status.repositories).map(e => e.host_port));
    for (let p = this.#ports[0]; p <= this.#ports[1]; p++) if (!used.has(p)) return p;
    throw Error("Nessuna porta libera per lo staging");
  }

  async #containerState(name) {
    const result = await this.#docker(["inspect", "--format",
      "{{.State.Running}} {{index .Config.Labels \"" + LABEL + ".sha\"}}", CONTAINER_PREFIX + name]);
    if (result.code !== 0) return {exists: false, running: false, sha: null};
    const [running, sha] = result.stdout.trim().split(" ");
    return {exists: true, running: running === "true", sha: sha || null};
  }

  async #imageExists(image) {
    return (await this.#docker(["image", "inspect", "--format", "{{.Id}}", image])).code === 0;
  }

  /** One reconciliation pass over every repository. */
  async tick() {
    if (this.#busy) return;
    this.#busy = true;
    try {
      const profiles = this.#store.listProfiles();
      for (const [name, profile] of profiles) {
        if (!profile?.enabled) continue;
        try { await this.#reconcile(name, profile); }
        catch (error) {
          this.#log(`[${name}] ${error.message}`);
          this.#set(name, {state: "failed", message: error.message, log: error.output ?? null});
        }
      }
      // Repositories deleted or staging disabled: stop their app. An
      // unreadable profile changes nothing (never an outage by mistake).
      for (const name of Object.keys(this.#status.repositories)) {
        if (profiles.has(name) && profiles.get(name)?.enabled !== false) continue;
        await this.#remove(name);
      }
      this.#save();
    } finally { this.#busy = false; }
  }

  async #reconcile(name, profile) {
    const sha = await this.#mainSha(name);
    const entry = this.#status.repositories[name] ?? {};
    if (!sha) {
      if (entry.state !== "waiting" || entry.message !== "Repository non trovata in Gitea")
        this.#set(name, {state: "waiting", message: "Repository non trovata in Gitea"});
      return;
    }
    const digest = stagingProfileDigest(profile);
    const container = await this.#containerState(name);
    const upToDate = entry.live_sha === sha && entry.profile_sha256 === digest;
    if (upToDate && container.running && container.sha === sha) return;
    // Do not loop on a version that already failed with this same profile
    // (saving the profile again in the console is the explicit retry).
    const retryRequested = (this.#store.savedAt(name) || "") > (entry.failed_at || "");
    if (entry.failed_sha === sha && entry.failed_profile_sha256 === digest && !retryRequested) {
      if (!container.running && entry.live_image && await this.#imageExists(entry.live_image))
        await this.#run(name, entry.live_image, entry.live_sha, profile);
      return;
    }
    // Same version, container gone (stack restarted): start the built image.
    const image = IMAGE_REPOSITORY + name.toLowerCase() + ":" + sha.slice(0, 12);
    if (upToDate && await this.#imageExists(image)) {
      this.#set(name, {state: "starting", target_sha: sha, message: "Avvio della versione " + sha.slice(0, 7)});
      await this.#run(name, image, sha, profile);
      if (await this.#ready(name, profile))
        this.#set(name, {state: "running", message: "Versione " + sha.slice(0, 7) + " attiva"});
      else this.#set(name, {state: "failed", message: "L'app non risponde", log: await this.#logs(name)});
      return;
    }
    await this.#deploy(name, sha, profile, digest, image);
  }

  async #deploy(name, sha, profile, digest, image) {
    const short = sha.slice(0, 7);
    const entry = this.#set(name, {state: "building", target_sha: sha, log: null,
      message: "Build della versione " + short + " (main aggiornato)"});
    this.#log(`[${name}] build ${short}`);
    const work = mkdtempSync(join(tmpdir(), "staging-"));
    const builder = CONTAINER_PREFIX + "build-" + name.toLowerCase();
    try {
      // 1. Exact commit from Gitea (archive of the merged main).
      const archive = await this.#gitea_(`/repos/${encodeURIComponent(this.#gitea.org)}/` +
        `${encodeURIComponent(name)}/archive/${sha}.tar.gz`, {binary: true});
      if (!archive) throw Error("Archivio del commit non disponibile");
      const src = join(work, "src"); mkdirSync(src);
      writeFileSync(join(work, "source.tar.gz"), archive);
      const untar = await runCommand("tar", ["-xzf", join(work, "source.tar.gz"), "-C", src,
        "--strip-components=1", "--no-same-owner"]);
      if (untar.code !== 0) throw Error("Archivio non valido: " + tail(untar.stderr).slice(-300));

      // 2. Build in a throw-away container, then freeze it as an image.
      await this.#docker(["rm", "-f", builder]);
      const exports = Object.entries(this.#buildEnv).filter(([, v]) => v)
        .map(([k, v]) => `export ${k}=${shellQuote(v)}; `).join("") +
        (this.#extraCa ? "export NODE_EXTRA_CA_CERTS=/tmp/staging-extra-ca.crt; " : "");
      await this.#docker_(["create", "--name", builder, "--label", LABEL + ".build=" + name,
        "--network", "bridge", "--memory", "3g", "--pids-limit", "1024",
        "--security-opt", "no-new-privileges", "-w", "/app", profile.image,
        "sh", "-c", exports + "set -e; " + profile.build], {timeoutMs: 15 * 60_000});
      await this.#docker_(["cp", src + "/.", builder + ":/app"]);
      if (this.#extraCa) await this.#docker_(["cp", this.#extraCa, builder + ":/tmp/staging-extra-ca.crt"]);
      const build = await this.#docker(["start", "-a", builder], {timeoutMs: this.#buildTimeoutMs});
      if (build.code !== 0) {
        const error = Error(build.timed_out ? "Build interrotta: tempo massimo superato"
          : "Build non riuscita (codice " + build.code + ")");
        error.output = tail(build.stdout + "\n" + build.stderr);
        throw error;
      }
      await this.#docker_(["commit",
        "--change", "WORKDIR /app",
        "--change", "CMD " + JSON.stringify(["sh", "-c", profile.start]),
        "--change", `EXPOSE ${profile.port}`,
        "--change", `LABEL ${LABEL}=${name} ${LABEL}.sha=${sha}`,
        builder, image], {timeoutMs: 10 * 60_000});

      // 3. Roll out, 4. readiness; roll back on failure.
      this.#set(name, {state: "starting", message: "Avvio della versione " + short});
      const previous = {image: entry.live_image, sha: entry.live_sha};
      await this.#run(name, image, sha, profile);
      if (await this.#ready(name, profile)) {
        const at = this.#now().toISOString();
        this.#set(name, {state: "running", live_sha: sha, live_image: image, profile_sha256: digest,
          deployed_at: at, failed_sha: null, failed_profile_sha256: null, log: null,
          message: "Versione " + short + " attiva"});
        this.#log(`[${name}] ${short} attiva su ${this.#status.repositories[name].url}`);
        if (previous.image && previous.image !== image) await this.#pruneImages(name, [image, previous.image]);
        return;
      }
      const logs = await this.#logs(name);
      let message = "La versione " + short + " non risponde su HTTP";
      if (previous.image && await this.#imageExists(previous.image)) {
        await this.#run(name, previous.image, previous.sha, profile);
        message += ": ripristinata la versione " + previous.sha.slice(0, 7);
      }
      this.#set(name, {state: "failed", failed_sha: sha, failed_profile_sha256: digest,
        failed_at: this.#now().toISOString(), message, log: logs, ...(previous.image ? {} : {live_sha: null})});
    } catch (error) {
      this.#set(name, {state: "failed", failed_sha: sha, failed_profile_sha256: digest,
        failed_at: this.#now().toISOString(), message: error.message, log: error.output ?? null});
      this.#log(`[${name}] ${error.message}`);
      // The running version (if any) is untouched by a failed build.
      const live = this.#status.repositories[name];
      if (live.live_sha) this.#status.repositories[name].message =
        error.message + ": resta attiva la versione " + live.live_sha.slice(0, 7);
      this.#save();
    } finally {
      await this.#docker(["rm", "-f", builder]);
      rmSync(work, {recursive: true, force: true});
    }
  }

  /** (Re)start the app container of a repository from an image. */
  async #run(name, image, sha, profile) {
    const hostPort = this.#hostPort(name);
    await this.#docker(["rm", "-f", CONTAINER_PREFIX + name]);
    await this.#docker_(["run", "-d", "--name", CONTAINER_PREFIX + name,
      "--label", `${LABEL}=${name}`, "--label", `${LABEL}.sha=${sha}`,
      "--network", this.#network, "--restart", "unless-stopped",
      "--memory", "1g", "--pids-limit", "512", "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges",
      "-p", `${this.#bind}:${hostPort}:${profile.port}`, image]);
    this.#set(name, {host_port: hostPort, url: `http://127.0.0.1:${hostPort}/`});
  }

  /** The app answers HTTP (any status) on its port, on the staging network. */
  async #ready(name, profile) {
    const deadline = Date.now() + this.#readyTimeoutMs;
    while (Date.now() < deadline) {
      try {
        await this.#fetch(`http://${CONTAINER_PREFIX + name}:${profile.port}/`,
          {redirect: "manual", signal: AbortSignal.timeout(3000)});
        return true;
      } catch { /* not yet */ }
      const state = await this.#containerState(name);
      if (!state.running) return false;
      await this.#sleep(1500);
    }
    return false;
  }

  async #logs(name) {
    const result = await this.#docker(["logs", "--tail", "60", CONTAINER_PREFIX + name]);
    return tail(result.stdout + "\n" + result.stderr);
  }

  async #pruneImages(name, keep) {
    const result = await this.#docker(["image", "ls", "--format", "{{.Repository}}:{{.Tag}}",
      IMAGE_REPOSITORY + name.toLowerCase()]);
    for (const image of result.stdout.split("\n").map(s => s.trim()).filter(Boolean))
      if (!keep.includes(image)) await this.#docker(["image", "rm", image]);
  }

  async #remove(name) {
    await this.#docker(["rm", "-f", CONTAINER_PREFIX + name]);
    await this.#pruneImages(name, []);
    delete this.#status.repositories[name];
    this.#log(`[${name}] staging rimosso`);
  }

  /** Stack shutdown: stop the app containers (the staging network goes away
   * with the stack); images stay, so the next start needs no rebuild. */
  async shutdown() {
    for (const name of Object.keys(this.#status.repositories)) {
      await this.#docker(["rm", "-f", CONTAINER_PREFIX + name]);
      await this.#docker(["rm", "-f", CONTAINER_PREFIX + "build-" + name.toLowerCase()]);
    }
    this.#save();
  }
}
