import { GatewayError } from "./errors.ts";
import type { GiteaClient } from "./gitea-client.ts";
import type { AgentRole, NormalizedToolRequest, PreparedRequestRecord } from "./types.ts";

/**
 * Single-process, opt-in trusted Planning revision registry.
 *
 * Registration is an in-process operation for an authenticated trusted
 * coordinator, NEVER an HTTP, MCP or LLM tool. On creation the Gateway
 * obtains the revision from its own authenticated Gitea client.
 *
 * This registry is NOT a substitute for Engineer authentication or DC/VP/OPA,
 * nor does it persist sessions across Gateway replicas/restarts. A durable
 * store and authenticated bootstrap are required for live Planning.
 */
const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const MAX_PLANNING_TTL_MS = 15 * 60 * 1000;

interface Session {
  readonly taskId: string;
  baseRevision: string;
  expiresAtMs: number;
  active: boolean;
}

export interface TrustedPlanningRevision {
  readonly task_id: string;
  readonly base_revision: string;
  readonly expires_at: string;
}

function planningRead(request: NormalizedToolRequest): boolean {
  return request.tool === "read_repository" ||
    ((request.tool === "list_directory" || request.tool === "read_file") &&
      request.arguments.branch === "main");
}

export class TrustedPlanningRevisions {
  readonly #client: Pick<GiteaClient, "readRepository">;
  readonly #sessions = new Map<string, Session>();
  readonly #now: () => number;

  constructor(
    authenticatedGiteaClient: Pick<GiteaClient, "readRepository">,
    options: { nowMs?: () => number } = {}
  ) {
    this.#client = authenticatedGiteaClient;
    this.#now = options.nowMs ?? Date.now;
  }

  /** Bootstrap is trusted code only: never exposed through Gateway HTTP. */
  async begin(taskId: string, ttlMs: number): Promise<TrustedPlanningRevision> {
    if (typeof taskId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(taskId) ||
        !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > MAX_PLANNING_TTL_MS) {
      throw new GatewayError(400, "invalid_planning_session", "Invalid trusted Planning session");
    }
    if (this.#sessions.has(taskId)) {
      throw new GatewayError(409, "planning_session_exists", "Planning session already registered");
    }

    // Reserve the identifier before the first await; concurrent begins cannot
    // race to register different base revisions for the same task.
    const session: Session = {
      taskId, baseRevision: "", expiresAtMs: 0, active: false
    };
    this.#sessions.set(taskId, session);
    try {
      const repository = await this.#client.readRepository();
      const now = this.#now();
      if (repository.default_branch !== "main" || !COMMIT_SHA.test(repository.revision)) {
        throw new GatewayError(
          503, "planning_revision_unavailable",
          "Trusted Gitea Planning snapshot must identify main at a full SHA-1 commit"
        );
      }
      // An issuer/Planner can never supply its own revision. The verified
      // Gitea client is the sole origin of the pinned SHA.
      session.baseRevision = repository.revision;
      session.expiresAtMs = now + ttlMs;
      session.active = true;
      return Object.freeze({
        task_id: taskId,
        base_revision: session.baseRevision,
        expires_at: new Date(session.expiresAtMs).toISOString()
      });
    } catch (error) {
      // Keep a failed ID reserved: retry under another authenticated session,
      // never silently replace a potentially observed base SHA.
      throw error;
    }
  }

  /** Ends the session and invalidates any outstanding prepare challenges. */
  end(taskId: string): void {
    const session = this.#sessions.get(taskId);
    if (!session) {
      throw new GatewayError(404, "planning_session_missing", "Unknown Planning session");
    }
    session.active = false;
  }

  /** Invoked by Gateway prepare; binds immutable revision into the request record. */
  authorizePrepare(taskId: string, role: AgentRole, request: NormalizedToolRequest): string | undefined {
    const session = this.#sessions.get(taskId);
    if (!session && !planningRead(request)) return undefined;

    // A Planning session cannot be used as an operational Task, even if
    // a model somehow obtains an operational delegation.
    if (session && (role !== "orchestrator" || !planningRead(request))) {
      throw new GatewayError(403, "planning_scope_denied", "Tool outside trusted Planning scope");
    }
    if (!session || role !== "orchestrator" || !session.active ||
        !Number.isFinite(session.expiresAtMs) || this.#now() >= session.expiresAtMs) {
      throw new GatewayError(403, "planning_session_required", "Active trusted Planning session required");
    }
    return session.baseRevision;
  }

  /** Recheck after asynchronous VP and OPA verification, before provider I/O. */
  assertActiveForExecution(record: PreparedRequestRecord): void {
    const session = this.#sessions.get(record.task_id);
    if (!session && !record.pinned_revision) return;
    if (!session || !record.pinned_revision || !COMMIT_SHA.test(record.pinned_revision) ||
        session.baseRevision !== record.pinned_revision ||
        !session.active || this.#now() >= session.expiresAtMs ||
        record.agent_role !== "orchestrator" || !planningRead(record.request)) {
      throw new GatewayError(403, "planning_revision_invalid", "Planning revision not active or mismatched");
    }
  }
}
