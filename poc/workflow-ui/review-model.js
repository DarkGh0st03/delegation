"use strict";
/**
 * Browser-only state and validation for the UNTRUSTED offline mock.
 * Never use these checks to issue DCs or authorize real execution.
 * The backend must use plan-contracts + Rust/Gateway/OPA independently.
 */
(function () {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const fail = (message) => { throw new Error(message); };
  const validId = (value) => typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
  const validResource = (value, repository) => {
    if (typeof value !== "string" || !/^[a-z][a-z0-9+.-]*:[^\s]+$/iu.test(value) ||
        /%(?![0-9a-f]{2})/iu.test(value) || value.includes("..")) return false;
    const base = "gitea://" + repository.authority.toLowerCase() + "/" +
      encodeURIComponent(repository.owner) + "/" + encodeURIComponent(repository.repository);
    return value === base || value.startsWith(base + "/");
  };
  const canonical = (value) => Array.isArray(value) ? value.map(canonical) :
    value !== null && typeof value === "object" ?
      Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) :
      value;
  const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

  function validateDemoPlan(plan, operationChoices) {
    if (plan?.schema_version !== "1.0.0" || !validId(plan.plan_id) ||
        !validId(plan.session_id) || !Number.isSafeInteger(plan.version) ||
        plan.version < 1 || !/^[0-9a-f]{40}$/u.test(plan.base_revision)) {
      fail("Identificativo, versione, schema o revisione del piano non validi.");
    }
    const repo = plan.repository;
    if (!repo || !["authority","owner","repository"].every((k) =>
      typeof repo[k] === "string" && repo[k].trim())) fail("Repository non valida.");
    if (typeof plan.requirement !== "string" || !plan.requirement.trim()) fail("Requisito vuoto.");
    if (!Array.isArray(plan.candidate_agents) || !Array.isArray(plan.tasks) ||
        !plan.tasks.length || !Array.isArray(plan.requested_permissions) ||
        !Array.isArray(plan.assumptions) || !Array.isArray(plan.uncertainties)) {
      fail("Piano incompleto.");
    }
    const agents = new Set(["orchestrator"]);
    for (const a of plan.candidate_agents) {
      if (!validId(a.agent_id) || agents.has(a.agent_id) ||
          typeof a.did !== "string" || !a.did.startsWith("did:") ||
          typeof a.card_ref !== "string" || !a.card_ref) fail("Agent Card non valida.");
      agents.add(a.agent_id);
    }
    const tasks = new Map();
    for (const t of plan.tasks) {
      if (!validId(t.id) || tasks.has(t.id) || !agents.has(t.agent_id) ||
          !t.title?.trim() || !t.description?.trim() ||
          !Array.isArray(t.depends_on) || new Set(t.depends_on).size !== t.depends_on.length ||
          !Array.isArray(t.resources) || new Set(t.resources).size !== t.resources.length ||
          t.resources.some((r) => !validResource(r, repo))) {
        fail("Task o risorse non validi: " + String(t.id));
      }
      tasks.set(t.id, t);
    }
    const visiting = new Set(), visited = new Set();
    function visit(id) {
      if (visited.has(id)) return;
      if (!tasks.has(id) || visiting.has(id)) fail("Dipendenza inesistente o ciclica.");
      visiting.add(id);
      for (const dep of tasks.get(id).depends_on) visit(dep);
      visiting.delete(id); visited.add(id);
    }
    for (const id of tasks.keys()) visit(id);
    const ids = new Set();
    for (const p of plan.requested_permissions) {
      const task = tasks.get(p.task_id);
      if (!validId(p.id) || ids.has(p.id) || !task ||
          task.agent_id !== p.agent_id || !task.resources.includes(p.resource) ||
          !validResource(p.resource, repo) || !operationChoices.includes(p.operation) ||
          typeof p.reason !== "string" || !p.reason.trim()) {
        fail("Permission non coerente con il Task o la risorsa: " + String(p.id));
      }
      ids.add(p.id);
    }
    return true;
  }
  function createState(fixture) {
    const plan = clone(fixture);
    return {
      original: clone(fixture), plan,
      included: new Set(plan.requested_permissions.map((p) => p.id)),
      sequence: 1, review: null
    };
  }
  function touch(state, changesPlan = true) {
    if (changesPlan) state.plan.version += 1;
    state.review = null;
  }
  function setRequirement(state, value) {
    if (state.plan.requirement === value) return;
    state.plan.requirement = value; touch(state);
  }
  function setTaskAgent(state, taskId, agentId) {
    const task = state.plan.tasks.find((t) => t.id === taskId);
    if (!task || !["orchestrator",...state.plan.candidate_agents.map((a)=>a.agent_id)].includes(agentId)) {
      fail("Agente non presente nel registro mock.");
    }
    if (task.agent_id === agentId) return;
    task.agent_id = agentId;
    for (const p of state.plan.requested_permissions) {
      if (p.task_id === taskId) p.agent_id = agentId;
    }
    touch(state);
  }
  function togglePermission(state, permissionId, enabled) {
    if (!state.plan.requested_permissions.some((p) => p.id === permissionId)) fail("Permission inesistente.");
    if (enabled) state.included.add(permissionId); else state.included.delete(permissionId);
    // Choosing which proposed permissions to approve does not mutate the plan.
    touch(state, false);
  }
  function editPermission(state, permissionId, field, value) {
    const p = state.plan.requested_permissions.find((p) => p.id === permissionId);
    if (!p || !["task_id","resource","operation","reason"].includes(field)) {
      fail("Campo permission sconosciuto.");
    }
    if (p[field] === value) return;
    p[field] = value;
    const task = state.plan.tasks.find((t) => t.id === p.task_id);
    if (field === "task_id") {
      if (!task) fail("Task destinazione sconosciuto.");
      p.agent_id = task.agent_id;
      if (!task.resources.includes(p.resource)) p.resource = task.resources[0] || "";
    }
    if (field === "resource" && task && value && !task.resources.includes(value)) {
      // A resource edit also updates the displayed task scope, which is
      // consequently covered by the incremented plan version and digest.
      task.resources.push(value);
    }
    touch(state);
  }
  function addPermission(state) {
    const task = state.plan.tasks.find((t)=>t.agent_id !== "orchestrator" && t.resources.length) ||
      state.plan.tasks.find((t)=>t.resources.length);
    if (!task) fail("Nessun Task con risorse disponibili.");
    let id;
    do { id = "manual-" + state.sequence++; }
    while (state.plan.requested_permissions.some((p) => p.id === id));
    state.plan.requested_permissions.push({
      id, task_id:task.id, agent_id:task.agent_id, operation:"read_file",
      resource:task.resources[0], reason:"Permission proposta manualmente (mock)"
    });
    state.included.add(id); touch(state); return id;
  }
  function removePermission(state, id) {
    if (!state.plan.requested_permissions.some((p)=>p.id===id)) fail("Permission inesistente.");
    state.plan.requested_permissions = state.plan.requested_permissions.filter((p)=>p.id!==id);
    state.included.delete(id); touch(state);
  }
  function differences(state) {
    const before = state.original, after = state.plan;
    const changes = [];
    if (before.requirement !== after.requirement) changes.push("Requisito modificato");
    const prevTasks = new Map(before.tasks.map((t)=>[t.id,t]));
    for (const t of after.tasks) {
      const old = prevTasks.get(t.id);
      if (!old) changes.push("Task aggiunto: " + t.id);
      else if (t.agent_id !== old.agent_id) changes.push("Riassegnazione " + t.id +
        ": " + old.agent_id + " → " + t.agent_id);
      else if (!equal(t,old)) changes.push("Task modificato: " + t.id);
    }
    const prevPermissions = new Map(before.requested_permissions.map((p)=>[p.id,p]));
    const currentIds = new Set(after.requested_permissions.map((p)=>p.id));
    for (const p of after.requested_permissions) {
      const old = prevPermissions.get(p.id);
      if (!old) changes.push("Permission aggiunta: " + p.id);
      else if (!equal(p,old)) changes.push("Permission modificata: " + p.id);
    }
    for (const p of before.requested_permissions) {
      if (!currentIds.has(p.id)) changes.push("Permission rimossa: " + p.id);
      else if (!state.included.has(p.id)) changes.push("Permission esclusa: " + p.id);
    }
    return changes;
  }
  async function digest(plan, cryptoProvider = globalThis.crypto) {
    if (!cryptoProvider?.subtle?.digest || typeof TextEncoder === "undefined") {
      fail("SHA-256 non disponibile nel browser. Aprire con un browser moderno in contesto attendibile.");
    }
    const bytes = new TextEncoder().encode(JSON.stringify(canonical(plan)));
    const hash = await cryptoProvider.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)].map((n) => n.toString(16).padStart(2,"0")).join("");
  }
  async function makeMockReview(state, operationChoices, cryptoProvider = globalThis.crypto) {
    validateDemoPlan(state.plan, operationChoices);
    const ids = state.plan.requested_permissions.filter((p)=>state.included.has(p.id)).map((p)=>p.id);
    if (!ids.length) fail("Seleziona almeno una permission prima di confermare.");
    const review = {
      kind:"mock_authorization_review", simulated:true,
      plan:clone(state.plan), plan_digest:await digest(state.plan, cryptoProvider),
      approved_permission_ids:ids,
      excluded_permission_ids:state.plan.requested_permissions.filter((p)=>!state.included.has(p.id)).map((p)=>p.id),
      changes_from_initial_proposal:differences(state),
      notice:"SIMULAZIONE: nessuna approvazione autenticata, DC o autorità reale."
    };
    state.review = clone(review);
    return review;
  }
  globalThis.DELEGATION_REVIEW_MODEL = Object.freeze({
    createState, validateDemoPlan, setRequirement, setTaskAgent,
    togglePermission, editPermission, addPermission, removePermission,
    differences, digest, makeMockReview
  });
})();
