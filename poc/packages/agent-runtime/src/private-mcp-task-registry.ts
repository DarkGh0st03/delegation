import { randomUUID } from "node:crypto";
import {parseCreatePresentationArgs} from "../../../mcp-shared/src/crypto-catalog.ts";
import type {DelegationEvidenceHandler, PreparedGatewayAuthorization} from "./delegation-evidence-handler.ts";
import { issueTaskToken, verifyTaskToken, bearerToken, type AgentRole, type TaskClaims } from "../../../mcp-shared/src/task-token.ts";
import { parseReadFileArgs, parseUpdateFileArgs, parseCreateFileArgs, parseRunTestsArgs } from "../../../mcp-shared/src/catalog.ts";
import { SPECIALIZED_AGENT_PROFILES } from "./specialized-agents.ts";
import type { GatewayControlledToolClient } from "./gateway-tool-client.ts";

export class PrivateMcpTaskError extends Error {
  readonly kind: "unauthorized" | "inactive_task" | "invalid_tool_call";
  constructor(kind: "unauthorized" | "inactive_task" | "invalid_tool_call") {
    super(kind);
    this.kind = kind;
  }
}

interface PendingCryptoChallenge {
  prepared: PreparedGatewayAuthorization;
  used: boolean;
}

interface ActiveTask {
  client: Pick<GatewayControlledToolClient, "invoke">;
  /** Installed by trusted A2A handler, not the MCP server or LLM. */
  evidenceHandler?: Pick<DelegationEvidenceHandler,
    "createPresentation"|"credentialId"|"presenterId">;
  pendingCrypto: Map<string, PendingCryptoChallenge>;
  signedProofs: Map<string, string>;
  bearer: string;
  claims: Readonly<TaskClaims>;
  signal?: AbortSignal;
  allowUpdateFile: boolean;
  allowCreateFile: boolean;
  allowRunTests: boolean;
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
    signal?: AbortSignal,
    options: {
      allowUpdateFile?: boolean;
      allowCreateFile?: boolean;
      allowRunTests?: boolean;
      evidenceHandler?: Pick<DelegationEvidenceHandler,
        "createPresentation"|"credentialId"|"presenterId">;
    } = {}
  ): void {
    if (this.#active.has(taskId)) throw new Error("Duplicate active MCP task");
    if (signal?.aborted) throw new PrivateMcpTaskError("inactive_task");
    const bearer = issueTaskToken(this.#signingKey, this.#role, taskId);
    const claims = verifyTaskToken(bearer, { [this.#role]: this.#verificationKey });
    const task: ActiveTask = {client, bearer, claims, signal,
      pendingCrypto:new Map(), signedProofs:new Map(),
      ...(options.evidenceHandler?{evidenceHandler:options.evidenceHandler}:{}),
      allowUpdateFile: options.allowUpdateFile === true,
      allowCreateFile: this.#role==="test" && options.allowCreateFile===true,
      allowRunTests: this.#role==="test" && options.allowRunTests===true};
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

  /**
   * Trusted gateway-client hook. The challenge MUST originate from a real
   * Gateway prepare response and is never accepted over an HTTP endpoint.
   * The current legacy tool client does not yet call this hook.
   */
  stageGatewayChallenge(taskId:string, prepared:PreparedGatewayAuthorization):void {
    const task=this.#active.get(taskId);
    if(!task || task.signal?.aborted || !task.evidenceHandler) {
      throw new PrivateMcpTaskError("inactive_task");
    }
    if (typeof prepared.request_id!=="string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(prepared.request_id) ||
        prepared.audience!=="cloud-access-gateway" ||
        typeof prepared.challenge!=="string" ||
        !prepared.challenge.trim() || prepared.challenge.length>512 ||
        typeof prepared.required_permission?.resource!=="string" ||
        !prepared.required_permission.resource.startsWith("gitea://") ||
        typeof prepared.required_permission.operation!=="string" ||
        !prepared.required_permission.operation ||
        typeof prepared.expires_at!=="string") {
      throw new PrivateMcpTaskError("invalid_tool_call");
    }
    const deadline=Date.parse(prepared.expires_at);
    if(!Number.isFinite(deadline) || deadline<=Date.now() ||
       deadline>Date.now()+120_000 ||
       task.pendingCrypto.size>=8 || task.pendingCrypto.has(prepared.request_id)) {
      throw new PrivateMcpTaskError("invalid_tool_call");
    }
    task.pendingCrypto.set(prepared.request_id,{
      prepared:structuredClone(prepared),used:false
    });
  }

  /**
   * Trusted-only proof retrieval. No HTTP route exposes this capability to
   * Gemini, an MCP client, or any other untrusted caller.
   */
  takeSignedPresentation(taskId:string,proofRef:string):string {
    const task=this.#active.get(taskId);
    if(!task || task.signal?.aborted) {
      throw new PrivateMcpTaskError("inactive_task");
    }
    const jwt=task.signedProofs.get(proofRef);
    if(!jwt)throw new PrivateMcpTaskError("invalid_tool_call");
    task.signedProofs.delete(proofRef);
    return jwt;
  }

  /**
   * Crypto-only MCP handler. The agent supplies only a request ID; it cannot
   * choose the credential, URI, Operation, audience or challenge.
   * The signed VP is retained in trusted memory and never reaches MCP output.
   */
  async invokeCrypto(authorizationHeader:string|undefined, raw:unknown):Promise<unknown> {
    let token:string, claims:Readonly<TaskClaims>;
    try {
      token=bearerToken(authorizationHeader);
      claims=verifyTaskToken(token,{[this.#role]:this.#verificationKey});
    }catch{
      throw new PrivateMcpTaskError("unauthorized");
    }
    const task=this.#active.get(claims.task_id);
    if(!task || task.bearer!==token || task.claims.jti!==claims.jti ||
       task.signal?.aborted || !task.evidenceHandler) {
      throw new PrivateMcpTaskError("inactive_task");
    }
    if(raw===null || typeof raw!=="object" || Array.isArray(raw)){
      throw new PrivateMcpTaskError("invalid_tool_call");
    }
    const call=raw as Record<string,unknown>;
    if(Object.keys(call).sort().join(",")!=="arguments,tool" ||
       call.tool!=="delegation_create_presentation") {
      throw new PrivateMcpTaskError("invalid_tool_call");
    }
    let requestId:string;
    try {
      requestId=parseCreatePresentationArgs(call.arguments).request_id;
    }catch{throw new PrivateMcpTaskError("invalid_tool_call");}
    const pending=task.pendingCrypto.get(requestId);
    if(!pending || pending.used || Date.parse(pending.prepared.expires_at)<=Date.now()){
      throw new PrivateMcpTaskError("invalid_tool_call");
    }
    pending.used=true; // consumed before awaiting the Adapter; blocks racing replay
    const signed=await task.evidenceHandler.createPresentation(pending.prepared);
    if(task.signal?.aborted || this.#active.get(claims.task_id)!==task){
      throw new PrivateMcpTaskError("inactive_task");
    }
    if(typeof signed!=="string" || !signed.trim() ||
       task.signedProofs.size>=8) {
      throw new PrivateMcpTaskError("invalid_tool_call");
    }
    const proof_ref="proof_"+randomUUID();
    task.signedProofs.set(proof_ref,signed);
    return {
      request_id:requestId,proof_ref,prepared:true,
      credential_id:task.evidenceHandler.credentialId,
      presenter_id:task.evidenceHandler.presenterId
    };
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
    if (Object.keys(payload).sort().join(",") !== "arguments,tool" || (payload.tool !== "read_file" && payload.tool !== "update_file" && payload.tool !== "create_file" && payload.tool !== "run_tests")) {
      throw new PrivateMcpTaskError("invalid_tool_call");
    }
    let args;
    try {
      args = payload.tool === "read_file"
        ? parseReadFileArgs(payload.arguments)
        : payload.tool === "update_file"
          ? parseUpdateFileArgs(payload.arguments)
          : payload.tool === "create_file"
            ? parseCreateFileArgs(payload.arguments)
            : parseRunTestsArgs(payload.arguments);
    } catch { throw new PrivateMcpTaskError("invalid_tool_call"); }
    if (payload.tool === "update_file" &&
        (!task.allowUpdateFile ||
         !SPECIALIZED_AGENT_PROFILES[this.#role].writable_paths.includes(args.path))) {
      throw new PrivateMcpTaskError("invalid_tool_call");
    }

    if (payload.tool === "create_file" &&
        (!task.allowCreateFile || this.#role!=="test" ||
         !SPECIALIZED_AGENT_PROFILES.test.creatable_paths.includes(args.path))) {
      throw new PrivateMcpTaskError("invalid_tool_call");
    }
    if(payload.tool === "run_tests" &&
       (!task.allowRunTests || this.#role!=="test" ||
        !SPECIALIZED_AGENT_PROFILES.test.can_run_tests)){
      throw new PrivateMcpTaskError("invalid_tool_call");
    }
    const result = await task.client.invoke(payload.tool, args);
    // If cancellation raced with the network call, never advertise success.
    if (task.signal?.aborted || this.#active.get(claims.task_id) !== task) {
      throw new PrivateMcpTaskError("inactive_task");
    }
    return result;
  }
}
