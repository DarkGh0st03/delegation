/**
 * Server-side Gitea administration used by the trusted Engineer console.
 * The admin credential never reaches the browser or any agent: the console
 * only returns repository metadata.
 */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u;

export function validateRepoName(name) {
  if (typeof name !== "string" || !NAME.test(name) || name.endsWith(".git"))
    throw Error("Invalid repository name");
  return name;
}

/** Only public https clone URLs without embedded credentials. A web page
 * address (branch, file or commit view) is refused with a clear hint. */
export function validateCloneUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw Error("URL non valido"); }
  if (url.protocol !== "https:" || url.username || url.password ||
      url.search || url.hash || String(raw).length > 300)
    throw Error("Serve un URL https semplice, senza credenziali né parametri");
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2 ||
      segments.some(s => ["tree", "blob", "commit", "commits", "pull", "pulls", "-"].includes(s)))
    throw Error("Usa l'indirizzo di clonazione della repository, ad esempio " +
      "https://github.com/utente/progetto.git (non l'indirizzo di un branch o di un file)");
  return url.toString();
}

export class GiteaAdmin {
  #base; #auth; #org; #gatewayUser; #runnerUser; #fetch;

  constructor({baseUrl, adminUser, adminPassword, org, gatewayUser, runnerUser,
    fetchFn = fetch}) {
    this.#base = baseUrl;
    this.#auth = "Basic " + Buffer.from(adminUser + ":" + adminPassword).toString("base64");
    this.#org = org;
    this.#gatewayUser = gatewayUser;
    this.#runnerUser = runnerUser;
    this.#fetch = fetchFn;
  }

  get org() { return this.#org; }

  async #call(method, path, body, okStatuses = [200]) {
    const response = await this.#fetch(this.#base + "/api/v1" + path, {
      method, redirect: "error",
      headers: {authorization: this.#auth, accept: "application/json",
        ...(body === undefined ? {} : {"content-type": "application/json"})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
      signal: AbortSignal.timeout(120_000)
    });
    if (!okStatuses.includes(response.status)) {
      const error = Error(`Gitea ${method} ${path} failed with HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    if (response.status === 204) return undefined;
    const text = await response.text();
    return text ? JSON.parse(text) : undefined;
  }

  async listRepositories() {
    const repos = await this.#call("GET", `/orgs/${encodeURIComponent(this.#org)}/repos?limit=50`);
    return (repos ?? []).map(r => ({
      owner: r.owner?.login ?? this.#org, name: r.name,
      default_branch: r.default_branch, private: !!r.private,
      empty: !!r.empty, updated_at: r.updated_at
    }));
  }

  async repositoryDetail(name) {
    validateRepoName(name);
    const path = `/repos/${encodeURIComponent(this.#org)}/${encodeURIComponent(name)}`;
    const repo = await this.#call("GET", path);
    const branch = await this.#call("GET",
      `${path}/branches/${encodeURIComponent(repo.default_branch)}`);
    const protections = await this.#call("GET", `${path}/branch_protections`);
    return {
      owner: this.#org, name: repo.name, default_branch: repo.default_branch,
      head_sha: branch?.commit?.id ?? null,
      protected_branches: (protections ?? []).map(p => p.branch_name ?? p.rule_name)
    };
  }

  /**
   * Trusted owner snapshot: every file and directory path at an exact
   * commit (Gitea recursive tree, paginated). Paths only, never content.
   */
  async repositoryTree(name, sha, {maxPaths = 4096} = {}) {
    validateRepoName(name);
    if (!/^[a-f0-9]{40}$/u.test(sha)) throw Error("Invalid commit SHA");
    const files = [], directories = [""];
    for (let page = 1; ; page++) {
      const body = await this.#call("GET", `/repos/${encodeURIComponent(this.#org)}/` +
        `${encodeURIComponent(name)}/git/trees/${sha}?recursive=true&per_page=1000&page=${page}`);
      for (const entry of body?.tree ?? []) {
        if (entry.type === "blob") files.push(entry.path);
        else if (entry.type === "tree") directories.push(entry.path);
      }
      if (files.length + directories.length > maxPaths)
        throw Error(`La repository ha più di ${maxPaths} percorsi: troppo grande per il Planning`);
      const total = Number(body?.total_count ?? 0);
      if (!body?.truncated && (body?.tree?.length ?? 0) < 1000) break;
      if (total && files.length + directories.length - 1 >= total) break;
      if (page > 10) throw Error("Albero della repository troppo grande");
    }
    return {files: [...new Set(files)].sort(), directories: [...new Set(directories)].sort()};
  }

  /** The open pull request whose head is `branch`, or null (read-only). */
  async pullRequestFor(name, branch) {
    validateRepoName(name);
    const pulls = await this.#call("GET", `/repos/${encodeURIComponent(this.#org)}/` +
      `${encodeURIComponent(name)}/pulls?state=open&limit=50`);
    const pr = (pulls ?? []).find(p => p.head?.ref === branch);
    return pr ? {number: pr.number, title: pr.title, url: pr.html_url,
      draft: !!pr.draft || /^(WIP|\[WIP\]|Draft)/iu.test(pr.title ?? ""), merged: !!pr.merged} : null;
  }

  /**
   * Import a public repository and apply the same baseline protections as
   * poc/scripts/bootstrap-gitea.sh: protected default branch, Gateway write
   * collaborator, Runner read collaborator.
   */
  async importRepository({cloneUrl, name, credentials}) {
    const url = validateCloneUrl(cloneUrl);
    validateRepoName(name);
    await this.#call("POST", "/repos/migrate", {
      clone_addr: url, repo_owner: this.#org, repo_name: name, service: "git",
      // One-time clone of a private repository; Gitea does not keep a mirror.
      ...(credentials ? {auth_username: credentials.username, auth_password: credentials.password} : {}),
      mirror: false, private: true, issues: false, labels: false, milestones: false,
      pull_requests: false, releases: false, wiki: false, lfs: false
    }, [201]);
    const path = `/repos/${encodeURIComponent(this.#org)}/${encodeURIComponent(name)}`;
    const repo = await this.#call("GET", path);
    await this.#call("POST", `${path}/branch_protections`, {
      branch_name: repo.default_branch, enable_push: false, enable_force_push: false,
      required_approvals: 1, block_admin_merge_override: true,
      dismiss_stale_approvals: true, block_on_outdated_branch: true
    }, [201]);
    await this.#call("PUT", `${path}/collaborators/${encodeURIComponent(this.#gatewayUser)}`,
      {permission: "write"}, [204]);
    await this.#call("PUT", `${path}/collaborators/${encodeURIComponent(this.#runnerUser)}`,
      {permission: "read"}, [204]);
    return this.repositoryDetail(name);
  }

  /** Delete a repository of the organisation (branches, PRs and history). */
  async deleteRepository(name) {
    validateRepoName(name);
    await this.#call("DELETE", `/repos/${encodeURIComponent(this.#org)}/${encodeURIComponent(name)}`,
      undefined, [204]);
  }
}
