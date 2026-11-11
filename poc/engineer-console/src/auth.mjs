/**
 * Local Engineer authentication for the console.
 *
 * Users live in a gitignored JSON file (mode 0600) holding only scrypt
 * hashes. Sessions are random opaque tokens kept in memory; they never
 * carry authority to sign or issue credentials by themselves.
 */
import {randomBytes, scryptSync, timingSafeEqual} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync} from "node:fs";
import {dirname} from "node:path";

const SCRYPT = Object.freeze({N: 16384, r: 8, p: 1, keylen: 64});
const USERNAME = /^[a-z][a-z0-9._-]{2,31}$/u;
export const SESSION_COOKIE = "engineer_console_session";

export function hashPassword(password, salt = randomBytes(16)) {
  if (typeof password !== "string" || password.length < 8 || password.length > 256)
    throw Error("Password must be 8-256 characters");
  const hash = scryptSync(password, salt, SCRYPT.keylen,
    {N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p});
  return {salt: salt.toString("hex"), hash: hash.toString("hex"),
    params: {...SCRYPT}};
}

export function validateUsername(username) {
  if (typeof username !== "string" || !USERNAME.test(username))
    throw Error("Username must be 3-32 chars: lowercase letters, digits, . _ -");
  return username;
}

export function writeUserFile(path, users) {
  mkdirSync(dirname(path), {recursive: true, mode: 0o700});
  writeFileSync(path, JSON.stringify({version: 1, users}, null, 2) + "\n",
    {mode: 0o600});
  chmodSync(path, 0o600);
}

export function readUserFile(path) {
  if (!existsSync(path)) return {};
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!parsed || parsed.version !== 1 || typeof parsed.users !== "object")
    throw Error("Invalid console user file");
  return parsed.users;
}

export class ConsoleAuth {
  #users; #sessions = new Map(); #failures = new Map();
  #ttlMs; #now;

  constructor({users, ttlMs = 8 * 3600_000, now = Date.now}) {
    this.#users = users ?? {};
    this.#ttlMs = ttlMs;
    this.#now = now;
  }

  get hasUsers() { return Object.keys(this.#users).length > 0; }

  /** Returns a session token, or throws a generic error. */
  login(username, password) {
    const key = typeof username === "string" ? username : "";
    const failure = this.#failures.get(key);
    if (failure && failure.lockedUntil > this.#now())
      throw Error("Too many attempts: retry later");
    const record = Object.hasOwn(this.#users, key) ? this.#users[key] : undefined;
    // Always run scrypt, even for unknown users, to avoid a timing oracle.
    const salt = Buffer.from(record?.salt ?? "00".repeat(16), "hex");
    let candidate;
    try {
      candidate = scryptSync(typeof password === "string" ? password : "", salt,
        SCRYPT.keylen, {N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p});
    } catch {
      candidate = Buffer.alloc(SCRYPT.keylen);
    }
    const expected = Buffer.from(record?.hash ?? "00".repeat(SCRYPT.keylen), "hex");
    const ok = !!record && expected.length === candidate.length &&
      timingSafeEqual(expected, candidate);
    if (!ok) {
      const count = (failure?.count ?? 0) + 1;
      this.#failures.set(key, {count,
        lockedUntil: count >= 5 ? this.#now() + 30_000 : 0});
      throw Error("Invalid username or password");
    }
    this.#failures.delete(key);
    const token = randomBytes(32).toString("base64url");
    this.#sessions.set(token, {username: key, expiresAt: this.#now() + this.#ttlMs});
    return token;
  }

  /** Returns the username for a live session token, or undefined. */
  verify(token) {
    if (typeof token !== "string" || !token) return undefined;
    const session = this.#sessions.get(token);
    if (!session) return undefined;
    if (session.expiresAt <= this.#now()) {
      this.#sessions.delete(token);
      return undefined;
    }
    return session.username;
  }

  logout(token) { this.#sessions.delete(token); }
}

export function sessionTokenFromCookie(header) {
  if (typeof header !== "string") return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=");
  }
  return undefined;
}
