import {isDeepStrictEqual} from "node:util";
import {createNativeOrchestratorPresentation}
 from "../../../packages/orchestrator-runtime/src/native-orchestrator-presentation.ts";

/** One private root effect. The canonical launcher stages its durable flight
 * between prepare and execute. The Gateway independently enforces that flight. */
export function createTrustedAuthorityOnlyRootEffectTransport({
 native,credentialId,permission,prepareGateway,executeGateway
}){
 const pin=Object.freeze({...permission});
 if(!["create_branch","create_pull_request"].includes(pin.operation)||
    typeof pin.resource!=="string"||!pin.resource||
    typeof credentialId!=="string"||!credentialId||
    typeof prepareGateway!=="function"||typeof executeGateway!=="function")
  throw Error("Invalid canonical Root effect configuration");
 const config=Object.freeze({...native});
 let started=false,consumed=false,flight;
 return Object.freeze({
  async prepare(request){
   if(started||request?.agent_role!=="orchestrator"||request.tool!==pin.operation)
    throw Error("Canonical Root effect Prepare denied");
   started=true;
   const original=structuredClone(request);
   const prepared=await prepareGateway(request);
   if(!isDeepStrictEqual(prepared?.required_permission,pin)||
      !prepared.request_id||!prepared.audience||!prepared.challenge)
    throw Error("Canonical Root effect permission mismatch");
   flight={request:original,prepared:structuredClone(prepared)};
   return prepared;
  },
  async execute({request,prepared}={}){
   if(consumed||!flight||!isDeepStrictEqual(request,flight.request)||
      !isDeepStrictEqual(prepared,flight.prepared))
    throw Error("Canonical Root effect Execute denied");
   consumed=true;
   const signed_vp=await createNativeOrchestratorPresentation(config,{
    credential_id:credentialId,disclosed_permissions:[pin],
    audience:flight.prepared.audience,challenge:flight.prepared.challenge
   });
   return executeGateway({request_id:flight.prepared.request_id,signed_vp});
  }
 });
}
