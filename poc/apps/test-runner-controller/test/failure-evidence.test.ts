import {IAM_CONSOLE_PROJECT_PROFILE,projectProfileDigest} from "../../../packages/plan-contracts/src/project-profile.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,readdir,readFile,stat,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {retainFailureEvidence} from "../src/failure-evidence.ts";
test("private failure bundle preserves exact archive and log with revision and hashes",async()=>{
 const root=await mkdtemp(join(tmpdir(),"failure-test-"));
 try{
  const archivePath=join(root,"input.tar.gz"),directory=join(root,"evidence");
  await writeFile(archivePath,"exact archive");
  const input={directory,archivePath,log:"FAIL expected 409 actual 200",request:{
   request_id:"r",repository:"gitea://local/o/r",branch:"feature/test",commit_sha:"a".repeat(40),profile:"poc-default" as const,project_profile:IAM_CONSOLE_PROJECT_PROFILE,project_profile_sha256:projectProfileDigest(IAM_CONSOLE_PROJECT_PROFILE)},
   phases:[{phase:"frontend_tests" as const,status:"fail" as const}]};
  await retainFailureEvidence(input);
  const bundle=join(directory,(await readdir(directory))[0]);
  const manifest=JSON.parse(await readFile(join(bundle,"manifest.json"),"utf8"));
  assert.equal(manifest.tested_commit_sha,input.request.commit_sha);
  for(const [file,key] of [["source.tar.gz","archive_sha256"],["runner.log","log_sha256"]]){
   const bytes=await readFile(join(bundle,file));
   assert.equal(createHash("sha256").update(bytes).digest("hex"),manifest[key]);
   if(process.platform!=="win32")assert.equal((await stat(join(bundle,file))).mode&0o777,0o600);
  }
  assert.equal(await readFile(join(bundle,"runner.log"),"utf8"),input.log);
  await assert.rejects(retainFailureEvidence({...input,phases:[]}),/failed phase/);
  await assert.rejects(retainFailureEvidence({...input,archivePath:join(root,"missing")}));
  assert.equal((await readdir(directory)).length,1);
 }finally{await rm(root,{recursive:true,force:true});}
});

test("Runner retains only failures when opted in and keeps bundle out of its response",async()=>{
 const {IsolatedDockerRunnerExecutor}=await import("../src/isolated-executor.ts");
 const root=await mkdtemp(join(tmpdir(),"runner-retain-"));
 try{
  const request={request_id:"retention",repository:"gitea://local/o/r",branch:"feature/test",commit_sha:"a".repeat(40),profile:"poc-default" as const,project_profile:IAM_CONSOLE_PROJECT_PROFILE,project_profile_sha256:projectProfileDigest(IAM_CONSOLE_PROJECT_PROFILE)};
  let failed=false;
  const executor=new IsolatedDockerRunnerExecutor({gitea_base_url:"http://localhost",gitea_token:"secret",phase_timeout_ms:1000,log_dir:join(root,"logs"),failure_evidence_dir:join(root,"private")},{
   fetch_fn:async(url)=>String(url).includes("/archive/")?new Response("archive"):new Response(JSON.stringify({commit:{id:request.commit_sha}})),
   command_runner:async(_command,args)=>({exit_code:failed&&args.includes("bash")?1:0,stdout:"test output",stderr:"",timed_out:false})
  });
  await executor.run(request);
  await assert.rejects(readdir(join(root,"private")));
  failed=true;
  const result=await executor.run(request);
  assert.equal(result.status,"fail");
  assert.equal((await readdir(join(root,"private"))).length,1);
  assert.doesNotMatch(JSON.stringify(result),/failure-|archive_sha256|test output|secret/);
 }finally{await rm(root,{recursive:true,force:true});}
});
