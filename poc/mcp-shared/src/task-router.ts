import type {AgentRole, TaskClaims} from "./task-token.ts";
import {parseReadFileArgs} from "./catalog.ts";
export type WorkerEndpoints = Readonly<Record<AgentRole,{baseUrl:string}>>;
/**
 * MCP keeps only public keys and routes to an Agent's trusted private worker.
 * The worker MUST reverify token signature, check ACTIVE task_id, and use its
 * existing per-task GatewayControlledToolClient (which owns private evidence).
 */
export class TaskRouter {
  readonly #workers: WorkerEndpoints;
  readonly #fetch: typeof fetch;
  constructor(workers: WorkerEndpoints, fetchFn: typeof fetch = fetch) {
    for (const role of ["backend","frontend","test"] as const) {
      const u=new URL(workers[role].baseUrl);
      if (!["http:","https:"].includes(u.protocol) || u.username || u.password || u.hash) {
        throw new Error("invalid_worker_endpoint");
      }
    }
    this.#workers=workers; this.#fetch=fetchFn;
  }
  async readFile(claims: Readonly<TaskClaims>, taskToken: string, raw: unknown): Promise<unknown> {
    const args=parseReadFileArgs(raw);
    const url=new URL("/internal/mcp-tool-call", this.#workers[claims.role].baseUrl);
    let response: Response;
    try {
      response=await this.#fetch(url,{
        method:"POST",
        headers:{authorization:"Bearer "+taskToken,"content-type":"application/json"},
        body:JSON.stringify({tool:"read_file",arguments:args}),
        redirect:"error",
        signal:AbortSignal.timeout(10000)
      });
    } catch { throw new Error("task_worker_unavailable"); }
    if (Number(response.headers.get("content-length"))>2_000_000) throw new Error("task_worker_invalid_result");
    let parsed: unknown;
    try {
      const body=await response.text();
      if (body.length>2_000_000) throw new Error("oversized");
      parsed=JSON.parse(body);
    } catch { throw new Error("task_worker_invalid_result"); }
    if (!response.ok) {
      const candidate = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as {error?:{kind?:unknown}}).error?.kind : undefined;
      const safe = ["authorization_denied", "invalid_tool_call", "inactive_task",
                    "unauthorized", "tool_unavailable", "tests_failed"];
      // Errors are fixed-category only. Never forward a worker's raw error text.
      throw new Error(typeof candidate === "string" && safe.includes(candidate)
        ? candidate : "task_worker_rejected");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
        (parsed as Record<string,unknown>).ok !== true || !("result" in parsed)) {
      throw new Error("task_worker_invalid_result");
    }
    return (parsed as {result:unknown}).result;
  }
}
