/**
 * R5 original-owner FULL SIGNED-TASK INVENTORY public-EVM observation.
 *
 * Enforces complete signed specialized Task coverage, both operator-recorded
 * root identities and every original Host child (including uncertain intent).
 * All Status List JWTs are checked independently on ONE pinned block via the
 * public verifier: NO Gateway bearer, Adapter inspection, mutation or retry.
 *
 * Evidentiary limits: root status entries and supplied public artifacts are
 * operator assertions until separately corroborated; signature verification
 * authenticates the original Engineer plan, not physical host provenance or
 * exhaustiveness of credentials issued outside the registered Host path.
 */
import {SignedEngineerApprovalFileStore}
  from "../packages/orchestrator-runtime/src/signed-approval-store.ts";
import {TrustedChildIssuanceJournal}
  from "../packages/orchestrator-runtime/src/trusted-child-issuance-journal.mjs";
import {validateR5SignedRevocationInventory}
  from "./r5-signed-revocation-inventory.mjs";
import {observeR5IndependentEvmStatus}
  from "./r5-independent-status-evm-verifier.mjs";

const FIELDS=["credential_id","status_list_credential","status_list_index"]
  .sort().join(",");
const LIST_FIELDS=["status_list_credential","signed_status_jwt"]
  .sort().join(",");
const PINS=["rpcUrl","expectedChainId","registryAddress",
  "issuerAddress","issuerDid","issuerPublicJwk"].sort().join(",");
const SLOT=/^(?:0|[1-9][0-9]{0,5})$/u;
function deny(reason){throw Error("R5 full-DAG public status NO-GO: "+reason);}
function plain(value){return value!==null&&typeof value==="object"&&
  !Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;}
function fields(value,keys){return plain(value)&&
  Object.keys(value).sort().join(",")===keys;}
function statusRow(value){
  if(!fields(value,FIELDS)||typeof value.credential_id!=="string"||
     value.credential_id.length===0||
     typeof value.status_list_credential!=="string"||
     !/^https:\/\//u.test(value.status_list_credential)||
     value.status_list_credential.length>512||
     typeof value.status_list_index!=="string"||
     !SLOT.test(value.status_list_index)||
     Number(value.status_list_index)>=262144)
    deny("malformed or unbounded registered status entry");
  return value;
}
/**
 * approvalStore MUST use independently pinned Ed25519 public keys. This
 * function authenticates the receipt itself before touching EVM RPC.
 * The status rows for roots are NOT signed root credential evidence.
 */
export async function observeR5IndependentDagRevocations({
  ownerEvidence,inventory,approvalStore,issuanceJournal,
  rootStatusEntries,publicStatusLists,chainPins,
  fetchFn=fetch,verifyEntry=observeR5IndependentEvmStatus
}={}){
  if(!(approvalStore instanceof SignedEngineerApprovalFileStore)||
     !(issuanceJournal instanceof TrustedChildIssuanceJournal)||
     !fields(chainPins,PINS)||typeof fetchFn!=="function"||
     typeof verifyEntry!=="function")
    deny("independent signed review and read-only EVM trust pins required");
  let verifiedReview;
  try{
    verifiedReview=await approvalStore.loadAuthenticatedApproval(
      inventory?.session_id);
    validateR5SignedRevocationInventory({
      ownerEvidence,inventory,authenticatedReview:verifiedReview
    });
  }catch{deny("original Engineer review or signed Task coverage invalid");}
  issuanceJournal.assertBound({
    sessionId:inventory.session_id,baseRevision:inventory.source_sha,
    planDigest:inventory.approved_plan_digest,
    parentCredentialId:inventory.operational_root_id
  });
  if(!Array.isArray(rootStatusEntries)||rootStatusEntries.length!==2||
     !Array.isArray(publicStatusLists)||publicStatusLists.length<1||
     publicStatusLists.length>130)
    deny("exact two roots and bounded public Status Lists required");
  const expectedRootIds=new Set([
    inventory.preliminary_root_id,inventory.operational_root_id
  ]);
  const rootRows=rootStatusEntries.map(statusRow);
  if(new Set(rootRows.map(x=>x.credential_id)).size!==2||
     rootRows.some(x=>!expectedRootIds.has(x.credential_id)))
    deny("operator root statuses do not match original two root identities");
  const journalBefore=await issuanceJournal.records();
  if(journalBefore.length!==inventory.task_children.length)
    deny("not every signed child has an original Host issuance intent");
  const uniqueTask=new Set(),childRows=[];
  for(const record of journalBefore){
    const paired=inventory.task_children.find(x=>x.task_id===record.task_id&&
      x.credential_id===record.credential_id);
    if(!paired||uniqueTask.has(record.task_id))
      deny("unrecognized, duplicated or substituted original child intent");
    uniqueTask.add(record.task_id);
    childRows.push(statusRow({
      credential_id:record.credential_id,
      status_list_credential:record.status_list_credential,
      status_list_index:record.status_list_index
    }));
  }
  const rows=[...rootRows,...childRows];
  const ids=new Set(rows.map(x=>x.credential_id));
  const slots=new Set(rows.map(x=>JSON.stringify([
    x.status_list_credential,x.status_list_index
  ])));
  if(ids.size!==rows.length||slots.size!==rows.length)
    deny("duplicate credential or Status List bit among roots and children");
  const lists=new Map();
  for(const record of publicStatusLists){
    if(!fields(record,LIST_FIELDS)||
       typeof record.status_list_credential!=="string"||
       !/^https:\/\//u.test(record.status_list_credential)||
       typeof record.signed_status_jwt!=="string"||
       record.signed_status_jwt.length<20||
       record.signed_status_jwt.length>1024*1024||
       lists.has(record.status_list_credential))
      deny("missing or repeated bounded public JWT");
    lists.set(record.status_list_credential,record.signed_status_jwt);
  }
  const expectedLists=new Set(rows.map(x=>x.status_list_credential));
  if(lists.size!==expectedLists.size||
     [...expectedLists].some(x=>!lists.has(x)))
    deny("public JWT evidence does not exactly cover roots and children");
  // Each independent check performs Ed25519 + Keccak + EVM eth_call
  // against the SAME pinned chain block. No post hoc aggregation of
  // statuses from different block identities is allowed.
  let pinnedBlockNumber,pinnedBlockHash,anchorCount=0;
  for(const row of rows){
    const out=await verifyEntry({
      ...chainPins,statusListCredential:row.status_list_credential,
      statusListIndex:Number(row.status_list_index),
      signedStatusJwt:lists.get(row.status_list_credential),
      fetchFn,expectedBlockNumber:pinnedBlockNumber,
      expectedBlockHash:pinnedBlockHash
    });
    if(!plain(out)||out.status!==
       "public_jwt_signature_evm_anchor_and_revoked_bit_verified"||
       out.external_r5_go!==false||
       out.adapter_status_endpoint_used!==false||
       out.gateway_bearer_used!==false||
       out.chain_id!==chainPins.expectedChainId||
       typeof out.block_number!=="string"||
       typeof out.block_hash!=="string")
      deny("independent public EVM status not verified for exact identity");
    if(anchorCount===0){
      pinnedBlockNumber=out.block_number;
      pinnedBlockHash=out.block_hash;
    }else if(out.block_number!==pinnedBlockNumber||
       out.block_hash.toLowerCase()!==pinnedBlockHash.toLowerCase())
      deny("mixed chain snapshots cannot prove whole-DAG status");
    anchorCount++;
  }
  // A concurrent new issuance invalidates an otherwise valid snapshot.
  if(JSON.stringify(await issuanceJournal.records())!==
     JSON.stringify(journalBefore))
    deny("original issuance ledger changed during public EVM audit");
  const uncertain=journalBefore.filter(x=>
    x.observation==="issuance_uncertain").length;
  return Object.freeze({
    status:"all_registered_signed_dag_status_bits_publicly_observed_revoked",
    observed_root_count:2,observed_specialized_child_count:childRows.length,
    uncertain_child_issuance_count:uncertain,
    audited_status_list_count:expectedLists.size,
    observed_block_number:pinnedBlockNumber,
    observed_block_hash:pinnedBlockHash,
    one_block_consistent:true,
    roots_externally_authenticated_as_issued:false,
    complete_issuer_issuance_ledger_independently_verified:false,
    independent_chain_finality_verified:false,
    uncertain_issuance_automatically_reconciled:false,
    safe_to_retry_child_issuance:false,
    external_r5_go:false
  });
}
