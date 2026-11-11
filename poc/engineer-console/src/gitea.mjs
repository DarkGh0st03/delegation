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
   * Import a public repository and apply the same baseline protections as
   * poc/scripts/bootstrap-gitea.sh: protected default branch, Gateway write
   * collaborator, Runner read collaborator.
   */
  async importRepository({cloneUrl, name}) {
    const url = validateCloneUrl(cloneUrl);
    validateRepoName(name);
    await this.#call("POST", "/repos/migrate", {
      clone_addr: url, repo_owner: this.#org, repo_name: name, service: "git",
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
}
