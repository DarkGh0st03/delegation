/**
 * R384.4 — disposable TEST-OWNER ONLY functional-coverage audit.
 *
 * Compares the known unsolved Account Suspension baseline with the pinned
 * researcher-functional reference to identify exact source operations that
 * the signed Engineer Root would need to contain for THAT REFERENCE PATH.
 *
 * This is NOT a planning oracle, model prompt, approval, executable edit,
 * authority expansion, Rust signature check or claim of a Test PASS.
 * Never load target bytes into an ADK request or delegated Task.
 */
import {createHash} from "node:crypto";
import {giteaPermissionCovers}
 from "../../../packages/plan-contracts/src/gitea-permission-containment.mjs";
import {ACCOUNT_SUSPENSION_REFERENCE_FILES}
 from "../fixtures/account-suspension-reference.mjs";
import {ACCOUNT_SUSPENSION_UNSOLVED_BASELINE_FILES}
 from "../fixtures/account-suspension-unsolved-baseline.mjs";

const REPO="gitea://gitea.local/thesis/iam-console-poc";
const BRANCH="feature/account-suspension";
const PREFIX=REPO+"/branches/"+encodeURIComponent(BRANCH);
const ALLOWED=/^(?:apps\/(?:backend|frontend)\/|packages\/shared\/|tests\/(?:backend|frontend)\/)[A-Za-z0-9_@.\/-]+$/u;
const SHA40=/^[a-f0-9]{40}$/u;
const HIDDEN="tests/e2e/account-suspension.spec.ts";
function deny(reason){throw Error("R384.4 functional coverage preflight NO-GO: "+reason);}
function permission(path,operation){
 return Object.freeze({resource:PREFIX+"/files/"+path,operation});
}
function fingerprint(items){
 return createHash("sha256").update(JSON.stringify(items)).digest("hex");
}
/**
 * @param {{rootPermissions:Array<{resource:string,operation:string}>,
 *   repository?:string,branch?:string}} options
 * @returns readonly sanitized aggregate, NEVER source content.
 */
export function auditAccountSuspensionFunctionalCoverage({
 rootPermissions,repository=REPO,branch=BRANCH
}={}){
 if(repository!==REPO||branch!==BRANCH||
    !Array.isArray(rootPermissions)||rootPermissions.length<1||
    rootPermissions.length>256||
    rootPermissions.some(x=>!x||typeof x!=="object"||
     typeof x.resource!=="string"||typeof x.operation!=="string"))
  deny("pinned repository, branch and original Engineer grants required");
 const referencePaths=Object.keys(ACCOUNT_SUSPENSION_REFERENCE_FILES).sort();
 if(referencePaths.length!==11||!referencePaths.includes(HIDDEN))
  deny("researcher reference was changed without an owner review");
 const missing=[],covered=[],required=[],excluded=[];
 for(const path of referencePaths){
  const replacement=ACCOUNT_SUSPENSION_REFERENCE_FILES[path];
  const baseline=ACCOUNT_SUSPENSION_UNSOLVED_BASELINE_FILES[path];
  if(typeof replacement!=="string"||!replacement.length||
     (baseline!==undefined&&typeof baseline!=="string"))
   deny("reference contains missing, empty or malformed source bytes");
  if(path===HIDDEN){
   // Runner-owned researcher checks are never writable by model agents.
   if(baseline!==undefined)deny("runner acceptance is unexpectedly in baseline");
   excluded.push(path);
   continue;
  }
  if(!ALLOWED.test(path)||path.includes("..")||
     path.split("/").some(segment=>segment==="."||segment===".."))
   deny("reference includes a noncanonical or unapproved application path");
  if(replacement===baseline)continue;
  const operations=baseline===undefined?
   ["create_file"]:["read_file","update_file"];
  for(const operation of operations){
   const item=permission(path,operation);
   required.push(item);
   if(rootPermissions.some(grant=>giteaPermissionCovers(grant,item)))
    covered.push(item);
   else missing.push(item);
  }
 }
 const changedPaths=new Set(required.map(x=>x.resource.split("/files/")[1]));
 if(changedPaths.size!==10||excluded.length!==1||
    required.length!==20)
  deny("pinned Account Suspension reference coverage no longer matches reviewed scope");
 const status=missing.length===0?
  "known_reference_operations_covered_preflight_only":
  "signed_root_insufficient_for_known_functional_reference";
 return Object.freeze({
  status,
  scenario:"account-suspension",
  repository,branch,
  reviewed_source_paths:changedPaths.size,
  required_operation_pairs:required.length,
  covered_operation_pairs:covered.length,
  missing_operation_pairs:missing.length,
  missing: Object.freeze(missing.map(x=>Object.freeze({...x}))),
  researcher_owned_paths_excluded:Object.freeze([...excluded]),
  exact_required_grants_sha256:fingerprint(required),
  source_material_disclosed:false,
  original_root_signature_verified:false,
  rust_vp_verified:false,
  gateway_write_authorized:false,
  root_expanded:false,
  model_generated_source:false,
  functional_pass_attested:false
 });
}
