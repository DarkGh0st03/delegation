/**
 * R382.6 — owner-private real Gemini model -> original authority-only
 * Planning Review Host options.
 *
 * A pure binding step: NO model call, provider effect, key file IO,
 * Engineer approval, Root issuance or GitHub OIDC admission.
 *
 * The authenticated operator supplies the ORIGINAL Review Host's durable
 * stores, native Rust crypto ports and approved agents. The separately
 * protected 0600 Gemini owner file may select only the SAME Planning
 * snapshot/Root/requirement/roles and a pinned model. It cannot replace
 * the checkpoint store, signer, Review Host, Branch or grant.
 */
import {BaseLlm} from "@google/adk";
import {isDeepStrictEqual} from "node:util";

const ROLES=Object.freeze(["backend","frontend","test"]);
const FROZEN_LIMITS=Object.freeze({
 maxModelTurns:20,
 maxModelCallMs:60000,
 maxOutputTokens:12000,
 maxPlanningMs:180000,
 maxProposalRevisions:2,
 thinkingLevel:"LOW"
});
function deny(){throw Error("Protected canonical Gemini owner binding denied");}
function plain(x){return !!x&&typeof x==="object"&&!Array.isArray(x)&&
 Object.getPrototypeOf(x)===Object.prototype;}
function sameAgentPins(a,b){
 if(!plain(a)||!plain(b)||
    Object.keys(b).sort().join(",")!=="backend,frontend,test")
  return false;
 return ROLES.every(role=>{
  const p=a[role],q=b[role];
  return plain(p)&&plain(q)&&typeof p.did==="string"&&
    p.did.startsWith("did:")&&p.did===q.did&&
    typeof p.card_ref==="string"&&p.card_ref===q.card_ref;
 });
}

/** Return exact in-memory original-host constructor input, with no key
 * or model prompt exposed to SDK, Task, A2A, CLI or GitHub workflow data.
 * The original Host rechecks its signer and signed checkpoint on start.
 */
export function bindProtectedCanonicalGeminiOwner({authority,input,model}={}){
 if(process.env.DELEGATION_GATEWAY_ARCHITECTURE!=="authority-only"||
    process.env.APPROVED_RUNNER_NATIVE_MCP!=="1"||
    !plain(authority)||!plain(input)||
    !(model instanceof BaseLlm)||
    input.authorizationInput!=="I AUTHORIZE GEMINI API CHARGES"||
    input.modelName!=="gemini-3.8-flash"||
    typeof input.backendPrivateKeyPem!=="string"||
    !input.backendPrivateKeyPem.includes("BEGIN PRIVATE KEY")||
    typeof input.geminiApiKey!=="string"||input.geminiApiKey.length<8||
    !plain(authority.planner)||typeof authority.planner.planId!=="string"||
    authority.planner.planId!==input.planId||
    // Supplying another model or changing host limits via operator JSON
    // would create a second non-canonical Planning selection.
    Object.keys(authority.planner).some(k=>
      !["planId","onObservation"].includes(k))||
    (authority.planner.onObservation!==undefined&&
     typeof authority.planner.onObservation!=="function")||
    !isDeepStrictEqual(authority.snapshot,input.snapshot)||
    !isDeepStrictEqual(authority.preliminaryRoot,input.preliminaryRoot)||
    authority.requirement!==input.requirement||
    !sameAgentPins(authority.trustedAgentRegistry,input.agents)||
    authority.gateway?.gatewayBaseUrl!==input.gatewayBaseUrl||
    typeof authority.checkpoint?.backendKeyId!=="string"||
    typeof authority.checkpoint?.store?.assertSigner!=="function"||
    typeof authority.workBranch!=="string"||
    !authority.workBranch.startsWith("feature/"))
  deny();

 // Backend private key comes only from the protected 0600 owner file,
 // not a model, request or alternate signer. Original Host independently
 // calls store.assertSigner() on this same key before any paid Planning.
 // Keep original typed store/journal/crypto instances — never clone them.
 const checkpoint=Object.freeze({
  ...authority.checkpoint,
  backendPrivateKeyPem:input.backendPrivateKeyPem
 });
 const planner=Object.freeze({
  planId:input.planId,model,...FROZEN_LIMITS,
  ...(authority.planner.onObservation===undefined?{}:
    {onObservation:authority.planner.onObservation})
 });
 return Object.freeze({...authority,checkpoint,planner});
}
