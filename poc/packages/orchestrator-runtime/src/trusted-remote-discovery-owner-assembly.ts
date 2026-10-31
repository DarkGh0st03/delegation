/** Owner-only late assembly: construct the remote discovery under the intake
 * created at startup, only after the original Gateway has attested Test FAIL.
 * Operator ports are configuration, never an authorization source. */
import {TrustedApprovedPlanChildAuthorityIssuer} from "./trusted-approved-child-issuer.ts";
import {TrustedRemoteDiscoveryA2AHandoff} from "./trusted-remote-discovery-a2a-handoff.ts";
import {TrustedRemoteDiscoveryOwnerBindings} from "./trusted-remote-discovery-owner-bindings.ts";

type IssuerConfig=Parameters<typeof TrustedApprovedPlanChildAuthorityIssuer.createForRemoteRepairDiscovery>[0];
type HandoffConfig=ConstructorParameters<typeof TrustedRemoteDiscoveryA2AHandoff>[0];
export type TrustedRemoteDiscoveryOwnerPorts=Readonly<
 Pick<IssuerConfig,"adapterBaseUrl"|"bearerToken"|"issuanceJournal"|"fetchFn"|"timeoutMs"> &
 Pick<HandoffConfig,"a2a"|"backendTaskBinding"|"discoveryTaskId"|"resource"|"path"|"backendAgentBaseUrl"> & {
  issueInput:ConstructorParameters<typeof TrustedRemoteDiscoveryOwnerBindings>[0]["issueInput"];
 }>;
export type TrustedRemoteDiscoveryOwnerContext=Readonly<
 Pick<HandoffConfig,"coordinator"|"gateway"|"intake"|"sessionId"|"failedRuntimeTestTaskId"> &
 Pick<IssuerConfig,"engineerDid">
>;
export async function assembleTrustedRemoteDiscoveryOwner(
 ports:TrustedRemoteDiscoveryOwnerPorts,context:TrustedRemoteDiscoveryOwnerContext
):Promise<TrustedRemoteDiscoveryOwnerBindings>{
 if(!ports?.issueInput||ports.issueInput.selection?.role!=="backend"||
    ports.issueInput.approved_task_id!==ports.discoveryTaskId)
  throw Error("Owner discovery assembly requires one exact Backend Task");
 // Explicit trusted context fields win over any extra caller-supplied keys.
 // Constructing the handoff checks the REAL Coordinator before any IPC.
 const handoff=new TrustedRemoteDiscoveryA2AHandoff({
  a2a:ports.a2a,backendTaskBinding:ports.backendTaskBinding,
  discoveryTaskId:ports.discoveryTaskId,resource:ports.resource,
  path:ports.path,backendAgentBaseUrl:ports.backendAgentBaseUrl,
  coordinator:context.coordinator,gateway:context.gateway,intake:context.intake,
  sessionId:context.sessionId,failedRuntimeTestTaskId:context.failedRuntimeTestTaskId,
  requirePrivateSourceDelivery:true
 });
 const issuer=await TrustedApprovedPlanChildAuthorityIssuer.createForRemoteRepairDiscovery({
  adapterBaseUrl:ports.adapterBaseUrl,bearerToken:ports.bearerToken,
  issuanceJournal:ports.issuanceJournal,fetchFn:ports.fetchFn,timeoutMs:ports.timeoutMs,
  coordinator:context.coordinator,gateway:context.gateway,intake:context.intake,
  sessionId:context.sessionId,engineerDid:context.engineerDid,
  failedRuntimeTestTaskId:context.failedRuntimeTestTaskId,
  discoveryTaskId:ports.discoveryTaskId,resource:ports.resource,role:"backend"
 });
 return new TrustedRemoteDiscoveryOwnerBindings({issuer,handoff,issueInput:ports.issueInput});
}
