/**
 * Engineer console HTTP handler (no framework, loopback only).
 *
 * Security rules:
 * - every /api route except login/me requires a live session cookie;
 * - state-changing requests require the X-Console-Request header and, when
 *   present, a same-origin Origin header (blocks cross-site form posts);
 * - static files come from a fixed allow-list (no path traversal);
 * - Gitea admin credentials stay server-side.
 */
import {readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {SESSION_COOKIE, sessionTokenFromCookie} from "./auth.mjs";
import {validateRepoName} from "./gitea.mjs";
import {defaultPolicy, validatePolicy} from "./policy.mjs";

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "../public");
const STATIC = Object.freeze({
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"]
});
const SECURITY_HEADERS = Object.freeze({
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; " +
    "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store"
});
const MAX_BODY = 64 * 1024;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function send(res, status, body, headers = {}) {
  const json = JSON.stringify(body);
  res.writeHead(status, {...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json), ...headers});
  res.end(json);
}

async function readJson(req) {
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json"))
    throw new HttpError(415, "JSON body required");
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, "Body too large");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw new HttpError(400, "Invalid JSON"); }
}

function validateRequirement(text) {
  if (typeof text !== "string") throw new HttpError(400, "Requirement must be text");
  const trimmed = text.trim();
  if (trimmed.length < 10 || trimmed.length > 4000)
    throw new HttpError(400, "Requirement must be 10-4000 characters");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(trimmed))
    throw new HttpError(400, "Requirement contains control characters");
  return trimmed;
}

export function createConsoleHandler({auth, gitea, store, health, port, opa, sessions}) {
  const allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);

  function requireMutationGuards(req) {
    if (req.headers["x-console-request"] !== "1")
      throw new HttpError(403, "Missing console request header");
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedOrigins.has(origin))
      throw new HttpError(403, "Cross-origin request refused");
  }

  function requireUser(req) {
    const user = auth.verify(sessionTokenFromCookie(req.headers.cookie));
    if (!user) throw new HttpError(401, "Login required");
    return user;
  }

  async function repoWithPolicy(name) {
    const repository = await gitea.repositoryDetail(validateRepoName(name));
    const stored = store.loadPolicy(repository.owner, repository.name);
    let policy = defaultPolicy(repository), policySource = "default";
    if (stored) {
      try {
        const {saved_at: _ignored, ...raw} = stored;
        policy = validatePolicy(raw, repository); policySource = "saved";
      } catch { policySource = "default (saved policy no longer valid)"; }
    }
    return {repository, policy, policy_source: policySource};
  }

  return async function handle(req, res) {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const path = url.pathname;
      const method = req.method ?? "GET";

      if (method === "GET" && Object.hasOwn(STATIC, path)) {
        const [file, type] = STATIC[path];
        const body = readFileSync(resolve(PUBLIC, file));
        res.writeHead(200, {...SECURITY_HEADERS, "content-type": type,
          "content-length": body.length});
        return void res.end(body);
      }
      if (!path.startsWith("/api/")) throw new HttpError(404, "Not found");
      if (method !== "GET") requireMutationGuards(req);

      if (method === "GET" && path === "/api/me") {
        const user = auth.verify(sessionTokenFromCookie(req.headers.cookie));
        return send(res, 200, {username: user ?? null, users_configured: auth.hasUsers,
          gemini_available: Boolean(process.env.GEMINI_API_KEY)});
      }
      if (method === "POST" && path === "/api/login") {
        const body = await readJson(req);
        let token;
        try { token = auth.login(body.username, body.password); }
        catch (error) { throw new HttpError(401, error.message); }
        return send(res, 200, {username: body.username}, {"set-cookie":
          `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`});
      }
      if (method === "POST" && path === "/api/logout") {
        auth.logout(sessionTokenFromCookie(req.headers.cookie));
        return send(res, 200, {ok: true}, {"set-cookie":
          `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`});
      }

      const username = requireUser(req);

      if (method === "GET" && path === "/api/health")
        return send(res, 200, await health());
      if (method === "GET" && path === "/api/repos")
        return send(res, 200, {org: gitea.org, repositories: await gitea.listRepositories()});
      if (method === "POST" && path === "/api/repos/import") {
        const body = await readJson(req);
        try {
          const repository = await gitea.importRepository({cloneUrl: body.clone_url, name: body.name});
          return send(res, 201, {repository});
        } catch (error) {
          if (error.status === 409)
            throw new HttpError(409, "Esiste già una repository con questo nome in Gitea");
          if (error.status === 422)
            throw new HttpError(422, "Gitea ha rifiutato l'import: controlla che l'URL sia " +
              "l'indirizzo di clonazione di una repository pubblica (https://…/utente/progetto.git)");
          throw new HttpError(400, error.message);
        }
      }
      const repoMatch = /^\/api\/repos\/([^/]+)(\/policy)?$/u.exec(path);
      if (repoMatch) {
        const name = decodeURIComponent(repoMatch[1]);
        if (method === "GET" && !repoMatch[2]) return send(res, 200, await repoWithPolicy(name));
        if (method === "PUT" && repoMatch[2]) {
          const {repository} = await repoWithPolicy(name);
          let policy;
          try { policy = validatePolicy(await readJson(req), repository); }
          catch (error) { throw new HttpError(error.status ?? 400, error.message); }
          store.savePolicy(policy);
          let opaPublished = false, opaError;
          if (opa) {
            try { await opa.publish(store.listPolicies()); opaPublished = true; }
            catch (error) { opaError = error.message; }
          }
          return send(res, 200, {repository, policy, policy_source: "saved",
            opa_published: opaPublished, ...(opaError ? {opa_error: opaError} : {})});
        }
      }
      const planningMatch = /^\/api\/requests\/([a-f0-9-]{36})\/planning$/u.exec(path);
      if (planningMatch && method === "POST") {
        if (!sessions) throw new HttpError(503, "Le sessioni sono disponibili solo nell'avvio con Docker");
        const request = store.getRequest(planningMatch[1]);
        if (!request) throw new HttpError(404, "Richiesta non trovata");
        const body = await readJson(req);
        try {
          const session = sessions.start({request, mode: body.mode,
            geminiConsent: body.gemini_consent === true, username,
            userRecord: auth.userRecord(username)});
          return send(res, 202, {session});
        } catch (error) { throw new HttpError(409, error.message); }
      }
      if (method === "GET" && path === "/api/sessions")
        return send(res, 200, {sessions: sessions ? sessions.list() : []});
      const sessionMatch = /^\/api\/sessions\/(s-[a-f0-9]{12})$/u.exec(path);
      if (sessionMatch && method === "GET") {
        const session = sessions?.get(sessionMatch[1]);
        if (!session) throw new HttpError(404, "Sessione non trovata");
        return send(res, 200, {session});
      }
      const actionMatch = /^\/api\/sessions\/(s-[a-f0-9]{12})\/(approve|stop)$/u.exec(path);
      if (actionMatch && method === "POST") {
        if (!sessions) throw new HttpError(503, "Le sessioni sono disponibili solo nell'avvio con Docker");
        const body = await readJson(req);
        if (actionMatch[2] === "approve") {
          // Same lockout as login: a stolen browser session cannot guess
          // the password through the signing endpoint.
          if (!auth.verifyPassword(username, body.password))
            throw new HttpError(403, "Password non corretta (o troppi tentativi: riprova tra poco)");
          try {
            return send(res, 200, {session: await sessions.approve({id: actionMatch[1],
              password: body.password, permissionIds: body.permission_ids})});
          } catch (error) { throw new HttpError(409, error.message); }
        }
        try { return send(res, 200, {session: await sessions.stop(actionMatch[1])}); }
        catch (error) { throw new HttpError(409, error.message); }
      }
      if (method === "GET" && path === "/api/requests")
        return send(res, 200, {requests: store.listRequests()});
      if (method === "POST" && path === "/api/requests") {
        const body = await readJson(req);
        const requirement = validateRequirement(body.requirement);
        const {repository} = await repoWithPolicy(String(body.repository ?? ""));
        if (!repository.head_sha) throw new HttpError(409, "Repository has no commits");
        const request = store.createRequest({
          repository: {owner: repository.owner, name: repository.name,
            default_branch: repository.default_branch},
          baseSha: repository.head_sha, requirement, username
        });
        return send(res, 201, {request});
      }
      throw new HttpError(404, "Not found");
    } catch (error) {
      const status = error instanceof HttpError ? error.status :
        (error?.status === 404 ? 404 : 500);
      const message = status === 500 ? "Internal error: " + (error?.message ?? "unknown") : error.message;
      if (!res.headersSent) send(res, status, {error: message});
      else res.end();
    }
  };
}
