/**
 * Durable console state in the gitignored runtime directory: per-repository
 * policy parameters and Engineer requirement drafts. Plain JSON files with
 * owner-only permissions; no credentials are stored here.
 */
import {randomUUID} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync} from "node:fs";
import {join} from "node:path";

const ID = /^[a-z0-9-]{1,64}$/u;

export class ConsoleStore {
  #dir;
  constructor(directory) {
    this.#dir = directory;
    mkdirSync(join(directory, "policies"), {recursive: true, mode: 0o700});
    mkdirSync(join(directory, "requests"), {recursive: true, mode: 0o700});
  }

  #write(path, value) {
    const tmp = path + ".tmp-" + process.pid;
    writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", {mode: 0o600});
    renameSync(tmp, path);
  }

  #policyPath(owner, name) {
    return join(this.#dir, "policies", `${owner}__${name}.json`);
  }

  loadPolicy(owner, name) {
    const path = this.#policyPath(owner, name);
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
  }

  /** All saved policies (metadata stripped), for publication to OPA. */
  listPolicies() {
    return readdirSync(join(this.#dir, "policies"))
      .filter(f => f.endsWith(".json"))
      .map(f => {
        const {saved_at: _ignored, ...policy} =
          JSON.parse(readFileSync(join(this.#dir, "policies", f), "utf8"));
        return policy;
      })
      .sort((a, b) => `${a.repository.owner}/${a.repository.name}`
        .localeCompare(`${b.repository.owner}/${b.repository.name}`));
  }

  savePolicy(policy) {
    const {owner, name} = policy.repository;
    this.#write(this.#policyPath(owner, name), {...policy, saved_at: new Date().toISOString()});
  }

  createRequest({repository, baseSha, requirement, username}) {
    const id = randomUUID();
    const request = {
      id, status: "draft", created_at: new Date().toISOString(), created_by: username,
      repository, base_sha: baseSha, requirement
    };
    this.#write(join(this.#dir, "requests", id + ".json"), request);
    return request;
  }

  listRequests() {
    return readdirSync(join(this.#dir, "requests"))
      .filter(f => f.endsWith(".json"))
      .map(f => JSON.parse(readFileSync(join(this.#dir, "requests", f), "utf8")))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  getRequest(id) {
    if (!ID.test(id)) return undefined;
    const path = join(this.#dir, "requests", id + ".json");
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
  }
}
