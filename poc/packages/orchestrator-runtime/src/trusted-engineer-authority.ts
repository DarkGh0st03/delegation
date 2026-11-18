/**
 * Shared contracts of the Engineer authority: the Planning snapshot, Root
 * parameters, the Engineer credential port and the exact read-only
 * permissions of the preliminary Planning Root.
 *
 * Both roots are issued by the Engineer in Rust. The operational root is
 * independent of the revoked preliminary root (never its child).
 */
import {validateDynamicPlanningRoots} from "./trusted-planning-discovery-ledger.ts";
import {
  canonicalRepositoryUri, canonicalFileUri, canonicalDirectoryUri
} from "../../../apps/gateway/src/canonical.ts";
import {validatePrepareAuthorizationRequest} from "../../../apps/gateway/src/validation.ts";
import type {
  CredentialStatusInput, IssuedDelegationCredential,
} from "./trusted-credential-contracts.ts";
import type {DelegatedPermission} from "./delegated-permission.ts";

export interface TrustedPlanningSnapshot {
  session_id:string;
  repository:{authority:string;owner:string;repository:string};
  base_revision:string;
  /** Optional owner-signed, revision-pinned feature baseline for a disposable
   * already-created branch. Omitted means the historical main read boundary.
   * NEVER supplied by ADK/tool arguments or inferred from a model response. */
  planning_branch?:string;
  /** Explicit original-owner selection of a branch-root, read-only hierarchical
   * Planning scope. NEVER a model/tool or unsigned GUI option. The trusted
   * snapshot still lists the exact paths discoverable by the Planner. */
  hierarchical_preliminary_read?:boolean;
  /** Optional explicit source subtrees selected by the authenticated owner
   * BEFORE signing the preliminary Root. Subtree entries become model-readable
   * only after a trusted SHA-pinned Gitea list-directory observation. */
  dynamic_discovery_roots?:readonly string[];
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

/** Trusted bridge to the Gateway's in-process, revision-pinned Planning store.
 * Never supply this bridge to a model, A2A task, or unauthenticated HTTP route.
 */
export interface TrustedPlanningRevisionPort {
  begin(taskId:string,ttlMs:number):Promise<{
    task_id:string;base_revision:string;expires_at:string
  }>;
  end(taskId:string):void|Promise<void>;
}

export interface EngineerCredentialPort {
  issueScopedOrchestratorRoot(
    request:RootParameters & {permissions:readonly DelegatedPermission[]}
  ):Promise<IssuedDelegationCredential>;
  revokeRoot(credentialId:string):Promise<void>;
}

const SHA=/^[a-f0-9]{40}$/u;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function fail(message:string):never {throw new Error("Trusted Engineer authority: "+message);}
function validId(x:unknown,label:string):string {
  if(typeof x!=="string" || !ID.test(x))fail(label+" is invalid");
  return x as string;
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
function distinct(values:readonly string[],label:string,max=128):void {
  if(!Array.isArray(values) || values.length>max ||
     new Set(values).size!==values.length)fail("duplicate or oversized "+label);
}
export function trustedPlanningSourceBranch(
 snapshot:Pick<TrustedPlanningSnapshot,"planning_branch">):string{
  // The repository base branch (any safe name, default "main") or a
  // feature/ work branch of an earlier session.
  const branch=snapshot.planning_branch??"main";
  if(typeof branch!=="string"||
     !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/u.test(branch)||
     branch.endsWith("/")||branch.includes("..")||branch.includes("//")||
     branch.endsWith(".lock")||
     (branch.startsWith("feature/")&&!/^feature\/[a-z0-9][a-z0-9._/-]*$/u.test(branch)))
    fail("invalid trusted Planning source branch");
  return branch;
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
  const sourceBranch=trustedPlanningSourceBranch(snapshot);
  if(snapshot.hierarchical_preliminary_read!==undefined&&
     typeof snapshot.hierarchical_preliminary_read!=="boolean")
    fail("invalid trusted Planning hierarchy selection");
  const hierarchical=snapshot.hierarchical_preliminary_read===true;
  // The signed Root stays O(1) for this explicit read-only mode; trusted
  // snapshot paths stay bounded independently of Root permission count.
  const maxPaths=hierarchical?4096:128;
  distinct(snapshot.directories,"directory list",maxPaths);
  distinct(snapshot.files,"file list",maxPaths);
  if(!snapshot.directories.includes(""))fail("planning snapshot must include root directory");
  // Reading the default repository metadata at an unrelated feature HEAD
  // cannot be revision pinned; feature snapshots authorize only exact
  // feature list/read operations, never an ambiguous main HEAD read.
  // The base branch (not a feature/ snapshot) allows the repository read.
  const permissions:DelegatedPermission[]=!sourceBranch.startsWith("feature/")?
    [{resource:canonicalRepositoryUri(repo),operation:"read_repository"}]:[];
  for(const dir of snapshot.directories) {
    path(dir,true);
    // Apply exactly the Gateway's normalizer and canonical resource mapping.
    const request=validatePrepareAuthorizationRequest({
      task_id:"trusted-planning-read",agent_role:"orchestrator",
      tool:"list_directory",arguments:{branch:sourceBranch,path:dir}
    });
    if(!hierarchical)permissions.push({
      resource:canonicalDirectoryUri(repo,sourceBranch,request.request.arguments.path),
      operation:"list_directory"
    });
  }
  for(const file of snapshot.files) {
    path(file,false);
    const request=validatePrepareAuthorizationRequest({
      task_id:"trusted-planning-read",agent_role:"orchestrator",
      tool:"read_file",arguments:{branch:sourceBranch,path:file}
    });
    if(!hierarchical)permissions.push({
      resource:canonicalFileUri(repo,sourceBranch,request.request.arguments.path),
      operation:"read_file"
    });
  }
  // Even though the signed hierarchical Root already covers the whole
  // branch, model-discovered paths require an additional immutable,
  // operator-selected subtree pin. Invalid opt-ins fail before issuance.
  validateDynamicPlanningRoots(snapshot);
  if(hierarchical){
    const root=canonicalDirectoryUri(repo,sourceBranch,"");
    // Rust ResourceUri::contains_resource accepts a directory ancestor for
    // the SAME operation only. These are TWO separate read/list rights:
    // neither may grant update, create, tests or access another branch.
    permissions.push({resource:root,operation:"list_directory"});
    permissions.push({resource:root,operation:"read_file"});
  }
  if(permissions.length>128)fail("read-only discovery exceeds root permission limit");
  return permissions;
}
