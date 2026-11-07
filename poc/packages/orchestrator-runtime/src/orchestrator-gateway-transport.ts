/**
 * Internal shared Gateway prepare -> signed VP -> execute transport.
 * Never handed to ADK and never re-exported by the canonical runtime index.
 * Source encapsulation does not replace native Rust DC/VP and OPA policy.
 */
import {createNativeOrchestratorPresentation} from "./native-orchestrator-presentation.ts";
import {giteaPermissionCovers}
  from "../../plan-contracts/src/gitea-permission-containment.mjs";
type FetchLike = typeof fetch;


interface RequiredPermission {
  resource: string;
  operation: string;
}

interface PreparedAuthorization {
  request_id: string;
  audience: string;
  challenge: string;
  required_permission: RequiredPermission;
}

export interface OrchestratorGatewayTransportConfig {
  gatewayBaseUrl: string;
  /** Required for historical HTTP fixtures only; native Rust issuer needs no URL. */
  adapterBaseUrl?: string;
  adapterToken: string;
  rootCredentialId: string;
  timeoutMs?: number;
  fetchFn?: FetchLike;
  /** Original-owner issued read-only hierarchical preliminary grants.
   * NEVER tool/model supplied and NEVER used by operational Task signing. */
  trustedHierarchicalPlanningGrants?:readonly RequiredPermission[];
}


export class OrchestratorGatewayClientError extends Error {
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "OrchestratorGatewayClientError";
    this.statusCode = statusCode;
  }
}

export function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new OrchestratorGatewayClientError(
      `${label} must be a non-empty string`
    );
  }
  return value;
}

function errorMessage(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null) {
    if (
      "message" in body &&
      typeof (body as { message?: unknown }).message === "string"
    ) {
      return (body as { message: string }).message;
    }
    if (
      "error" in body &&
      typeof (body as { error?: unknown }).error === "string"
    ) {
      return (body as { error: string }).error;
    }
  }
  return fallback;
}

async function parseJson(response: Response, label: string): Promise<unknown> {
  const raw = await response.text();
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new OrchestratorGatewayClientError(
      `${label} returned invalid JSON`,
      response.status
    );
  }
}


export class OrchestratorGatewayTransport {
  readonly #gatewayBaseUrl: string;
  readonly #adapterBaseUrl: string;
  readonly #adapterToken: string;
  readonly #rootCredentialId: string;
  readonly #timeoutMs: number;
  readonly #fetch: FetchLike;
  readonly #nativeSocketPath?:string;
  readonly #hierarchicalReadGrants:readonly RequiredPermission[];

  constructor(config: OrchestratorGatewayTransportConfig) {
    this.#gatewayBaseUrl = nonEmptyString(
      config.gatewayBaseUrl,
      "Gateway base URL"
    ).replace(/\/+$/u, "");
    // Native Rust VP issuance does not depend on any Adapter HTTP address.
    // Legacy HTTP fixtures must still specify one explicitly.
    this.#adapterBaseUrl = config.adapterBaseUrl?.trim()
      ? config.adapterBaseUrl.replace(/\/+$/u, "")
      : "";
    this.#adapterToken = nonEmptyString(
      config.adapterToken,
      "Orchestrator Adapter token"
    );
    this.#rootCredentialId = nonEmptyString(
      config.rootCredentialId,
      "Orchestrator root credential id"
    );
    this.#timeoutMs = config.timeoutMs ?? 10_000;
    this.#fetch = config.fetchFn ?? fetch;
    const grants=config.trustedHierarchicalPlanningGrants??[];
    if(!Array.isArray(grants)||grants.length>3||
       grants.some(g=>!g||!["read_file","list_directory"].includes(g.operation)||
         typeof g.resource!=="string"||
         !/\/directories(?:\/[A-Za-z0-9_@.\/-]+)?$/u.test(g.resource))||
       new Set(grants.map(g=>g.operation+"\0"+g.resource)).size!==grants.length)
      throw new OrchestratorGatewayClientError(
        "Untrusted hierarchical Planning presentation configuration");
    this.#hierarchicalReadGrants=Object.freeze(grants.map(g=>
      Object.freeze({operation:g.operation,resource:g.resource})));
    // Canonical trusted-owner path shares the SAME Rust issuer as Engineer,
    // Child DC and Agent VP. Bad socket configuration fails closed.
    const socketPath=process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
    if(socketPath!==undefined){
      if(!socketPath.startsWith("/")||socketPath.length>100||
         socketPath.trim()!==socketPath)
        throw new OrchestratorGatewayClientError("Native Rust signer socket invalid");
      this.#nativeSocketPath=socketPath;
    }else if(process.env.APPROVED_RUNNER_NATIVE_MCP==="1"){
      // Refuse before Gateway prepare, rather than trying legacy Adapter
      // signing after a canonical native socket has been omitted.
      throw new OrchestratorGatewayClientError(
        "Canonical signed DAG requires native Rust Orchestrator signer socket");
    }else if(!this.#adapterBaseUrl){
      throw new OrchestratorGatewayClientError(
        "Historical Orchestrator HTTP signing requires explicit Adapter URL");
    }
  }


  /** Cancellation prevents subsequent stages and rejects late results.
   * Provider effects already initiated cannot be undone by AbortSignal. */
  #assertActive(signal?:AbortSignal):void {
    if(signal?.aborted)
      throw new OrchestratorGatewayClientError("Trusted Gateway invocation cancelled");
  }
  #requestSignal(signal?:AbortSignal):AbortSignal {
    this.#assertActive(signal);
    const timeout=AbortSignal.timeout(this.#timeoutMs);
    return signal?AbortSignal.any([signal,timeout]):timeout;
  }
  /** Only the original signed directory permission is disclosed to Rust:
   * requesting a leaf as an exact disclosure would invent a permission NOT
   * present in the preliminary credential. Gateway still challenges each
   * exact leaf and independently verifies its containment through Core Rust.
   */
  #disclosure(permissions:readonly RequiredPermission[]):readonly RequiredPermission[]{
    if(this.#hierarchicalReadGrants.length===0)return permissions;
    const selected=permissions.map(required=>{
      if(required.operation!=="read_file"&&required.operation!=="list_directory")
        return required;
      const grant=this.#hierarchicalReadGrants.find(parent=>
        giteaPermissionCovers(parent,required));
      if(!grant)
        throw new OrchestratorGatewayClientError(
          "Signed Planning Root does not cover exact Gateway challenge");
      return grant;
    });
    return [...new Map(selected.map(p=>
      [p.operation+"\0"+p.resource,p])).values()];
  }

  async invoke(
    taskId: string,
    tool: "create_branch" | "create_pull_request" |
      "read_repository"|"list_directory"|"read_file",
    args: Record<string, unknown>,
    expectedPermission?:RequiredPermission,
    signal?:AbortSignal
  ): Promise<unknown> {
    this.#assertActive(signal);
    const prepared = await this.#prepare(taskId, tool, args,signal);
    this.#assertActive(signal);
    // Fail before the Adapter can sign an unexpected permission. The trusted
    // Planning caller derives expectedPermission from its pinned snapshot.
    if(expectedPermission && (prepared.required_permission.operation !==
         expectedPermission.operation ||
       prepared.required_permission.resource!==expectedPermission.resource)){
      throw new OrchestratorGatewayClientError(
        "Gateway Planning challenge does not match trusted resource"
      );
    }
    const signedVp = await this.#createPresentation(prepared,signal,
      this.#disclosure([prepared.required_permission]));
    this.#assertActive(signal);
    const result=await this.#execute(prepared.request_id,signedVp,signal);
    this.#assertActive(signal);
    return result;
  }

  /** One verified multi-permission VP for a Planning-only read batch.
   * Never available for authority-only operational Tasks or write effects.
   * The original trusted caller supplies all exact resource pins BEFORE
   * Gateway prepare; any response widening fails before VP creation. */
  async invokeReadComposite(
    taskId:string,
    actions:readonly {tool:"read_file"|"list_directory";arguments:Record<string,unknown>}[],
    expected:readonly RequiredPermission[],
    pinnedRevision:string,
    signal?:AbortSignal
  ):Promise<unknown>{
    this.#assertActive(signal);
    if(!Array.isArray(actions)||actions.length<2||actions.length>12||
       !Array.isArray(expected)||expected.length!==actions.length||
       !/^[a-f0-9]{40}$/u.test(pinnedRevision)||
       actions.some(a=>!a||!["read_file","list_directory"].includes(a.tool))||
       expected.some(p=>!p||typeof p.resource!=="string"||
         !["read_file","list_directory"].includes(p.operation))||
       new Set(expected.map(p=>p.operation+"\0"+p.resource)).size!==expected.length)
      throw new OrchestratorGatewayClientError("Invalid trusted Planning composite request");
    let response:Response;
    try{
      response=await this.#fetch(
        this.#gatewayBaseUrl+"/v1/authorization/prepare-read-composite",{
          method:"POST",
          headers:{"content-type":"application/json",accept:"application/json"},
          body:JSON.stringify({task_id:taskId,agent_role:"orchestrator",actions}),
          signal:this.#requestSignal(signal)
        });
    }catch{
      throw new OrchestratorGatewayClientError("Trusted Planning composite prepare unavailable");
    }
    this.#assertActive(signal);
    const raw=await parseJson(response,"Planning composite prepare");
    this.#assertActive(signal);
    if(!response.ok)
      throw new OrchestratorGatewayClientError("Trusted Planning composite prepare denied",response.status);
    if(!raw||typeof raw!=="object"||Array.isArray(raw))
      throw new OrchestratorGatewayClientError("Malformed trusted Planning composite prepare");
    const prepared=raw as Record<string,unknown>;
    const perms=prepared.required_permissions;
    if(prepared.authorization_only!==false||
       prepared.pinned_revision!==pinnedRevision||
       !Array.isArray(perms)||perms.length!==expected.length||
       !perms.every((p,i)=>p&&typeof p==="object"&&
         (p as RequiredPermission).resource===expected[i].resource&&
         (p as RequiredPermission).operation===expected[i].operation))
      throw new OrchestratorGatewayClientError(
        "Gateway composite challenge differs from trusted Planning read permissions");
    const requestId=nonEmptyString(prepared.request_id,"composite request_id");
    const audience=nonEmptyString(prepared.audience,"composite audience");
    const challenge=nonEmptyString(prepared.challenge,"composite challenge");
    // Sign the Gateway-challenged EXACT set with one original Root. There is
    // no client-side privilege synthesis or per-action VP fallback.
    const signedVp=await this.#createPresentation({
      request_id:requestId,audience,challenge,required_permission:expected[0]
    },signal,this.#disclosure(expected));
    this.#assertActive(signal);
    let executed:Response;
    try{
      executed=await this.#fetch(
        this.#gatewayBaseUrl+"/v1/authorization/execute-read-composite",{
          method:"POST",
          headers:{"content-type":"application/json",accept:"application/json"},
          body:JSON.stringify({request_id:requestId,signed_vp:signedVp}),
          signal:this.#requestSignal(signal)
        });
    }catch{
      throw new OrchestratorGatewayClientError("Trusted Planning composite execution unavailable");
    }
    this.#assertActive(signal);
    const rawResult=await parseJson(executed,"Planning composite execute");
    this.#assertActive(signal);
    if(!executed.ok||!rawResult||typeof rawResult!=="object"||
       Array.isArray(rawResult))
      throw new OrchestratorGatewayClientError("Trusted Planning composite execution denied",
        executed.status);
    const result=rawResult as Record<string,unknown>;
    if(result.request_id!==requestId||result.decision!=="allow"||
       result.pinned_revision!==pinnedRevision||
       !Array.isArray(result.executions)||
       result.executions.length!==actions.length)
      throw new OrchestratorGatewayClientError("Unverified Planning composite response");
    return result;
  }

  async #prepare(
    taskId: string,
    tool: "create_branch" | "create_pull_request" |
      "read_repository"|"list_directory"|"read_file",
    args: Record<string, unknown>,
    signal?:AbortSignal
  ): Promise<PreparedAuthorization> {
    let response: Response;
    try {
      response = await this.#fetch(
        `${this.#gatewayBaseUrl}/v1/authorization/prepare`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json"
          },
          body: JSON.stringify({
            task_id: taskId,
            agent_role: "orchestrator",
            tool,
            arguments: args
          }),
          signal: this.#requestSignal(signal)
        }
      );
    } catch (error) {
      throw new OrchestratorGatewayClientError(
        `Gateway prepare is unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    this.#assertActive(signal);
    const body = await parseJson(response, "Gateway prepare");
    this.#assertActive(signal);
    if (!response.ok) {
      throw new OrchestratorGatewayClientError(
        errorMessage(
          body,
          `Gateway prepare failed with HTTP ${response.status}`
        ),
        response.status
      );
    }

    if (typeof body !== "object" || body === null) {
      throw new OrchestratorGatewayClientError(
        "Gateway prepare returned a malformed authorization challenge"
      );
    }
    const raw = body as Record<string, unknown>;
    if (
      typeof raw.required_permission !== "object" ||
      raw.required_permission === null
    ) {
      throw new OrchestratorGatewayClientError(
        "Gateway prepare response is missing required_permission"
      );
    }
    const required = raw.required_permission as Record<string, unknown>;

    return {
      request_id: nonEmptyString(raw.request_id, "request_id"),
      audience: nonEmptyString(raw.audience, "audience"),
      challenge: nonEmptyString(raw.challenge, "challenge"),
      required_permission: {
        resource: nonEmptyString(
          required.resource,
          "required_permission.resource"
        ),
        operation: nonEmptyString(
          required.operation,
          "required_permission.operation"
        )
      }
    };
  }

  async #createPresentation(
    prepared: PreparedAuthorization,signal?:AbortSignal,
    requiredPermissions?:readonly RequiredPermission[]
  ): Promise<string> {
    const input={
      credential_id:this.#rootCredentialId,
      disclosed_permissions:requiredPermissions??[prepared.required_permission],
      audience:prepared.audience,
      challenge:prepared.challenge
    };
    if(this.#nativeSocketPath){
      try{
        return await createNativeOrchestratorPresentation({
          socketPath:this.#nativeSocketPath,token:this.#adapterToken,
          timeoutMs:this.#timeoutMs
        },input,signal);
      }catch(error){
        throw new OrchestratorGatewayClientError(
          error instanceof Error?error.message:"Native Rust Orchestrator presentation denied");
      }
    }
    if(process.env.APPROVED_RUNNER_NATIVE_MCP==="1")
      throw new OrchestratorGatewayClientError(
        "Canonical signed DAG requires native Rust Orchestrator signing");
    let response: Response;
    try {
      response = await this.#fetch(
        `${this.#adapterBaseUrl}/v1/presentations`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.#adapterToken}`,
            "content-type": "application/json",
            accept: "application/json"
          },
          body: JSON.stringify(input),
          signal: this.#requestSignal(signal)
        }
      );
    } catch (error) {
      throw new OrchestratorGatewayClientError(
        `Delegation Adapter presentation is unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    this.#assertActive(signal);
    const body = await parseJson(
      response,
      "Delegation Adapter presentation"
    );
    this.#assertActive(signal);
    if (!response.ok) {
      throw new OrchestratorGatewayClientError(
        errorMessage(
          body,
          `Delegation Adapter rejected presentation with HTTP ${response.status}`
        ),
        response.status
      );
    }
    if (typeof body !== "object" || body === null) {
      throw new OrchestratorGatewayClientError(
        "Delegation Adapter returned a malformed presentation response"
      );
    }

    return nonEmptyString(
      (body as Record<string, unknown>).signed_vp,
      "signed_vp"
    );
  }

  async #execute(requestId: string, signedVp: string,
    signal?:AbortSignal): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(
        `${this.#gatewayBaseUrl}/v1/authorization/execute`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json"
          },
          body: JSON.stringify({
            request_id: requestId,
            signed_vp: signedVp
          }),
          signal: this.#requestSignal(signal)
        }
      );
    } catch (error) {
      throw new OrchestratorGatewayClientError(
        `Gateway execute is unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    this.#assertActive(signal);
    const body = await parseJson(response, "Gateway execute");
    this.#assertActive(signal);
    if (!response.ok) {
      throw new OrchestratorGatewayClientError(
        errorMessage(
          body,
          `Gateway execute failed with HTTP ${response.status}`
        ),
        response.status
      );
    }
    if (
      typeof body !== "object" ||
      body === null ||
      !("execution" in body)
    ) {
      throw new OrchestratorGatewayClientError(
        "Gateway execute response is missing execution result"
      );
    }
    return (body as { execution: unknown }).execution;
  }


}
