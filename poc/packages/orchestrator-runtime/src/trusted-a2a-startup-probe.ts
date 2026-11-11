/**
 * Non-billable owner-side readiness probe between signed root activation
 * and the first approved DAG provider effect. This is NOT A2A peer
 * authentication: authority remains with signed VC/VP + Gateway/Rust/OPA.
 *
 * The endpoints MUST come from the host-owned, newly started role servers,
 * not workflow inputs, plan text or an LLM response. Never send secrets or
 * delegated credentials to this read-only probe.
 */
import {A2A_PROTOCOL_VERSION,type AgentCard} from "@a2a-js/sdk";
import {APPROVED_SPECIALIZED_AGENT_PROFILES,nativeAuthorityOnlyAdvertisedCapabilities}
  from "../../agent-runtime/src/approved-specialized-profiles.ts";
import {trustedSignerAgentDid} from "../../agent-runtime/src/cards.ts";
import {DELEGATED_AUTHORIZATION_EXTENSION_URI}
  from "../../agent-runtime/src/contracts.ts";

type Role="backend"|"frontend"|"test";
type VerifiedProfile=Readonly<{did:string;capabilities:readonly string[]}>;
// Three canonical SDK roles remain statically guaranteed; additional
// verified Owner roles may be indexed without weakening those base pins.
export type VerifiedA2AProfiles=Readonly<
 Record<Role,VerifiedProfile>&Record<string,VerifiedProfile>
>;
/** Extra specialist pins are an Owner-owned startup contract, NOT an
 * Agent Card claim, A2A-supplied registration or delegated permission. */
export interface TrustedAdditionalA2ACardPin {
 did:string;name:string;skillId:string;
 capabilities:readonly string[];
}
const ROLES=["backend","frontend","test"] as const;
const NAMES:Readonly<Record<Role,string>>=Object.freeze({
  backend:"Backend Development Agent",
  frontend:"Frontend Development Agent",
  test:"Software Testing Agent"
});
const SKILLS:Readonly<Record<Role,string>>=Object.freeze({
  backend:"backend-software-engineering",
  frontend:"frontend-software-engineering",
  test:"software-testing"
});
const BASE=/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/?$/u;
const LIMIT=32*1024;
const ROLE_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DID=/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/u;
const FILE_OPERATIONS=new Set(["read_file","update_file","create_file"]);
const exactKeys=(value:object,keys:string[])=>{
 const actual=Object.keys(value).sort();
 return actual.length===keys.length&&
  actual.every((name,i)=>name===keys[i]);
};
/**
 * Read-only verification of an additional Owner-provisioned Card. Unlike
 * legacy fixed profiles, this role's identity/name/skill/capability ceiling
 * must ALL come from the trusted host. Never derive signer DID or powers
 * from a remote card, model output, environment fallback or role string.
 * This does NOT start a worker or make the extra role executable.
 */
export function verifyOwnerPinnedAdditionalCard(
 role:string,base:string,card:AgentCard,pin:TrustedAdditionalA2ACardPin
):VerifiedProfile{
 const ext=card?.capabilities?.extensions;
 const permitted=pin.capabilities;
 const offered=ext?.[0]?.params?.taskCapabilities;
 const interfaces=card?.supportedInterfaces;
 if(!ROLE_ID.test(role)||ROLES.includes(role as Role)||role==="orchestrator"||
    !pin||typeof pin!=="object"||Array.isArray(pin)||
    !exactKeys(pin,["capabilities","did","name","skillId"])||
    typeof pin.did!=="string"||!DID.test(pin.did)||
    typeof pin.name!=="string"||!pin.name.trim()||
    pin.name.length>128||/[\x00-\x1f\x7f]/u.test(pin.name)||
    typeof pin.skillId!=="string"||!ROLE_ID.test(pin.skillId)||
    !Array.isArray(permitted)||!permitted.length||permitted.length>3||
    new Set(permitted).size!==permitted.length||
    permitted.some(c=>typeof c!=="string"||!FILE_OPERATIONS.has(c))||
    card?.name!==pin.name||
    !Array.isArray(interfaces)||interfaces.length!==1||
    interfaces[0]?.url!==base.replace(/\/$/u,"")+"/a2a/rest"||
    interfaces[0]?.protocolBinding!=="HTTP+JSON"||
    interfaces[0]?.protocolVersion!==A2A_PROTOCOL_VERSION||
    !Array.isArray(ext)||ext.length!==1||
    ext[0]?.uri!==DELEGATED_AUTHORIZATION_EXTENSION_URI||
    ext[0]?.required!==true||
    ext[0]?.params?.agentDid!==pin.did||
    ext[0]?.params?.evidenceLocation!=="message.metadata.delegation_evidence"||
    !Array.isArray(offered)||!offered.length||
    offered.length>permitted.length||
    new Set(offered).size!==offered.length||
    offered.some(c=>typeof c!=="string"||!permitted.includes(c))||
    !Array.isArray(card?.skills)||card.skills.length!==1||
    card.skills[0]?.id!==pin.skillId)
   denied();
 return Object.freeze({did:pin.did,capabilities:Object.freeze([...offered])});
}
function denied():never{
  throw Error("Trusted A2A startup: pinned localhost role-card verification denied");
}
/** Reuse the startup checks on the card that the SDK will use for a send. */
export function verifyTrustedApprovedAgentCard(role:Role,base:string,card:AgentCard)
 :VerifiedA2AProfiles[Role]{
  const interfaces=card?.supportedInterfaces;
  const ext=card?.capabilities?.extensions;
  const capabilities=ext?.[0]?.params?.taskCapabilities;
  // The trusted role DID must agree with the original Rust signer in
  // authority-only mode. Historical Cards retain their fixed demonstration DID.
  const expectedDid=trustedSignerAgentDid(role);
  // Native discovery advertises only owner-implemented operations.
  // A Test CREATE is subsequently authorized only on an exact project-test
  // source by the original signed Task, Rust/OPA and Gateway CAS.
  const nativeOwner=process.env.APPROVED_RUNNER_NATIVE_MCP==="1"&&
   process.env.DELEGATION_GATEWAY_ARCHITECTURE==="authority-only";
  const supported=new Set<string>(nativeOwner?
   nativeAuthorityOnlyAdvertisedCapabilities(role):
   APPROVED_SPECIALIZED_AGENT_PROFILES[role].tools);
  if(!Array.isArray(capabilities)||capabilities.length===0||
     capabilities.length>supported.size||new Set(capabilities).size!==capabilities.length||
     capabilities.some(c=>typeof c!=="string"||!supported.has(c))||
     card?.name!==NAMES[role]||
     !Array.isArray(interfaces)||interfaces.length!==1||
     interfaces[0]?.url!==base.replace(/\/$/u,"")+"/a2a/rest"||
     interfaces[0]?.protocolBinding!=="HTTP+JSON"||
     interfaces[0]?.protocolVersion!==A2A_PROTOCOL_VERSION||
     !Array.isArray(ext)||ext.length!==1||
     ext[0]?.uri!==DELEGATED_AUTHORIZATION_EXTENSION_URI||
     ext[0]?.required!==true||
     ext[0]?.params?.agentDid!==expectedDid||
     ext[0]?.params?.evidenceLocation!==
       "message.metadata.delegation_evidence"||
     !Array.isArray(card?.skills)||card.skills.length!==1||
     card.skills[0]?.id!==SKILLS[role])
    denied();
  return Object.freeze({did:expectedDid,
    capabilities:Object.freeze([...capabilities])});
}
export async function assertTrustedApprovedA2AStartup(input:{
  // Retain the original fixed-role call contract; extra Owner-pinned
  // roles are additional own keys on this map, not a model-controlled API.
  endpoints:Readonly<Record<Role,string>>;
  /** Owner-provisioned signed-registry Card pins for additional roles. */
  additionalRolePins?:Readonly<Record<string,TrustedAdditionalA2ACardPin>>;
  /** Test-only injectable fetch; private owner uses global fetch. */
  fetchFn?:typeof fetch;
}):Promise<VerifiedA2AProfiles>{
  const endpoints=input?.endpoints as Readonly<Record<string,string>>|undefined;
  if(!endpoints||typeof endpoints!=="object"||Array.isArray(endpoints)||
     ROLES.some(role=>!Object.hasOwn(endpoints,role)))denied();
  const keys=Object.keys(endpoints);
  const extra=keys.filter(role=>!ROLES.includes(role as Role)).sort();
  const pins=input.additionalRolePins;
  if(keys.length>16||
     (extra.length>0&&(!pins||typeof pins!=="object"||Array.isArray(pins)||
       !exactKeys(pins,extra)))||
     (!extra.length&&pins!==undefined&&
      (typeof pins!=="object"||Array.isArray(pins)||Object.keys(pins).length!==0))||
     extra.some(role=>{
      const pin=pins?.[role];
      return !ROLE_ID.test(role)||role==="orchestrator"||!pin||
       !exactKeys(pin,["capabilities","did","name","skillId"])||
       typeof pin.did!=="string"||!DID.test(pin.did)||
       typeof pin.name!=="string"||!pin.name.trim()||
       typeof pin.skillId!=="string"||!ROLE_ID.test(pin.skillId)||
       !Array.isArray(pin.capabilities)||!pin.capabilities.length||
       pin.capabilities.length>3||
       new Set(pin.capabilities).size!==pin.capabilities.length||
       pin.capabilities.some(c=>!FILE_OPERATIONS.has(c));
     }))
   denied();
  const roles=[...ROLES,...extra];
  const addresses=roles.map(role=>endpoints[role]!);
  if(new Set(addresses).size!==roles.length)denied();
  const profiles:Record<string,VerifiedProfile>={};
  for(const role of roles){
    const base=endpoints[role]!;
    const match=typeof base==="string"?BASE.exec(base):null;
    if(!match||Number(match[1])>65535)denied();
    const target=base.replace(/\/$/u,"")+"/.well-known/agent-card.json";
    let result:Response;
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),5000);
    try{
      // One probe at a time. No A2A sendMessage, no Adapter token,
      // Authorization header, redirects, or credentials.
      result=await (input.fetchFn??fetch)(target,{
        method:"GET",redirect:"error",signal:controller.signal,
        headers:{accept:"application/json"}
      });
      if(!result.ok||!result.headers.get("content-type")?.includes("json")||
         !result.body)denied();
      let n=0;
      const parts:Uint8Array[]=[];
      const reader=result.body.getReader();
      try{
        while(true){
          const chunk=await reader.read();
          if(chunk.done)break;
          n+=chunk.value.byteLength;
          if(n>LIMIT)denied();
          parts.push(chunk.value);
        }
      }finally{await reader.cancel().catch(()=>{});}
      const card=JSON.parse(Buffer.concat(parts).toString("utf8"));
      profiles[role]=ROLES.includes(role as Role)?
       verifyTrustedApprovedAgentCard(role as Role,base,card):
       verifyOwnerPinnedAdditionalCard(role,base,card,pins![role]!);
    }catch{denied();}
    finally{clearTimeout(timer);}
  }
  // One signing identity per independently pinned role: no additional Card
  // can impersonate Backend, Frontend or Test through a duplicate DID.
  if(new Set(Object.values(profiles).map(profile=>profile.did)).size!==roles.length)
   denied();
  return Object.freeze(profiles) as VerifiedA2AProfiles;
}
