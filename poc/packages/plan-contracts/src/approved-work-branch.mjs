/**
 * A signed plan can designate exactly ONE restricted feature branch.
 * No model-supplied branch or authorization flag is consulted.
 */
const SAFE=/^feature\/[a-z0-9][a-z0-9./_-]*$/u;
const LEGACY="feature/account-suspension";
export function approvedWorkBranch(plan){
  const repo=plan?.repository;
  if(!repo||!["authority","owner","repository"].every(k=>
     typeof repo[k]==="string"&&repo[k].length>0)){
    throw Error("Approved branch: missing repository");
  }
  // R151.22.1: match the Gateway's canonicalRepositoryUri contract.
  // In particular, the owner/repository path segments are percent-encoded;
  // signed grants using canonical URIs must not be mistaken for an
  // external repository when the owner contains '+' or other characters.
  const root="gitea://"+repo.authority.trim().toLowerCase()+"/"+
    encodeURIComponent(repo.owner)+"/"+encodeURIComponent(repo.repository);
  if(!Array.isArray(plan.requested_permissions)){
    throw Error("Approved branch: missing permission set");
  }
  const branches=new Set();
  for(const row of plan.requested_permissions){
    const resource=row?.resource;
    if(typeof resource!=="string")throw Error("Approved branch: malformed resource");
    if(resource===root)continue;
    const prefix=root+"/branches/";
    if(!resource.startsWith(prefix))throw Error("Approved branch: external repository");
    const part=resource.slice(prefix.length).split("/")[0];
    let branch;
    try{branch=decodeURIComponent(part);}
    catch{throw Error("Approved branch: invalid encoded branch");}
    if(!SAFE.test(branch)||branch.length>120||branch.includes("..")||
       branch.includes("//")||branch.endsWith("/")||branch.endsWith(".")||
       branch.endsWith(".lock")||branch.includes("@{")||
       encodeURIComponent(branch)!==part){
      throw Error("Approved branch: noncanonical or forbidden feature branch");
    }
    branches.add(branch);
  }
  if(branches.size>1)throw Error("Approved branch: multiple working branches");
  // A branch-only historical plan has no separate branch-scoped permission.
  // It must use the legacy fixed branch until scope is made explicit.
  return branches.size===1?[...branches][0]:LEGACY;
}
export {LEGACY as LEGACY_APPROVED_BRANCH};
