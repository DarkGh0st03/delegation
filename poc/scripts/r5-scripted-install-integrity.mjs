/**
 * R5 read-only defence-in-depth: check the *locally installed* executable
 * tree before requesting a GitHub OIDC token. Remote branch SHA and workflow
 * registration alone do NOT verify what a privileged runner will execute.
 *
 * A clean local Git checkout is not a cryptographic attestation. Deployment
 * must independently secure OS, Git binary, code, dependencies and runner.
 * This guard never connects to GitHub, starts a model or grants authority.
 */
import {lstat} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {join} from "node:path";

export const SCRIPTED_INSTALL_ROOT="/opt/delegation/r5";
const SHA=/^[a-f0-9]{40}$/u;
const OWNER_ONLY_DIRECTORIES=Object.freeze([
  "/opt", "/opt/delegation", SCRIPTED_INSTALL_ROOT,
  join(SCRIPTED_INSTALL_ROOT,".git"),
  join(SCRIPTED_INSTALL_ROOT,"poc"),
  join(SCRIPTED_INSTALL_ROOT,"poc","apps"),
  join(SCRIPTED_INSTALL_ROOT,"poc","apps","orchestrator"),
  join(SCRIPTED_INSTALL_ROOT,"poc","apps","orchestrator","src"),
  join(SCRIPTED_INSTALL_ROOT,"poc","packages"),
  join(SCRIPTED_INSTALL_ROOT,"poc","packages","orchestrator-runtime"),
  join(SCRIPTED_INSTALL_ROOT,"poc","packages","orchestrator-runtime","src"),
  join(SCRIPTED_INSTALL_ROOT,"poc","scripts")
]);
const TRUSTED_ENTRYPOINTS=Object.freeze([
  "poc/scripts/r5-scripted-install-integrity.mjs",
  "poc/scripts/r5-scripted-dispatch-registration.mjs",
  "poc/apps/orchestrator/src/hold-private-scripted-github-session.mjs",
  "poc/apps/orchestrator/src/trusted-private-scripted-runner-oidc.mjs"
]);
function deny(reason){
  throw Error("R5 protected scripted install denied: "+reason);
}
function localGit(args){
  const git=spawnSync("/usr/bin/git",[
    "-c","safe.directory="+SCRIPTED_INSTALL_ROOT,
    "-C",SCRIPTED_INSTALL_ROOT,...args
  ],{
    encoding:"utf8",timeout:12000,maxBuffer:4*1024*1024,
    env:{PATH:"/usr/bin:/bin",HOME:"/nonexistent",
      GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_GLOBAL:"/dev/null",
      GIT_OPTIONAL_LOCKS:"0"}
  });
  if(git.error||git.status!==0||typeof git.stdout!=="string")
    deny("local Git inspection unavailable");
  return git.stdout;
}
async function protectedEntry(path,kind,lstatFn){
  let stat;
  try{stat=await lstatFn(path);}catch{deny("installed source missing");}
  if(stat.isSymbolicLink()||
     (kind==="directory"?!stat.isDirectory():!stat.isFile())||
     stat.uid!==0||(stat.mode&0o022)!==0)
    deny("installed source not root-owned and protected against group/other writes");
}
/**
 * Root-owned, non-group-writable code tree; non-root runner identity;
 * actual local Git HEAD, toplevel, clean index/worktree, no symlinks/gitlinks.
 * An offline preparation/diagnostic only, never an authorization or R5 GO.
 */
export async function verifyProtectedScriptedInstallation({
  expectedSourceSha,runnerUid=process.getuid?.(),
  lstatFn=lstat,gitFn=localGit
}={}){
  if(!SHA.test(expectedSourceSha??""))deny("missing pinned Git SHA");
  if(!Number.isSafeInteger(runnerUid)||runnerUid<1)
    deny("private runner must execute as a non-root service account");
  for(const path of OWNER_ONLY_DIRECTORIES)
    await protectedEntry(path,"directory",lstatFn);
  for(const relative of TRUSTED_ENTRYPOINTS)
    await protectedEntry(join(SCRIPTED_INSTALL_ROOT,relative),"file",lstatFn);

  if(gitFn(["rev-parse","--show-toplevel"]).trim()!==SCRIPTED_INSTALL_ROOT)
    deny("installed source is not its expected Git checkout");
  if(gitFn(["rev-parse","--verify","HEAD"]).trim()!==expectedSourceSha)
    deny("installed Git HEAD differs from the independently pinned source SHA");
  if(gitFn(["status","--porcelain=v1","--untracked-files=all"])!=="")
    deny("installed tracked/untracked source contains changes");
  // --stage -z shows Git file modes including 120000 symlinks and 160000
  // gitlinks. They could load code outside this pinned executable tree.
  const index=gitFn(["ls-files","--stage","-z"]);
  const records=index.split("\0");
  if(records.at(-1)!=="")deny("malformed local Git index");
  records.pop();
  if(records.length===0)
    deny("installed Git index has no pinned files");
  // Also enforce ownership of EVERY tracked source file and intermediate
  // directory: checking only the main entrypoint misses a mutable imported
  // library or test helper replaced after the Git-status check.
  const protectedDirs=new Set(OWNER_ONLY_DIRECTORIES);
  for(const line of records){
    const match=/^100(?:644|755) [a-f0-9]{40} 0\t([^\0]+)$/u.exec(line);
    if(!match)deny("installed Git index includes symlinks or gitlinks");
    const parts=match[1].split("/");
    if(parts.some(x=>!x||x==="."||x===".."))
      deny("installed Git index contains unsafe paths");
    for(let end=1;end<parts.length;end++){
      const parent=join(SCRIPTED_INSTALL_ROOT,...parts.slice(0,end));
      if(!protectedDirs.has(parent)){
        await protectedEntry(parent,"directory",lstatFn);
        protectedDirs.add(parent);
      }
    }
    await protectedEntry(join(SCRIPTED_INSTALL_ROOT,...parts),"file",lstatFn);
  }
  return Object.freeze({status:"local_install_checked_not_r5_go",
    source_sha:expectedSourceSha});
}
