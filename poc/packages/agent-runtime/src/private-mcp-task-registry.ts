import {safeToolFailureReason, type ToolFailureReason} from "../../../mcp-shared/src/tool-failure-reason.ts";
import { randomUUID } from "node:crypto";
import {parseCreatePresentationArgs} from "../../../mcp-shared/src/crypto-catalog.ts";
import type {DelegationEvidenceHandler, PreparedGatewayAuthorization} from "./delegation-evidence-handler.ts";
import { issueTaskToken, verifyTaskToken, bearerToken, type AgentRole, type TaskClaims } from "../../../mcp-shared/src/task-token.ts";
import {validatePrivateApprovedBranch} from "./approved-branch.ts";
import type {ApprovedTaskFilePermission} from "./contracts.ts";
import type { GatewayControlledToolClient } from "./gateway-tool-client.ts";

export class PrivateMcpTaskError extends Error {
  readonly kind: "unauthorized" | "inactive_task" | "invalid_tool_call";
  readonly reason?: ToolFailureReason;
  constructor(kind: "unauthorized" | "inactive_task" | "invalid_tool_call", reason?: ToolFailureReason) {
    super(kind);
    this.kind = kind;
    this.reason = safeToolFailureReason(reason);
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
  approvedBranch?:string;
  /** Task-scoped path ceiling; absent only for legacy unbound sessions. */
  allowedPaths?: ReadonlySet<string>;
  /** Exact approved read/write/create operations, not merely paths. */
  allowedFilePermissions?: ReadonlySet<string>;
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
      approvedBranch?:string;
      allowedPaths?:readonly string[];
      allowedFilePermissions?:readonly ApprovedTaskFilePermission[];
      evidenceHandler?: Pick<DelegationEvidenceHandler,
        "createPresentation"|"credentialId"|"presenterId">;
    } = {}
  ): void {
    if (this.#active.has(taskId)) throw new Error("Duplicate active MCP task");
    if (signal?.aborted) throw new PrivateMcpTaskError("inactive_task");
    if(options.allowedPaths!==undefined&&(
       options.allowedPaths.length>32||
       options.allowedPaths.some(p=>typeof p!=="string"||p.length===0||
         p.length>240||p.startsWith("/")||p.includes("\\")||
         p.includes("//")||p.split("/").some(x=>
           !x||x==="."||x==="..")||
         /[\x00-\x1f\x7f]/u.test(p)))){
      throw new PrivateMcpTaskError("invalid_tool_call");
    }
    if(options.allowedFilePermissions!==undefined&&(
       options.allowedPaths===undefined||
       options.allowedFilePermissions.length>32||
       options.allowedFilePermissions.some(p=>
         !p||!["read_file","update_file","create_file"].includes(p.operation)||
         typeof p.path!=="string"||!options.allowedPaths!.includes(p.path)))){
      throw new PrivateMcpTaskError("invalid_tool_call");
    }
    if(options.approvedBranch!==undefined){
      try{validatePrivateApprovedBranch(options.approvedBranch);}
      catch{throw new PrivateMcpTaskError("invalid_tool_call");}
      if(options.allowedPaths===undefined||
         options.allowedFilePermissions===undefined)
        throw new PrivateMcpTaskError("invalid_tool_call");
    }
    const allowedOperationKeys=options.allowedFilePermissions?.map(p=>
      p.operation+"\0"+p.path);
    if(allowedOperationKeys&&new Set(allowedOperationKeys).size!==
       allowedOperationKeys.length) {
      throw new PrivateMcpTaskError("invalid_tool_call");
    }
    const bearer = issueTaskToken(this.#signingKey, this.#role, taskId);
    const claims = verifyTaskToken(bearer, { [this.#role]: this.#verificationKey });
    const task: ActiveTask = {client, bearer, claims, signal,
      pendingCrypto:new Map(), signedProofs:new Map(),
      ...(options.evidenceHandler?{evidenceHandler:options.evidenceHandler}:{}),
      ...(options.allowedPaths!==undefined
        ? {allowedPaths:new Set(options.allowedPaths)} : {}),
      ...(allowedOperationKeys!==undefined
        ? {allowedFilePermissions:new Set(allowedOperationKeys)} : {}),
      ...(options.approvedBranch!==undefined
        ?{approvedBranch:options.approvedBranch}:{}),
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
    // Bound requests currently waiting for Adapter signing, NOT completed
    // one-shot challenges. Completed request IDs remain as replay tombstones
    // until the Task ends; they must not exhaust the concurrency ceiling.
    // The separate total cap prevents a long task from retaining unbounded IDs.
    const activeChallenges=[...task.pendingCrypto.values()]
      .filter(entry=>!entry.used).length;
    if(!Number.isFinite(deadline) || deadline<=Date.now() ||
       deadline>Date.now()+120_000 ||
       activeChallenges>=8 || task.pendingCrypto.size>=256 ||
       task.pendingCrypto.has(prepared.request_id)) {
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


}
