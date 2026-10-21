/**
 * Shared approval-plan contract for the future trusted backend.
 *
 * This module validates plan structure and checks execution against a trusted
 * approval record. It NEVER grants a Delegation Credential, verifies a VP, or
 * replaces the Gateway/Core Rust/OPA authorization path.
 *
 * The caller MUST load approvals from an authenticated trusted store. A hash
 * alone is not proof of human consent: an attacker can recompute a hash.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export const PLAN_SCHEMA_VERSION = "1.0.0";
const SHA40 = /^[0-9a-f]{40}$/u;
const SHA64 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const OPERATION_NAME = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;

function fail(message) {
  throw new Error("Plan contract: " + message);
}
function object(value, label, required) {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    fail(label + " must be an object");
  }
  const actual = Object.keys(value);
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  const extra = actual.filter((key) => !required.includes(key));
  if (missing.length || extra.length) {
    fail(label + " fields invalid (missing: " + missing.join(",") +
      "; unexpected: " + extra.join(",") + ")");
  }
}
function nonempty(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(label + " must be nonempty");
}
function identifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) fail(label + " invalid");
}
function stringList(value, label) {
  if (!Array.isArray(value) || value.some((x) => typeof x !== "string" || !x.trim())) {
    fail(label + " must be a list of nonempty strings");
  }
  if (new Set(value).size !== value.length) fail(label + " has duplicates");
}
function resource(value) {
  nonempty(value, "resource");
  // Precise Gitea URI canonicalization remains the Gateway's responsibility.
  if (!/^[a-z][a-z0-9+.-]*:[^\s]+$/iu.test(value) ||
      /%(?![a-f0-9]{2})/iu.test(value) || value.includes("..")) {
    fail("resource must be a syntactically valid absolute URI");
  }
}
function operationCatalog(allowedOperations) {
  if (!(allowedOperations instanceof Set) || allowedOperations.size === 0) {
    fail("authoritative Rust Operation catalog is required (fail closed)");
  }
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])])
    );
  }
  return value;
}
export function planDigest(plan) {
  return createHash("sha256").update(JSON.stringify(canonical(plan))).digest("hex");
}

/**
 * Validate a proposed or human-edited plan. Caller supplies an operation set
 * derived/checked against src/delegation/authorization/operation.rs; we do not
 * maintain a second competing operation catalog.
 */
export function validatePlan(plan, { allowedOperations } = {}) {
  operationCatalog(allowedOperations);
  object(plan, "plan", [
    "schema_version", "plan_id", "session_id", "version", "repository",
    "base_revision", "requirement", "candidate_agents", "tasks",
    "requested_permissions", "assumptions", "uncertainties"
  ]);
  if (plan.schema_version !== PLAN_SCHEMA_VERSION) fail("unsupported schema version");
  identifier(plan.plan_id, "plan_id");
  identifier(plan.session_id, "session_id");
  if (!Number.isSafeInteger(plan.version) || plan.version < 1) fail("version invalid");
  object(plan.repository, "repository", ["authority", "owner", "repository"]);
  for (const key of ["authority", "owner", "repository"]) {
    nonempty(plan.repository[key], "repository." + key);
  }
  if (typeof plan.base_revision !== "string" || !SHA40.test(plan.base_revision)) {
    fail("base_revision must be a pinned 40-digit Git SHA");
  }
  nonempty(plan.requirement, "requirement");
  stringList(plan.assumptions, "assumptions");
  stringList(plan.uncertainties, "uncertainties");
  if (!Array.isArray(plan.candidate_agents) || !Array.isArray(plan.tasks) ||
      !Array.isArray(plan.requested_permissions)) fail("agent/task/permission arrays required");
  if (!plan.tasks.length) fail("at least one task required");

  const agents = new Set(["orchestrator"]);
  for (const a of plan.candidate_agents) {
    object(a, "candidate_agent", ["agent_id", "did", "card_ref"]);
    identifier(a.agent_id, "candidate_agent.agent_id");
    nonempty(a.did, "candidate_agent.did");
    nonempty(a.card_ref, "candidate_agent.card_ref");
    if (!a.did.startsWith("did:") || agents.has(a.agent_id)) fail("duplicate/invalid agent");
    agents.add(a.agent_id);
  }

  const tasks = new Map();
  for (const t of plan.tasks) {
    object(t, "task", ["id", "agent_id", "title", "description", "depends_on", "resources"]);
    identifier(t.id, "task.id");
    identifier(t.agent_id, "task.agent_id");
    if (!agents.has(t.agent_id)) fail("task assigned to unregistered agent: " + t.id);
    if (tasks.has(t.id)) fail("duplicate task: " + t.id);
    nonempty(t.title, "task.title");
    nonempty(t.description, "task.description");
    stringList(t.depends_on, "task.depends_on");
    stringList(t.resources, "task.resources");
    for (const uri of t.resources) resource(uri);
    tasks.set(t.id, t);
  }
  const visited = new Set(), visiting = new Set();
  function visit(id) {
    if (visiting.has(id)) fail("cyclic task dependencies");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of tasks.get(id).depends_on) {
      if (!tasks.has(dependency)) fail("unknown task dependency: " + dependency);
      visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of tasks.keys()) visit(id);

  const permissionIds = new Set();
  for (const p of plan.requested_permissions) {
    object(p, "requested_permission", [
      "id", "task_id", "agent_id", "resource", "operation", "reason"
    ]);
    identifier(p.id, "requested_permission.id");
    identifier(p.task_id, "requested_permission.task_id");
    identifier(p.agent_id, "requested_permission.agent_id");
    if (permissionIds.has(p.id)) fail("duplicate permission: " + p.id);
    permissionIds.add(p.id);
    const task = tasks.get(p.task_id);
    if (!task || task.agent_id !== p.agent_id) {
      fail("permission not bound to assigned agent/task: " + p.id);
    }
    resource(p.resource);
    if (!task.resources.includes(p.resource)) {
      fail("permission resource outside task: " + p.id);
    }
    if (typeof p.operation !== "string" || !OPERATION_NAME.test(p.operation) ||
        !allowedOperations.has(p.operation)) {
      fail("operation absent from authoritative Rust catalog: " + p.id);
    }
    nonempty(p.reason, "requested_permission.reason");
  }
  return plan;
}

/**
 * Trusted-backend helper. Must only run after authenticating the Engineer and
 * confirming the Engineer's real authority separately from the LLM proposal.
 * Plan edits change the digest and require a new trusted approval record.
 */
export function makeApproval(plan, options) {
  const { allowedOperations, decision_id, approved_by, approved_at,
    approved_permission_ids } = options;
  validatePlan(plan, { allowedOperations });
  identifier(decision_id, "decision_id");
  nonempty(approved_by, "approved_by");
  if (typeof approved_at !== "string" ||
      !Number.isFinite(Date.parse(approved_at))) fail("approved_at invalid");
  stringList(approved_permission_ids, "approved_permission_ids");
  if (!approved_permission_ids.length) fail("no approved permissions");
  const ids = new Set(plan.requested_permissions.map((p) => p.id));
  for (const id of approved_permission_ids) {
    if (!ids.has(id)) fail("approval references permission outside plan: " + id);
  }
  return {
    schema_version: PLAN_SCHEMA_VERSION,
    decision_id,
    plan_id: plan.plan_id,
    session_id: plan.session_id,
    plan_version: plan.version,
    plan_digest: planDigest(plan),
    approved_permission_ids: [...approved_permission_ids],
    approved_by,
    approved_at
  };
}

/**
 * Validate the scope of an already-persisted approval for ROOT ISSUANCE.
 *
 * Unlike assertApprovedExecution, this DOES NOT pretend that any tasks have
 * completed. Only an authenticated trusted backend may supply an approval.
 * A plan hash is content integrity, never authentication or human consent.
 */
export function assertApprovedPlanScope(
  plan, approval, { allowedOperations, expectedEngineerDid } = {}
) {
  validatePlan(plan, { allowedOperations });
  object(approval, "approval", [
    "schema_version", "decision_id", "plan_id", "session_id", "plan_version",
    "plan_digest", "approved_permission_ids", "approved_by", "approved_at"
  ]);
  if (approval.schema_version !== PLAN_SCHEMA_VERSION ||
      approval.plan_id !== plan.plan_id ||
      approval.session_id !== plan.session_id ||
      approval.plan_version !== plan.version ||
      typeof approval.plan_digest !== "string" || !SHA64.test(approval.plan_digest) ||
      !timingSafeEqual(Buffer.from(approval.plan_digest, "hex"),
        Buffer.from(planDigest(plan), "hex"))) {
    fail("approval version or digest does not match pinned plan");
  }
  identifier(approval.decision_id, "decision_id");
  nonempty(approval.approved_by, "approved_by");
  if(typeof expectedEngineerDid !== "string" || !expectedEngineerDid.startsWith("did:") ||
     approval.approved_by !== expectedEngineerDid) {
    fail("approval does not belong to authenticated Engineer");
  }
  if(typeof approval.approved_at !== "string" ||
     !Number.isFinite(Date.parse(approval.approved_at)))fail("approval timestamp invalid");
  stringList(approval.approved_permission_ids, "approved_permission_ids");
  if(!approval.approved_permission_ids.length)fail("no approved permissions");
  const requested=new Map(plan.requested_permissions.map(p=>[p.id,p]));
  return approval.approved_permission_ids.map(id=>{
    const item=requested.get(id);
    if(!item)fail("approval contains unplanned permission: "+id);
    return item;
  });
}

/**
 * Plan compliance preflight, NOT credential verification. The actual trusted
 * path must check this against a stored approval AND still enforce DC/VP/OPA.
 */
export function assertApprovedExecution(
  plan, approval, action, { allowedOperations, completedTaskIds = [] } = {}
) {
  validatePlan(plan, { allowedOperations });
  object(approval, "approval", [
    "schema_version", "decision_id", "plan_id", "session_id", "plan_version",
    "plan_digest", "approved_permission_ids", "approved_by", "approved_at"
  ]);
  if (approval.schema_version !== PLAN_SCHEMA_VERSION ||
      approval.plan_id !== plan.plan_id ||
      approval.session_id !== plan.session_id ||
      approval.plan_version !== plan.version ||
      typeof approval.plan_digest !== "string" || !SHA64.test(approval.plan_digest) ||
      !timingSafeEqual(Buffer.from(approval.plan_digest, "hex"),
        Buffer.from(planDigest(plan), "hex"))) {
    fail("approval version or digest does not match pinned plan");
  }
  stringList(approval.approved_permission_ids, "approved_permission_ids");
  const knownIds = new Set(plan.requested_permissions.map((p) => p.id));
  if (approval.approved_permission_ids.some((id) => !knownIds.has(id))) {
    fail("approval contains unplanned permission");
  }
  object(action, "action", ["task_id", "agent_id", "operation", "resource"]);
  const task = plan.tasks.find((t) => t.id === action.task_id);
  if (!task || task.agent_id !== action.agent_id) {
    fail("task is not assigned to requesting agent");
  }
  // Must be supplied by the trusted coordinator's persisted task state,
  // not asserted by an A2A caller or by Gemini.
  stringList(completedTaskIds, "completedTaskIds");
  for (const dependency of task.depends_on) {
    if (!completedTaskIds.includes(dependency)) {
      fail("task dependency not completed: " + dependency);
    }
  }
  const permitted = plan.requested_permissions.some((p) =>
    p.task_id === action.task_id && p.agent_id === action.agent_id &&
    p.operation === action.operation && p.resource === action.resource &&
    approval.approved_permission_ids.includes(p.id)
  );
  if (!permitted) fail("operation not approved for task/agent/resource");
  return true;
}
