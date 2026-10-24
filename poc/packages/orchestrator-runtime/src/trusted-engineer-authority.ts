/**
 * Trusted Software Engineer authority session for the two-phase workflow.
 *
 * NOT a tool, MCP endpoint, Gemini callback or autonomous approval service.
 * The caller must be a separately authenticated Engineer backend. Approval
 * records are obtained from a trusted store, never from LLM/GUI request JSON.
 *
 * Both roots are issued by the Engineer in Rust. The operational root is
 * independent of the revoked preliminary root (never its child).
 */
import {RUST_OPERATIONS} from "../../../apps/gateway/src/operation-catalog.ts";
import {TOOL_NAMES} from "../../../apps/gateway/src/types.ts";
import {
  canonicalRepositoryUri, canonicalFileUri, canonicalDirectoryUri, canonicalBranchUri
} from "../../../apps/gateway/src/canonical.ts";
import {validatePrepareAuthorizationRequest} from "../../../apps/gateway/src/validation.ts";
import {assertApprovedPlanScope,planDigest}
  from "../../../packages/plan-contracts/src/plan.mjs";
import type {
  CredentialStatusInput, IssuedDelegationCredential,
} from "./authority-client.ts";
import type {DelegatedPermission} from "./delegated-permission.ts";

export interface TrustedPlanningSnapshot {
  session_id:string;
  repository:{authority:string;owner:string;repository:string};
  base_revision:string;
  /** Trusted operator/Gitea-discovery-derived, not model-proposed paths. */
  directories:readonly string[];
  files:readonly string[];
}

export interface RootParameters {
  credential_id:string;
  valid_from:string;
  validity_seconds:number;
  credential_status:CredentialStatusInput;
}

export interface TrustedApprovalRecord {
  /** Authenticated and persisted by a trusted Engineer backend. */
  plan:unknown;
  approval:unknown;
  authenticated_engineer_did:string;
}

/** Must never accept raw GUI or model output without external authentication. */
export interface TrustedApprovalStore {
  loadAuthenticatedApproval(sessionId:string):Promise<TrustedApprovalRecord>;
}

/** Trusted bridge to the Gateway's in-process, revision-pinned Planning store.
 * Never supply this bridge to a model, A2A task, or unauthenticated HTTP route.
 */
export interface TrustedPlanningRevisionPort {
  begin(taskId:string,ttlMs:number):Promise<{
    task_id:string;base_revision:string;expires_at:string
  }>;
  end(taskId:string):void;
}

export interface EngineerCredentialPort {
  issueScopedOrchestratorRoot(
    request:RootParameters & {permissions:readonly DelegatedPermission[]}
  ):Promise<IssuedDelegationCredential>;
  revokeRoot(credentialId:string):Promise<void>;
}

type State="not_started"|"planning"|"revocation_pending"|"revoked"|"operational"|"failed_closed";
const SHA=/^[a-f0-9]{40}$/u;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CATALOG=new Set<string>(RUST_OPERATIONS);
const SUPPORTED=new Set<string>(TOOL_NAMES);

function fail(message:string):never {throw new Error("Trusted Engineer authority: "+message);}
function validId(x:unknown,label:string):string {
  if(typeof x!=="string" || !ID.test(x))fail(label+" is invalid");
  return x as string;
}
function validateRoot(p:RootParameters,maxSeconds:number):void {
  validId(p.credential_id,"credential_id");
  if(typeof p.valid_from!=="string" || !Number.isFinite(Date.parse(p.valid_from))) {
    fail("valid_from must be an ISO timestamp");
  }
  if(!Number.isSafeInteger(p.validity_seconds) ||
     p.validity_seconds<1 || p.validity_seconds>maxSeconds) {
    fail("root validity is outside the trusted time budget");
  }
  const v=p.credential_status;
  if(!v || v.type!=="BitstringStatusListEntry" ||
     v.statusPurpose!=="revocation" ||
     typeof v.statusListIndex!=="string" ||
     !/^\d+$/u.test(v.statusListIndex) ||
     typeof v.statusListCredential!=="string" ||
     !v.statusListCredential.trim()) {
    fail("root needs a valid terminal-revocation Status List entry");
  }
}
function path(p:string,allowRoot:boolean):string {
  if(p==="" && allowRoot)return p;
  if(typeof p!=="string" || p.length<1 || p.length>1024 ||
     p.startsWith("/") || p.endsWith("/") || p.includes("\\") ||
     p.split("/").some(piece=>
       !piece || piece==="." || piece===".." ||
       /[\x00-\x1f\x7f]/u.test(piece) ||
       piece.includes("%")))fail("invalid or noncanonical repository path");
  return p;
}
function distinct(values:readonly string[],label:string):void {
  if(!Array.isArray(values) || values.length>128 ||
     new Set(values).size!==values.length)fail("duplicate or oversized "+label);
}
function equality(a:unknown,b:unknown):boolean {
  return JSON.stringify(a)===JSON.stringify(b);
}

export function preliminaryReadPermissions(
  snapshot:TrustedPlanningSnapshot
):DelegatedPermission[] {
  validId(snapshot.session_id,"session_id");
  const repo=snapshot.repository;
  if(!repo || !["authority","owner","repository"].every(k=>
    typeof repo[k as keyof typeof repo]==="string" &&
    !!repo[k as keyof typeof repo].trim()))fail("repository identity missing");
  if(typeof snapshot.base_revision!=="string" ||
     !SHA.test(snapshot.base_revision))fail("unpinned Git base revision");
  distinct(snapshot.directories,"directory list");
  distinct(snapshot.files,"file list");
  if(!snapshot.directories.includes(""))fail("planning snapshot must include root directory");
  const permissions:DelegatedPermission[]=[
    {resource:canonicalRepositoryUri(repo),operation:"read_repository"}
  ];
  for(const dir of snapshot.directories) {
    path(dir,true);
    // Apply exactly the Gateway's normalizer and canonical resource mapping.
    const request=validatePrepareAuthorizationRequest({
      task_id:"trusted-planning-read",agent_role:"orchestrator",
      tool:"list_directory",arguments:{branch:"main",path:dir}
    });
    permissions.push({
      resource:canonicalDirectoryUri(repo,"main",request.request.arguments.path),
      operation:"list_directory"
    });
  }
  for(const file of snapshot.files) {
    path(file,false);
    const request=validatePrepareAuthorizationRequest({
      task_id:"trusted-planning-read",agent_role:"orchestrator",
      tool:"read_file",arguments:{branch:"main",path:file}
    });
    permissions.push({
      resource:canonicalFileUri(repo,"main",request.request.arguments.path),
      operation:"read_file"
    });
  }
  if(permissions.length>128)fail("read-only discovery exceeds root permission limit");
  return permissions;
}

function canonicalApprovedPermission(
  p:{operation:string;resource:string}, repository:TrustedPlanningSnapshot["repository"]
):DelegatedPermission {
  if(!CATALOG.has(p.operation) || !SUPPORTED.has(p.operation)) {
    fail("unimplemented or unapproved tool operation");
  }
  const repoUri=canonicalRepositoryUri(repository);
  if(p.operation==="read_repository" ||
     p.operation==="create_branch" || p.operation==="create_pull_request") {
    if(p.resource!==repoUri)fail("repository operation has wrong exact URI");
    return {resource:p.resource,operation:p.operation as DelegatedPermission["operation"]};
  }
  if(typeof p.resource!=="string")fail("missing approved permission URI");
  const prefix=repoUri+"/branches/";
  if(!p.resource.startsWith(prefix))fail("approved resource outside repository");
  const tail=p.resource.slice(prefix.length);
  const pos=tail.indexOf("/");
  const branchEncoded=pos<0?tail:tail.slice(0,pos);
  let branch:string;
  try{branch=decodeURIComponent(branchEncoded);}catch{fail("invalid approved branch encoding");}
  if(!branch || encodeURIComponent(branch)!==branchEncoded ||
     branch==="." || branch===".." || branch.includes("\\") ||
     /[\x00-\x1f\x7f]/u.test(branch))fail("invalid approved branch");
  const sub=pos<0?"":tail.slice(pos);
  const branchUri=canonicalBranchUri(repository,branch);
  if(p.operation==="run_tests") {
    if(p.resource!==branchUri || branch==="main")fail("invalid approved test execution branch");
  }else if(p.operation==="list_directory" || p.operation==="read_file" ||
           p.operation==="update_file" || p.operation==="create_file") {
    const directory=p.operation==="list_directory";
    const lead=directory?"/directories":"/files/";
    if(!sub.startsWith(lead))fail("invalid approved resource kind");
    const encoded=sub.slice(lead.length);
    const decoded:string[]=encoded===""?[]:encoded.split("/").map(part=>{
      let dec:string;try{dec=decodeURIComponent(part);}catch{fail("invalid URI encoding");}
      if(!dec || dec==="." || dec===".." || dec.includes("/") ||
         dec.includes("\\") || encodeURIComponent(dec)!==part ||
         /[\x00-\x1f\x7f]/u.test(dec))fail("noncanonical URI resource");
      return dec;
    });
    if(!directory && !decoded.length)fail("empty file URI");
    if(branch==="main" && p.operation!=="list_directory" &&
       p.operation!=="read_file")fail("write to main not authorized");
    const expected=directory?
      canonicalDirectoryUri(repository,branch,decoded.join("/")):
      canonicalFileUri(repository,branch,decoded.join("/"));
    if(p.resource!==expected)fail("noncanonical approved resource");
  }else fail("unsafe operation not supported by current provider");
  return {resource:p.resource,operation:p.operation as DelegatedPermission["operation"]};
}

export class TrustedEngineerAuthoritySession {
  readonly #snapshot:TrustedPlanningSnapshot;
  readonly #client:EngineerCredentialPort;
  readonly #store:TrustedApprovalStore;
  readonly #engineerDid:string;
  readonly #planningRevisions?:TrustedPlanningRevisionPort;
  #state:State="not_started";
  #provisionalId?:string;
  #provisionalStatus?:CredentialStatusInput;
  #operationalId?:string;
  #approvedPlanDigest?:string;
  #planningClosure?:Promise<void>;

  constructor(options:{
    snapshot:TrustedPlanningSnapshot;
    credentials:EngineerCredentialPort;
    approvals:TrustedApprovalStore;
    authenticatedEngineerDid:string;
    planningRevisions?:TrustedPlanningRevisionPort;
  }) {
    if(typeof options.authenticatedEngineerDid!=="string" ||
       !options.authenticatedEngineerDid.startsWith("did:")) {
      fail("authenticated Engineer identity missing");
    }
    preliminaryReadPermissions(options.snapshot);
    this.#snapshot=structuredClone(options.snapshot);
    this.#client=options.credentials;
    this.#store=options.approvals;
    this.#engineerDid=options.authenticatedEngineerDid;
    this.#planningRevisions=options.planningRevisions;
  }

  get phase():State {return this.#state;}
  get approvedPlanDigest():string|undefined{return this.#approvedPlanDigest;}

  /** A temporary, short-lived root; never contains a write/test/PR permission. */
  async startPlanning(root:RootParameters):Promise<{
    credential_id:string;phase:"planning";permissions:DelegatedPermission[]
  }> {
    if(this.#state!=="not_started")fail("planning root already requested");
    validateRoot(root,900);
    const permissions=preliminaryReadPermissions(this.#snapshot);
    this.#state="failed_closed"; // reserve before awaiting external network
    let registered=false;
    try {
      if(this.#planningRevisions) {
        // The base SHA must be read by the trusted Gateway Gitea client.
        // Neither Engineer input nor the LLM may silently replace it.
        const pinned=await this.#planningRevisions.begin(
          this.#snapshot.session_id,root.validity_seconds*1000
        );
        registered=true;
        if(pinned.task_id!==this.#snapshot.session_id ||
           pinned.base_revision!==this.#snapshot.base_revision ||
           !SHA.test(pinned.base_revision) ||
           !Number.isFinite(Date.parse(pinned.expires_at))) {
          fail("trusted Gitea base revision differs from Engineer snapshot");
        }
      }
      const issued=await this.#client.issueScopedOrchestratorRoot({...root,permissions});
      if(issued.id!==root.credential_id || !equality(issued.credentialSubject?.per,permissions)){
        fail("Adapter returned inconsistent provisional root");
      }
      this.#provisionalId=root.credential_id;
      this.#provisionalStatus=structuredClone(root.credential_status);
      this.#state="planning";
      return {credential_id:issued.id,phase:"planning",permissions};
    } catch(error) {
      if(registered) {
        try {this.#planningRevisions?.end(this.#snapshot.session_id);} catch {/* fail closed */}
      }
      throw error;
    }
  }

  /** Private Engineer-side abort. Reserve terminal state BEFORE awaiting
   * Gateway retirement and native Rust/Adapter revocation; every concurrent
   * caller receives the same result, including failed reconciliation. */
  cancelPlanning():Promise<void>{
    if(this.#planningClosure)return this.#planningClosure;
    if(this.#state!=="planning"||!this.#provisionalId)
      return Promise.reject(Error("No active provisional root to cancel"));
    const rootId=this.#provisionalId;
    this.#state="failed_closed";
    this.#planningClosure=(async()=>{
      let registryEnded=false,rootRevoked=false;
      try{
        this.#planningRevisions?.end(this.#snapshot.session_id);
        registryEnded=true;
      }catch{/* Still attempt native root revocation. */}
      try{
        await this.#client.revokeRoot(rootId);
        rootRevoked=true;
      }catch{/* Never claim a completed cancellation without a Rust receipt. */}
      if(!registryEnded||!rootRevoked)
        fail("Planning root cancellation not confirmed; manual reconciliation required");
      this.#provisionalId=undefined;
      this.#provisionalStatus=undefined;
      this.#state="revoked";
    })();
    return this.#planningClosure;
  }

  /**
   * Approval comes from trusted persisted state and authenticated Engineer
   * context only. Never supply the plan/approval as call parameters from
   * Gemini, A2A or a demo UI. No operational DC without prior revocation.
   */
  async approveAndIssueOperationalRoot(root:RootParameters):Promise<{
    credential_id:string;
    phase:"operational";
    plan_digest:string;
    approval_decision_id:string;
    permissions:DelegatedPermission[];
  }> {
    if(this.#state!=="planning" || !this.#provisionalId ||
       !this.#provisionalStatus)fail("active preliminary authority missing");
    validateRoot(root,7200);
    if(root.credential_id===this.#provisionalId)fail("operational root must use independent credential ID");
    if(root.credential_status.statusListCredential===this.#provisionalStatus.statusListCredential &&
       root.credential_status.statusListIndex===this.#provisionalStatus.statusListIndex) {
      fail("operational and provisional status entries must be independent");
    }

    // Validate the immutable approved plan and authenticated approval before
    // revoking the provisional root; approval must not be user-supplied.
    const trusted=await this.#store.loadAuthenticatedApproval(this.#snapshot.session_id);
    if(trusted.authenticated_engineer_did!==this.#engineerDid)
      fail("approval belongs to another authenticated Engineer");
    const plan=trusted.plan as any, approval=trusted.approval as any;
    if(plan?.session_id!==this.#snapshot.session_id ||
       !equality(plan.repository,this.#snapshot.repository) ||
       plan.base_revision!==this.#snapshot.base_revision) {
      fail("plan does not match trusted repository snapshot and base SHA");
    }
    const approvedRows=assertApprovedPlanScope(plan,approval,{
      allowedOperations:CATALOG,expectedEngineerDid:this.#engineerDid
    });

    const selected:DelegatedPermission[]=[];
    const seen=new Set<string>();
    // This checks proposed/approved scope, NOT execution dependencies.
    // Actual completedTaskIds must come later from the trusted A2A runtime.
    for(const row of approvedRows) {
      const permission=canonicalApprovedPermission(row,this.#snapshot.repository);
      const key=JSON.stringify(permission);
      if(!seen.has(key))selected.push(permission);
      seen.add(key);
    }
    if(selected.length===0 || selected.length>128)fail("invalid operational root permission count");

    this.#state="revocation_pending"; // reject concurrent issuance/approval
    try{
      // Stop outstanding read challenges before attempting on-chain revocation.
      // If the registry is unreachable or fails, NEVER issue operational DC.
      this.#planningRevisions?.end(this.#snapshot.session_id);
      await this.#client.revokeRoot(this.#provisionalId);
    }catch{
      // Ambiguous failure means the old credential may still be active;
      // no new operational root may be issued in this session.
      this.#state="failed_closed";
      fail("provisional root revocation not confirmed; operational authority blocked");
    }
    this.#state="revoked";

    // This root is issued directly by the Engineer, with no parent link to
    // the former preliminary DC. Failure leaves provisional root revoked.
    this.#state="failed_closed";
    const issued=await this.#client.issueScopedOrchestratorRoot({...root,permissions:selected});
    if(issued.id!==root.credential_id || !equality(issued.credentialSubject?.per,selected))
      fail("Adapter returned inconsistent operational root");
    this.#operationalId=issued.id;
    this.#approvedPlanDigest=planDigest(plan);
    this.#state="operational";
    return {
      credential_id:issued.id,
      phase:"operational",
      plan_digest:this.#approvedPlanDigest,
      approval_decision_id:approval.decision_id,
      permissions:selected
    };
  }
}
