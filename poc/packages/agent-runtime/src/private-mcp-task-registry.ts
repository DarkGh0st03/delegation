import { issueTaskToken, verifyTaskToken, bearerToken, type AgentRole, type TaskClaims } from "../../../mcp-shared/src/task-token.ts";
import { parseReadFileArgs } from "../../../mcp-shared/src/catalog.ts";
import type { GatewayControlledToolClient } from "./gateway-tool-client.ts";

export class PrivateMcpTaskError extends Error {
  readonly kind: "unauthorized" | "inactive_task" | "invalid_tool_call";
  constructor(kind: "unauthorized" | "inactive_task" | "invalid_tool_call") {
    super(kind);
    this.kind = kind;
  }
}

interface ActiveTask {
  client: Pick<GatewayControlledToolClient, "invoke">;
  bearer: string;
  claims: Readonly<TaskClaims>;
  signal?: AbortSignal;
  onAbort?: () => void;
}

/**
 * Lives in a trusted Agent runtime, NOT in the shared MCP process.
 * This registry holds the existing Gateway client and the per-task evidence
 * indirectly through its private closure. The shared MCP server only sees
 * a short-lived signed task token and the application tool arguments.
 */
export class PrivateMcpTaskRegistry {
  readonly #role: AgentRole;
  readonly #signingKey: string;
  readonly #verificationKey: string;
  readonly #active = new Map<string, ActiveTask>();

  constructor(config: {
    role: AgentRole;
    signingPrivateKeyPem: string;
    signingPublicKeyPem: string;
  }) {
    this.#role = config.role;
    this.#signingKey = config.signingPrivateKeyPem;
    this.#verificationKey = config.signingPublicKeyPem;
  }

  begin(
    taskId: string,
    client: Pick<GatewayControlledToolClient, "invoke">,
    signal?: AbortSignal
  ): void {
    if (this.#active.has(taskId)) throw new Error("Duplicate active MCP task");
    if (signal?.aborted) throw new PrivateMcpTaskError("inactive_task");
    const bearer = issueTaskToken(this.#signingKey, this.#role, taskId);
    const claims = verifyTaskToken(bearer, { [this.#role]: this.#verificationKey });
    const task: ActiveTask = {client, bearer, claims, signal};
    if (signal) {
      task.onAbort = () => this.end(taskId);
      signal.addEventListener("abort", task.onAbort, {once:true});
    }
    this.#active.set(taskId, task);
  }

  /** Only the trusted ADK client factory may read this value; never pass to Gemini. */
  bearerFor(taskId: string): string {
    const task = this.#active.get(taskId);
    if (!task || task.signal?.aborted) throw new PrivateMcpTaskError("inactive_task");
    // Rotate on demand for lengthy LLM tasks; old tokens become invalid at worker.
    if (task.claims.exp - Math.floor(Date.now()/1000) <= 30) {
      task.bearer = issueTaskToken(this.#signingKey, this.#role, taskId);
      task.claims = verifyTaskToken(task.bearer, {[this.#role]:this.#verificationKey});
    }
    return task.bearer;
  }

  end(taskId: string): void {
    const task = this.#active.get(taskId);
    if (task?.signal && task.onAbort) task.signal.removeEventListener("abort", task.onAbort);
    this.#active.delete(taskId);
  }

  async invoke(authorizationHeader: string | undefined, request: unknown): Promise<unknown> {
    let token: string;
    let claims: Readonly<TaskClaims>;
    try {
      token = bearerToken(authorizationHeader);
      claims = verifyTaskToken(token, {[this.#role]: this.#verificationKey});
    } catch {
      throw new PrivateMcpTaskError("unauthorized");
    }

    const task = this.#active.get(claims.task_id);
    if (!task || task.bearer !== token || task.claims.jti !== claims.jti || task.signal?.aborted) {
      throw new PrivateMcpTaskError("inactive_task");
    }

    if (request === null || typeof request !== "object" || Array.isArray(request)) {
      throw new PrivateMcpTaskError("invalid_tool_call");
    }
    const payload = request as Record<string,unknown>;
    if (Object.keys(payload).sort().join(",") !== "arguments,tool" || payload.tool !== "read_file") {
      throw new PrivateMcpTaskError("invalid_tool_call");
    }
    let args;
    try { args = parseReadFileArgs(payload.arguments); }
    catch { throw new PrivateMcpTaskError("invalid_tool_call"); }

    const result = await task.client.invoke("read_file", args);
    // If cancellation raced with the network call, never advertise success.
    if (task.signal?.aborted || this.#active.get(claims.task_id) !== task) {
      throw new PrivateMcpTaskError("inactive_task");
    }
    return result;
  }
}
