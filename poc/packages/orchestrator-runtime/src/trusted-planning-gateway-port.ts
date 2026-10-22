/**
 * Trusted Planning read-only port.
 *
 * Bind to a root actually issued by TrustedExecutionCoordinator.beginPlanning.
 * Every read crosses Gateway prepare -> Adapter-signed VP -> Gateway verifier
 * -> OPA -> pinned Gitea provider. The model only sees read-only ADK tools.
 * Neither model text nor an HTTP caller can select a credential or grant.
 */
import {deriveRequiredPermission} from "../../../apps/gateway/src/canonical.ts";
import {validatePrepareAuthorizationRequest}
  from "../../../apps/gateway/src/validation.ts";
import type {GatewayRepositoryConfig,NormalizedToolRequest}
  from "../../../apps/gateway/src/types.ts";
import type {PlanningReadPort} from "./trusted-adk-planner.ts";
import type {TrustedPlanningSnapshot}
  from "./trusted-engineer-authority.ts";
import {preliminaryReadPermissions}
  from "./trusted-engineer-authority.ts";
import {OrchestratorProtectedGatewayClient}
  from "./orchestrator-gateway-client.ts";
import type {TrustedExecutionCoordinator}
  from "./trusted-execution-coordinator.ts";

type ReadTool="read_repository"|"list_directory"|"read_file";
export interface TrustedPlanningGatewayPortConfig {
  coordinator:TrustedExecutionCoordinator;
  snapshot:TrustedPlanningSnapshot;
  gatewayBaseUrl:string;
  adapterBaseUrl:string;
  adapterToken:string;
  fetchFn?:typeof fetch;
  timeoutMs?:number;
}
function key(p:{operation:string;resource:string}){
  return p.operation+"\0"+p.resource;
}
function fail():never{
  throw Error("Trusted Planning read denied: inactive or out-of-scope read");
}
export class TrustedPlanningGatewayReadPort implements PlanningReadPort {
  readonly #coordinator:TrustedExecutionCoordinator;
  readonly #snapshot:TrustedPlanningSnapshot;
  readonly #client:OrchestratorProtectedGatewayClient;
  readonly #allowed:Set<string>;
  readonly #credentialId:string;
  constructor(config:TrustedPlanningGatewayPortConfig){
    const snapshot=structuredClone(config.snapshot);
    const root=config.coordinator.trustedPlanningAuthority();
    if(root.session_id!==snapshot.session_id||
       root.base_revision!==snapshot.base_revision)fail();
    const allowed=preliminaryReadPermissions(snapshot);
    const actual=new Set(root.permissions.map(key));
    if(actual.size!==allowed.length||
       allowed.some(p=>!actual.has(key(p))))fail();
    this.#coordinator=config.coordinator;
    this.#snapshot=snapshot;
    this.#allowed=new Set(allowed.map(key));
    this.#credentialId=root.credential_id;
    this.#client=new OrchestratorProtectedGatewayClient({
      gatewayBaseUrl:config.gatewayBaseUrl,
      adapterBaseUrl:config.adapterBaseUrl,
      adapterToken:config.adapterToken,
      rootCredentialId:root.credential_id,
      ...(config.fetchFn?{fetchFn:config.fetchFn}:{}),
      ...(config.timeoutMs?{timeoutMs:config.timeoutMs}:{})
    });
  }

  async invoke(tool:ReadTool,args:Record<string,unknown>):Promise<unknown>{
    // Bound again for every call. Approval/revocation transitions make the
    // provisional credential unusable even if the port object is retained.
    const root=this.#coordinator.trustedPlanningAuthority();
    if(root.credential_id!==this.#credentialId||
       root.session_id!==this.#snapshot.session_id||
       root.base_revision!==this.#snapshot.base_revision)fail();

    let request:NormalizedToolRequest;
    try{
      request=validatePrepareAuthorizationRequest({
        task_id:root.session_id,agent_role:"orchestrator",tool,arguments:args
      }).request;
    }catch{fail();}
    if(request.tool!==tool)fail();
    if(tool==="read_file" &&
       (request.tool!=="read_file"||request.arguments.branch!=="main"||
        !this.#snapshot.files.includes(request.arguments.path)))fail();
    if(tool==="list_directory" &&
       (request.tool!=="list_directory"||request.arguments.branch!=="main"||
        !this.#snapshot.directories.includes(request.arguments.path)))fail();
    const required=deriveRequiredPermission(
      this.#snapshot.repository as GatewayRepositoryConfig,request);
    if(!this.#allowed.has(key(required)))fail();

    const execution=await this.#client.readPlanningResource(
      root.session_id,tool,request.arguments,this.#snapshot.repository
    );
    if(!execution||typeof execution!=="object"||Array.isArray(execution))fail();
    const response=execution as Record<string,unknown>;
    if(response.provider!=="gitea"||response.performed!==true||
       response.tool!==tool||response.revision!==root.base_revision)fail();
    if(tool==="read_repository"){
      if(response.default_branch!=="main"||
         response.full_name!==
          this.#snapshot.repository.owner+"/"+
          this.#snapshot.repository.repository)fail();
    }else {
      const requested=request as Extract<NormalizedToolRequest,
        {tool:"list_directory"|"read_file"}>;
      if(response.branch!=="main"||response.path!==requested.arguments.path)fail();
    }
    // The Planner also enforces file and aggregate byte budgets.
    // No VP, Adapter token or root ID is included in this provider output.
    return execution;
  }
}
