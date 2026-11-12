/**
 * Trusted Planning read-only port.
 *
 * Bind to a root actually issued by the legacy read-only Coordinator or
 * TrustedAuthorityOnlyEngineerSession, with the exact owner snapshot.
 * Every read crosses Gateway prepare -> Adapter-signed VP -> Gateway verifier
 * -> OPA -> pinned Gitea provider. The model only sees read-only ADK tools.
 * Neither model text nor an HTTP caller can select a credential or grant.
 */
import {isDeepStrictEqual} from "node:util";
import {giteaPermissionCovers}
  from "../../plan-contracts/src/gitea-permission-containment.mjs";
import {TrustedPlanningDiscoveryLedger}
  from "./trusted-planning-discovery-ledger.ts";
import {deriveRequiredPermission} from "../../../apps/gateway/src/canonical.ts";
import {validatePrepareAuthorizationRequest}
  from "../../../apps/gateway/src/validation.ts";
import type {GatewayRepositoryConfig,NormalizedToolRequest}
  from "../../../apps/gateway/src/types.ts";
import type {PlanningReadPort} from "./trusted-adk-planner.ts";
import type {TrustedPlanningSnapshot}
  from "./trusted-engineer-authority.ts";
import {preliminaryReadPermissions,trustedPlanningSourceBranch}
  from "./trusted-engineer-authority.ts";
import {OrchestratorPlanningGatewayReadClient}
  from "./orchestrator-gateway-client.ts";
import type {TrustedExecutionCoordinator}
  from "./trusted-execution-coordinator.ts";
import {TrustedAuthorityOnlyEngineerSession}
  from "./trusted-authority-only-engineer-session.ts";
type PlanningAuthority=TrustedExecutionCoordinator|TrustedAuthorityOnlyEngineerSession;

type ReadTool="read_repository"|"list_directory"|"read_file";
export interface TrustedPlanningGatewayPortConfig {
  coordinator:PlanningAuthority;
  snapshot:TrustedPlanningSnapshot;
  gatewayBaseUrl:string;
  /** Historical HTTP presenter only; approved Rust signer needs no URL. */
  adapterBaseUrl?:string;
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
  readonly #coordinator:PlanningAuthority;
  readonly #snapshot:TrustedPlanningSnapshot;
  readonly #client:OrchestratorPlanningGatewayReadClient;
  readonly #allowed:Set<string>;
  readonly #hierarchicalGrants:readonly {resource:string;operation:string}[];
  readonly #discovery:TrustedPlanningDiscoveryLedger;
  readonly #credentialId:string;
  constructor(config:TrustedPlanningGatewayPortConfig){
    const snapshot=structuredClone(config.snapshot);
    if(config.coordinator instanceof TrustedAuthorityOnlyEngineerSession)
      config.coordinator.assertTrustedPlanningSnapshot(snapshot);
    const root=config.coordinator.trustedPlanningAuthority();
    if(root.session_id!==snapshot.session_id||
       root.base_revision!==snapshot.base_revision)fail();
    const allowed=preliminaryReadPermissions(snapshot);
    const actual=new Set(root.permissions.map(key));
    if(actual.size!==allowed.length||
       allowed.some(p=>!actual.has(key(p))))fail();
    this.#coordinator=config.coordinator;
    this.#snapshot=snapshot;
    this.#discovery=new TrustedPlanningDiscoveryLedger(snapshot);
    this.#allowed=new Set(allowed.map(key));
    // Read-only ancestor coverage is enabled ONLY by the same original
    // immutable snapshot used to issue and bind the Root. Tool arguments
    // remain limited to trusted discovered paths, not arbitrary subtrees.
    this.#hierarchicalGrants=snapshot.hierarchical_preliminary_read===true
      ?Object.freeze(allowed.map(p=>Object.freeze({...p}))):Object.freeze([]);
    this.#credentialId=root.credential_id;
    this.#client=new OrchestratorPlanningGatewayReadClient({
      gatewayBaseUrl:config.gatewayBaseUrl,
      ...(config.adapterBaseUrl!==undefined?{adapterBaseUrl:config.adapterBaseUrl}:{}),
      adapterToken:config.adapterToken,
      rootCredentialId:root.credential_id,
      planningBranch:trustedPlanningSourceBranch(snapshot),
      ...(this.#hierarchicalGrants.length?{
        trustedHierarchicalPlanningGrants:this.#hierarchicalGrants.filter(p=>
          p.operation==="read_file"||p.operation==="list_directory")
      }:{}),
      ...(config.fetchFn?{fetchFn:config.fetchFn}:{}),
      ...(config.timeoutMs?{timeoutMs:config.timeoutMs}:{})
    });
  }

  /** Private host-only binding check. This instance and its provisional
   * credential must belong to the exact active coordinator and snapshot. */
  assertTrustedPlanningBinding(coordinator:PlanningAuthority,
    snapshot:TrustedPlanningSnapshot):void{
    if(this.#coordinator!==coordinator||
       !isDeepStrictEqual(this.#snapshot,snapshot))fail();
    const root=this.#coordinator.trustedPlanningAuthority();
    if(root.credential_id!==this.#credentialId||
       root.session_id!==snapshot.session_id||
       root.base_revision!==snapshot.base_revision)fail();
  }

  /** Execute 2-12 already-authorized source observations under ONE signed
   * multipermission VP. The native Gateway verifies all actions and OPA
   * before any provider read. No operational Task or arbitrary path allowed. */
  async invokeComposite(
    actions:readonly {tool:"read_file"|"list_directory";
      arguments:Record<string,unknown>}[],
    signal?:AbortSignal
  ):Promise<unknown>{
    if(signal?.aborted||!Array.isArray(actions)||actions.length<2||
       actions.length>12)fail();
    const root=this.#coordinator.trustedPlanningAuthority();
    if(root.credential_id!==this.#credentialId||
       root.session_id!==this.#snapshot.session_id||
       root.base_revision!==this.#snapshot.base_revision)fail();
    const branch=trustedPlanningSourceBranch(this.#snapshot);
    const normalized: {tool:"read_file"|"list_directory";
      arguments:Record<string,unknown>}[]=[];
    const seen=new Set<string>();
    for(const action of actions){
      if(!action||typeof action!=="object"||
         (action.tool!=="read_file"&&action.tool!=="list_directory"))fail();
      let request:NormalizedToolRequest;
      try{
        request=validatePrepareAuthorizationRequest({
          task_id:root.session_id,agent_role:"orchestrator",
          tool:action.tool,arguments:action.arguments
        }).request;
      }catch{fail();}
      if(request.tool!=="read_file"&&request.tool!=="list_directory")fail();
      if(request.arguments.branch!==branch)fail();
      if(request.tool==="read_file"&&
         !this.#discovery.hasFile(request.arguments.path))fail();
      if(request.tool==="list_directory"&&
         !this.#discovery.hasDirectory(request.arguments.path))fail();
      const required=deriveRequiredPermission(this.#snapshot.repository,request);
      const keyValue=key(required);
      if(seen.has(keyValue)||
         (!this.#allowed.has(keyValue)&&
           !this.#hierarchicalGrants.some(parent=>
             giteaPermissionCovers(parent,required))))fail();
      seen.add(keyValue);
      normalized.push({tool:request.tool,arguments:request.arguments});
    }
    const result=await this.#client.readCompositePlanningResources(
      root.session_id,normalized,this.#snapshot.repository,
      root.base_revision,signal);
    if(signal?.aborted)fail();
    const live=this.#coordinator.trustedPlanningAuthority();
    if(live.credential_id!==this.#credentialId||
       live.base_revision!==root.base_revision)fail();
    if(!result||typeof result!=="object"||Array.isArray(result))fail();
    const value=result as Record<string,unknown>;
    if(value.decision!=="allow"||
       value.pinned_revision!==root.base_revision||
       !Array.isArray(value.executions)||
       value.executions.length!==normalized.length)fail();
    for(const [i,raw] of value.executions.entries()){
      const request=normalized[i];
      if(!raw||typeof raw!=="object"||Array.isArray(raw))fail();
      const observed=raw as Record<string,unknown>;
      if(observed.provider!=="gitea"||observed.performed!==true||
         observed.tool!==request.tool||
         observed.revision!==root.base_revision||
         observed.branch!==branch||
         observed.path!==request.arguments.path)fail();
      if(request.tool==="read_file"&&
         (observed.encoding!=="utf-8"||typeof observed.content!=="string"))fail();
      if(request.tool==="list_directory"&&
         !Array.isArray(observed.entries))fail();
    }
    // Register new paths only after ALL provider outcomes, signed bindings
    // and immutable Gitea revisions have been verified. Invalid entries
    // must not partially change the discovery ledger.
    if(this.#discovery.enabled)
      this.#discovery.observeListings(value.executions.flatMap((raw,i)=>
        normalized[i].tool==="list_directory"
          ?[{path:normalized[i].arguments.path as string,
             entries:(raw as Record<string,unknown>).entries}]
          :[]));
    return result;
  }

  async invoke(tool:ReadTool,args:Record<string,unknown>,
    signal?:AbortSignal):Promise<unknown>{
    if(signal?.aborted)fail();
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
    const sourceBranch=trustedPlanningSourceBranch(this.#snapshot);
    if(tool==="read_repository"&&sourceBranch.startsWith("feature/"))fail();
    if(tool==="read_file" &&
       (request.tool!=="read_file"||request.arguments.branch!==sourceBranch||
        !this.#discovery.hasFile(request.arguments.path)))fail();
    if(tool==="list_directory" &&
       (request.tool!=="list_directory"||request.arguments.branch!==sourceBranch||
        !this.#discovery.hasDirectory(request.arguments.path)))fail();
    const required=deriveRequiredPermission(
      this.#snapshot.repository as GatewayRepositoryConfig,request);
    if(!this.#allowed.has(key(required))&&
       !this.#hierarchicalGrants.some(parent=>
         giteaPermissionCovers(parent,required)))fail();

    const execution=await this.#client.readPlanningResource(
      root.session_id,tool,request.arguments,this.#snapshot.repository,
      signal
    );
    if(signal?.aborted)fail();
    // Reject a read whose provisional root was revoked during transport.
    const current=this.#coordinator.trustedPlanningAuthority();
    if(current.credential_id!==this.#credentialId||
       current.base_revision!==root.base_revision)fail();
    if(!execution||typeof execution!=="object"||Array.isArray(execution))fail();
    const response=execution as Record<string,unknown>;
    if(response.provider!=="gitea"||response.performed!==true||
       response.tool!==tool||response.revision!==root.base_revision)fail();
    if(tool==="read_repository"){
      if(response.default_branch!==sourceBranch||
         response.full_name!==
          this.#snapshot.repository.owner+"/"+
          this.#snapshot.repository.repository)fail();
    }else {
      const requested=request as Extract<NormalizedToolRequest,
        {tool:"list_directory"|"read_file"}>;
      if(response.branch!==sourceBranch||response.path!==requested.arguments.path)fail();
    }
    // A newly discovered path becomes visible only from a completed,
    // authenticated and SHA-pinned Gitea listing; never from model text.
    if(this.#discovery.enabled&&request.tool==="list_directory")
      this.#discovery.observeListings([{
        path:request.arguments.path,entries:response.entries
      }]);
    // The Planner also enforces file and aggregate byte budgets.
    // No VP, Adapter token or root ID is included in this provider output.
    return execution;
  }
}
