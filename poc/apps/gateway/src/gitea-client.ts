import {
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

  async #json(url: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "GET",
        headers: {
          authorization: `token ${this.#token}`,
          accept: "application/json"
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
    if (!response.ok) {
      throw new ProviderUnavailableError(`Gitea returned HTTP ${response.status}`);
    }

    try {
      return raw.length === 0 ? {} : JSON.parse(raw);
    } catch {
      throw new ProviderUnavailableError("Gitea returned invalid JSON");
    }
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

  async readTextFile(branch: string, path: string): Promise<GiteaFileSnapshot> {
    // Resolve the branch first and pin the content read to that exact commit SHA.
    // This prevents a moving branch from changing the file between metadata and content reads.
    const branchMetadata = await this.getBranchMetadata(branch);
    const url =
      this.#repoApi(`/contents/${encodePath(path)}`) +
      `?ref=${encodeURIComponent(branchMetadata.commit_sha)}`;
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
      revision: branchMetadata.commit_sha,
      blob_sha: requiredString(body.sha, "file.sha"),
      last_commit_sha:
        typeof body.last_commit_sha === "string" && body.last_commit_sha.length > 0
          ? body.last_commit_sha
          : branchMetadata.commit_sha,
      size,
      content,
      encoding: "utf-8"
    };
  }
}
