/**
 * R151.48.3 — glue the one-use Child issuer to the concrete remote A2A
 * source handoff and the owner Planner's private source callback.
 *
 * This object is NEVER exposed to an ADK, A2A or MCP endpoint. It does
 * not issue a credential until the owner invokes dispatchRemoteDiscovery
 * after a Gateway-confirmed failed Runner Task. The actual handoff then
 * independently checks the native root, journal, Child and Gitea receipt.
 */
import {TrustedApprovedPlanChildAuthorityIssuer} from
 "./trusted-approved-child-issuer.ts";
import {TrustedRemoteDiscoveryA2AHandoff} from
 "./trusted-remote-discovery-a2a-handoff.ts";

const deny=(s:string):never=>{
 throw Error("Trusted remote discovery owner binding NO-GO: "+s);
};
export function createTrustedRemoteDiscoveryOwnerBindings(config:Readonly<{
 issuer:TrustedApprovedPlanChildAuthorityIssuer;
 handoff:TrustedRemoteDiscoveryA2AHandoff;
 issueInput:Parameters<
  TrustedApprovedPlanChildAuthorityIssuer["issueSpecializedChild"]
 >[0];
}>){
 if(!(config?.issuer instanceof TrustedApprovedPlanChildAuthorityIssuer)||
    !(config.handoff instanceof TrustedRemoteDiscoveryA2AHandoff)||
    !config.issueInput||
    config.issueInput.selection?.role!=="backend")
  deny("native-issuer backed Backend Child and actual A2A handoff required");
 let used=false;
 return Object.freeze({
  async dispatchRemoteDiscovery(){
   if(used)deny("one-use Backend discovery already attempted");
   used=true; // reserve BEFORE native issuance and remote A2A side effects
   const issued=await config.issuer.issueSpecializedChild(config.issueInput);
   if(issued.role!=="backend")deny("native child role differs from Backend");
   return config.handoff.dispatchIssuedChild(issued.credential);
  },
  loadCompletedDiscoverySource(
   pins:Readonly<{task_id:string;runtime_task_id:string;resource:string}>
  ){
   // Read from owner-only ephemeral memory after independent Gateway/VP
   // completion and private HMAC source delivery. No provider bypass.
   return config.handoff.takeVerifiedSource(pins);
  }
 });
}
