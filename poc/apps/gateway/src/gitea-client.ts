import {createHash} from "node:crypto";
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
  /** The repository's base (default) branch; owner-pinned, default "main".
   * Agents never write it: they work only on feature/ branches. */
  baseBranch?: string;
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

/** A commit moved onto the signed feature branch via an atomic old-HEAD CAS. */
export interface GiteaHeadCasFileMutation extends GiteaFileMutation {
  previous_head_sha:string;
  previous_blob_sha:string;
  staging_branch:string;
  next_content_sha256:string;
}
/** R383.2 — CAS-created file; absence, unlike update_file, has no old blob. */
export interface GiteaHeadCasCreatedFile extends GiteaFileMutation {
  previous_head_sha:string;
  staging_branch:string;
  next_content_sha256:string;
  old_path_absent_at_pinned_head:true;
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
  readonly #baseBranch: string;
  readonly #timeoutMs: number;
  readonly #fetch: FetchLike;

  /** Static, class-private identity proof: caller-provided repository
   * labels and overridable metadata methods cannot impersonate the Gitea
   * client actually provisioned by the trusted Gateway owner. */
  static isPinnedRepositoryClient(value: unknown,
    owner: string, repository: string): value is GiteaClient {
    return value instanceof GiteaClient && #owner in value &&
      value.#owner === owner && value.#repository === repository;
  }

  constructor(config: GiteaClientConfig) {
    if (config.baseUrl.trim().length === 0) throw new Error("Gitea base URL cannot be empty");
    if (config.token.trim().length === 0) throw new Error("Gitea token cannot be empty");
    if (config.owner.trim().length === 0) throw new Error("Gitea owner cannot be empty");
    if (config.repository.trim().length === 0) throw new Error("Gitea repository cannot be empty");

    this.#baseUrl = config.baseUrl.replace(/\/+$/u, "");
    this.#token = config.token;
    this.#owner = config.owner;
    this.#repository = config.repository;
    const baseBranch = config.baseBranch ?? "main";
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/u.test(baseBranch) || baseBranch.startsWith("feature/") ||
        baseBranch.includes("..") || baseBranch.includes("//") || baseBranch.endsWith("/") ||
        baseBranch.endsWith(".lock"))
      throw new Error("Gitea base branch must be a safe branch name outside feature/");
    this.#baseBranch = baseBranch;
    this.#timeoutMs = config.timeoutMs ?? 3_000;
    this.#fetch = config.fetchFn ?? fetch;
  }

  /** Owner-pinned base branch of the repository. */
  get baseBranch(): string { return this.#baseBranch; }

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

  /** Create only at the Engineer-pinned main revision, never a moving ref. */
  async createPinnedBranch(baseBranch:string,branch:string,expectedBaseSha:string):Promise<GiteaCreatedBranch>{
    if(baseBranch!==this.#baseBranch||!/^feature\/[a-z0-9][a-z0-9./_-]*$/u.test(branch)||
       branch.includes("..")||branch.includes("//")||branch.endsWith(".lock")||
       branch.endsWith("/")||branch.endsWith(".")||branch.length>100||
       !/^[a-f0-9]{40}$/u.test(expectedBaseSha))
      throw new ProviderUnavailableError("Invalid pinned branch context");
    const base=await this.getBranchMetadata(baseBranch);
    if(base.commit_sha!==expectedBaseSha)
      throw new ProviderConflictError("Approved main revision changed before branch creation");
    try{
      await this.getBranchMetadata(branch);
      throw new ProviderConflictError("Approved feature branch already exists");
    }catch(error){if(!(error instanceof ProviderNotFoundError))throw error;}
    const body=object(await this.#requestJson(this.#repoApi("/branches"),{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({new_branch_name:branch,old_ref_name:expectedBaseSha})
    }),"Gitea pinned branch response");
    if(requiredString(body.name,"branch.name")!==branch||
       requiredString(object(body.commit,"branch.commit").id,"branch.commit.id")!==expectedBaseSha)
      throw new ProviderUnavailableError("Created branch differs from approved revision");
    await this.inspectPinnedBranch(baseBranch,branch,expectedBaseSha);
    return {name:branch,base_branch:baseBranch,base_revision:expectedBaseSha,commit_sha:expectedBaseSha};
  }
  async inspectPinnedBranch(baseBranch:string,branch:string,expectedBaseSha:string){
    if(baseBranch!==this.#baseBranch||!branch.startsWith("feature/")||!/^[a-f0-9]{40}$/u.test(expectedBaseSha))
      throw new ProviderUnavailableError("Invalid branch observation context");
    const base=await this.getBranchMetadata(baseBranch);
    const created=await this.getBranchMetadata(branch);
    const fresh=await this.getBranchMetadata(baseBranch);
    if(base.commit_sha!==expectedBaseSha||fresh.commit_sha!==expectedBaseSha||
       created.commit_sha!==expectedBaseSha)
      throw new ProviderConflictError("Independent branch or main revision changed");
    return Object.freeze({name:branch,base_branch:baseBranch,base_revision:expectedBaseSha,commit_sha:expectedBaseSha});
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

  /**
   * R143 owner-side review-only creation in a disposable or explicitly
   * approved repository. This is NOT a Rust DC capability, nor may a
   * signed Test PASS or local Coordinator phase call it automatically.
   *
   * Gitea does not offer atomic HEAD compare-and-create for PRs.
   * Detect all observable races; an uncertain POST is never retried.
   */
  async createDraftPullRequest(
    headBranch:string,baseBranch:string,title:string,
    expectedHeadSha:string,body?:string
  ):Promise<Readonly<GiteaCreatedPullRequest&{
    draft:true;open:true;merged:false;base_revision:string
  }>>{
    if(typeof headBranch!=="string"||
       !/^feature\/[A-Za-z0-9][A-Za-z0-9._/-]{0,180}$/u.test(headBranch)||
       headBranch.includes("..")||headBranch.includes("//")||
       typeof baseBranch!=="string"||
       !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,180}$/u.test(baseBranch)||
       baseBranch.includes("..")||baseBranch.includes("//")||
       headBranch===baseBranch||
       typeof title!=="string"||!title.trim()||title.length>160||
       typeof expectedHeadSha!=="string"||
       !/^[a-f0-9]{40}$/u.test(expectedHeadSha)||
       (body!==undefined&&
         (typeof body!=="string"||body.length>4096)))
      throw new ProviderConflictError("Invalid explicitly scoped draft PR request");
    // Gitea's CreatePullRequestOption has no writable draft field.
    // A configured WIP title prefix is what makes the SERVER return
    // draft:true and prevents accidental merge. This is not cosmetic:
    // never weaken the independent created/GET draft=true checks below.
    const draftTitle=/^(?:WIP:|\[WIP\])(?:\s|$)/iu.test(title)
      ?title:"WIP: "+title;
    if(draftTitle.length>160)
      throw new ProviderConflictError("Draft PR WIP title exceeds limit");
    const head=await this.getBranchMetadata(headBranch);
    if(head.commit_sha!==expectedHeadSha)
      throw new ProviderConflictError("Draft PR Gitea HEAD differs from accepted SHA");
    const base=await this.getBranchMetadata(baseBranch);
    if(!/^[a-f0-9]{40}$/u.test(base.commit_sha))
      throw new ProviderUnavailableError("Gitea base branch SHA is not immutable");
    // This is a ONE-SHOT POST with draft:true; no retries after ambiguous
    // network status. Any later mismatch is an untrusted orphan for review.
    const created=object(await this.#requestJson(this.#repoApi("/pulls"),{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({
        head:headBranch,base:baseBranch,title:draftTitle,body:body??""
      })
    }),"Gitea draft PR response");
    const number=requiredSafeInteger(created.number,"pull_request.number");
    if(number<1)
      throw new ProviderUnavailableError("Gitea returned invalid draft PR number");
    const assertDraft=(raw:unknown,label:string)=>{
      const p=object(raw,label);
      const h=object(p.head,"Gitea PR head");
      const b=object(p.base,"Gitea PR base");
      if(p.number!==number||p.state!=="open"||
         p.merged!==false||p.draft!==true||
         h.ref!==headBranch||h.sha!==expectedHeadSha||
         b.ref!==baseBranch||
         (typeof b.sha==="string"&&b.sha!==base.commit_sha))
        throw new ProviderUnavailableError(
         "Gitea draft PR is not open, unmerged or pinned to accepted SHA");
      return p;
    };
    assertDraft(created,"Gitea created draft PR");
    const confirmed=assertDraft(
      await this.#json(this.#repoApi("/pulls/"+number)),
      "Gitea confirmed draft PR"
    );
    const after=await this.getBranchMetadata(headBranch);
    const afterBase=await this.getBranchMetadata(baseBranch);
    if(after.commit_sha!==expectedHeadSha||
       afterBase.commit_sha!==base.commit_sha)
      throw new ProviderUnavailableError(
       "Gitea head or base branch moved after draft PR creation");
    const url=typeof confirmed.html_url==="string"&&confirmed.html_url.trim()
      ?confirmed.html_url:undefined;
    return Object.freeze({
      id:requiredSafeInteger(confirmed.id,"pull_request.id"),
      number,
      ...(url?{url}:{}),
      head_branch:headBranch,base_branch:baseBranch,
      head_revision:expectedHeadSha,
      draft:true as const,open:true as const,merged:false as const,
      base_revision:base.commit_sha
    });
  }

  /** Read-only independent confirmation of an already-created exact Draft PR. */
  async inspectDraftPullRequest(input:{number:number;headBranch:string;baseBranch:string;
    expectedHeadSha:string;expectedBaseSha:string}):Promise<Readonly<GiteaCreatedPullRequest&{
      draft:true;open:true;merged:false;base_revision:string
    }>>{
    if(!input||!Number.isSafeInteger(input.number)||input.number<1||
       !/^feature\/[A-Za-z0-9][A-Za-z0-9._/-]{0,180}$/u.test(input.headBranch)||
       input.headBranch.includes("..")||input.headBranch.includes("//")||
       input.baseBranch!==this.#baseBranch||
       !/^[a-f0-9]{40}$/u.test(input.expectedHeadSha)||
       !/^[a-f0-9]{40}$/u.test(input.expectedBaseSha))
      throw new ProviderConflictError("Invalid exact Draft PR observation request");
    const head=await this.getBranchMetadata(input.headBranch);
    const base=await this.getBranchMetadata(input.baseBranch);
    if(head.commit_sha!==input.expectedHeadSha||base.commit_sha!==input.expectedBaseSha)
      throw new ProviderConflictError("Observed PR head or base differs from original accepted SHA");
    const pr=object(await this.#json(this.#repoApi("/pulls/"+input.number)),"Observed Draft PR");
    const h=object(pr.head,"Observed PR head"),b=object(pr.base,"Observed PR base");
    const id=requiredSafeInteger(pr.id,"Observed PR id");
    if(id<1||pr.number!==input.number||pr.state!=="open"||pr.draft!==true||
       pr.merged!==false||h.ref!==input.headBranch||h.sha!==input.expectedHeadSha||
       b.ref!==input.baseBranch||b.sha!==input.expectedBaseSha)
      throw new ProviderUnavailableError("Observed PR is not the original open unmerged Draft at tested SHA");
    const after=await this.getBranchMetadata(input.headBranch);
    const afterBase=await this.getBranchMetadata(input.baseBranch);
    if(after.commit_sha!==input.expectedHeadSha||afterBase.commit_sha!==input.expectedBaseSha)
      throw new ProviderConflictError("Observed PR branches changed during independent read");
    return Object.freeze({id,number:input.number,
      head_branch:input.headBranch,base_branch:input.baseBranch,
      head_revision:input.expectedHeadSha,base_revision:input.expectedBaseSha,
      draft:true as const,open:true as const,merged:false as const});
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

  /**
   * R302.2 trusted provider transport: atomic branch-HEAD CAS via a disposable
   * isolated staging ref. This is NOT wired to the Gateway's model/HTTP paths.
   *
   * Plain PUT /contents/{filepath} only guards the blob SHA; it cannot
   * atomically guard an unrelated change to the feature branch. We therefore
   * prepare a commit on a unique private staging ref initialized from the
   * exact old SHA, then use Gitea's old_commit_id compare-and-swap to move
   * the authorized branch. The operation is SINGLE ATTEMPT: any error or
   * lost acknowledgment is ambiguous and MUST NOT be retried automatically.
   */
  async updateFileWithHeadCas(input:Readonly<{
    branch:string;path:string;content:string;message:string;
    requestId:string;expectedHeadSha:string;expectedBlobSha:string;
  }>):Promise<GiteaHeadCasFileMutation>{
    const {branch,path,content,message,requestId,expectedHeadSha,
      expectedBlobSha}=input;
    if(typeof branch!=="string"||branch===this.#baseBranch||
       !/^feature\/[a-z0-9][a-z0-9./_-]*$/u.test(branch)||
       branch.includes("..")||branch.includes("//")||
       branch.startsWith("feature/r302-internal-")||
       typeof path!=="string"||!path||path.length>512||
       path.startsWith("/")||path.split("/").some(x=>
        !x||x==="."||x===".."||x.includes("%")||x.includes("\\"))||
       typeof content!=="string"||
       Buffer.byteLength(content,"utf8")<1||
       Buffer.byteLength(content,"utf8")>2_000_000||
       content.includes("\0")||
       typeof message!=="string"||!message.trim()||
       message.length>300||
       typeof requestId!=="string"||
       !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(requestId)||
       !/^[a-f0-9]{40}$/u.test(expectedHeadSha)||
       !/^[a-f0-9]{40}$/u.test(expectedBlobSha))
      throw new ProviderConflictError("Untrusted owner-pinned conditional Gitea update");
    const branchBefore=await this.getBranchMetadata(branch);
    if(branchBefore.commit_sha!==expectedHeadSha)
      throw new ProviderConflictError("Signed feature branch advanced before CAS");
    const original=await this.readTextFile(branch,path,expectedHeadSha);
    if(original.blob_sha!==expectedBlobSha||
       original.revision!==expectedHeadSha||original.path!==path)
      throw new ProviderConflictError("Owner-pinned file blob differs from Git snapshot");
    const nextHash=createHash("sha256").update(content,"utf8").digest("hex");
    if(createHash("sha256").update(original.content,"utf8").digest("hex")===nextHash)
      throw new ProviderConflictError("Identical bytes cannot create an authorized effect");
    const stageHash=createHash("sha256")
      .update(branch+"\n"+path+"\n"+requestId+"\n"+expectedHeadSha)
      .digest("hex").slice(0,28);
    const stagingBranch="feature/r302-internal-"+stageHash;
    // Not the Engineer-authorized branch: this is an owner-only *private*
    // implementation staging ref. Neither agent nor Gateway Executor can
    // request or select this branch.
    const stage=object(await this.#requestJson(this.#repoApi("/branches"),{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({
        new_branch_name:stagingBranch,old_ref_name:expectedHeadSha
      })
    }),"Gitea pinned staging branch");
    const stageCommit=object(stage.commit,"Gitea staging ref commit");
    if(stage.name!==stagingBranch||
       requiredString(stageCommit.id,"staging commit id")!==expectedHeadSha)
      throw new ProviderUnavailableError("Gitea staging ref did not start at pinned HEAD");
    if((await this.getBranchMetadata(stagingBranch)).commit_sha!==expectedHeadSha)
      throw new ProviderUnavailableError("Gitea staging HEAD diverged before mutation");
    // The staging branch is private and unique. File blob SHA prevents
    // mutation if contents changed unexpectedly during prepare.
    const staged=await this.updateFile(
      stagingBranch,path,content,message);
    if(staged.precondition_blob_sha!==expectedBlobSha||
       !/^[a-f0-9]{40}$/u.test(staged.commit_sha)||
       staged.commit_sha===expectedHeadSha||
       !/^[a-f0-9]{40}$/u.test(staged.blob_sha))
      throw new ProviderUnavailableError("Gitea staging commit is not bound to original blob");
    const commit=object(await this.#json(this.#repoApi(
      "/git/commits/"+staged.commit_sha)),"Gitea staged commit");
    const parents=commit.parents;
    if(commit.sha!==staged.commit_sha||!Array.isArray(parents)||
       parents.length!==1||!parents[0]||
       typeof parents[0]!=="object"||
       (parents[0] as JsonObject).sha!==expectedHeadSha)
      throw new ProviderUnavailableError("Gitea staging commit has unexpected parent");
    const stagedFile=await this.readTextFile(
      stagingBranch,path,staged.commit_sha);
    if((await this.getBranchMetadata(stagingBranch)).commit_sha!==staged.commit_sha||
       stagedFile.blob_sha!==staged.blob_sha||
       stagedFile.content!==content)
      throw new ProviderUnavailableError("Gitea staged file differs from proposed contents");
    // The remote compare-and-swap is the sole authorized branch movement.
    if((await this.getBranchMetadata(branch)).commit_sha!==expectedHeadSha)
      throw new ProviderConflictError("Feature HEAD moved while preparing staged commit");
    await this.#requestJson(this.#repoApi(
      "/branches/"+encodeURIComponent(branch)),{
        method:"PUT",headers:{"content-type":"application/json"},
        body:JSON.stringify({
          new_commit_id:staged.commit_sha,old_commit_id:expectedHeadSha,
          force:false
        })
    });
    // After remote CAS, any uncertain result is terminal. Callers must not
    // retry the old intent; the stage ref remains for manual reconciliation.
    if((await this.getBranchMetadata(branch)).commit_sha!==staged.commit_sha)
      throw new ProviderUnavailableError("Gitea remote CAS outcome ambiguous");
    const actual=await this.readTextFile(branch,path,staged.commit_sha);
    if(actual.blob_sha!==staged.blob_sha||actual.content!==content)
      throw new ProviderUnavailableError("Committed feature file differs from pinned CAS");
    return {
      branch,path,revision:staged.commit_sha,
      commit_sha:staged.commit_sha,blob_sha:staged.blob_sha,
      previous_revision:expectedHeadSha,
      precondition_blob_sha:expectedBlobSha,
      previous_head_sha:expectedHeadSha,
      previous_blob_sha:expectedBlobSha,
      staging_branch:stagingBranch,
      next_content_sha256:nextHash
    };
  }

  /**
   * R383.2 private Gateway owner transport: create a file that provably did
   * not exist at the original HEAD, using an isolated staged commit and the
   * same Gitea remote old_commit_id compare-and-swap as update_file.
   *
   * This is NOT an agent/Gateway Prepare/Execute permission or a signed
   * completion. Until a durable create-intent, native Rust/OPA admission and
   * independent authenticated receipt are wired, the canonical native owner
   * MUST NOT call this method as a model-requested create_file operation.
   *
   * Every invocation is a SINGLE attempt. A lost response after a staging
   * ref or branch CAS is ambiguous: do NOT retry; reconcile out of band.
   */
  async createFileWithHeadCas(input:Readonly<{
    branch:string;path:string;content:string;message:string;
    requestId:string;expectedHeadSha:string;
  }>):Promise<GiteaHeadCasCreatedFile>{
    if(!input||typeof input!=="object")throw new ProviderConflictError(
      "Original owner-pinned conditional Gitea create input required");
    const {branch,path,content,message,requestId,expectedHeadSha}=input;
    if(typeof branch!=="string"||branch===this.#baseBranch||
       !/^feature\/[a-z0-9][a-z0-9./_-]*$/u.test(branch)||
       branch.includes("..")||branch.includes("//")||
       branch.startsWith("feature/r302-internal-")||
       branch.startsWith("feature/r3832-create-")||
       typeof path!=="string"||!path||path.length>512||
       path.startsWith("/")||path.split("/").some(x=>
        !x||x==="."||x===".."||x.includes("%")||x.includes("\\"))||
       typeof content!=="string"||
       Buffer.byteLength(content,"utf8")<1||
       Buffer.byteLength(content,"utf8")>2_000_000||
       content.includes("\0")||
       typeof message!=="string"||!message.trim()||
       message.length>300||
       typeof requestId!=="string"||
       !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(requestId)||
       !/^[a-f0-9]{40}$/u.test(expectedHeadSha))
      throw new ProviderConflictError(
       "Untrusted owner-pinned conditional Gitea create");
    const branchBefore=await this.getBranchMetadata(branch);
    if(branchBefore.commit_sha!==expectedHeadSha)
      throw new ProviderConflictError(
       "Signed feature branch advanced before create CAS");
    const assertAbsent=async (atBranch:string,revision:string)=>{
      try{await this.readTextFile(atBranch,path,revision);}
      catch(error){
        // A 404 is sufficient only after the BRANCH HEAD itself was
        // verified, not when an HTTP/permission/parse error is masked.
        if(error instanceof ProviderNotFoundError)return;
        throw error;
      }
      throw new ProviderConflictError(
       "New file path already exists on original source snapshot");
    };
    await assertAbsent(branch,expectedHeadSha);
    if((await this.getBranchMetadata(branch)).commit_sha!==expectedHeadSha)
      throw new ProviderConflictError(
       "Source HEAD changed while attesting create absence");
    const nextHash=createHash("sha256").update(content,"utf8").digest("hex");
    const stageHash=createHash("sha256")
      .update(branch+"\n"+path+"\n"+requestId+"\n"+expectedHeadSha)
      .digest("hex").slice(0,28);
    const stagingBranch="feature/r3832-create-"+stageHash;
    const stage=object(await this.#requestJson(this.#repoApi("/branches"),{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({
        new_branch_name:stagingBranch,old_ref_name:expectedHeadSha
      })
    }),"Gitea pinned create staging branch");
    const stageCommit=object(stage.commit,"Gitea create staging ref commit");
    if(stage.name!==stagingBranch||
       requiredString(stageCommit.id,"staging commit id")!==expectedHeadSha)
      throw new ProviderUnavailableError(
       "Create staging ref did not start at pinned HEAD");
    if((await this.getBranchMetadata(stagingBranch)).commit_sha!==expectedHeadSha)
      throw new ProviderUnavailableError(
       "Create staging HEAD diverged before file creation");
    await assertAbsent(stagingBranch,expectedHeadSha);
    const staged=await this.createFile(
      stagingBranch,path,content,message);
    if(!/^[a-f0-9]{40}$/u.test(staged.commit_sha)||
       staged.commit_sha===expectedHeadSha||
       !/^[a-f0-9]{40}$/u.test(staged.blob_sha))
      throw new ProviderUnavailableError(
       "Staged create commit or blob is not trustworthy");
    // Crucially, absence is pinned to the *parent* tree, not asserted
    // from an arbitrary model-returned success or from staging alone.
    if(await this.getSingleGitCommitParent(staged.commit_sha)!==
       expectedHeadSha)
      throw new ProviderUnavailableError(
       "Staged create commit has unexpected parent");
    const actualStage=await this.readTextFile(
      stagingBranch,path,staged.commit_sha);
    if((await this.getBranchMetadata(stagingBranch)).commit_sha!==staged.commit_sha||
       actualStage.blob_sha!==staged.blob_sha||
       actualStage.content!==content)
      throw new ProviderUnavailableError(
       "Staged create file differs from owner-pinned bytes");
    if((await this.getBranchMetadata(branch)).commit_sha!==expectedHeadSha)
      throw new ProviderConflictError(
       "Feature HEAD moved while staging created file");
    // This exact old/new commit CAS is the only authorized main feature
    // branch movement; plain create_file POST is never used on that ref.
    await this.#requestJson(this.#repoApi(
      "/branches/"+encodeURIComponent(branch)),{
        method:"PUT",headers:{"content-type":"application/json"},
        body:JSON.stringify({
          new_commit_id:staged.commit_sha,
          old_commit_id:expectedHeadSha,force:false
        })
    });
    if((await this.getBranchMetadata(branch)).commit_sha!==staged.commit_sha)
      throw new ProviderUnavailableError(
       "Gitea create branch CAS outcome ambiguous");
    const committed=await this.readTextFile(branch,path,staged.commit_sha);
    if(committed.blob_sha!==staged.blob_sha||committed.content!==content)
      throw new ProviderUnavailableError(
       "Committed created file differs from pinned staged blob");
    return Object.freeze({
      branch,path,revision:staged.commit_sha,
      commit_sha:staged.commit_sha,blob_sha:staged.blob_sha,
      previous_head_sha:expectedHeadSha,staging_branch:stagingBranch,
      next_content_sha256:nextHash,old_path_absent_at_pinned_head:true
    });
  }

  /**
   * R383.2 read-only verifier. The Gateway must inject a DIFFERENT
   * authenticated GiteaClient and compare this proof against an immutable,
   * durably reserved native create intent before publishing any MAC receipt.
   * Alone this observation is NOT a signed grant, Rust/OPA approval,
   * authenticated Gateway receipt, or permission to report Task completion.
   */
  async verifyCreatedFileHeadCas(input:Readonly<{
    branch:string;path:string;expectedHeadSha:string;
    createdCommitSha:string;createdBlobSha:string;
    expectedContentSha256:string;expectedContentBytes:number;
  }>):Promise<Readonly<{
    status:"gitea_create_head_cas_read_only_verified";
    branch:string;path:string;previous_head_sha:string;
    commit_sha:string;blob_sha:string;content_sha256:string;
    provider_write_authorized:false;
  }>>{
    if(!input||typeof input!=="object")
      throw new ProviderConflictError("Original owner create observation pins required");
    const {branch,path,expectedHeadSha,createdCommitSha,
      createdBlobSha,expectedContentSha256,expectedContentBytes}=input;
    if(typeof branch!=="string"||branch===this.#baseBranch||
       !/^feature\/[a-z0-9][a-z0-9./_-]*$/u.test(branch)||
       branch.includes("..")||branch.includes("//")||
       branch.startsWith("feature/r302-internal-")||
       branch.startsWith("feature/r3832-create-")||
       typeof path!=="string"||!path||path.length>512||
       path.startsWith("/")||
       path.split("/").some(p=>!p||p==="."||p===".."||
        p.includes("%")||p.includes("\\"))||
       !/^[a-f0-9]{40}$/u.test(expectedHeadSha??"")||
       !/^[a-f0-9]{40}$/u.test(createdCommitSha??"")||
       !/^[a-f0-9]{40}$/u.test(createdBlobSha??"")||
       !/^[a-f0-9]{64}$/u.test(expectedContentSha256??"")||
       expectedHeadSha===createdCommitSha||
       !Number.isSafeInteger(expectedContentBytes)||
       expectedContentBytes<1||expectedContentBytes>2_000_000)
      throw new ProviderConflictError("Invalid pinned Gitea create observation");
    if((await this.getBranchMetadata(branch)).commit_sha!==createdCommitSha)
      throw new ProviderConflictError("Created commit is no longer feature HEAD");
    if(await this.getSingleGitCommitParent(createdCommitSha)!==expectedHeadSha)
      throw new ProviderConflictError("Created commit has wrong original parent");
    try{
      await this.readTextFile(branch,path,expectedHeadSha);
    }catch(error){
      if(!(error instanceof ProviderNotFoundError))throw error;
      // Only a genuine NotFound at the independently pinned old tree is
      // evidence of absence; any reachable file is a conflict.
      const current=await this.readTextFile(branch,path,createdCommitSha);
      const bytes=Buffer.from(current.content,"utf8");
      const digest=createHash("sha256").update(bytes).digest("hex");
      if(current.branch!==branch||current.path!==path||
         current.revision!==createdCommitSha||
         current.blob_sha!==createdBlobSha||
         bytes.length!==expectedContentBytes||
         digest!==expectedContentSha256||
         (await this.getBranchMetadata(branch)).commit_sha!==createdCommitSha)
        throw new ProviderConflictError(
         "Actual created file, HEAD or bytes differ from original owner pins");
      return Object.freeze({
        status:"gitea_create_head_cas_read_only_verified",
        branch,path,previous_head_sha:expectedHeadSha,
        commit_sha:createdCommitSha,blob_sha:createdBlobSha,
        content_sha256:digest,provider_write_authorized:false
      });
    }
    throw new ProviderConflictError(
      "Created file already existed at the original pinned HEAD");
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

  /** Independently inspect a real Git commit's immediate parent. */
  async getSingleGitCommitParent(revision:string):Promise<string>{
    this.#validatePinnedRevision(revision);
    const body=object(await this.#json(this.#repoApi(
      "/git/commits/"+revision)),"Gitea commit response");
    if(body.sha!==revision||!Array.isArray(body.parents)||
       body.parents.length!==1)
      throw new ProviderUnavailableError("Gitea commit lacks a single pinned parent");
    const parent=object(body.parents[0],"Gitea commit parent");
    const parentSha=requiredString(parent.sha,"commit parent.sha");
    this.#validatePinnedRevision(parentSha);
    return parentSha;
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
