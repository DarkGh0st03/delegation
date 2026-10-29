/**
 * R82 trusted, source-free comparison of compiler error locations across the
 * pinned baseline and exact Docker-tested feature SHA. This is an OBSERVATION,
 * not causal attribution: an unchanged location can fail because OTHER files
 * changed, and a changed location does not prove that its edit caused the error.
 *
 * Only the owner-private test host may supply Gitea reads and verified Gateway
 * write receipts. This does not authorize agent reads, writes, repairs or re-issue.
 */
const SHA=/^[a-f0-9]{40}$/u;
const PATH=/^[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*\.tsx?$/u;
const SCHEMA="typecheck-revision-comparison-v1";
const FIELDS=["diagnostic_files","same_blob_as_base","different_blob_from_base",
  "verified_new_files","unverifiable_files","backend_writes_observed",
  "frontend_writes_observed","test_writes_observed","without_observed_writes"];
function pathOK(s){
  return typeof s==="string"&&s.length<=180&&PATH.test(s)&&
    s.split("/").every(x=>x!=="."&&x!=="..");
}
function count(n){return Number.isSafeInteger(n)&&n>=0&&n<=8;}
/** Strict public boundary: only fixed names, integer aggregates, zero paths. */
export function safeTypecheckRevisionComparison(raw){
  if(!raw||typeof raw!=="object"||Array.isArray(raw)||
     Object.keys(raw).sort().join(",")!==
       [...FIELDS,"schema","status"].sort().join(",")||
     raw.schema!==SCHEMA||raw.status!=="observed")return null;
  const out={schema:SCHEMA,status:"observed"};
  for(const field of FIELDS){
    if(!count(raw[field]))return null;
    out[field]=raw[field];
  }
  const n=out.diagnostic_files;
  if(n===0||out.same_blob_as_base+out.different_blob_from_base+
       out.verified_new_files+out.unverifiable_files!==n||
     out.backend_writes_observed>n||out.frontend_writes_observed>n||
     out.test_writes_observed>n||out.without_observed_writes>n)
    return null;
  return Object.freeze(out);
}
/** Fail closed on invalid metadata; failed read operations count as unknown. */
export async function compareTrustedTypecheckRevisions({
  diagnostics,planningFiles,createdPaths,observedWrites,reader,
  branch,baseSha,testedSha
}={}){
  if(!Array.isArray(diagnostics)||!diagnostics.length||diagnostics.length>8||
     diagnostics.some(d=>!d||typeof d!=="object"||
       Object.keys(d).sort().join(",")!=="code,column,line,path"||
       !pathOK(d.path)||!/^TS[0-9]{4,5}$/u.test(d.code)||
       !Number.isSafeInteger(d.line)||d.line<1||d.line>100000||
       !Number.isSafeInteger(d.column)||d.column<1||d.column>10000)||
     !Array.isArray(planningFiles)||planningFiles.length>128||
     planningFiles.some(p=>!pathOK(p))||
     !Array.isArray(createdPaths)||createdPaths.length>32||
     createdPaths.some(p=>!pathOK(p))||
     !observedWrites||typeof observedWrites!=="object"||
     !["backend","frontend","test"].every(role=>
       observedWrites[role] instanceof Set&&
       observedWrites[role].size<=128&&
       [...observedWrites[role]].every(p=>pathOK(p)))||
     typeof branch!=="string"||!branch.startsWith("feature/")||
     branch.length>128||!SHA.test(baseSha)||!SHA.test(testedSha)||
     !reader||typeof reader.readTextFile!=="function"||
     typeof reader.getBranchMetadata!=="function")return null;
  // The caller already has a verified Runner receipt for testedSha.
  // Recheck current Gitea branch for a race before AND after private reads.
  try {
    if((await reader.getBranchMetadata(branch)).commit_sha!==testedSha)
      return null;
  } catch {return null;}
  const existing=new Set(planningFiles),created=new Set(createdPaths);
  const counts=Object.fromEntries(FIELDS.map(k=>[k,0]));
  const paths=new Set(diagnostics.map(d=>d.path));
  counts.diagnostic_files=paths.size;
  for(const path of paths){
    const roles=["backend","frontend","test"]
      .filter(role=>observedWrites[role].has(path));
    if(roles.length===0)counts.without_observed_writes++;
    for(const role of roles)counts[role+"_writes_observed"]++;
    if(!existing.has(path)&&!(created.has(path)&&
       observedWrites.test.has(path))){
      // Compiler path is not a trusted discovery or recorded creation.
      // Do NOT use the privileged Gitea reader to explore that path.
      counts.unverifiable_files++;
      continue;
    }
    try {
      const feature=await reader.readTextFile(branch,path,testedSha);
      if(feature.path!==path||feature.revision!==testedSha||
         !SHA.test(feature.blob_sha)){
        counts.unverifiable_files++;continue;
      }
      if(!existing.has(path)){
        counts.verified_new_files++;
        continue;
      }
      const before=await reader.readTextFile("main",path,baseSha);
      if(before.path!==path||before.revision!==baseSha||
         !SHA.test(before.blob_sha)){
        counts.unverifiable_files++;continue;
      }
      if(before.blob_sha===feature.blob_sha)
        counts.same_blob_as_base++;
      else counts.different_blob_from_base++;
    } catch {
      // Missing files, provider errors and undecodable text are UNKNOWN,
      // not proof of a new file or an agent's mistake.
      counts.unverifiable_files++;
    }
  }
  try {
    if((await reader.getBranchMetadata(branch)).commit_sha!==testedSha)
      return null;
  } catch {return null;}
  return safeTypecheckRevisionComparison({
    schema:SCHEMA,status:"observed",...counts
  });
}
