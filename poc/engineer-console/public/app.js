// Sigillo (Ardesia Labs) — Engineer console front-end.
// All dynamic text is inserted with textContent (never innerHTML), so
// repository data, model output and errors cannot inject markup or scripts.
"use strict";

const $ = (id) => document.getElementById(id);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
};

let me = {username: null, gemini: false};
let selectedRepo = null;          // {repository, policy, policy_source}
let currentSession = null;        // id shown in the session view
let sessionData = null;
let pollTimer = null;
let homeTimer = null;
const reviewOffered = new Set();  // sessions whose approval pop-up was already shown
let feedKeys = [];                // feed entries already rendered for currentSession

async function api(method, path, body) {
  const response = await fetch(path, {
    method, credentials: "same-origin",
    headers: {"x-console-request": "1", ...(body ? {"content-type": "application/json"} : {})},
    ...(body ? {body: JSON.stringify(body)} : {})
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== "/api/login") showLogin();
  if (!response.ok) throw new Error(data.error || ("HTTP " + response.status));
  return data;
}
function message(id, text, kind) {
  const node = $(id);
  node.textContent = text || "";
  node.className = "msg" + (kind ? " " + kind : "");
}
const lines = (text) => text.split("\n").map(s => s.trim()).filter(Boolean);
const time = (iso) => (iso || "").slice(11, 19);
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } }
};

// =====================================================================
// Login
// =====================================================================
function showLogin() {
  clearTimeout(pollTimer); clearTimeout(homeTimer);
  $("login-view").hidden = false; $("app-view").hidden = true;
  for (const d of document.querySelectorAll("dialog[open]")) d.close();
}
async function showApp(username, gemini) {
  me = {username, gemini: !!gemini};
  $("login-view").hidden = true; $("app-view").hidden = false;
  $("whoami").textContent = username;
  $("avatar").textContent = (username || "?").slice(0, 1).toUpperCase();
  $("hello-name").textContent = username ? ", " + username : "";
  updateComposerAvailability();
  refreshEnvDot();
  await route();
}
$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    const data = await api("POST", "/api/login",
      {username: form.get("username"), password: form.get("password")});
    event.target.reset(); message("login-error", "");
    const who = await api("GET", "/api/me");
    await showApp(data.username, who.gemini_available);
  } catch (error) { message("login-error", error.message, "error"); }
});
$("logout").addEventListener("click", async () => {
  await api("POST", "/api/logout").catch(() => {});
  showLogin();
});

// =====================================================================
// Routing: #/ (home) and #/session/<id> (live session)
// =====================================================================
async function route() {
  if ($("app-view").hidden) return;
  clearTimeout(pollTimer); clearTimeout(homeTimer);
  const match = /^#\/session\/(s-[a-f0-9]{12})$/u.exec(location.hash);
  $("home-view").hidden = !!match;
  $("session-view").hidden = !match;
  if (match) {
    if (currentSession !== match[1]) { currentSession = match[1]; feedKeys = []; $("sv-feed").replaceChildren(); }
    await loadSession();
  } else {
    currentSession = null;
    await loadHome();
  }
  window.scrollTo({top: 0});
}
window.addEventListener("hashchange", route);
for (const dialog of document.querySelectorAll("dialog"))
  for (const button of dialog.querySelectorAll("[data-close]"))
    button.addEventListener("click", () => dialog.close());

// =====================================================================
// Settings: environment status
// =====================================================================
async function loadHealth() {
  const rows = $("env-rows"); rows.replaceChildren();
  try {
    const data = await api("GET", "/api/health");
    for (const check of data.checks) {
      const li = el("li", check.ok ? "ok" : "fail");
      li.appendChild(el("span", "c-ico"));
      const body = el("div");
      body.appendChild(el("div", "c-label", check.label + (check.ok ? "" : " · non pronto")));
      body.appendChild(el("div", "c-detail",
        check.ok ? check.detail : (check.detail ? check.detail + " — " : "") + (check.hint || "")));
      li.appendChild(body); rows.appendChild(li);
    }
    setEnvDot(data.checks.every(c => c.ok));
  } catch (error) {
    const li = el("li", "fail"); li.appendChild(el("span", "c-ico"));
    li.appendChild(el("div", "c-label", error.message)); rows.appendChild(li);
    setEnvDot(false);
  }
}
function setEnvDot(ok) { $("env-dot").className = "dot " + (ok ? "ok" : "fail"); }
async function refreshEnvDot() {
  try { const data = await api("GET", "/api/health"); setEnvDot(data.checks.every(c => c.ok)); }
  catch { setEnvDot(false); }
}
$("open-settings").addEventListener("click", () => { $("settings-dialog").showModal(); loadHealth(); });
$("env-refresh").addEventListener("click", loadHealth);

// =====================================================================
// Home: repositories, sessions, composer
// =====================================================================
async function loadHome() {
  await Promise.all([loadRepos(), loadSessionList(), loadGithubRepos()]);
  const remembered = store.get("sigillo.repo");
  if (!selectedRepo && remembered) await selectRepo(remembered, true);
  renderContext();
}

// ---- Staging: "Apri l'app" (deployed main of each repository) ----
const appCells = new Map();      // repository name -> table cell
const stagingUrls = new Map();   // repository name -> live app URL
let stagingTimer = null;
const STAGE_TEXT = {building: "Build della nuova versione…", starting: "Avvio della nuova versione…",
  waiting: "In attesa del primo deploy…", failed: "Deploy non riuscito"};

function renderAppCell(td, repo, available) {
  td.replaceChildren();
  const st = repo.staging;
  if (!available || !st) { td.appendChild(el("span", "muted small", "—")); return; }
  if (!st.configured && st.detection?.interface === "none") {
    // Automatic detection found no graphical interface (library, CLI, API).
    const na = el("span", "app-meta na", "Interfaccia non disponibile");
    na.title = st.detection.reason + " — puoi comunque configurarla da Configura.";
    td.appendChild(na); return;
  }
  if (!st.configured && st.detection?.interface === "web" && st.detection.proposal) {
    // Detected web interface: a proposal the Engineer confirms with one click.
    const b = el("button", "btn secondary small", "Pubblica l'app");
    b.type = "button"; b.title = "Rilevata: " + st.detection.reason + ". Pubblica main su un indirizzo locale.";
    b.addEventListener("click", async (event) => {
      event.stopPropagation(); b.disabled = true;
      try {
        const name = encodeURIComponent(repo.name);
        const data = await api("GET", "/api/repos/" + name + "/staging");
        if (!data.detection?.proposal) throw new Error("Nessuna proposta disponibile");
        await api("PUT", "/api/repos/" + name + "/staging", {...data.detection.proposal, enabled: true});
        await loadRepos();
      } catch (error) { b.disabled = false; message("import-msg", error.message, "error"); }
    });
    td.appendChild(b);
    td.appendChild(el("span", "app-meta", "Interfaccia web rilevata"));
    return;
  }
  if (!st.configured || !st.enabled) {
    const b = el("button", "btn ghost small", st.configured ? "Disattivata" : "Configura app");
    b.type = "button"; b.title = "Come costruire e avviare l'app di questa repository";
    b.addEventListener("click", async (event) => {
      event.stopPropagation(); await selectRepo(repo.name); openPolicy("staging");
    });
    td.appendChild(b); return;
  }
  const status = st.status;
  const live = status?.live_sha && status?.url;
  if (live) stagingUrls.set(repo.name, status.url); else stagingUrls.delete(repo.name);
  if (live) {
    const a = el("a", "btn secondary small open-app", "Apri l'app ↗");
    a.href = status.url; a.target = "_blank"; a.rel = "noopener noreferrer";
    a.title = "Versione di main " + status.live_sha.slice(0, 7) + " su " + status.url;
    a.addEventListener("click", (event) => event.stopPropagation());
    td.appendChild(a);
  }
  let note, kind = "muted";
  if (status && status.deployer_alive === false) { note = "servizio staging fermo"; kind = "deny"; }
  else if (!status) note = STAGE_TEXT.waiting;
  else if (status.state === "running" && live) note = "main @ " + status.live_sha.slice(0, 7);
  else if (status.state === "failed") { note = live ? "ultimo deploy non riuscito" : STAGE_TEXT.failed; kind = "deny"; }
  else { note = STAGE_TEXT[status.state] || status.state; kind = "busy"; }
  const meta = el("span", "app-meta " + kind, note);
  if (status?.message) meta.title = status.message + (status.log ? "\n\n" + status.log.slice(-1200) : "");
  td.appendChild(meta);
}

/** Every few seconds while the home is open: a merge shows up as a new
 * build and then as the new version, without reloading the page. */
async function refreshStaging() {
  clearTimeout(stagingTimer);
  if (!$("app-view").hidden && !$("home-view").hidden && appCells.size) {
    try {
      const data = await api("GET", "/api/repos");
      for (const repo of data.repositories) {
        const td = appCells.get(repo.name);
        if (td) renderAppCell(td, repo, data.staging_available);
      }
    } catch { /* shown at the next full reload */ }
  }
  stagingTimer = setTimeout(refreshStaging, 5000);
}

async function loadRepos() {
  const rows = $("repo-rows"); rows.replaceChildren(); appCells.clear();
  try {
    const data = await api("GET", "/api/repos");
    $("repo-org").textContent = "Organizzazione Gitea: " + data.org;
    for (const repo of data.repositories) {
      const tr = el("tr");
      if (selectedRepo?.repository.name === repo.name) tr.classList.add("selected");
      const name = el("td");
      name.appendChild(el("span", "repo-owner", (repo.owner || data.org) + " / "));
      name.appendChild(el("span", "repo-name", repo.name));
      tr.appendChild(name);
      const branch = el("td"); branch.appendChild(el("span", "pill", repo.default_branch)); tr.appendChild(branch);
      const policy = el("td");
      const button = el("button", "btn ghost small", "Configura");
      button.type = "button";
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        await selectRepo(repo.name); openPolicy();
      });
      policy.appendChild(button); tr.appendChild(policy);
      const app = el("td", "app-cell"); appCells.set(repo.name, app);
      renderAppCell(app, repo, data.staging_available); tr.appendChild(app);
      const pick = el("td"); pick.appendChild(el("span", "pill brand",
        selectedRepo?.repository.name === repo.name ? "Selezionata" : "Seleziona"));
      tr.appendChild(pick);
      const del = el("td"), trash = el("button", "icon-del");
      trash.type = "button"; trash.title = "Elimina " + repo.name + " da Gitea";
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const use = document.createElementNS("http://www.w3.org/2000/svg", "use"); use.setAttribute("href", "#i-trash");
      svg.appendChild(use); trash.appendChild(svg);
      trash.addEventListener("click", (event) => { event.stopPropagation(); deleteRepo(repo.name); });
      del.appendChild(trash); tr.appendChild(del);
      tr.addEventListener("click", () => selectRepo(repo.name));
      rows.appendChild(tr);
    }
    if (!data.repositories.length) {
      const tr = el("tr"); const td = el("td", "muted", "Nessuna repository: importane una da GitHub.");
      td.colSpan = 6; tr.appendChild(td); rows.appendChild(tr);
    }
    if (!stagingTimer) stagingTimer = setTimeout(refreshStaging, 5000);
  } catch (error) {
    const tr = el("tr"); const td = el("td", "deny", error.message); td.colSpan = 6;
    tr.appendChild(td); rows.appendChild(tr);
  }
}

async function selectRepo(name, quiet) {
  try {
    selectedRepo = await api("GET", "/api/repos/" + encodeURIComponent(name));
    store.set("sigillo.repo", name);
    if (!quiet) await loadRepos();
    renderContext();
  } catch (error) { if (!quiet) message("import-msg", error.message, "error"); }
}

function renderContext() {
  const chip = $("ctx-repo"), label = chip.querySelector("span");
  if (selectedRepo) {
    const r = selectedRepo.repository;
    label.textContent = r.owner + "/" + r.name + " · " + r.default_branch +
      (r.head_sha ? " @ " + r.head_sha.slice(0, 8) : "");
    chip.classList.add("active");
    $("ctx-policy").querySelector("span").textContent = "Policy " +
      (selectedRepo.policy_source === "saved" ? "salvata" : "predefinita") + " · configura";
  } else {
    label.textContent = "Seleziona una repository";
    chip.classList.remove("active");
    $("ctx-policy").querySelector("span").textContent = "Configura policy";
  }
  $("ctx-policy").disabled = !selectedRepo;
  updateSend();
}

async function deleteRepo(name) {
  if (!confirm("Eliminare " + name + " da Gitea? Si cancellano branch, Pull Request e storia della copia " +
    "locale (la repository su GitHub non viene toccata). Le sessioni passate restano nell'archivio.")) return;
  try {
    await api("DELETE", "/api/repos/" + encodeURIComponent(name));
    if (selectedRepo?.repository.name === name) { selectedRepo = null; store.set("sigillo.repo", ""); }
    message("import-msg", name + " eliminata.", "ok");
    await Promise.all([loadRepos(), loadGithubRepos()]); renderContext();
  } catch (error) { message("import-msg", error.message, "error"); }
}

async function loadGithubRepos() {
  const select = $("github-repo"); select.replaceChildren();
  try {
    const [gh, local] = await Promise.all([api("GET", "/api/github/repos"),
      api("GET", "/api/repos").catch(() => ({repositories: []}))]);
    if (!gh.configured) {
      select.appendChild(new Option("Import disattivato: imposta GITHUB_OWNER nel file .env", ""));
      select.disabled = true; $("import-btn").disabled = true; return;
    }
    if (gh.error) throw Error(gh.error);
    const imported = new Set(local.repositories.map(r => r.name));
    select.appendChild(new Option("Scegli una repository di " + gh.owner + " su GitHub", ""));
    for (const r of gh.repositories) {
      const option = new Option(r.name + (r.private ? " (privata)" : "") +
        (imported.has(r.name) ? " — già importata" : ""), r.name);
      option.disabled = imported.has(r.name);
      select.appendChild(option);
    }
    select.disabled = false; $("import-btn").disabled = false;
  } catch (error) {
    select.appendChild(new Option("GitHub non disponibile: " + error.message, ""));
    select.disabled = true; $("import-btn").disabled = true;
  }
}

$("import-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = $("github-repo").value;
  if (!name) return;
  message("import-msg", "Import di " + name + " da GitHub in Gitea (può richiedere un minuto)…");
  $("import-btn").disabled = true;
  try {
    const data = await api("POST", "/api/repos/import", {github_repo: name});
    message("import-msg", "Importata: " + data.repository.owner + "/" + data.repository.name +
      ". Il branch principale è protetto (nessun push diretto).", "ok");
    await selectRepo(data.repository.name);
    await loadGithubRepos();
  } catch (error) { message("import-msg", error.message, "error"); $("import-btn").disabled = false; }
});

// ---------- sessions list ----------
const PHASES = {
  planning: "Planning in corso",
  awaiting_review: "In attesa della tua approvazione",
  approving: "Firma in corso",
  executing: "Esecuzione in corso",
  completed: "Completata",
  stopping: "Revoca in corso",
  stopped: "Terminata",
  failed: "Errore",
  interrupted: "Interrotta (console riavviata)"
};
const BUSY = new Set(["planning", "approving", "executing", "stopping"]);
const phaseClass = (p) => p === "completed" ? "ok" : p === "failed" ? "fail" :
  p === "awaiting_review" ? "wait" : BUSY.has(p) ? "busy" : "";

async function loadSessionList() {
  const list = $("session-list"); list.replaceChildren();
  const data = await api("GET", "/api/sessions").catch(() => ({sessions: []}));
  for (const s of data.sessions.slice(0, 40)) {
    const li = el("li");
    li.appendChild(el("span", "s-dot " + phaseClass(s.phase)));
    li.appendChild(el("span", "s-text", s.requirement));
    li.appendChild(el("span", "s-meta", s.repository.name + " · " + (PHASES[s.phase] || s.phase) + " · " +
      s.created_at.replace("T", " ").slice(5, 16) + (s.pull_request ? " · PR #" + s.pull_request.number : "")));
    li.title = s.requirement;
    li.addEventListener("click", () => { location.hash = "#/session/" + s.id; });
    list.appendChild(li);
  }
  if (!data.sessions.length) list.appendChild(el("li", "empty", "Ancora nessuna sessione: scrivi il primo requisito qui sotto."));
  if (data.sessions.some(s => BUSY.has(s.phase)) && !$("home-view").hidden)
    homeTimer = setTimeout(loadSessionList, 4000);
}

// ---------- composer ----------
// Sessions use Gemini. Sending the prompt is the Engineer's explicit start of
// a paid session, bounded by the per-session call and token limits. (The free
// simulated modes exist only for automated tests and the offline sandbox.)
const sessionMode = () => store.get("sigillo.devMode") || "gemini";
function updateComposerAvailability() {
  const ready = me.gemini || sessionMode() !== "gemini";
  $("composer-hint").textContent = ready ? "Ctrl + Invio per avviare"
    : "Gemini non configurato: imposta GEMINI_API_KEY nel file .env";
  updateSend();
}
function updateSend() {
  const text = $("prompt").value.trim();
  $("send").disabled = !selectedRepo || text.length < 10 || !(me.gemini || sessionMode() !== "gemini");
}
$("prompt").addEventListener("input", () => {
  const t = $("prompt"); t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 260) + "px";
  updateSend();
});
$("prompt").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) $("composer").requestSubmit();
});
$("ctx-policy").addEventListener("click", () => openPolicy());

$("composer").addEventListener("submit", async (event) => {
  event.preventDefault();
  if ($("send").disabled) return;
  $("send").disabled = true;
  message("composer-msg", "Avvio del Planning…");
  try {
    const {request} = await api("POST", "/api/requests",
      {repository: selectedRepo.repository.name, requirement: $("prompt").value});
    const {session} = await api("POST", "/api/requests/" + request.id + "/planning",
      {mode: sessionMode(), gemini_consent: true});
    $("prompt").value = ""; message("composer-msg", "");
    location.hash = "#/session/" + session.id;
  } catch (error) { message("composer-msg", error.message, "error"); updateSend(); }
});

// =====================================================================
// Policy dialog (OPA rules only; the project test profile is kept as is)
// =====================================================================
function openPolicy(section) {
  if (!selectedRepo) return;
  loadStagingForm(section === "staging");
  const p = selectedRepo.policy, f = $("policy-form").elements, r = selectedRepo.repository;
  $("policy-repo").textContent = r.owner + "/" + r.name;
  $("policy-source").textContent = {default: "predefinita", saved: "salvata"}[selectedRepo.policy_source] ??
    "predefinita (quella salvata non era più valida)";
  f.protected_branches.value = p.protected_branches.join("\n");
  f.forbidden_path_prefixes.value = p.forbidden_path_prefixes.join("\n");
  f.work_branch_prefix.value = p.work_branch_prefix + "<sessione>";
  f.allow_pull_request.checked = p.allow_pull_request;
  message("policy-msg", "");
  if (!$("policy-dialog").open) $("policy-dialog").showModal();
}
$("policy-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const f = event.target.elements, r = selectedRepo.repository, p = selectedRepo.policy;
  try {
    selectedRepo = await api("PUT", "/api/repos/" + encodeURIComponent(r.name) + "/policy", {
      version: 2, repository: {owner: r.owner, name: r.name}, base_branch: p.base_branch ?? r.default_branch,
      protected_branches: lines(f.protected_branches.value),
      work_branch_prefix: p.work_branch_prefix,
      forbidden_path_prefixes: lines(f.forbidden_path_prefixes.value),
      // Not edited here: kept exactly as the repository's current profile.
      project_profile: p.project_profile,
      allow_pull_request: f.allow_pull_request.checked,
      agents_may_merge: false
    });
    openPolicy(); renderContext();
    if (selectedRepo.opa_published) message("policy-msg", "Policy salvata e applicata da OPA.", "ok");
    else message("policy-msg", "Policy salvata ma NON applicata: " +
      (selectedRepo.opa_error || "OPA non raggiungibile") + ". Controlla le Impostazioni.", "error");
  } catch (error) { message("policy-msg", error.message, "error"); }
});
// Staging profile (same dialog, separate form: not part of the OPA policy)
async function loadStagingForm(focus) {
  const form = $("staging-form"), f = form.elements;
  message("staging-msg", ""); $("staging-state").textContent = "";
  try {
    const data = await api("GET", "/api/repos/" + encodeURIComponent(selectedRepo.repository.name) + "/staging");
    form.hidden = false;
    const d = data.detection;
    const p = data.profile || d?.proposal ||
      {enabled: false, image: "node:22.15.0-bookworm", build: "", start: "", port: 3000};
    f.enabled.checked = !!data.profile?.enabled; f.image.value = p.image; f.build.value = p.build;
    f.start.value = p.start; f.port.value = p.port;
    const st = data.status;
    const detected = data.profile ? "" : !d ? "Non configurata." :
      d.interface === "web" ? "Proposta rilevata automaticamente (" + d.reason + "): controllala, attiva l'interruttore e salva."
      : "Interfaccia non disponibile: " + d.reason + "." + (d.proposal ? " Proposta precompilata, disattivata." : "") +
        " Puoi comunque configurarla a mano.";
    $("staging-state").textContent = !st ? (data.profile ? "Nessun deploy ancora registrato." : detected) :
      (st.live_sha ? "Attiva: main @ " + st.live_sha.slice(0, 7) + " su " + st.url + ". " : "") +
      (st.message || "") + (st.state === "failed" ? " Correggi i comandi o premi «Salva app di prova» per riprovare." : "");
    if (focus) form.scrollIntoView({block: "start"});
  } catch { form.hidden = true; }
}
$("staging-detect").addEventListener("click", async () => {
  try {
    await api("POST", "/api/repos/" + encodeURIComponent(selectedRepo.repository.name) + "/staging/detect");
    await loadStagingForm(false);
    message("staging-msg", "Repository analizzata di nuovo.", "ok");
    loadRepos();
  } catch (error) { message("staging-msg", error.message, "error"); }
});
$("staging-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const f = event.target.elements;
  try {
    await api("PUT", "/api/repos/" + encodeURIComponent(selectedRepo.repository.name) + "/staging", {
      version: 1, enabled: f.enabled.checked, image: f.image.value.trim(), build: f.build.value.trim(),
      start: f.start.value.trim(), port: Number(f.port.value)});
    await loadStagingForm(false);
    message("staging-msg", f.enabled.checked ? "Salvato: il servizio di staging pubblica main entro pochi secondi " +
      "(la prima build può richiedere qualche minuto)." : "Salvato: app di prova disattivata.", "ok");
    loadRepos();
  } catch (error) { message("staging-msg", error.message, "error"); }
});
$("policy-reset").addEventListener("click", async () => {
  if (selectedRepo) await selectRepo(selectedRepo.repository.name, true);
  openPolicy(); message("policy-msg", "Valori ricaricati (non ancora salvati).");
});

// =====================================================================
// Session view: live activity, steps, approval pop-up, Draft PR
// =====================================================================
const MODES = {gemini: "Gemini",
  scripted: "Simulato (nessuna IA)"};
const STEPS = ["Planning", "Approvazione", "Esecuzione", "Test", "Draft PR"];

/** "gitea://gitea.local/o/r/branches/feature%2Fx/files/a/b.ts" -> {branch, path} */
function describeResource(uri) {
  const m = /^gitea:\/\/[^/]+\/[^/]+\/[^/]+(?:\/branches\/([^/]+)(?:\/files\/(.+))?)?$/u.exec(uri || "");
  if (!m) return {branch: "", path: uri || ""};
  return {branch: m[1] ? decodeURIComponent(m[1]) : "",
    path: m[2] ? m[2].split("/").map(decodeURIComponent).join("/") : (m[1] ? "intero branch" : "repository")};
}

async function loadSession() {
  clearTimeout(pollTimer);
  const id = currentSession;
  let s;
  try { s = (await api("GET", "/api/sessions/" + id)).session; }
  catch (error) {
    $("sv-requirement").textContent = "Sessione non disponibile";
    $("sv-meta").textContent = error.message; return;
  }
  if (id !== currentSession) return;
  sessionData = s;
  renderHeader(s); renderSteps(s); renderBanner(s); renderFeed(s); renderStats(s); renderPr(s);
  renderGemini(s); renderGateway(s);
  if (s.phase === "awaiting_review" && !reviewOffered.has(s.id) && !$("review-dialog").open) {
    reviewOffered.add(s.id); openReview(s);
  }
  if (BUSY.has(s.phase) || s.phase === "awaiting_review")
    pollTimer = setTimeout(() => { if (currentSession === id && !$("session-view").hidden) loadSession(); }, 2000);
}

function renderHeader(s) {
  const badge = $("sv-status");
  badge.textContent = PHASES[s.phase] || s.phase;
  badge.className = "badge " + phaseClass(s.phase);
  $("sv-requirement").textContent = s.requirement;
  const meta = $("sv-meta"); meta.replaceChildren();
  meta.append(s.repository.owner + "/" + s.repository.name + " @ ");
  meta.appendChild(el("code", "", s.base_sha.slice(0, 10)));
  meta.append(" · branch ");
  meta.appendChild(el("code", "", s.work_branch));
  meta.append(" · " + (MODES[s.mode] || s.mode) + " · " + s.id);
  $("sv-review").hidden = s.phase !== "awaiting_review";
  $("sv-stop").hidden = s.phase !== "executing";
}

function reachedStep(s) {
  if (s.pull_request) return 4;
  if (s.log.some(l => /Test avviati nel Runner/u.test(l.text))) return 3;
  if (s.approval) return 2;
  if (s.proposal || s.phase === "awaiting_review") return 1;
  return 0;
}
function renderSteps(s) {
  const reached = reachedStep(s), list = $("sv-steps"); list.replaceChildren();
  const ended = !BUSY.has(s.phase) && s.phase !== "awaiting_review";
  STEPS.forEach((name, i) => {
    let state = i < reached ? "done" : i === reached ? "active" : "";
    if (i === reached && s.phase === "completed") state = "done";
    if (i === reached && ended && s.phase !== "completed") state = "failed";
    const li = el("li", "step " + state);
    li.appendChild(el("span", "step-dot", state === "done" ? "✓" : state === "failed" ? "!" : String(i + 1)));
    li.appendChild(el("span", "", name));
    list.appendChild(li);
  });
}

function renderBanner(s) {
  const banner = $("sv-banner");
  let text = "", kind = "";
  if (s.phase === "failed") { text = s.error || "Esecuzione interrotta."; kind = "fail"; }
  else if (s.phase === "completed") {
    text = s.pull_request ? "Completata: la Draft PR è pronta per la tua revisione. Il merge resta una tua decisione."
      : "Completata senza Draft PR" + (s.result?.reason ? ": " + s.result.reason : "."); kind = "ok";
  } else if (s.phase === "awaiting_review") { text = "La proposta è pronta: approva o rifiuta i permessi richiesti."; kind = "wait"; }
  else if (s.phase === "stopped") { text = "Sessione terminata: la Root è stata revocata."; kind = "wait"; }
  else if (s.phase === "interrupted") { text = "La console è stata riavviata durante questa sessione."; kind = "wait"; }
  banner.hidden = !text; banner.textContent = text; banner.className = "banner " + kind;
}

function classifyLog(text) {
  if (/^Errore|non riuscito|FAIL|Test fallito|Errore di compilazione|scartata|NO-GO/u.test(text)) return "fail";
  if (/PASS|Completata|Draft PR creata|registrata su|accettati/u.test(text)) return "ok";
  if (/MAX_TOKENS|limite di sicurezza/u.test(text)) return "warn";
  if (/Proposta pronta|Avvio dell'esecuzione|Test avviati|Root operativa|Agenti con|Agenti senza|Planner:/u.test(text)) return "milestone";
  return "";
}
function feedEvents(s) {
  let afterFail = false;
  const events = s.log.map((l, i) => {
    if (l.assignment) {
      const retry = afterFail; afterFail = false;
      return {key: "l" + i, at: l.at, kind: "assign" + (retry ? " retry" : ""), assignment: l.assignment,
        text: l.text.replace(/^Orchestrator → [^:]*: /u, ""), retry};
    }
    const kind = classifyLog(l.text);
    if (kind === "fail") afterFail = true;
    return {key: "l" + i, at: l.at, kind, text: l.text};
  });
  s.gateway_decisions.forEach((d, i) => {
    const r = describeResource(d.resource);
    const runnerFail = d.decision === "allow" && /provider_unavailable/u.test(d.reason || "");
    events.push({key: "g" + i, at: d.at, kind: d.decision !== "allow" ? "fail denied" : runnerFail ? "warn gw" : "gw",
      role: d.agent, op: d.tool, path: r.path,
      verdict: d.decision !== "allow" ? "negata dal Gateway" : runnerFail ? "eseguita: test non superati" : "consentita"});
  });
  return events.sort((a, b) => (a.at || "").localeCompare(b.at || ""));
}
function renderFeed(s) {
  const feed = $("sv-feed"), events = feedEvents(s);
  // Append only new entries (events are time-ordered and append-only).
  const known = new Set(feedKeys);
  if (events.slice(0, feedKeys.length).some((e, i) => e.key !== feedKeys[i])) { feed.replaceChildren(); feedKeys = []; known.clear(); }
  for (const e of events) {
    if (known.has(e.key)) continue;
    const li = el("li", e.kind);
    li.appendChild(el("span", "t", time(e.at)));
    li.appendChild(el("span", "ico"));
    const txt = el("span", "txt");
    if (e.assignment) {
      const who = el("span", "who", (e.retry ? "Orchestrator riassegna a " : "Orchestrator assegna un Task a "));
      txt.appendChild(who);
      txt.appendChild(el("span", "role " + e.assignment.agent, roleLabel(e.assignment.agent)));
      txt.appendChild(el("span", "instr", e.text));
      if (e.assignment.operations) txt.appendChild(el("span", "ops", e.assignment.operations));
    } else if (e.op) {
      txt.appendChild(el("span", "role " + e.role, roleLabel(e.role)));
      txt.appendChild(el("span", "op", e.op + " "));
      txt.append(e.path + " — " + e.verdict);
    } else txt.textContent = e.text;
    li.appendChild(txt); feed.appendChild(li); feedKeys.push(e.key);
  }
  if ($("sv-follow").checked) feed.scrollTop = feed.scrollHeight;
}

function stat(dl, label, value, cls) {
  const box = el("div"); box.appendChild(el("dt", "", label)); box.appendChild(el("dd", cls || "", value)); dl.appendChild(box);
}
function renderStats(s) {
  const dl = $("sv-stats"); dl.replaceChildren();
  const allowed = s.gateway_decisions.filter(d => d.decision === "allow").length;
  const denied = s.gateway_decisions.length - allowed;
  const calls = s.model_calls ?? [];
  const tokens = calls.reduce((n, c) => n + (c.total_tokens || 0), 0);
  const first = s.log[0]?.at, last = s.log.at(-1)?.at;
  const minutes = first && last ? Math.max(0, Math.round((Date.parse(last) - Date.parse(first)) / 60000)) : 0;
  stat(dl, "Consentite", allowed, "ok");
  stat(dl, "Negate", denied, denied ? "fail" : "");
  stat(dl, "Permessi firmati", s.approval ? s.approval.permission_count + "/" + s.proposal.permissions.length : "—");
  stat(dl, "Durata", minutes + " min");
  if (calls.length) { stat(dl, "Chiamate IA", calls.length); stat(dl, "Token", tokens.toLocaleString("it-IT")); }
}
function renderPr(s) {
  const card = $("sv-pr"); card.replaceChildren();
  card.hidden = !s.pull_request;
  if (!s.pull_request) return;
  const pr = s.pull_request;
  const h = el("h2"); const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use"); use.setAttribute("href", "#i-pr");
  svg.appendChild(use); h.appendChild(svg); h.append("Draft PR #" + pr.number); card.appendChild(h);
  card.appendChild(el("p", "", pr.title));
  const a = el("a", "", "Apri in Gitea");
  // Gitea is published on the local machine only.
  try { a.href = "http://127.0.0.1:3000" + new URL(pr.url).pathname; } catch { a.href = "#"; }
  a.target = "_blank"; a.rel = "noopener"; card.appendChild(a);
  // After the merge the staging service publishes the new main.
  const url = stagingUrls.get(s.repository.name);
  const note = el("p", "pr-next", "Dopo il merge in Gitea l'app di prova si aggiorna da sola in pochi minuti. ");
  if (url) {
    const app = el("a", "", "Apri l'app ↗"); app.href = url; app.target = "_blank"; app.rel = "noopener noreferrer";
    note.appendChild(app);
  }
  card.appendChild(note);
}
const ROLE_LABELS = {orchestrator: "Orchestrator", backend: "Backend", frontend: "Frontend", test: "Test",
  docs: "Documentation", data: "Data", devops: "DevOps"};
const roleLabel = (role) => ROLE_LABELS[role] || role;
const PHASE_LABELS = {"planning": "Orchestrator Planning", "adaptive-execution": "Orchestrator Execution",
  ...ROLE_LABELS};
function renderGemini(s) {
  const calls = s.model_calls ?? [];
  $("sv-gemini-box").hidden = !calls.length;
  const rows = $("sv-gemini"); rows.replaceChildren();
  for (const c of calls) {
    const tr = el("tr");
    tr.appendChild(el("td", "", time(c.at))); tr.appendChild(el("td", "", PHASE_LABELS[c.phase] || c.phase));
    tr.appendChild(el("td", c.ok ? "allow" : "deny", c.ok ? "ok" : (c.layer === "budget" ? "scartata (limite)" : "errore")));
    tr.appendChild(el("td", "", (c.ms / 1000).toFixed(1) + " s"));
    tr.appendChild(el("td", "", c.total_tokens != null ? c.input_tokens + " + " + c.output_tokens + " = " + c.total_tokens : "—"));
    tr.appendChild(el("td", "", c.finish || "")); tr.appendChild(el("td", "", (c.tools || []).join(", ")));
    tr.appendChild(el("td", "", c.error || c.preview || ""));
    rows.appendChild(tr);
  }
}
function renderGateway(s) {
  const rows = $("sv-gateway"); rows.replaceChildren();
  for (const d of s.gateway_decisions) {
    const tr = el("tr"), r = describeResource(d.resource);
    tr.appendChild(el("td", "", time(d.at))); tr.appendChild(el("td", "", d.agent)); tr.appendChild(el("td", "", d.tool));
    tr.appendChild(el("td", "", (r.branch ? r.branch + ": " : "") + r.path));
    tr.appendChild(el("td", d.decision === "allow" ? "allow" : "deny", d.decision === "allow" ? "consentita" : "negata"));
    tr.appendChild(el("td", "", (d.reason || "") + (d.detail ? " — " + d.detail : "")));
    rows.appendChild(tr);
  }
}

$("sv-review").addEventListener("click", () => openReview(sessionData));
$("sv-stop").addEventListener("click", async () => {
  if (!confirm("Interrompere l'esecuzione? La Root viene revocata e gli agenti non potranno più operare.")) return;
  try { await api("POST", "/api/sessions/" + currentSession + "/stop", {}); } catch (error) { alert(error.message); }
  await loadSession();
});

// =====================================================================
// Approval pop-up
// =====================================================================
const WORKFLOW_GRANTS = [
  ["create_branch", "senza create_branch l'esecuzione non può partire (manca il branch di lavoro)"],
  ["run_tests", "senza run_tests i test non verranno eseguiti e la Draft PR non potrà essere creata"],
  ["create_pull_request", "senza create_pull_request non verrà creata nessuna Draft PR"]
];
function updateCount() {
  const boxes = [...document.querySelectorAll("#rv-rows input")];
  const chosen = boxes.filter(b => b.checked);
  const granted = new Set(chosen.map(b => b.dataset.operation));
  const warnings = WORKFLOW_GRANTS.filter(([op]) => !granted.has(op)).map(([, text]) => "Attenzione: " + text + ".");
  message("rv-warnings", warnings.join(" "), warnings.length ? "warn" : "");
  $("rv-count").textContent = chosen.length + " di " + boxes.length + " permessi selezionati";
  $("rv-approve").disabled = chosen.length === 0;
  for (const box of boxes) box.closest("tr").classList.toggle("denied", !box.checked);
}
function openReview(s) {
  if (!s || s.phase !== "awaiting_review") return;
  $("rv-repo").textContent = s.repository.owner + "/" + s.repository.name;
  $("rv-branch").textContent = s.work_branch;
  const until = s.proposal.expires_at ? new Date(s.proposal.expires_at) : null;
  $("rv-expiry").textContent = until ? "Firmabile fino alle " + until.toLocaleTimeString("it-IT", {hour: "2-digit", minute: "2-digit"}) + " (mancano " +
    Math.max(0, Math.round((until - Date.now()) / 60000)) + " minuti); dopo va rifatto il Planning." : "";
  const note = s.mode === "scripted" ? "Proposta SIMULATA: nessun modello di IA è stato usato. Rivedi con attenzione ogni permesso." : "";
  $("rv-simulated").hidden = !note; $("rv-simulated").textContent = note;
  for (const [id, items] of [["rv-assumptions", s.proposal.assumptions], ["rv-uncertainties", s.proposal.uncertainties]]) {
    const list = $(id); list.replaceChildren();
    for (const t of items.length ? items : ["(nessuna)"]) list.appendChild(el("li", "", t));
  }
  const rows = $("rv-rows"); rows.replaceChildren();
  for (const p of s.proposal.permissions) {
    const tr = el("tr"), r = describeResource(p.resource);
    const td = el("td"), box = el("input");
    box.type = "checkbox"; box.checked = true; box.value = p.id; box.dataset.operation = p.operation;
    box.addEventListener("change", updateCount);
    td.appendChild(box); tr.appendChild(td);
    const op = el("td"); op.appendChild(el("span", "op-badge " + p.operation, p.operation)); tr.appendChild(op);
    tr.appendChild(el("td", "res-path", r.path));
    tr.addEventListener("click", (event) => { if (event.target !== box) { box.checked = !box.checked; updateCount(); } });
    rows.appendChild(tr);
  }
  $("rv-password").value = ""; message("rv-msg", "");
  updateCount();
  $("review-dialog").showModal();
}
function setAll(value) { for (const box of document.querySelectorAll("#rv-rows input")) box.checked = value; updateCount(); }
$("rv-all").addEventListener("click", () => setAll(true));
$("rv-none").addEventListener("click", () => setAll(false));
$("rv-close").addEventListener("click", () => $("review-dialog").close());
$("rv-approve").addEventListener("click", async () => {
  const ids = [...document.querySelectorAll("#rv-rows input")].filter(b => b.checked).map(b => b.value);
  const password = $("rv-password").value;
  if (!password) { message("rv-msg", "Inserisci la password per firmare.", "error"); return; }
  $("rv-approve").disabled = true; message("rv-msg", "Firma e attivazione della Root operativa…");
  try {
    await api("POST", "/api/sessions/" + currentSession + "/approve", {password, permission_ids: ids});
    $("review-dialog").close();
  } catch (error) { message("rv-msg", error.message, "error"); $("rv-approve").disabled = false; }
  $("rv-password").value = "";
  await loadSession();
});
$("rv-reject").addEventListener("click", async () => {
  if (!confirm("Rifiutare la proposta? La Root preliminare viene revocata e la sessione termina.")) return;
  try {
    await api("POST", "/api/sessions/" + currentSession + "/stop", {});
    $("review-dialog").close();
  } catch (error) { message("rv-msg", error.message, "error"); }
  await loadSession();
});

// =====================================================================
// Bootstrap
// =====================================================================
(async () => {
  try {
    const who = await api("GET", "/api/me");
    if (who.username) await showApp(who.username, who.gemini_available); else showLogin();
  } catch { showLogin(); }
})();
