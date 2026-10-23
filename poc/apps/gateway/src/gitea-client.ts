import {
  ProviderConflictError,
  ProviderNotFoundError,
  ProviderUnavailableError
} from "./errors.ts";

type FetchLike = typeof fetch;
type JsonObject = Record<string, unknown>;

export interface GiteaClientConfig {
  baseUrl: string;
  token: string;
  owner: string;
  repository: string;
  timeoutMs?: number;
  fetchFn?: FetchLike;
}

export interface GiteaRepositoryMetadata {
  full_name: string;
  default_branch: string;
  object_format_name?: string;
}

export interface GiteaBranchMetadata {
  name: string;
  commit_sha: string;
}

export interface GiteaFileSnapshot {
  path: string;
  branch: string;
  revision: string;
  blob_sha: string;
  last_commit_sha: string;
  size: number;
  content: string;
  encoding: "utf-8";
}

export interface GiteaRepositorySnapshot extends GiteaRepositoryMetadata {
  revision: string;
}

export interface GiteaDirectoryEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
}

export interface GiteaDirectorySnapshot {
  branch: string;
  path: string;
  revision: string;
  entries: GiteaDirectoryEntry[];
}

export interface GiteaCreatedBranch {
  name: string;
  base_branch: string;
  base_revision: string;
  commit_sha: string;
}

export interface GiteaFileMutation {
  path: string;
  branch: string;
  revision: string;
  commit_sha: string;
  blob_sha: string;
  previous_revision?: string;
  precondition_blob_sha?: string;
}

export interface GiteaCreatedPullRequest {
  id: number;
  number: number;
  url?: string;
  head_branch: string;
  base_branch: string;
  head_revision: string;
}

function object(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProviderUnavailableError(`${label} is not an object`);
  }
  return value as JsonObject;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ProviderUnavailableError(`Gitea response is missing ${label}`);
  }
  return value;
}

function requiredSafeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ProviderUnavailableError(`Gitea response is missing valid ${label}`);
  }
  return value;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export class GiteaClient {
  readonly #baseUrl: string;
  readonly #token: string;
  readonly #owner: string;
  readonly #repository: string;
  readonly #timeoutMs: number;
  readonly #fetch: FetchLike;

  constructor(config: GiteaClientConfig) {
    if (config.baseUrl.trim().length === 0) throw new Error("Gitea base URL cannot be empty");
    if (config.token.trim().length === 0) throw new Error("Gitea token cannot be empty");
    if (config.owner.trim().length === 0) throw new Error("Gitea owner cannot be empty");
    if (config.repository.trim().length === 0) throw new Error("Gitea repository cannot be empty");

    this.#baseUrl = config.baseUrl.replace(/\/+$/u, "");
    this.#token = config.token;
    this.#owner = config.owner;
    this.#repository = config.repository;
    this.#timeoutMs = config.timeoutMs ?? 3_000;
    this.#fetch = config.fetchFn ?? fetch;
  }

  #repoApi(suffix = ""): string {
    return `${this.#baseUrl}/api/v1/repos/${encodeURIComponent(this.#owner)}/${encodeURIComponent(this.#repository)}${suffix}`;
  }

  async #requestJson(url: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(url, {
        ...init,
        headers: {
          authorization: `token ${this.#token}`,
          accept: "application/json",
          ...(init.headers as Record<string, string> | undefined)
        },
        signal: AbortSignal.timeout(this.#timeoutMs)
      });
    } catch (error) {
      throw new ProviderUnavailableError(
        `Gitea request failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const raw = await response.text();
    if (response.status === 404) {
      throw new ProviderNotFoundError("Requested Gitea repository resource was not found");
    }
    if (response.status === 409 || response.status === 422) {
      throw new ProviderConflictError(
        "Gitea rejected the operation because the repository state conflicts"
      );
    }
    if (!response.ok) {
      throw new ProviderUnavailableError(`Gitea returned HTTP ${response.status}`);
    }

    try {
      return raw.length === 0 ? {} : JSON.parse(raw);
    } catch {
      throw new ProviderUnavailableError("Gitea returned invalid JSON");
    }
  }

  async #json(url: string): Promise<unknown> {
    return this.#requestJson(url, { method: "GET" });
  }

  async getRepositoryMetadata(): Promise<GiteaRepositoryMetadata> {
    const body = object(await this.#json(this.#repoApi()), "Gitea repository response");
    const owner = object(body.owner, "Gitea repository owner");
    const ownerLogin = requiredString(owner.login, "owner.login");
    const name = requiredString(body.name, "name");

    if (ownerLogin !== this.#owner || name !== this.#repository) {
      throw new ProviderUnavailableError("Gitea repository identity does not match Gateway configuration");
    }

    return {
      full_name:
        typeof body.full_name === "string" && body.full_name.length > 0
          ? body.full_name
          : `${ownerLogin}/${name}`,
      default_branch: requiredString(body.default_branch, "default_branch"),
      ...(typeof body.object_format_name === "string"
        ? { object_format_name: body.object_format_name }
        : {})
    };
  }

  async getBranchMetadata(branch: string): Promise<GiteaBranchMetadata> {
    const body = object(
      await this.#json(this.#repoApi(`/branches/${encodeURIComponent(branch)}`)),
      "Gitea branch response"
    );
    const commit = object(body.commit, "Gitea branch commit");
    const returnedName = requiredString(body.name, "branch.name");
    if (returnedName !== branch) {
      throw new ProviderUnavailableError("Gitea returned an unexpected branch");
    }
    return {
      name: returnedName,
      commit_sha: requiredString(commit.id, "branch.commit.id")
    };
  }

  async readRepository(pinnedRevision?: string): Promise<GiteaRepositorySnapshot> {
    const metadata = await this.getRepositoryMetadata();
    if (pinnedRevision !== undefined) {
      this.#validatePinnedRevision(pinnedRevision);
      return {...metadata, revision:pinnedRevision};
    }
    const pinned = await this.getBranchMetadata(metadata.default_branch);
    return {...metadata, revision: pinned.commit_sha};
  }

  #validatePinnedRevision(revision: string): void {
    if (!/^[a-f0-9]{40}$/u.test(revision)) {
      throw new ProviderUnavailableError("Pinned Gitea revision must be an exact 40-character SHA");
    }
  }

  async listDirectory(
    branch: string, path: string, pinnedRevision?: string
  ): Promise<GiteaDirectorySnapshot> {
    // A trusted Planning session supplies one immutable revision. In ordinary
    // legacy execution, preserve existing per-operation branch pinning.
    if (pinnedRevision !== undefined) this.#validatePinnedRevision(pinnedRevision);
    const revision = pinnedRevision ?? (await this.getBranchMetadata(branch)).commit_sha;
    const suffix = path === ""
      ? "/contents"
      : `/contents/${encodePath(path)}`;
    const raw = await this.#json(
      this.#repoApi(suffix) + `?ref=${encodeURIComponent(revision)}`
    );
    if (!Array.isArray(raw) || raw.length > 200) {
      throw new ProviderUnavailableError(
        "Gitea directory listing is malformed or exceeds the 200-entry limit"
      );
    }
    const entries: GiteaDirectoryEntry[] = [];
    const seen = new Set<string>();
    for (const element of raw) {
      const item = object(element, "Gitea directory entry");
      const name = requiredString(item.name, "directory_entry.name");
      const returnedPath = requiredString(item.path, "directory_entry.path");
      const expectedPath = path === "" ? name : `${path}/${name}`;
      if (name === "." || name === ".." ||
          /[\\/\x00-\x1f\x7f]/u.test(name) ||
          returnedPath !== expectedPath || seen.has(name)) {
        throw new ProviderUnavailableError(
          "Gitea returned an unexpected directory entry or path"
        );
      }
      seen.add(name);
      if (item.type !== "dir" && item.type !== "file") {
        // Symlinks/submodules may need additional explicit controls; do not
        // dereference or expose them as ordinary files or directories.
        throw new ProviderUnavailableError("Gitea returned an unsupported entry type");
      }
      const entry: GiteaDirectoryEntry = {
        name,
        path: returnedPath,
        type: item.type
      };
      if (item.type === "file") {
        entry.size = requiredSafeInteger(item.size, "directory_entry.size");
      }
      entries.push(entry);
    }
    entries.sort((a,b)=>a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    return {branch, path, revision, entries};
  }

  async createBranch(baseBranch: string, branch: string): Promise<GiteaCreatedBranch> {
    const base = await this.getBranchMetadata(baseBranch);
    const body = object(
      await this.#requestJson(this.#repoApi("/branches"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          new_branch_name: branch,
          old_branch_name: baseBranch
        })
      }),
      "Gitea create branch response"
    );

    const returnedName = requiredString(body.name, "branch.name");
    if (returnedName !== branch) {
      throw new ProviderUnavailableError("Gitea returned an unexpected created branch");
    }

    const commit = object(body.commit, "Gitea created branch commit");
    const commitSha = requiredString(commit.id, "branch.commit.id");
    if (commitSha !== base.commit_sha) {
      throw new ProviderUnavailableError(
        "Created Gitea branch does not point to the requested base revision"
      );
    }

    return {
      name: returnedName,
      base_branch: baseBranch,
      base_revision: base.commit_sha,
      commit_sha: commitSha
    };
  }

  async createPullRequest(
    headBranch: string,
    baseBranch: string,
    title: string,
    body?: string,
    expectedHeadSha?:string
  ): Promise<GiteaCreatedPullRequest> {
    if(expectedHeadSha!==undefined&&
       !/^[a-f0-9]{40}$/u.test(expectedHeadSha)){
      throw new ProviderConflictError(
        "Exact tested PR head SHA is invalid");
    }
    const headMetadata = await this.getBranchMetadata(headBranch);
    // This check MUST precede POST /pulls: a changed feature head cannot
    // open an approved PR on a revision that never passed acceptance.
    if(expectedHeadSha!==undefined&&
       headMetadata.commit_sha!==expectedHeadSha){
      throw new ProviderConflictError(
        "PR feature head changed after exact-SHA Runner acceptance");
    }
    const response = object(
      await this.#requestJson(this.#repoApi("/pulls"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          head: headBranch,
          base: baseBranch,
          title,
          ...(body === undefined ? {} : { body })
        })
      }),
      "Gitea create pull request response"
    );

    const head = object(response.head, "Gitea pull request head");
    const base = object(response.base, "Gitea pull request base");
    const returnedHead = requiredString(head.ref, "pull_request.head.ref");
    const returnedBase = requiredString(base.ref, "pull_request.base.ref");
    if (returnedHead !== headBranch || returnedBase !== baseBranch) {
      throw new ProviderUnavailableError(
        "Gitea returned an unexpected pull request branch direction"
      );
    }

    const returnedHeadSha =
      typeof head.sha === "string" && head.sha.trim().length > 0
        ? head.sha
        : headMetadata.commit_sha;
    if (returnedHeadSha !== headMetadata.commit_sha ||
        (expectedHeadSha!==undefined&&(
          typeof head.sha!=="string"||head.sha!==expectedHeadSha))) {
      // Gitea does not expose an atomic compare-and-create PR API. A branch
      // race AFTER the preflight is detected here, but POST may have created
      // a PR; never treat that PR as an attested successful handoff.
      throw new ProviderUnavailableError(
        "Gitea PR head revision differs from exact tested feature SHA"
      );
    }

    const url =
      typeof response.html_url === "string" && response.html_url.trim().length > 0
        ? response.html_url
        : undefined;

    return {
      id: requiredSafeInteger(response.id, "pull_request.id"),
      number: requiredSafeInteger(response.number, "pull_request.number"),
      ...(url === undefined ? {} : { url }),
      head_branch: returnedHead,
      base_branch: returnedBase,
      head_revision: returnedHeadSha
    };
  }

  async createFile(
    branch: string,
    path: string,
    content: string,
    message: string
  ): Promise<GiteaFileMutation> {
    const body = object(
      await this.#requestJson(this.#repoApi(`/contents/${encodePath(path)}`), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          branch,
          content: Buffer.from(content, "utf8").toString("base64"),
          message
        })
      }),
      "Gitea create file response"
    );

    return this.#parseFileMutation(body, branch, path);
  }

  async updateFile(
    branch: string,
    path: string,
    content: string,
    message: string
  ): Promise<GiteaFileMutation> {
    // Resolve the current file first and pass its exact blob SHA back to Gitea.
    // If the file changes before the write is committed, Gitea rejects the stale SHA.
    const snapshot = await this.readTextFile(branch, path);
    const body = object(
      await this.#requestJson(this.#repoApi(`/contents/${encodePath(path)}`), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          branch,
          content: Buffer.from(content, "utf8").toString("base64"),
          message,
          sha: snapshot.blob_sha
        })
      }),
      "Gitea update file response"
    );

    return {
      ...this.#parseFileMutation(body, branch, path),
      previous_revision: snapshot.revision,
      precondition_blob_sha: snapshot.blob_sha
    };
  }

  #parseFileMutation(body: JsonObject, branch: string, path: string): GiteaFileMutation {
    const content = object(body.content, "Gitea file mutation content");
    const commit = object(body.commit, "Gitea file mutation commit");
    const returnedPath = requiredString(content.path, "content.path");
    if (returnedPath !== path) {
      throw new ProviderUnavailableError("Gitea returned an unexpected mutated file path");
    }

    const commitSha =
      typeof commit.sha === "string" && commit.sha.trim().length > 0
        ? commit.sha
        : requiredString(commit.id, "commit.sha");

    return {
      path,
      branch,
      revision: commitSha,
      commit_sha: commitSha,
      blob_sha: requiredString(content.sha, "content.sha")
    };
  }

  async readTextFile(
    branch: string, path: string, pinnedRevision?: string
  ): Promise<GiteaFileSnapshot> {
    // Planning reads use the exact trusted session SHA. Legacy calls resolve
    // the branch per operation for backwards-compatible update-file preflights.
    if (pinnedRevision !== undefined) this.#validatePinnedRevision(pinnedRevision);
    const revision = pinnedRevision ?? (await this.getBranchMetadata(branch)).commit_sha;
    const url =
      this.#repoApi(`/contents/${encodePath(path)}`) +
      `?ref=${encodeURIComponent(revision)}`;
    const body = object(await this.#json(url), "Gitea contents response");

    if (body.type !== "file") {
      throw new ProviderUnavailableError("Requested repository path is not a regular file");
    }
    const returnedPath = requiredString(body.path, "file.path");
    if (returnedPath !== path) {
      throw new ProviderUnavailableError("Gitea returned an unexpected file path");
    }

    const encoding = requiredString(body.encoding, "file.encoding");
    if (encoding.toLowerCase() !== "base64") {
      throw new ProviderUnavailableError(`Unsupported Gitea file encoding: ${encoding}`);
    }

    const encoded = requiredString(body.content, "file.content").replace(/\s+/gu, "");
    let bytes: Buffer;
    try {
      bytes = Buffer.from(encoded, "base64");
    } catch {
      throw new ProviderUnavailableError("Gitea returned invalid base64 file content");
    }
    if (bytes.length > 2_000_000) {
      throw new ProviderUnavailableError("Gitea file exceeds the 2 MiB Gateway read limit");
    }
    if (bytes.includes(0)) {
      throw new ProviderUnavailableError("Binary files are not supported by read_file");
    }

    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new ProviderUnavailableError("Repository file is not valid UTF-8 text");
    }

    const size =
      typeof body.size === "number" && Number.isSafeInteger(body.size) && body.size >= 0
        ? body.size
        : bytes.length;

    return {
      path,
      branch,
      revision,
      blob_sha: requiredString(body.sha, "file.sha"),
      last_commit_sha:
        typeof body.last_commit_sha === "string" && body.last_commit_sha.length > 0
          ? body.last_commit_sha
          : revision,
      size,
      content,
      encoding: "utf-8"
    };
  }
}
