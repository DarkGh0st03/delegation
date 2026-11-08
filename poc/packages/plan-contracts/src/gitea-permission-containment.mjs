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
export function isProjectTestSource(path) {
 return typeof path==="string"&&
  /^tests\/(backend|frontend)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.test\.tsx?$/u.test(path);
}
/** R383.0 — Test may investigate ONLY owner-scoped application test
 * sources in a dedicated read-only Child. This cannot authorize an edit,
 * Docker acceptance changes, Runner PASS or a broader directory grant. */
export function isProjectTestReadGrant(permissions) {
 if(!Array.isArray(permissions)||permissions.length!==1||
    permissions[0]?.operation!=="read_file")return false;
 const file=scope(permissions[0].resource);
 return file?.kind==="files"&&isProjectTestSource(file.path.join("/"));
}
/** Test CREATE is restricted to one exact project test source. This is a
 * grant-shape check only; native Rust, OPA, absence and CAS remain required. */
export function isProjectTestCreateGrant(permissions) {
 if(!Array.isArray(permissions)||permissions.length!==1||
    permissions[0]?.operation!=="create_file")return false;
 const file=scope(permissions[0].resource);
 return file?.kind==="files"&&isProjectTestSource(file.path.join("/"));
}
export function isProjectTestRepairGrant(permissions) {
 const read=permissions.find(p=>p.operation==="read_file");
 const update=permissions.find(p=>p.operation==="update_file");
 if(permissions.length!==2||!read||read.resource!==update?.resource)return false;
 const file=scope(read.resource);
 return file?.kind==="files"&&isProjectTestSource(file.path.join("/"));
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
