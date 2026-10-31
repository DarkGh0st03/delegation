/**
 * R151.49 — owner-only paired discovery binding. Native Child issuance,
 * authenticated one-use A2A discovery and SHA256-matched source delivery
 * are all tied to the SAME approved Backend Task. No A2A/MCP/model tool
 * may construct or receive this object.
 */
import {TrustedApprovedPlanChildAuthorityIssuer} from
 "./trusted-approved-child-issuer.ts";
import {TrustedRemoteDiscoveryA2AHandoff} from
 "./trusted-remote-discovery-a2a-handoff.ts";

const deny=(s:string):never=>{
 throw Error("Trusted remote discovery owner binding NO-GO: "+s);
};
export class TrustedRemoteDiscoveryOwnerBindings {
 readonly #issuer:TrustedApprovedPlanChildAuthorityIssuer;
 readonly #handoff:TrustedRemoteDiscoveryA2AHandoff;
 readonly #issueInput:Parameters<
  TrustedApprovedPlanChildAuthorityIssuer["issueSpecializedChild"]
 >[0];
 #used=false;
 constructor(config:Readonly<{
  issuer:TrustedApprovedPlanChildAuthorityIssuer;
  handoff:TrustedRemoteDiscoveryA2AHandoff;
  issueInput:Parameters<
   TrustedApprovedPlanChildAuthorityIssuer["issueSpecializedChild"]
  >[0];
 }>){
  if(!(config?.issuer instanceof TrustedApprovedPlanChildAuthorityIssuer)||
     !(config.handoff instanceof TrustedRemoteDiscoveryA2AHandoff)||
     !config.handoff.requiresPrivateSourceDelivery||
     !config.issueInput||config.issueInput.selection?.role!=="backend"||
     config.issueInput.approved_task_id!==config.handoff.discoveryTaskId)
   deny("one exact issued Backend discovery Child with mandatory private source required");
  // Cross-check coordinator identity and the ORIGINAL native root, not
  // merely a matching Task ID or a matching public Gitea URI.
  config.handoff.assertExactDiscoveryIssuer(config.issuer);
  this.#issuer=config.issuer;
  this.#handoff=config.handoff;
  this.#issueInput=Object.freeze({...config.issueInput});
 }
 async dispatchRemoteDiscovery(){
  if(this.#used)deny("one-use Backend discovery already attempted");
  this.#used=true;
  const issued=await this.#issuer.issueSpecializedChild(this.#issueInput);
  if(issued.role!=="backend")deny("native child role differs from Backend");
  return this.#handoff.dispatchIssuedChild(issued.credential);
 }
 loadCompletedDiscoverySource(
  pins:Readonly<{task_id:string;runtime_task_id:string;resource:string}>
 ){
  // Source already verified against Gateway SHA-256 and task-scoped, stored
  // in owner-private memory. Fetching it consumes the only source copy.
  return this.#handoff.takeVerifiedSource(pins);
 }
}
export function createTrustedRemoteDiscoveryOwnerBindings(config:
 ConstructorParameters<typeof TrustedRemoteDiscoveryOwnerBindings>[0]){
 return new TrustedRemoteDiscoveryOwnerBindings(config);
}
