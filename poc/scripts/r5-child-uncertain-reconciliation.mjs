/**
 * R5 read-only crash/timeout recovery: a lost Adapter response is NOT
 * evidence that a child was never issued. Inspect EVERY original Host
 * child intent, including still-uncertain ones, without issuing, revoking,
 * retrying, promoting an ACK or granting authority.
 *
 * The Adapter reports its current EVM-anchored state; this is NOT an
 * independent on-chain attestation or proof of a complete issuance ledger.
 */
import {assertApprovedPlanScope,planDigest}
  from "../packages/plan-contracts/src/plan.mjs";
import {RUST_OPERATIONS} from "../apps/gateway/src/operation-catalog.ts";
import {TrustedChildIssuanceJournal}
  from "../packages/orchestrator-runtime/src/trusted-child-issuance-journal.mjs";
import {SignedEngineerApprovalFileStore}
  from "../packages/orchestrator-runtime/src/signed-approval-store.ts";

const SOURCE="evm_anchored_signed_jwt";
const SHA=/^[a-f0-9]{40}$/u;
const DIGEST=/^[a-f0-9]{64}$/u;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const LOCAL=/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/u;
const ROLES=new Set(["backend","frontend","test"]);
const RESPONSE_FIELDS=["credential_id","status_purpose","status_set",
  "source","anchor_version"].sort().join(",");
function deny(reason){throw Error("R5 uncertain issuance recovery NO-GO: "+reason);}
function plain(obj){return !!obj&&typeof obj==="object"&&
  !Array.isArray(obj)&&Object.getPrototypeOf(obj)===Object.prototype;}

/**
 * The independently pinned protected store verifies the REAL Ed25519
 * Engineer receipt. If the signature has expired, recovery fails closed
 * and requires manual owner reconciliation, not new authorization.
 */
export async function observeR5UncertainChildIssuance({
  journal,approvalStore,sessionId,baseRevision,planDigestPin,
  parentCredentialId,adapterBaseUrl,gatewayVerifierToken,fetchFn=fetch
}={}){
  if(!(journal instanceof TrustedChildIssuanceJournal)||
     !(approvalStore instanceof SignedEngineerApprovalFileStore)||
     !ID.test(sessionId??"")||!SHA.test(baseRevision??"")||
     !DIGEST.test(planDigestPin??"")||!ID.test(parentCredentialId??""))
    deny("original protected child journal and authentic Engineer store required");
  const match=typeof adapterBaseUrl==="string"?LOCAL.exec(adapterBaseUrl):null;
  if(!match||Number(match[1])>65535||
     typeof gatewayVerifierToken!=="string"||
     gatewayVerifierToken.length<16||gatewayVerifierToken.length>512||
     /\s/u.test(gatewayVerifierToken)||typeof fetchFn!=="function")
    deny("private loopback Adapter and Gateway verifier bearer required");
  journal.assertBound({sessionId,baseRevision,planDigest:planDigestPin,
    parentCredentialId});
  let signed;
  try{signed=await approvalStore.loadAuthenticatedApproval(sessionId);}
  catch{deny("original Engineer Ed25519 approval unavailable or invalid");}
  const plan=signed?.plan;
  if(!plan||!plain(plan)||plan.session_id!==sessionId||
     plan.base_revision!==baseRevision||planDigest(plan)!==planDigestPin||
     !signed.authenticated_engineer_did?.startsWith("did:"))
    deny("original signed plan differs from journal pins");
  let approved;
  try{
    approved=assertApprovedPlanScope(plan,signed.approval,{
      allowedOperations:new Set(RUST_OPERATIONS),
      expectedEngineerDid:signed.authenticated_engineer_did
    });
  }catch{deny("invalid signed Engineer Task permissions");}
  const tasks=new Map(plan.tasks.map(t=>[t.id,t]));
  const before=await journal.records();
  if(before.length===0||before.length>128)
    deny("no bounded original Host child intent available");
  const statusSlots=new Set();
  for(const item of before){
    const task=tasks.get(item.task_id);
    if(!task||!ROLES.has(task.agent_id)||task.agent_id!==item.role||
       !approved.some(p=>p.task_id===item.task_id&&p.agent_id===item.role))
      deny("intent outside Engineer-signed specialized Tasks");
    const slot=JSON.stringify([item.status_list_credential,item.status_list_index]);
    if(statusSlots.has(slot))deny("reused child status-list slot");
    statusSlots.add(slot);
  }
  const endpoint=adapterBaseUrl+"/v1/credentials/status/inspect";
  for(const record of before){
    let raw;
    try{
      const response=await fetchFn(endpoint,{
        method:"POST",redirect:"error",
        headers:{authorization:"Bearer "+gatewayVerifierToken,
          accept:"application/json","content-type":"application/json"},
        body:JSON.stringify({credential_id:record.credential_id}),
        signal:AbortSignal.timeout(5000)
      });
      if(!response?.ok||response.status!==200)
        deny("Adapter could not corroborate one possible child issuance");
      raw=await response.text();
    }catch{deny("live native revocation inspection unavailable");}
    if(typeof raw!=="string"||Buffer.byteLength(raw,"utf8")>4096)
      deny("unsafe Adapter inspection response");
    let answer;
    try{answer=JSON.parse(raw);}catch{deny("malformed status observation");}
    if(!plain(answer)||Object.keys(answer).sort().join(",")!==RESPONSE_FIELDS||
       answer.credential_id!==record.credential_id||
       answer.status_purpose!=="revocation"||answer.status_set!==true||
       answer.source!==SOURCE||
       !Number.isSafeInteger(answer.anchor_version)||answer.anchor_version<1)
      deny("possibly issued child is not confirmed revoked by live EVM Adapter");
  }
  // An issuer may record more children during the external HTTP awaits.
  // A stale positive observation must never survive concurrent writes.
  const after=await journal.records();
  if(JSON.stringify(after)!==JSON.stringify(before))
    deny("original child journal changed during revocation observation");
  const uncertain=before.filter(x=>x.observation==="issuance_uncertain").length;
  return Object.freeze({
    status:"adapter_observed_revoked_intents_manual_reconciliation_required",
    observed_child_intent_count:before.length,
    uncertain_issuance_count:uncertain,
    acked_child_count:before.length-uncertain,
    observed_adapter_status_source:SOURCE,
    all_possible_issuance_intents_automatically_reconciled:false,
    independent_evm_attestation:false,
    safe_to_retry_child_issuance:false,
    external_r5_go:false
  });
}
