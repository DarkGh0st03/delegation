/**
 * R5 read-only observation of the LIVE Adapter's EVM-anchored revocation
 * answers for an independently supplied credential inventory.
 *
 * IMPORTANT: This is NOT an independent Rust/EVM verifier, a complete
 * issuance inventory, human consent, or R5 GO. The Adapter itself remains
 * the source of each observation; do not promote this result to attestation.
 * No credential is issued, revoked, or cleared by this module.
 */
import {validateR5OwnerCompletionClaim}
  from "./r5-post-run-github-crosscheck.mjs";

const SOURCE="evm_anchored_signed_jwt";
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA=/^[a-f0-9]{40}$/u;
const RUN=/^[1-9][0-9]{0,19}$/u;
const DIGEST=/^[a-f0-9]{64}$/u;
const LOOPBACK=/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/u;
const REQUIRED_CHILD_TASKS=["backend","frontend","test"];
const EXPECTED_FIELDS=[
  "credential_id","status_purpose","status_set","source","anchor_version"
].sort();
const MANIFEST_FIELDS=[
  "schema","source_sha","github_run_id","session_id",
  "approved_plan_digest","preliminary_root_id","operational_root_id",
  "task_children"
].sort();
function deny(reason){throw Error("R5 EVM revocation observation NO-GO: "+reason);}
function plain(v){return !!v&&typeof v==="object"&&!Array.isArray(v)&&
  Object.getPrototypeOf(v)===Object.prototype;}
function keys(v,expected){
  return plain(v)&&Object.keys(v).sort().join(",")===expected.join(",");
}
function validId(v){return typeof v==="string"&&ID.test(v);}

/**
 * Inventory is a separate owner-supplied assertion, NOT the Adapter's
 * list of issued credentials. Missing issuance records cannot be detected
 * from a status-inspection endpoint; the operator must verify completeness
 * independently before making any experimental claim.
 */
export function validateR5RevocationInventory({ownerEvidence,inventory}={}){
  if(!keys(inventory,MANIFEST_FIELDS)||
     inventory.schema!=="r5-credential-issuance-inventory-v1"||
     !SHA.test(inventory.source_sha??"")||
     !RUN.test(inventory.github_run_id??"")||
     !validId(inventory.session_id)||
     !DIGEST.test(inventory.approved_plan_digest??"")||
     !validId(inventory.preliminary_root_id)||
     !validId(inventory.operational_root_id))
    deny("bounded, exact owner-pinned credential inventory required");
  // Reuse the strict existing local witness validation, including its
  // explicit 'external_r5_go:false' non-attestation contract.
  validateR5OwnerCompletionClaim(ownerEvidence,{
    expectedSourceSha:inventory.source_sha,
    expectedRunId:inventory.github_run_id
  });
  if(ownerEvidence.session_id!==inventory.session_id||
     ownerEvidence.approved_plan_digest!==inventory.approved_plan_digest)
    deny("inventory does not match the original closed Coordinator claim");
  const tasks=ownerEvidence.approved_task_ids;
  if(!REQUIRED_CHILD_TASKS.every(id=>tasks.includes(id))||
     !Array.isArray(inventory.task_children)||
     inventory.task_children.length<REQUIRED_CHILD_TASKS.length||
     inventory.task_children.length>tasks.length)
    deny("all three specialized approved Task children must be inventoried");

  const taskIds=new Set();
  const credentialIds=[
    inventory.preliminary_root_id,inventory.operational_root_id
  ];
  for(const row of inventory.task_children){
    if(!keys(row,["credential_id","task_id"])||
       !validId(row.task_id)||!validId(row.credential_id)||
       !tasks.includes(row.task_id)||taskIds.has(row.task_id))
      deny("task children must be unique and bound to approved Task IDs");
    taskIds.add(row.task_id);
    credentialIds.push(row.credential_id);
  }
  if(!REQUIRED_CHILD_TASKS.every(id=>taskIds.has(id))||
     new Set(credentialIds).size!==credentialIds.length)
    deny("missing specialized child or duplicated credential identifier");
  return Object.freeze({
    source_sha:inventory.source_sha,
    github_run_id:inventory.github_run_id,
    session_id:inventory.session_id,
    ids:Object.freeze([...credentialIds]),
    child_count:inventory.task_children.length
  });
}

/**
 * Gateway-only bearer is provisioned OUTSIDE the model/runner and must be
 * used only over the explicitly pinned same-host loopback Adapter socket.
 * Fake responses are injectable solely for offline regression tests.
 */
export async function observeR5AdapterEvmRevocations({
  ownerEvidence,inventory,adapterBaseUrl,gatewayVerifierToken,
  fetchFn=fetch
}={}){
  const pinned=validateR5RevocationInventory({ownerEvidence,inventory});
  const match=typeof adapterBaseUrl==="string"
    ?LOOPBACK.exec(adapterBaseUrl):null;
  if(!match||Number(match[1])>65535||
     typeof gatewayVerifierToken!=="string"||
     gatewayVerifierToken.length<16||gatewayVerifierToken.length>512||
     /\s/u.test(gatewayVerifierToken)||typeof fetchFn!=="function")
    deny("pinned local Adapter and private Gateway verifier bearer required");
  const endpoint=adapterBaseUrl+"/v1/credentials/status/inspect";
  // Sequential observations avoid accidental unbounded EVM RPC fan-out.
  for(const credentialId of pinned.ids){
    let response,raw,body;
    try{
      response=await fetchFn(endpoint,{
        method:"POST",redirect:"error",
        headers:{
          authorization:"Bearer "+gatewayVerifierToken,
          accept:"application/json","content-type":"application/json"
        },
        body:JSON.stringify({credential_id:credentialId}),
        signal:AbortSignal.timeout(5000)
      });
      if(!response?.ok||response.status!==200)
        deny("Adapter inspection rejected a required credential");
      raw=await response.text();
    }catch{
      deny("authenticated live Adapter inspection unavailable");
    }
    if(typeof raw!=="string"||Buffer.byteLength(raw,"utf8")>4096)
      deny("unbounded credential status response");
    try{body=JSON.parse(raw);}
    catch{deny("malformed credential status response");}
    if(!keys(body,EXPECTED_FIELDS)||
       body.credential_id!==credentialId||
       body.status_purpose!=="revocation"||
       body.status_set!==true||
       body.source!==SOURCE||
       !Number.isSafeInteger(body.anchor_version)||
       body.anchor_version<1)
      deny("required credential is not verified revoked by EVM Adapter");
  }
  return Object.freeze({
    status:"adapter_reported_evm_revocation_for_supplied_inventory_only",
    source_sha:pinned.source_sha,
    github_run_id:pinned.github_run_id,
    observed_root_count:2,
    observed_task_child_count:pinned.child_count,
    adapter_status_source:SOURCE,
    issuance_inventory_completeness_independently_verified:false,
    adapter_and_chain_independently_attested:false,
    external_r5_go:false
  });
}
