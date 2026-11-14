/**
 * Staging ("app di prova"): how ONE repository's merged main is built and
 * served for manual checks, and the deploy state reported by the deployer.
 *
 * The staging profile is chosen by the Engineer in the console (never by an
 * agent or a model) and is NOT part of the agents' authority: it does not
 * enter the signed approval or the OPA policy. Only code that a human merged
 * into the default branch is ever deployed.
 *
 * Shared directory (Compose volume "staging"):
 *   profiles/<repo>.json   written by the console, read by the deployer;
 *   status.json            written by the deployer, read by the console.
 */
import {existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {join} from "node:path";
import {validateRepoName} from "./gitea.mjs";

export const STAGING_PROFILE_VERSION = 1;
const IMAGE = /^[a-z0-9][a-z0-9._/-]{0,150}(?::[A-Za-z0-9][A-Za-z0-9._-]{0,63})?(?:@sha256:[a-f0-9]{64})?$/u;
const STATES = new Set(["building", "starting", "running", "failed", "waiting"]);

const fail = reason => { throw Error("Profilo di staging non valido: " + reason); };
const plain = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).every(k => keys.includes(k));
const command = (value, name) => {
  if (typeof value !== "string" || !value.trim() || value.length > 4000 || /\x00/u.test(value))
    fail(`il comando di ${name} è obbligatorio (al massimo 4000 caratteri)`);
  return value.trim();
};

/** Strict validation; returns the canonical, frozen profile. */
export function validateStagingProfile(raw) {
  if (!plain(raw, ["version", "enabled", "image", "build", "start", "port"])) fail("campi sconosciuti");
  if (raw.version !== STAGING_PROFILE_VERSION) fail("versione non supportata");
  if (typeof raw.enabled !== "boolean") fail("enabled deve essere true o false");
  if (typeof raw.image !== "string" || !IMAGE.test(raw.image) ||
      !(/:[A-Za-z0-9]/u.test(raw.image.split("/").at(-1)) || raw.image.includes("@sha256:")) ||
      /:latest$/u.test(raw.image))
    fail("l'immagine Docker deve avere una versione esplicita (non latest), es. node:22.15.0-bookworm");
  const port = Number(raw.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail("porta non valida (1-65535)");
  return Object.freeze({version: STAGING_PROFILE_VERSION, enabled: raw.enabled, image: raw.image,
    build: command(raw.build, "build"), start: command(raw.start, "avvio"), port});
}

/** Digest of a profile: a change of profile triggers a new deploy. */
export function stagingProfileDigest(profile) {
  const p = validateStagingProfile(profile);
  return createHash("sha256").update(JSON.stringify([p.image, p.build, p.start, p.port])).digest("hex");
}

/** Known default of the example repository (backend + built frontend). */
const DEFAULTS = Object.freeze({
  "iam-console-poc": validateStagingProfile({
    version: 1, enabled: true, image: "node:22.15.0-bookworm",
    // --include=dev: the build tools are devDependencies (also with NODE_ENV=production).
    build: "npm ci --include=dev --no-audit --no-fund && npm run build -w @iam/frontend",
    // Backend on 3000 (internal); the frontend preview proxies /api to it.
    start: "npm run start -w @iam/backend & exec npm run preview -w @iam/frontend -- " +
      "--host 0.0.0.0 --port 5173 --strictPort",
    port: 5173
  })
});
export function defaultStagingProfile(name) { return DEFAULTS[name]; }

/** A deploy-status entry as written by the deployer (sanitised on read). */
function cleanStatus(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const sha = v => typeof v === "string" && /^[a-f0-9]{40}$/u.test(v) ? v : null;
  const text = (v, n) => typeof v === "string" ? v.slice(0, n) : null;
  return {
    state: STATES.has(raw.state) ? raw.state : "waiting",
    live_sha: sha(raw.live_sha), target_sha: sha(raw.target_sha),
    url: typeof raw.url === "string" && /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}\/$/u.test(raw.url) ? raw.url : null,
    message: text(raw.message, 400), log: text(raw.log, 4000),
    updated_at: text(raw.updated_at, 40), deployed_at: text(raw.deployed_at, 40)
  };
}

export class StagingStore {
  #dir;
  /** The deployer opens it with create: false (it runs as root and must
   * not own the folder the console writes to). */
  constructor(directory, {create = true} = {}) {
    this.#dir = directory;
    if (create) mkdirSync(join(directory, "profiles"), {recursive: true});
  }
  get directory() { return this.#dir; }

  #path(name) { return join(this.#dir, "profiles", validateRepoName(name) + ".json"); }

  /** Saved profile, or the known default (not yet saved), or undefined. */
  profile(name) {
    const path = this.#path(name);
    if (existsSync(path)) {
      try { return {profile: this.#read(path).profile, source: "saved"}; }
      catch { return {profile: undefined, source: "invalid"}; }
    }
    const fallback = defaultStagingProfile(name);
    return fallback ? {profile: fallback, source: "default"} : {profile: undefined, source: "none"};
  }

  #read(path) {
    const {saved_at: savedAt, ...raw} = JSON.parse(readFileSync(path, "utf8"));
    return {profile: validateStagingProfile(raw), savedAt: typeof savedAt === "string" ? savedAt : ""};
  }

  /** Saving (even unchanged) is also the Engineer's "try again" after a
   * failed deploy: the deployer retries a profile saved after the failure. */
  save(name, raw) {
    const profile = validateStagingProfile(raw);
    const path = this.#path(name), tmp = path + ".tmp-" + process.pid;
    writeFileSync(tmp, JSON.stringify({...profile, saved_at: new Date().toISOString()}, null, 2) + "\n");
    renameSync(tmp, path);
    return profile;
  }

  /** Write the known default for a repository that has no profile yet. */
  ensureDefault(name) {
    if (!existsSync(this.#path(name)) && defaultStagingProfile(name)) this.save(name, defaultStagingProfile(name));
  }

  delete(name) { const path = this.#path(name); if (existsSync(path)) rmSync(path); }

  /** When a profile was last saved (ISO time), "" if unknown. */
  savedAt(name) {
    try { return this.#read(this.#path(name)).savedAt; } catch { return ""; }
  }

  /** Every saved profile (name -> validated profile, or null when the file
   * is unreadable: the deployer then leaves that app exactly as it is). */
  listProfiles() {
    const out = new Map();
    const dir = join(this.#dir, "profiles");
    if (!existsSync(dir)) return out;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const name = file.slice(0, -5);
      try { validateRepoName(name); } catch { continue; }
      try { out.set(name, this.#read(join(dir, file)).profile); }
      catch { out.set(name, null); }
    }
    return out;
  }

  /** Deploy state of one repository (from the deployer), or undefined. */
  status(name) {
    try {
      const all = JSON.parse(readFileSync(join(this.#dir, "status.json"), "utf8"));
      const entry = cleanStatus(all?.repositories?.[name]);
      if (!entry) return undefined;
      // A deployer that stopped writing is reported as such.
      const age = Date.now() - Date.parse(all.heartbeat_at ?? "");
      return {...entry, deployer_alive: Number.isFinite(age) && age < 60_000};
    } catch { return undefined; }
  }

  /** What the repository table shows. */
  summary(name) {
    const {profile, source} = this.profile(name);
    return {configured: !!profile, enabled: !!profile?.enabled, profile_source: source,
      ...(profile?.enabled ? {status: this.status(name) ?? null} : {})};
  }
}
