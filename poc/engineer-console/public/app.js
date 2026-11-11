// Engineer console front-end. All dynamic text is inserted with textContent
// (never innerHTML) so repository data cannot inject markup or scripts.
"use strict";

const $ = (id) => document.getElementById(id);
let selectedRepo = null;
let geminiAvailable = false;
let currentSession = null;   // id of the session shown in the Planning tab
let pollTimer = null;

async function api(method, path, body) {
  const response = await fetch(path, {
    method, credentials: "same-origin",
    headers: {"x-console-request": "1", ...(body ? {"content-type": "application/json"} : {})},
    ...(body ? {body: JSON.stringify(body)} : {})
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== "/api/login") { showLogin(); }
  if (!response.ok) throw new Error(data.error || ("HTTP " + response.status));
  return data;
}

function cell(row, text, className) {
  const td = document.createElement("td");
  td.textContent = text ?? "";
  if (className) td.className = className;
  row.appendChild(td);
  return td;
}

function message(id, text, isError) {
  const el = $(id);
  el.textContent = text;
  el.className = isError ? "error" : "hint";
}

function lines(text) {
  return text.split("\n").map(s => s.trim()).filter(Boolean);
}

// ---------- login ----------
function showLogin() {
  $("login-view").hidden = false; $("app-view").hidden = true;
  $("logout").hidden = true; $("whoami").textContent = "";
}

async function showApp(username, gemini) {
  geminiAvailable = !!gemini;
  $("login-view").hidden = true; $("app-view").hidden = false;
  $("logout").hidden = false; $("whoami").textContent = "Engineer: " + username;
  await loadHealth();
}

$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    const data = await api("POST", "/api/login",
      {username: form.get("username"), password: form.get("password")});
    event.target.reset(); $("login-error").textContent = "";
    const me = await api("GET", "/api/me");
    await showApp(data.username, me.gemini_available);
  } catch (error) { $("login-error").textContent = error.message; }
});

$("logout").addEventListener("click", async () => {
  await api("POST", "/api/logout").catch(() => {});
  showLogin();
});

// ---------- tabs ----------
for (const button of document.querySelectorAll("nav button")) {
  button.addEventListener("click", async () => {
    for (const b of document.querySelectorAll("nav button")) b.classList.remove("active");
    button.classList.add("active");
    for (const tab of document.querySelectorAll(".tab")) tab.hidden = true;
    $("tab-" + button.dataset.tab).hidden = false;
    if (button.dataset.tab === "env") await loadHealth();
    if (button.dataset.tab === "repo") await loadRepos();
    if (button.dataset.tab === "policy") renderPolicy();
    if (button.dataset.tab === "request") await loadRequests();
    if (button.dataset.tab === "planning") await loadPlanning();
    if (button.dataset.tab === "execution") await loadExecution();
  });
}

// ---------- environment ----------
async function loadHealth() {
  const rows = $("env-rows"); rows.replaceChildren();
  try {
    const data = await api("GET", "/api/health");
    for (const check of data.checks) {
      const tr = document.createElement("tr");
      cell(tr, check.label);
      cell(tr, check.ok ? "OK" : "NON PRONTO", check.ok ? "ok" : "fail");
      cell(tr, check.ok ? check.detail : (check.detail ? check.detail + " — " : "") + check.hint);
      rows.appendChild(tr);
    }
  } catch (error) {
    const tr = document.createElement("tr"); cell(tr, "Errore"); cell(tr, error.message, "fail");
    rows.appendChild(tr);
  }
}
$("env-refresh").addEventListener("click", loadHealth);

// ---------- repositories ----------
async function loadRepos() {
  const rows = $("repo-rows"); rows.replaceChildren();
  try {
    const data = await api("GET", "/api/repos");
    $("repo-org").textContent = data.org;
    for (const repo of data.repositories) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      const button = document.createElement("button");
      button.textContent = "Seleziona";
      button.addEventListener("click", () => selectRepo(repo.name));
      td.appendChild(button); tr.appendChild(td);
      cell(tr, repo.name); cell(tr, repo.default_branch); cell(tr, repo.updated_at);
      rows.appendChild(tr);
    }
    if (!data.repositories.length) {
      const tr = document.createElement("tr"); cell(tr, ""); cell(tr, "Nessuna repository: importane una.");
      rows.appendChild(tr);
    }
  } catch (error) {
    const tr = document.createElement("tr"); cell(tr, ""); cell(tr, error.message, "fail");
    rows.appendChild(tr);
  }
}

async function selectRepo(name) {
  try {
    selectedRepo = await api("GET", "/api/repos/" + encodeURIComponent(name));
    const r = selectedRepo.repository;
    $("repo-detail").hidden = false;
    $("sel-name").textContent = r.owner + "/" + r.name;
    $("sel-branch").textContent = r.default_branch;
    $("sel-sha").textContent = r.head_sha || "(repository vuota)";
    $("sel-protected").textContent = r.protected_branches.join(", ") || "nessuno (attenzione)";
  } catch (error) { message("import-msg", error.message, true); }
}

$("import-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  message("import-msg", "Import in corso (può richiedere un minuto)...");
  try {
    const data = await api("POST", "/api/repos/import",
      {clone_url: form.get("clone_url"), name: form.get("name")});
    message("import-msg", "Importata: " + data.repository.owner + "/" + data.repository.name);
    event.target.reset();
    await loadRepos();
    await selectRepo(data.repository.name);
  } catch (error) { message("import-msg", error.message, true); }
});

// ---------- policy ----------
function renderPolicy() {
  const has = !!selectedRepo;
  $("policy-none").hidden = has; $("policy-form").hidden = !has;
  if (!has) return;
  const p = selectedRepo.policy, f = $("policy-form").elements;
  const sources = {"default": "predefinita", "saved": "salvata"};
  $("policy-source").textContent = sources[selectedRepo.policy_source] ??
    "predefinita (quella salvata non era più valida)";
  f.protected_branches.value = p.protected_branches.join("\n");
  f.work_branch_prefix.value = p.work_branch_prefix;
  f.forbidden_path_prefixes.value = p.forbidden_path_prefixes.join("\n");
  f.runner_profile.value = p.runner_profile;
  f.allow_pull_request.checked = p.allow_pull_request;
}

$("policy-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const f = event.target.elements, r = selectedRepo.repository;
  try {
    selectedRepo = await api("PUT", "/api/repos/" + encodeURIComponent(r.name) + "/policy", {
      version: 1, repository: {owner: r.owner, name: r.name}, base_branch: r.default_branch,
      protected_branches: lines(f.protected_branches.value),
      work_branch_prefix: f.work_branch_prefix.value.trim(),
      forbidden_path_prefixes: lines(f.forbidden_path_prefixes.value),
      runner_profile: f.runner_profile.value.trim(),
      allow_pull_request: f.allow_pull_request.checked,
      agents_may_merge: false
    });
    renderPolicy();
    if (selectedRepo.opa_published) message("policy-msg", "Policy salvata e applicata da OPA.");
    else message("policy-msg", "Policy salvata, ma NON applicata: " +
      (selectedRepo.opa_error || "OPA non raggiungibile") + ". Ricontrolla la pagina Ambiente.", true);
  } catch (error) { message("policy-msg", error.message, true); }
});

$("policy-reset").addEventListener("click", async () => {
  if (selectedRepo) await selectRepo(selectedRepo.repository.name);
  renderPolicy(); message("policy-msg", "Valori ricaricati (non ancora salvati).");
});

// ---------- requirement ----------
async function loadRequests() {
  const has = !!selectedRepo;
  $("request-none").hidden = has; $("request-form").hidden = !has;
  if (has) $("request-repo").textContent = selectedRepo.repository.owner + "/" + selectedRepo.repository.name;
  const rows = $("request-rows"); rows.replaceChildren();
  try {
    const data = await api("GET", "/api/requests");
    for (const r of data.requests) {
      const tr = document.createElement("tr");
      cell(tr, r.created_at); cell(tr, r.repository.owner + "/" + r.repository.name);
      cell(tr, r.base_sha.slice(0, 12)); cell(tr, r.requirement); cell(tr, r.status);
      rows.appendChild(tr);
    }
  } catch (error) { message("request-msg", error.message, true); }
}

$("request-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("POST", "/api/requests", {
      repository: selectedRepo.repository.name,
      requirement: event.target.elements.requirement.value
    });
    event.target.reset(); message("request-msg", "Richiesta salvata.");
    await loadRequests();
  } catch (error) { message("request-msg", error.message, true); }
});

// ---------- planning ----------
const PHASES = {
  planning: "Planning in corso (Root preliminare di sola lettura)",
  awaiting_review: "In attesa della tua revisione",
  approving: "Firma e attivazione in corso",
  operational: "Root operativa attiva",
  stopping: "Revoca in corso",
  stopped: "Terminata (Root revocata)",
  failed: "Errore",
  interrupted: "Non più attiva (console riavviata)"
};
const BUSY = new Set(["planning", "approving", "stopping"]);

/** "gitea://gitea.local/o/r/branches/feature%2Fx/files/a/b.ts" -> {branch, path} */
function describeResource(uri) {
  const m = /^gitea:\/\/[^/]+\/[^/]+\/[^/]+(?:\/branches\/([^/]+)(?:\/files\/(.+))?)?$/u.exec(uri || "");
  if (!m) return {branch: "", path: uri || ""};
  return {branch: m[1] ? decodeURIComponent(m[1]) : "",
    path: m[2] ? m[2].split("/").map(decodeURIComponent).join("/") : (m[1] ? "(branch)" : "(repository)")};
}

function li(list, text) {
  const item = document.createElement("li"); item.textContent = text; list.appendChild(item);
}

async function loadPlanning() {
  $("mode-gemini").disabled = !geminiAvailable;
  $("gemini-state").textContent = geminiAvailable ? "" : "— non disponibile: GEMINI_API_KEY non configurata";
  const select = $("plan-request"); select.replaceChildren();
  try {
    const data = await api("GET", "/api/requests");
    for (const r of data.requests) {
      const option = document.createElement("option");
      option.value = r.id;
      option.textContent = r.repository.owner + "/" + r.repository.name + " @" + r.base_sha.slice(0, 8) +
        " — " + r.requirement.slice(0, 90);
      select.appendChild(option);
    }
    if (!data.requests.length) {
      const option = document.createElement("option");
      option.value = ""; option.textContent = "Nessuna richiesta: creane una nella pagina Requisito";
      select.appendChild(option);
    }
  } catch (error) { message("plan-msg", error.message, true); }
  await loadSessions();
  if (currentSession) await showSession(currentSession);
}

async function loadSessions() {
  const rows = $("session-rows"); rows.replaceChildren();
  const data = await api("GET", "/api/sessions").catch(() => ({sessions: []}));
  for (const s of data.sessions) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    const button = document.createElement("button");
    button.textContent = "Apri";
    button.addEventListener("click", () => showSession(s.id));
    td.appendChild(button); tr.appendChild(td);
    cell(tr, s.created_at.replace("T", " ").slice(0, 19));
    cell(tr, s.repository.owner + "/" + s.repository.name);
    cell(tr, s.requirement.slice(0, 80));
    cell(tr, PHASES[s.phase] || s.phase, s.phase === "failed" ? "fail" : (s.phase === "operational" ? "ok" : ""));
    rows.appendChild(tr);
  }
  return data.sessions;
}

$("plan-form").addEventListener("change", () => {
  $("gemini-consent-row").hidden = $("plan-form").elements.mode.value !== "gemini";
});

$("plan-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const f = event.target.elements;
  if (!f.request.value) return message("plan-msg", "Crea prima una richiesta.", true);
  try {
    const data = await api("POST", "/api/requests/" + f.request.value + "/planning",
      {mode: f.mode.value, gemini_consent: f.gemini_consent.checked});
    message("plan-msg", "Planning avviato.");
    await loadSessions();
    await showSession(data.session.id);
  } catch (error) { message("plan-msg", error.message, true); }
});

async function showSession(id) {
  clearTimeout(pollTimer);
  currentSession = id;
  let s;
  try { s = (await api("GET", "/api/sessions/" + id)).session; }
  catch (error) { message("plan-msg", error.message, true); return; }
  $("session-detail").hidden = false;
  $("sd-id").textContent = s.id;
  $("sd-phase").textContent = PHASES[s.phase] || s.phase;
  $("sd-phase").className = s.phase === "failed" ? "fail" : (s.phase === "operational" ? "ok" : "");
  $("sd-repo").textContent = s.repository.owner + "/" + s.repository.name + " @ " + s.base_sha.slice(0, 12);
  $("sd-branch").textContent = s.work_branch;
  $("sd-mode").textContent = s.mode === "gemini" ? "Gemini" : "Simulato (nessuna IA)";
  $("sd-error").textContent = s.error || "";
  $("sd-review").hidden = s.phase !== "awaiting_review";
  $("sd-stop").hidden = s.phase !== "operational";
  const log = $("sd-log"); log.replaceChildren();
  for (const entry of s.log) li(log, entry.at.slice(11, 19) + " — " + entry.text);
  const rows = $("sd-gateway"); rows.replaceChildren();
  for (const d of s.gateway_decisions) {
    const tr = document.createElement("tr"); const r = describeResource(d.resource);
    cell(tr, (d.at || "").slice(11, 19)); cell(tr, d.agent); cell(tr, d.tool);
    cell(tr, (r.branch ? r.branch + ": " : "") + r.path);
    cell(tr, d.decision === "allow" ? "consentita" : "negata", d.decision === "allow" ? "allow" : "deny");
    cell(tr, d.reason || "");
    rows.appendChild(tr);
  }
  sessionCache = s;
  if (BUSY.has(s.phase)) pollTimer = setTimeout(async () => {
    if (currentSession === id && !$("tab-planning").hidden) { await showSession(id); await loadSessions(); }
  }, 2500);
}
let sessionCache = null;

$("sd-review").addEventListener("click", () => openReview(sessionCache));
$("sd-stop").addEventListener("click", () => stopSession(currentSession, "plan-msg"));

async function stopSession(id, msgId) {
  if (!confirm("Revocare la Root di questa sessione? Gli agenti non potranno più operare.")) return;
  try {
    await api("POST", "/api/sessions/" + id + "/stop", {});
    message(msgId, "Root revocata.");
  } catch (error) { message(msgId, error.message, true); }
  if (!$("tab-planning").hidden) { await loadSessions(); await showSession(id); }
  if (!$("tab-execution").hidden) await loadExecution();
}

// ---------- review dialog ----------
function updateCount() {
  const boxes = [...document.querySelectorAll("#rv-rows input")];
  const n = boxes.filter(b => b.checked).length;
  $("rv-count").textContent = "Selezionati " + n + " permessi su " + boxes.length;
  $("rv-approve").disabled = n === 0;
  for (const box of boxes) box.closest("tr").classList.toggle("denied", !box.checked);
}

function openReview(s) {
  if (!s || s.phase !== "awaiting_review") return;
  $("rv-repo").textContent = s.repository.owner + "/" + s.repository.name;
  $("rv-branch").textContent = s.work_branch;
  $("rv-simulated").textContent = s.mode === "scripted"
    ? "Proposta SIMULATA: nessun modello di IA è stato usato. Rivedi con attenzione ogni permesso." : "";
  const a = $("rv-assumptions"), u = $("rv-uncertainties");
  a.replaceChildren(); u.replaceChildren();
  for (const t of s.proposal.assumptions) li(a, t);
  for (const t of s.proposal.uncertainties) li(u, t);
  if (!s.proposal.assumptions.length) li(a, "(nessuna)");
  if (!s.proposal.uncertainties.length) li(u, "(nessuna)");
  const rows = $("rv-rows"); rows.replaceChildren();
  for (const p of s.proposal.permissions) {
    const tr = document.createElement("tr"); const r = describeResource(p.resource);
    const td = document.createElement("td"); const box = document.createElement("input");
    box.type = "checkbox"; box.checked = true; box.value = p.id;
    box.addEventListener("change", updateCount);
    td.appendChild(box); tr.appendChild(td);
    cell(tr, p.operation); cell(tr, r.branch); cell(tr, r.path);
    rows.appendChild(tr);
  }
  $("rv-password").value = ""; $("rv-msg").textContent = "";
  updateCount();
  $("review-dialog").showModal();
}

function setAll(value) {
  for (const box of document.querySelectorAll("#rv-rows input")) box.checked = value;
  updateCount();
}
$("rv-all").addEventListener("click", () => setAll(true));
$("rv-none").addEventListener("click", () => setAll(false));
$("rv-close").addEventListener("click", () => $("review-dialog").close());

$("rv-approve").addEventListener("click", async () => {
  const ids = [...document.querySelectorAll("#rv-rows input")].filter(b => b.checked).map(b => b.value);
  const password = $("rv-password").value;
  if (!password) { $("rv-msg").textContent = "Inserisci la password per firmare."; return; }
  $("rv-approve").disabled = true; $("rv-msg").textContent = "Firma e attivazione della Root operativa...";
  try {
    await api("POST", "/api/sessions/" + currentSession + "/approve", {password, permission_ids: ids});
    $("review-dialog").close();
    message("plan-msg", "Permessi firmati: Root preliminare revocata e Root operativa emessa.");
  } catch (error) { $("rv-msg").textContent = error.message; $("rv-approve").disabled = false; }
  $("rv-password").value = "";
  await loadSessions(); await showSession(currentSession);
});

$("rv-reject").addEventListener("click", async () => {
  if (!confirm("Rifiutare la proposta? La Root preliminare viene revocata e la sessione termina.")) return;
  try {
    await api("POST", "/api/sessions/" + currentSession + "/stop", {});
    $("review-dialog").close();
    message("plan-msg", "Proposta rifiutata: nessuna Root operativa emessa.");
  } catch (error) { $("rv-msg").textContent = error.message; }
  await loadSessions(); await showSession(currentSession);
});

// ---------- execution ----------
async function loadExecution() {
  const rows = $("exec-rows"); rows.replaceChildren();
  const data = await api("GET", "/api/sessions").catch(() => ({sessions: []}));
  const active = data.sessions.filter(s => s.phase === "operational");
  for (const s of active) {
    const tr = document.createElement("tr");
    const td = document.createElement("td"); const button = document.createElement("button");
    button.textContent = "Interrompi (revoca la Root)";
    button.addEventListener("click", () => stopSession(s.id, "exec-msg"));
    td.appendChild(button); tr.appendChild(td);
    cell(tr, s.id); cell(tr, s.repository.owner + "/" + s.repository.name);
    cell(tr, String(s.approval?.permission_count ?? "")); cell(tr, (s.operational?.expires_at || "").replace("T", " ").slice(0, 19));
    rows.appendChild(tr);
  }
  if (!active.length) { const tr = document.createElement("tr"); cell(tr, ""); cell(tr, "Nessuna sessione con Root operativa attiva."); rows.appendChild(tr); }
}

// ---------- bootstrap ----------
(async () => {
  try {
    const me = await api("GET", "/api/me");
    if (me.username) await showApp(me.username, me.gemini_available); else showLogin();
  } catch { showLogin(); }
})();
