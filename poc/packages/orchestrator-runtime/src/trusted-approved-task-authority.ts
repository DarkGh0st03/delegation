/**
 * Owner-only child credential allocator for signed reviewed A2A Tasks.
 *
 * Status List indices are provisioned by the operator, never by Gemini,
 * the Task description, GitHub workflow inputs or A2A messages. Each
 * (status-list URI, index) is atomically reserved in a PRIVATE persistent
 * directory BEFORE returning an authority request. A crash or ambiguous
 * issuance leaves a tombstone; NEVER retry that index.
 *
 * This is an allocation boundary, not a VC signer. The Rust Adapter
 * independently enforces the actual attenuated child permissions.
 */
import {createHash,randomBytes} from "node:crypto";
import {constants} from "node:fs";
import {lstat,open} from "node:fs/promises";
import {join} from "node:path";
import {assertApprovedPlanScope,planDigest}
  from "../../../packages/plan-contracts/src/plan.mjs";
import {RUST_OPERATIONS}
  from "../../../apps/gateway/src/operation-catalog.ts";
import {TrustedExecutionCoordinator}
  from "./trusted-execution-coordinator.ts";
import {TrustedPlanningReviewGate}
  from "./trusted-planning-review-gate.ts";
import type {SpecializedAgentRole} from "@thesis/agent-runtime";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const INDEX=/^(0|[1-9][0-9]{0,7})$/u;
const ROLES=new Set(["backend","frontend","test"]);
const OPS=new Set<string>(RUST_OPERATIONS);
function fail(message:string):never{
  throw Error("Trusted Task status allocator: "+message);
}
export interface TrustedTaskIndexProvisioning {
  /** Must be shared across all status reservations for this Status List. */
  reservationDirectory:string;
  /** A separately configured, canonical HTTPS Status List VC. */
  statusListCredential:string;
  /** Preassigned distinct indices for ALL signed specialized Task IDs. */
  indexByTask:Readonly<Record<string,string>>;
  /** The parent root's and other externally reserved indices; must be set. */
  excludedIndices:readonly string[];
  validitySeconds?:number;
}
export async function createTrustedApprovedTaskAuthorityAllocator(input:
  TrustedTaskIndexProvisioning & {
    coordinator:TrustedExecutionCoordinator;
    reviewGate:TrustedPlanningReviewGate;
    sessionId:string;
    engineerDid:string;
  }
):Promise<Readonly<{
  approvedTaskIds:readonly string[];
  authorityForTask:(taskId:string,role:SpecializedAgentRole)=>Promise<{
    parent_credential_id:string;credential_id:string;valid_from:string;
    validity_seconds:number;credential_status:{
      type:"BitstringStatusListEntry";statusPurpose:"revocation";
      statusListIndex:string;statusListCredential:string
    }
  }>;
}>>{
  if(!(input.coordinator instanceof TrustedExecutionCoordinator)||
     !(input.reviewGate instanceof TrustedPlanningReviewGate)||
     input.coordinator.phase!=="execution"||
     !ID.test(input.sessionId??"")||
     !input.engineerDid?.startsWith("did:")||
     !input.reservationDirectory?.startsWith("/")||
     !input.indexByTask||typeof input.indexByTask!=="object"||
     Array.isArray(input.indexByTask)||
     !Array.isArray(input.excludedIndices)||
     input.excludedIndices.length===0)
    fail("active reviewed Coordinator and owner-pinned status allocation required");
  let url:URL;
  try{url=new URL(input.statusListCredential);}catch{fail("invalid Status List URI");}
  if(url!.protocol!=="https:"||url!.username||url!.password||
     url!.hash||url!.search||url!.toString()!==input.statusListCredential||
     input.statusListCredential.length>1024)
    fail("noncanonical or unsafe Status List URI");
  const ttl=input.validitySeconds??300;
  if(!Number.isSafeInteger(ttl)||ttl<1||ttl>600)
    fail("unbounded child credential validity");
  const dir=await lstat(input.reservationDirectory);
  if(!dir.isDirectory()||dir.isSymbolicLink()||
     (dir.mode&0o077)!==0||
     (typeof process.getuid==="function"&&dir.uid!==process.getuid()))
    fail("persistent Status List reservation directory must be owner-only");
  const operational=input.coordinator.trustedOperationalAuthority();
  const signed=await input.reviewGate.loadAuthenticatedApproval(input.sessionId);
  if(signed.authenticated_engineer_did!==input.engineerDid||
     signed.plan.session_id!==input.sessionId||
     planDigest(signed.plan)!==operational.plan_digest)
    fail("signed Engineer plan does not match active root");
  const approved=assertApprovedPlanScope(signed.plan,signed.approval,{
    allowedOperations:OPS,expectedEngineerDid:input.engineerDid
  }) as {task_id:string;agent_id:string}[];
  const selected=new Map<string,SpecializedAgentRole>();
  for(const task of signed.plan.tasks){
    if(!ROLES.has(task.agent_id))continue;
    if(!approved.some(row=>row.task_id===task.id&&
       row.agent_id===task.agent_id))
      fail("specialized Task lacks Engineer-approved permissions");
    selected.set(task.id,task.agent_id as SpecializedAgentRole);
  }
  if(selected.size===0||selected.size>12)
    fail("no bounded specialized Task plan");
  const keys=Object.keys(input.indexByTask);
  if(keys.length!==selected.size||keys.some(key=>!selected.has(key)))
    fail("status indices differ from the exact signed Task set");
  const excluded=new Set(input.excludedIndices);
  if(excluded.size!==input.excludedIndices.length||
     [...excluded].some(x=>!INDEX.test(x)))
    fail("invalid or repeated externally reserved status index");
  const indices=new Set(excluded);
  const allocation=new Map<string,string>();
  for(const taskId of selected.keys()){
    const index=input.indexByTask[taskId];
    if(typeof index!=="string"||!INDEX.test(index)||indices.has(index))
      fail("repeated, reserved or invalid Status List index");
    indices.add(index);
    allocation.set(taskId,index);
  }
  // Copy immutable operator inputs; caller mutation after review is not
  // allowed to redirect an A2A child into another Status List index.
  const listUri=input.statusListCredential,dirPath=input.reservationDirectory;
  const rootId=operational.credential_id,digest=operational.plan_digest;
  const used=new Set<string>();
  const authorityForTask=async(taskId:string,role:SpecializedAgentRole)=>{
    if(used.has(taskId))fail("Task index already attempted");
    if(!selected.has(taskId)||selected.get(taskId)!==role)
      fail("Task and role do not match signed Engineer plan");
    if(input.coordinator.phase!=="execution")
      fail("no active approved operational authority");
    const current=input.coordinator.trustedOperationalAuthority();
    if(current.credential_id!==rootId||current.plan_digest!==digest)
      fail("operational root changed during status allocation");
    // Synchronously reserve one attempt before any filesystem await.
    used.add(taskId);
    const index=allocation.get(taskId)!;
    const token=createHash("sha256").update(listUri+"\n"+index).digest("hex");
    const location=join(dirPath,token+".reservation.json");
    const childId="urn:task-child:"+randomBytes(16).toString("hex");
    let fd;
    try{
      fd=await open(location,
        constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|
        constants.O_NOFOLLOW,0o600);
      await fd.writeFile(JSON.stringify({
        version:1,session_id:input.sessionId,task_id:taskId,
        role,credential_id:childId,status_list:listUri,index
      }));
      await fd.sync();
    }catch{
      // Includes EEXIST from a prior run/crash. Never retry the index.
      fail("Status List index already reserved or persistence unconfirmed");
    }finally{
      await fd?.close();
    }
    // A failed fsync or a deleted directory is terminal. Keep tombstones.
    let directoryFd;
    try{
      directoryFd=await open(dirPath,
        constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
      await directoryFd.sync();
    }catch{
      fail("Status List reservation durability unconfirmed");
    }finally{await directoryFd?.close();}
    if(input.coordinator.phase!=="execution")
      fail("operational root closed after Task index reservation");
    return {
      parent_credential_id:rootId,credential_id:childId,
      valid_from:new Date().toISOString(),validity_seconds:ttl,
      credential_status:{
        type:"BitstringStatusListEntry" as const,
        statusPurpose:"revocation" as const,
        statusListIndex:index,statusListCredential:listUri
      }
    };
  };
  return Object.freeze({
    approvedTaskIds:Object.freeze([...selected.keys()]),
    authorityForTask
  });
}
