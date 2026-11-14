/**
 * The Engineer's own GitHub account as the ONLY import source.
 *
 * The owner comes from the server configuration (GITHUB_OWNER), never from
 * the browser: the console can list and import only that account's
 * repositories. An optional GITHUB_TOKEN (read-only, for private
 * repositories) stays server-side: it is sent to Gitea for the one-time
 * clone and never returned to the browser or to any agent.
 */
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;
const REPO = /^[A-Za-z0-9._-]{1,100}$/u;

export class GitHubSource {
  #owner; #token; #fetch;

  constructor({owner, token, fetchFn = fetch}) {
    if (owner !== undefined && owner !== "" && !OWNER.test(owner))
      throw Error("GITHUB_OWNER non valido");
    this.#owner = owner || "";
    this.#token = token || "";
    this.#fetch = fetchFn;
  }

  get configured() { return !!this.#owner; }
  get owner() { return this.#owner; }
  /** Credentials for Gitea's one-time clone (server-side only). */
  get cloneCredentials() {
    return this.#token ? {username: this.#owner, password: this.#token} : undefined;
  }

  /** The owner's repositories (most recently updated first), metadata only. */
  async listRepositories() {
    if (!this.configured) throw Error("GITHUB_OWNER non configurato nel file .env");
    // With a token, /user/repos also returns the owner's private repositories.
    const url = this.#token
      ? "https://api.github.com/user/repos?affiliation=owner&sort=updated&per_page=100"
      : `https://api.github.com/users/${encodeURIComponent(this.#owner)}/repos?sort=updated&per_page=100`;
    let response;
    try {
      response = await this.#fetch(url, {
        headers: {accept: "application/vnd.github+json", "user-agent": "sigillo-console",
          ...(this.#token ? {authorization: "Bearer " + this.#token} : {})},
        redirect: "error", signal: AbortSignal.timeout(20_000)
      });
    } catch (error) {
      throw Error("GitHub non raggiungibile dal container: " + (error?.cause?.code ?? error?.message));
    }
    if (!response.ok) throw Error(`GitHub ha risposto HTTP ${response.status}` +
      (response.status === 401 ? ": GITHUB_TOKEN non valido" : ""));
    const body = await response.json();
    return (Array.isArray(body) ? body : [])
      .filter(r => r?.owner?.login?.toLowerCase() === this.#owner.toLowerCase() &&
        typeof r.name === "string" && REPO.test(r.name) && !r.archived)
      .map(r => ({name: r.name, private: !!r.private, description: String(r.description ?? "").slice(0, 200),
        default_branch: String(r.default_branch ?? ""), updated_at: String(r.updated_at ?? "")}));
  }

  /** Clone URL of one of the owner's repositories, after checking it exists. */
  async cloneUrlFor(name) {
    if (typeof name !== "string" || !REPO.test(name) || name.endsWith(".git"))
      throw Error("Nome di repository GitHub non valido");
    const repos = await this.listRepositories();
    if (!repos.some(r => r.name === name))
      throw Error(`La repository ${name} non è tra quelle di ${this.#owner} su GitHub`);
    return `https://github.com/${this.#owner}/${name}.git`;
  }
}
