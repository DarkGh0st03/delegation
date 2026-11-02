import {createHash} from "node:crypto";
import {mkdir,mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {join} from "node:path";
import type {RunnerRunRequest,RunnerPhaseResult} from "./types.ts";

/** Private operator evidence. Never returned to agents or public artifacts.
 * The configured directory must be retained by the operator across CI teardown.
 * Hashes establish bundle consistency, not independent provider attestation. */
export async function retainFailureEvidence(input:{directory:string;archivePath:string;
 log:string;request:RunnerRunRequest;phases:RunnerPhaseResult[];
 logReference?:string;
 privateVitestFailure?:ReturnType<typeof import("./private-vitest-failures.ts").extractPrivateVitestFailures>}):Promise<void>{
 if(!input.phases.some(p=>p.status==="fail"))throw Error("Failure evidence requires a failed phase");
 await mkdir(input.directory,{recursive:true,mode:0o700});
 const directory=await mkdtemp(join(input.directory,"failure-"));
 try{
  const archive=await readFile(input.archivePath);
  const log=Buffer.from(input.log,"utf8");
  const hash=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
  await writeFile(join(directory,"source.tar.gz"),archive,{mode:0o600,flag:"wx"});
  await writeFile(join(directory,"runner.log"),log,{mode:0o600,flag:"wx"});
  // Write manifest last: incomplete directories are never complete bundles.
  await writeFile(join(directory,"manifest.json"),JSON.stringify({
   schema:"runner-private-failure-v1",
   ...(input.logReference?{log_reference:input.logReference}:{}),
   repository:input.request.repository,
   branch:input.request.branch,tested_commit_sha:input.request.commit_sha,
   profile:input.request.profile,phases:input.phases.map(({phase,status})=>({phase,status})),
   archive_sha256:hash(archive),log_sha256:hash(log),
   ...(input.privateVitestFailure?{private_vitest_failure:{
    provenance:"runner_captured_test_controlled_report",
    causal_attribution:"not_established",...input.privateVitestFailure}}:{})
  },null,2)+"\n",{mode:0o600,flag:"wx"});
 }catch(error){await rm(directory,{recursive:true,force:true});throw error;}
}
