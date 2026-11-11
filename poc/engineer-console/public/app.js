// Engineer console front-end. All dynamic text is inserted with textContent
// (never innerHTML) so repository data cannot inject markup or scripts.
"use strict";

const $ = (id) => document.getElementById(id);
let selectedRepo = null;

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

async function showApp(username) {
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
    await showApp(data.username);
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

// ---------- bootstrap ----------
(async () => {
  try {
    const me = await api("GET", "/api/me");
    if (me.username) await showApp(me.username); else showLogin();
  } catch { showLogin(); }
})();
