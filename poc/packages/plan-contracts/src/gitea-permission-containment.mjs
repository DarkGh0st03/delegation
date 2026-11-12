/**
 * R299 — conservative mirror of the canonical Gitea-directory containment
 * implemented by Core Rust ResourceUri::contains_resource().
 *
 * Preflight only: this function does NOT verify accumulator witnesses, VP
 * signatures, trust/status, or OPA. A successful request still MUST be
 * checked by the native Rust verifier with the concrete required permission.
 */
const SCOPED_OPS=new Set(["read_file","update_file","create_file","list_directory"]);
const SEG=/^[A-Za-z0-9_@.-]+$/u;
const HOST=/^[a-z0-9][a-z0-9.-]*$/u;
const BRANCH=/^(?:main|feature\/[a-z0-9][a-z0-9./_-]*)$/u;

function scope(resource) {
 if(typeof resource!=="string"||resource.length>1024||
    !resource.startsWith("gitea://"))return null;
 const p=resource.slice(8).split("/");
 if(p.length<6||!HOST.test(p[0])||
    !SEG.test(p[1])||!SEG.test(p[2])||
    p[3]!=="branches"||
    (p[5]!=="directories"&&p[5]!=="files")||
    (p[5]==="files"&&p.length===6))return null;
 let branch;
 try{branch=decodeURIComponent(p[4]);}
 catch{return null;}
 if(!BRANCH.test(branch)||branch.includes("..")||
    branch.includes("//")||branch.endsWith("/")||
    encodeURIComponent(branch)!==p[4])return null;
 const prefix=p.slice(0,5).join("/");
 const path=p.slice(6);
 if(path.some(v=>!SEG.test(v)||v==="."||v===".."||
    v.includes("..")||v.includes("%")))return null;
 return {prefix,kind:p[5],path};
}
// Application tests may use dotted filenames (user.service.test.ts) but never\n// empty/double-dot path components. Runner-owned
// acceptance and execution configuration are outside this project scope.
/**
 * Repository-owned application-test source policy. Constructed ONLY by a
 * trusted provisioner, never from ADK tool arguments or A2A/model output.
 * The default profile preserves IAM Console's existing project-test scope.
 * This describes eligible test sources, NOT a DC, VP or permission grant.
 */
const TRUSTED_TEST_PROFILES=new WeakSet();
const ROOT_PART=/^[A-Za-z0-9_-]+$/u;
const FILE_STEM=/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/u;
const TEST_SUFFIX=/^\.(?:test|spec)\.(?:[cm]?js|tsx?|jsx?)$/u;
const FORBIDDEN_TEST_ROOT_SEGMENTS=new Set([
 "acceptance","researcher_acceptance","runner",".github","node_modules"
]);
export function createTrustedProjectTestSourceProfile(value) {
 const valid=value&&typeof value==="object"&&!Array.isArray(value)&&
  Object.getPrototypeOf(value)===Object.prototype&&
  Object.keys(value).sort().join(",")==="roots,suffixes";
 if(!valid||!Array.isArray(value.roots)||!Array.isArray(value.suffixes)||
    value.roots.length<1||value.roots.length>16||
    value.suffixes.length<1||value.suffixes.length>8||
    new Set(value.roots).size!==value.roots.length||
    new Set(value.suffixes).size!==value.suffixes.length)
  throw Error("Invalid trusted project-test profile");
 for(const root of value.roots){
  if(typeof root!=="string"||root.length>160||
     root.split("/").some(s=>!ROOT_PART.test(s)||
       FORBIDDEN_TEST_ROOT_SEGMENTS.has(s.toLowerCase())))
   throw Error("Invalid trusted project-test root");
 }
 if(value.suffixes.some(s=>typeof s!=="string"||!TEST_SUFFIX.test(s)))
  throw Error("Invalid trusted project-test suffix");
 const profile=Object.freeze({
  roots:Object.freeze([...value.roots]),
  suffixes:Object.freeze([...value.suffixes])
 });
 TRUSTED_TEST_PROFILES.add(profile);
 return profile;
}
export const IAM_CONSOLE_PROJECT_TEST_PROFILE=createTrustedProjectTestSourceProfile({
 roots:["tests/backend","tests/frontend"],
 suffixes:[".test.ts",".test.tsx"]
});
export function isTrustedProjectTestSourceProfile(value) {
 return !!value&&typeof value==="object"&&TRUSTED_TEST_PROFILES.has(value);
}
export function isProjectTestSource(path,profile=IAM_CONSOLE_PROJECT_TEST_PROFILE) {
 if(!isTrustedProjectTestSourceProfile(profile)||typeof path!=="string"||
    path.length>240||path.includes("%")||path.includes("\\")||
    /[\x00-\x1f\x7f]/u.test(path))return false;
 const root=profile.roots.find(root=>path.startsWith(root+"/"));
 if(!root)return false;
 const segments=path.slice(root.length+1).split("/");
 if(!segments.length||segments.slice(0,-1).some(s=>!ROOT_PART.test(s)))return false;
 const filename=segments.at(-1);
 return profile.suffixes.some(suffix=>
  filename.endsWith(suffix)&&
  FILE_STEM.test(filename.slice(0,-suffix.length)));
}
/** R383.0 — Test may investigate ONLY owner-scoped application test
 * sources in a dedicated read-only Child. This cannot authorize an edit,
 * Docker acceptance changes, Runner PASS or a broader directory grant. */
export function isProjectTestReadGrant(permissions,profile=IAM_CONSOLE_PROJECT_TEST_PROFILE) {
 if(!Array.isArray(permissions)||permissions.length!==1||
    permissions[0]?.operation!=="read_file")return false;
 const file=scope(permissions[0].resource);
 return file?.kind==="files"&&isProjectTestSource(file.path.join("/"),profile);
}
/** The Test agent may READ, in a dedicated read-only Task, ONE exact file
 * anywhere in the repository (e.g. the source written by Backend/Frontend),
 * so that it can write tests for the real behaviour. This is only the grant
 * SHAPE: the file must still be inside the Engineer-signed root scope, and
 * Rust VP, OPA and the pinned Gitea HEAD remain mandatory. Writes by the Test
 * agent stay limited to project test sources (create/repair grants below). */
export function isTestAgentReadGrant(permissions) {
 if(!Array.isArray(permissions)||permissions.length!==1||
    permissions[0]?.operation!=="read_file")return false;
 const file=scope(permissions[0].resource);
 return file?.kind==="files"&&file.path.length>0;
}
/** Test CREATE is restricted to one exact project test source. This is a
 * grant-shape check only; native Rust, OPA, absence and CAS remain required. */
export function isProjectTestCreateGrant(permissions,profile=IAM_CONSOLE_PROJECT_TEST_PROFILE) {
 if(!Array.isArray(permissions)||permissions.length!==1||
    permissions[0]?.operation!=="create_file")return false;
 const file=scope(permissions[0].resource);
 return file?.kind==="files"&&isProjectTestSource(file.path.join("/"),profile);
}
/** Most files one edit Task may read (the edited file plus its context). */
export const MAX_TASK_READS=15;
/**
 * Shape of a native "reads + one update" Task grant: exactly ONE update_file
 * of one exact file, plus 1..MAX_TASK_READS read_file of DISTINCT exact files
 * that include the edited one (its dependencies and context), nothing else.
 * Every read and the update remain separate, durably recorded, Rust/OPA
 * verified effects; this only describes the signed Task grant SHAPE.
 * Returns {edit, reads} (resources) or null.
 */
export function readUpdateGrantShape(permissions) {
 if(!Array.isArray(permissions)||permissions.length<2||
    permissions.length>MAX_TASK_READS+1)return null;
 const updates=permissions.filter(p=>p?.operation==="update_file");
 const reads=permissions.filter(p=>p?.operation==="read_file");
 if(updates.length!==1||reads.length+1!==permissions.length)return null;
 if([...reads,updates[0]].some(p=>typeof p.resource!=="string"||
    scope(p.resource)?.kind!=="files"))return null;
 const readSet=new Set(reads.map(p=>p.resource));
 if(readSet.size!==reads.length||!readSet.has(updates[0].resource))return null;
 return Object.freeze({edit:updates[0].resource,reads:Object.freeze([...readSet])});
}
/** Path of an exact file ResourceURI (no decoding beyond the canonical form). */
export function exactFilePath(resource) {
 const file=scope(resource);
 return file?.kind==="files"?file.path.join("/"):undefined;
}
/** True when a signed read_file grant of `permissions` covers the repository
 * `path` (exact file, or a directory grant that contains it). */
export function readGrantsCoverPath(permissions,path) {
 if(!Array.isArray(permissions)||typeof path!=="string"||!path)return false;
 const parts=path.split("/");
 if(parts.some(x=>!x||x==="."||x===".."))return false;
 return permissions.some(p=>{
  if(p?.operation!=="read_file")return false;
  const a=scope(p.resource);
  if(a?.kind==="files")return a.path.join("/")===path;
  return a?.kind==="directories"&&parts.length>a.path.length&&
   a.path.every((v,i)=>v===parts[i]);
 });
}
/** Test may EDIT only a project test source; it may READ any signed file
 * (application code it tests) in the same Task. */
export function isProjectTestRepairGrant(permissions,profile=IAM_CONSOLE_PROJECT_TEST_PROFILE) {
 const shape=readUpdateGrantShape(permissions);
 const edited=shape&&scope(shape.edit);
 return !!edited&&edited.kind==="files"&&
  isProjectTestSource(edited.path.join("/"),profile);
}
export function giteaPermissionCovers(parent,required) {
 if(!parent||!required||typeof parent!=="object"||
    typeof required!=="object"||
    typeof parent.operation!=="string"||
    parent.operation!==required.operation||
    typeof parent.resource!=="string"||
    typeof required.resource!=="string")return false;
 // Exact grants, including historical repo/branch operations, remain exact.
 if(parent.resource===required.resource)return true;
 if(!SCOPED_OPS.has(parent.operation))return false;
 const a=scope(parent.resource),b=scope(required.resource);
 return !!a&&!!b&&a.kind==="directories"&&
    a.prefix===b.prefix&&b.path.length>=a.path.length&&
    a.path.every((v,i)=>v===b.path[i]);
}
