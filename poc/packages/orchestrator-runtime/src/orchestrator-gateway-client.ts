/**
 * Read-only trusted Planning Gateway client. No branch/PR write shortcuts.
 * A separately authenticated coordinator pins credential scope and Gitea SHA.
 */
import {deriveRequiredPermission} from "../../../apps/gateway/src/canonical.ts";
import {validatePrepareAuthorizationRequest}
  from "../../../apps/gateway/src/validation.ts";
import {trustedPlanningSourceBranch}
 from "./trusted-engineer-authority.ts";
import type {GatewayRepositoryConfig}
  from "../../../apps/gateway/src/types.ts";
import {
  OrchestratorGatewayTransport,OrchestratorGatewayClientError,nonEmptyString
} from "./orchestrator-gateway-transport.ts";
import type {OrchestratorGatewayTransportConfig}
  from "./orchestrator-gateway-transport.ts";
export {OrchestratorGatewayClientError}
  from "./orchestrator-gateway-transport.ts";
export type OrchestratorPlanningGatewayReadClientConfig=
 OrchestratorGatewayTransportConfig & {planningBranch?:string};

export class OrchestratorPlanningGatewayReadClient {
  readonly #transport:OrchestratorGatewayTransport;
  readonly #planningBranch:string;
  constructor(config:OrchestratorPlanningGatewayReadClientConfig){
    // This is a trusted constructor parameter from the signed snapshot.
    // Callers of readPlanningResource cannot select or widen it per call.
    this.#planningBranch=trustedPlanningSourceBranch({
      planning_branch:config.planningBranch
    });
    const {planningBranch:_trustedBranch,...transport}=config;
    this.#transport=new OrchestratorGatewayTransport(transport);
  }

  /** Multiple prevalidated snapshot actions, one pinned Gateway challenge
   * and one multipermission native VP; no arbitrary caller-defined scopes. */
  async readCompositePlanningResources(
    taskId:string,
    actions:readonly {tool:"read_file"|"list_directory";
      arguments:Record<string,unknown>}[],
    repository:GatewayRepositoryConfig,
    pinnedRevision:string,
    signal?:AbortSignal
  ):Promise<unknown>{
    if(!Array.isArray(actions)||actions.length<2||actions.length>12)
      throw new OrchestratorGatewayClientError("Invalid Planning composite size");
    const normalized=actions.map(action=>{
      const n=validatePrepareAuthorizationRequest({
        task_id:nonEmptyString(taskId,"Planning Task ID"),
        agent_role:"orchestrator",tool:action.tool,arguments:action.arguments
      });
      if(n.request.tool!=="read_file"&&n.request.tool!=="list_directory")
        throw new OrchestratorGatewayClientError("Composite Planning rejects non-read tools");
      if(n.request.arguments.branch!==this.#planningBranch)
        throw new OrchestratorGatewayClientError("Composite Planning branch differs from owner pin");
      return {tool:n.request.tool,arguments:n.request.arguments,
        permission:deriveRequiredPermission(repository,n.request)};
    });
    const actionsPinned=normalized.map(a=>({
      tool:a.tool,arguments:a.arguments
    }));
    return this.#transport.invokeReadComposite(taskId,actionsPinned,
      normalized.map(a=>a.permission),pinnedRevision,signal);
  }

  /**
   * Planning-only read transport. Must be held by the trusted read port,
   * never published to ADK as a writable/unrestricted client.
   * Authority and snapshot pinning are independently enforced by Gateway.
   */
  async readPlanningResource(
    taskId:string,
    tool:"read_repository"|"list_directory"|"read_file",
    args:Record<string,unknown>,
    repository:GatewayRepositoryConfig,
    signal?:AbortSignal
  ):Promise<unknown> {
    const normalized=validatePrepareAuthorizationRequest({
      task_id:nonEmptyString(taskId,"Planning Task ID"),
      agent_role:"orchestrator",tool,arguments:args
    });
    if(normalized.request.tool!==tool ||
       (tool!=="read_repository"&&
         (normalized.request.arguments as {branch?:string}).branch!==this.#planningBranch)||
       (tool==="read_repository"&&this.#planningBranch!=="main")) {
      throw new OrchestratorGatewayClientError(
        "Planning accepts only trusted snapshot source-branch reads");
    }
    const permission=deriveRequiredPermission(repository,normalized.request);
    return this.#transport.invoke(
      taskId,tool,normalized.request.arguments,permission,signal);
  }


}
