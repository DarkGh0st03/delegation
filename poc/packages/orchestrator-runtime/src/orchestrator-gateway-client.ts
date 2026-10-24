/**
 * Read-only trusted Planning Gateway client. No branch/PR write shortcuts.
 * A separately authenticated coordinator pins credential scope and Gitea SHA.
 */
import {deriveRequiredPermission} from "../../../apps/gateway/src/canonical.ts";
import {validatePrepareAuthorizationRequest}
  from "../../../apps/gateway/src/validation.ts";
import type {GatewayRepositoryConfig}
  from "../../../apps/gateway/src/types.ts";
import {
  OrchestratorGatewayTransport,OrchestratorGatewayClientError,nonEmptyString
} from "./orchestrator-gateway-transport.ts";
import type {OrchestratorGatewayTransportConfig}
  from "./orchestrator-gateway-transport.ts";
export {OrchestratorGatewayClientError}
  from "./orchestrator-gateway-transport.ts";
export type {OrchestratorGatewayTransportConfig as OrchestratorPlanningGatewayReadClientConfig}
  from "./orchestrator-gateway-transport.ts";

export class OrchestratorPlanningGatewayReadClient {
  readonly #transport:OrchestratorGatewayTransport;
  constructor(config:OrchestratorGatewayTransportConfig){
    this.#transport=new OrchestratorGatewayTransport(config);
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
         (normalized.request.arguments as {branch?:string}).branch!=="main")) {
      throw new OrchestratorGatewayClientError("Planning accepts main reads only");
    }
    const permission=deriveRequiredPermission(repository,normalized.request);
    return this.#transport.invoke(
      taskId,tool,normalized.request.arguments,permission,signal);
  }


}
