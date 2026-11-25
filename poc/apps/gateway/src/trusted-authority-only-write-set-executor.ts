/**
 * Phase W (W2): the ONE-SHOT write-set publisher (Atomic Write-Set Publication).
 *
 * Reached only from the Gateway Execute of the LAST item of a write batch,
 * after native Rust VP, OPA and the admissions binding of every item.
 *
 *  P1  admissions: validated -> publishing (synchronous, single use)
 *  P2  durable attempt marker (before ANY Gitea write)
 *      byte binding: the bytes sent are the Gateway records' contents, whose
 *      fingerprint, SHA-256 and size are recomputed against the intent
 *  P3  isolated staging ref at the pinned HEAD + ONE ChangeFiles commit
 *  P4  exact change set: single parent, files + status (commit AND compare),
 *      contents, git modes (no new symlink/executable, update keeps mode)
 *  P5  strict mode: SECOND full verifyMultiple of the same VP
 *  P6  after every await: write-set still publishing, Root live, Child not
 *      expired, batch window open, work branch still at the pinned HEAD
 *  P7  admissions: publishing -> cas_sent, then the single HEAD-CAS
 *  P8  reread: branch at the commit -> published; certain refusal -> failed;
 *      anything else -> ambiguous (never retried)
 *  P9  per-file receipts bound to the commit and the write_set_digest
 */
import {createHash} from "node:crypto";
import {GiteaClient} from "./gitea-client.ts";
import {ProviderConflictError,ProviderUnavailableError} from "./errors.ts";
import {TrustedAuthorityOnlyGatewayAdmissions} from "./trusted-authority-only-admissions.ts";
import {DurableAuthorityOnlyWriteSetIntentJournal,type TrustedWriteSetIntent}
 from "./trusted-authority-only-write-set-intent-journal.ts";
import {TrustedGatewayWriteSetEvidencePublisher} from "./trusted-authority-only-write-set-evidence.ts";
import type {WriteBatch} from "./trusted-write-batch.ts";
import type {PreparedRequestRecord,PolicyDecision,VerifierPort,VerifiedDelegation} from "./types.ts";

const sha=(v:string)=>createHash("sha256").update(v,"utf8").digest("hex");
function deny(reason:string):never{
 throw new ProviderConflictError("Trusted write-set publication NO-GO: "+reason);
}
export interface WriteSetPublicationResult{
 readonly provider:"gitea";readonly performed:true;readonly tool:"write_files";
 readonly branch:string;readonly commit_sha:string;readonly previous_head_sha:string;
 readonly write_set_digest:string;readonly batch_id:string;readonly reverified:boolean;
 readonly files:readonly {path:string;operation:"update_file"|"create_file";
  next_content_sha256:string}[];
}
export class TrustedAuthorityOnlyWriteSetExecutor{
 readonly #admissions:TrustedAuthorityOnlyGatewayAdmissions;
 readonly #gitea:GiteaClient;
 readonly #journal:DurableAuthorityOnlyWriteSetIntentJournal;
 readonly #publisher:TrustedGatewayWriteSetEvidencePublisher;
 readonly #verifier:VerifierPort;
 readonly #strict:boolean;
 readonly #repository:string;
 readonly #branch:string;
 readonly #nowMs:()=>number;
 #inFlight=false;
 constructor(opts:{admissions:TrustedAuthorityOnlyGatewayAdmissions;giteaClient:GiteaClient;
  journal:DurableAuthorityOnlyWriteSetIntentJournal;publisher:TrustedGatewayWriteSetEvidencePublisher;
  verifier:VerifierPort;strictReverification?:boolean;repository:string;branch:string;
  nowMs?:()=>number}){
  if(!opts||!(opts.admissions instanceof TrustedAuthorityOnlyGatewayAdmissions)||
     !(opts.giteaClient instanceof GiteaClient)||
     !(opts.journal instanceof DurableAuthorityOnlyWriteSetIntentJournal)||
     !TrustedGatewayWriteSetEvidencePublisher.isNative(opts.publisher)||
     typeof opts.verifier?.verifyMultiple!=="function"||
     (opts.strictReverification!==undefined&&typeof opts.strictReverification!=="boolean")||
     !/^[a-z0-9._-]+\/[a-z0-9._-]+$/u.test(opts.repository??"")||
     !GiteaClient.isPinnedRepositoryClient(opts.giteaClient,opts.repository.split("/")[0]!,
      opts.repository.split("/")[1]!)||
     !/^feature\/[a-z0-9][a-z0-9./_-]*$/u.test(opts.branch??"")||
     /^feature\/(r302-internal-|r3832-create-|w2-write-set-)/u.test(opts.branch))
   throw Error("Write-set executor is not bound to the exact trusted Gateway");
  this.#admissions=opts.admissions;this.#gitea=opts.giteaClient;this.#journal=opts.journal;
  this.#publisher=opts.publisher;this.#verifier=opts.verifier;
  this.#strict=opts.strictReverification!==false;
  this.#repository=opts.repository;this.#branch=opts.branch;this.#nowMs=opts.nowMs??Date.now;
 }
 isForAdmissions(a:TrustedAuthorityOnlyGatewayAdmissions):boolean{return a===this.#admissions;}
 get strictReverification():boolean{return this.#strict;}

 /** Byte binding: rebuild every file from the Gateway records, never trust an intent alone. */
 #filesFromRecords(intent:TrustedWriteSetIntent,records:readonly PreparedRequestRecord[]){
  const byId=new Map(records.map(r=>[r.request_id,r]));
  if(byId.size!==intent.items.length)deny("records differ from the reserved write-set");
  return intent.items.map(it=>{
   const r=byId.get(it.request_id);
   const args=r?.request.arguments as {branch?:unknown;path?:unknown;content?:unknown}|undefined;
   if(!r||!args||r.consumed!==true||r.request.tool!==it.operation||args.path!==it.path||
      args.branch!==intent.branch||typeof args.content!=="string")
    deny("record does not match its reserved write-set item");
   const fingerprint=sha(JSON.stringify({task_id:r.task_id,agent_role:r.agent_role,request:r.request}));
   if(fingerprint!==r.request_fingerprint||fingerprint!==it.request_fingerprint||
      sha(args.content)!==it.next_content_sha256||
      Buffer.byteLength(args.content,"utf8")!==it.next_content_bytes)
    deny("bytes to publish differ from the authorized intent");
   return {operation:it.operation,path:it.path,content:args.content,expectedBlobSha:it.expected_blob_sha};
  });
 }

 async publishAfterVerifiedRustOpa(input:{batch:WriteBatch;records:readonly PreparedRequestRecord[];
  policy:PolicyDecision;verified:VerifiedDelegation}):Promise<WriteSetPublicationResult>{
  const {batch,records,policy,verified}=input;
  if(this.#inFlight)deny("concurrent write-set publication prohibited");
  if(!batch?.write_set_digest||!batch.plan_task_id||batch.state!=="verified"||
     typeof batch.signed_vp!=="string"||!policy||policy.allow!==true||
     typeof policy.policy_version!=="string"||!policy.policy_version.trim())
   deny("verified, OPA-allowed and staged write batch required");
  const task=batch.plan_task_id,runtime=batch.task_id,digest=batch.write_set_digest;
  // P1: synchronous single-use transition; a replay or concurrent call stops here.
  const {intent}=this.#admissions.beginTrustedWriteSetPublication(task,runtime,digest);
  this.#inFlight=true;
  let casSent=false,staging:string|undefined;
  /** Synchronous local checks: admissions state, Root, Child, batch, window. */
  const local=()=>{
   this.#admissions.assertTrustedWriteSetStillPublishable(task,runtime,digest);
   if(batch.state!=="verified")deny("write batch failed closed during publication");
   if(this.#nowMs()>=batch.expires_at_ms)deny("write batch window expired before the CAS");
  };
  const still=async(checkHead=false)=>{
   local();
   if(checkHead&&(await this.#gitea.getBranchMetadata(this.#branch)).commit_sha!==intent.expected_head_sha)
    deny("work branch advanced before the CAS");
   // Re-run every local check AFTER the last await (time may have passed).
   local();
  };
  try{
   if(intent.repository!==this.#repository||intent.branch!==this.#branch)
    deny("write-set intent is for another repository or branch");
   const files=this.#filesFromRecords(intent,records);
   // P2: durable single attempt BEFORE any Gitea write.
   await this.#journal.reserveAttempt(intent,digest,batch.batch_id);
   await still();
   // P3: one commit on an isolated staging ref at the pinned HEAD.
   const stagingBranch="feature/w2-write-set-"+sha(digest+"\n"+batch.batch_id).slice(0,28);
   staging=stagingBranch;
   const staged=await this.#gitea.stageWriteSetCommit({branch:this.#branch,
    expectedHeadSha:intent.expected_head_sha,stagingBranch,
    message:"thesis-gateway: write-set "+batch.batch_id+" ["+digest.slice(0,16)+"]",files});
   await still();
   // P4: exact change set, contents and modes.
   const expected=files.map(f=>`${f.path}:${f.operation==="update_file"?"modified":"added"}`).sort();
   const commit=await this.#gitea.getCommitChanges(staged.commit_sha);
   const compare=await this.#gitea.compareCommitFiles(intent.expected_head_sha,staged.commit_sha);
   const list=(xs:{filename:string;status:string}[])=>JSON.stringify(xs.map(x=>`${x.filename}:${x.status}`).sort());
   if(commit.parents.length!==1||commit.parents[0]!==intent.expected_head_sha||
      list(commit.files)!==JSON.stringify(expected)||list(compare.files)!==JSON.stringify(expected)||
      compare.total_commits!==1)
    deny("staged commit is not exactly the authorized change set");
   for(const f of files){
    const got=await this.#gitea.readTextFile(staging,f.path,staged.commit_sha);
    if(sha(got.content)!==sha(f.content)||got.content!==f.content)
     deny("staged file differs from authorized bytes");
   }
   const paths=files.map(f=>f.path);
   const before=await this.#gitea.getTreeModes(intent.expected_head_sha,paths);
   const after=await this.#gitea.getTreeModes(staged.commit_sha,paths);
   for(const f of files){
    const a=after.get(f.path),b=before.get(f.path);
    if(!a||a.type!=="blob"||(a.mode!=="100644"&&a.mode!=="100755"))
     deny("written path is not a regular file");
    if(f.operation==="update_file"?(!b||b.type!=="blob"||b.mode!==a.mode):(b!==undefined||a.mode!=="100644"))
     deny("write-set changes a file mode or replaces a non-regular file");
   }
   await still();
   // P5: strict mode — second complete verification of the SAME VP.
   if(this.#strict){
    const again=await this.#verifier.verifyMultiple!({presenter:batch.agent_role,audience:batch.audience,
     challenge:batch.challenge,required_permissions:batch.required_permissions.map(p=>({...p})),
     signed_vp:batch.signed_vp!});
    if(again.presenter_id!==verified.presenter_id||again.credential_id!==verified.credential_id||
       again.root_credential_id!==verified.root_credential_id)
     deny("second verification does not confirm the same delegation");
   }
   // P6: after the last asynchronous step, including the HEAD.
   await still(true);
   // P7: no await between the last full recheck and cas_sent: the window,
   // batch, Root and Child are checked synchronously right before the CAS.
   local();
   this.#admissions.markTrustedWriteSetCasSent(task,runtime,digest);
   casSent=true;
   let outcome:"updated"|"rejected";
   try{outcome=await this.#gitea.casBranchToCommit(this.#branch,intent.expected_head_sha,staged.commit_sha);}
   catch(error){
    this.#admissions.recordTrustedWriteSetCasAmbiguous(task,runtime,digest); // -> ambiguous
    await this.#journal.reserveOutcome(intent,digest,"ambiguous",null).catch(()=>undefined);
    throw error instanceof ProviderUnavailableError?error:
     new ProviderUnavailableError("Gitea write-set CAS outcome ambiguous");
   }
   if(outcome==="rejected"){
    this.#admissions.recordTrustedWriteSetCasRejected(task,runtime,digest);  // certain: -> failed
    await this.#journal.reserveOutcome(intent,digest,"cas_rejected",null).catch(()=>undefined);
    throw new ProviderConflictError("Work branch moved: the write-set CAS was rejected, nothing published");
   }
   // P8: published (the client reread the branch at the commit).
   this.#admissions.recordTrustedWriteSetPublished(task,runtime,digest,staged.commit_sha);
   await this.#journal.reserveOutcome(intent,digest,"published",staged.commit_sha);
   // P9: per-file receipts bound to commit + digest + batch. A failure here
   // leaves the write-set published and the Task NOT finalizable.
   await this.#publisher.publishAll(intent,{write_set_digest:digest,batch_id:batch.batch_id,
    commit_sha:staged.commit_sha,previous_head_sha:intent.expected_head_sha},policy.policy_version);
   await this.#gitea.deleteWriteSetStagingRef(stagingBranch).catch(()=>undefined);
   return Object.freeze({provider:"gitea",performed:true,tool:"write_files",branch:this.#branch,
    commit_sha:staged.commit_sha,previous_head_sha:intent.expected_head_sha,write_set_digest:digest,
    batch_id:batch.batch_id,reverified:this.#strict,
    files:Object.freeze(intent.items.map(i=>({path:i.path,operation:i.operation,
     next_content_sha256:i.next_content_sha256})))});
  }catch(error){
   // Before the CAS request: nothing was published -> failed (terminal).
   if(!casSent){
    this.#admissions.failTrustedWriteSet(task,runtime,digest);
    await this.#journal.reserveOutcome(intent,digest,"failed_before_cas",null).catch(()=>undefined);
   }
   batch.state="failed";
   throw error;
  }finally{this.#inFlight=false;void staging;}
 }
}
