import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {createHash,randomBytes} from "node:crypto";
import {IsolatedDockerRunnerExecutor} from "../src/isolated-executor.ts";
import {sealDirectory,unseal} from "../../../scripts/seal-runner-evidence.mjs";
const exec=promisify(execFile);

test("real Docker FAIL survives cleanup as decryptable exact-source evidence",{
 skip:process.env.RUNNER_EVIDENCE_REAL_DOCKER!=="1",timeout:120000
},async()=>{
 const root=await mkdtemp(join(tmpdir(),"evidence-docker-"));
 try{
  const source=join(root,"fixture"),archivePath=join(root,"fixture.tar.gz");
  await mkdir(source);
  // npm ci must fail: no lockfile. No dependency downloads or model calls.
  await writeFile(join(source,"package.json"),JSON.stringify({name:"failure-evidence-fixture",version:"1.0.0",private:true}));
  await exec("tar",["-czf",archivePath,"-C",root,"fixture"]);
  const archive=await readFile(archivePath);
  const sha="a".repeat(40),directory=join(root,"private");
  const request={request_id:"evidence-docker",repository:"gitea://fixture/o/r",branch:"feature/evidence",commit_sha:sha,profile:"poc-default" as const};
  const executor=new IsolatedDockerRunnerExecutor({
   gitea_base_url:"http://fixture.invalid",gitea_owner:"o",gitea_repository:"r",gitea_token:"fixture-only",
   docker_image:"node:22.15.0-bookworm",phase_timeout_ms:30000,total_timeout_ms:90000,
   log_dir:join(root,"logs"),failure_evidence_dir:directory,acceptance_enabled:false
  },{fetch_fn:async(url)=>{
   const address=String(url);
   if(address.endsWith(`/archive/${sha}.tar.gz`))return new Response(archive);
   if(address.includes("/branches/"))return new Response(JSON.stringify({commit:{id:sha}}));
   throw Error("Unexpected fixture request");
  }});
  const result=await executor.run(request);
  assert.equal(result.status,"fail");
  assert.equal(result.phases.find(p=>p.status==="fail")?.phase,"dependency_install");
  assert.ok(result.phases.slice(1).every(p=>p.status==="skipped"));
  assert.equal((await readdir(directory)).length,1);
  const key=randomBytes(32).toString("hex"),output=join(root,"evidence.enc");
  assert.equal(await sealDirectory(directory,output,key),true);
  // Simulate loss of disposable plaintext before recovering the artifact.
  await rm(directory,{recursive:true});await rm(source,{recursive:true});
  const envelope=await readFile(output);
  const recovered=JSON.parse(unseal(envelope,key));
  const files=recovered.bundles[0].files;
  const manifest=JSON.parse(Buffer.from(files["manifest.json"],"base64").toString());
  assert.equal(manifest.tested_commit_sha,sha);
  assert.deepEqual(Buffer.from(files["source.tar.gz"],"base64"),archive);
  const log=Buffer.from(files["runner.log"],"base64");
  assert.equal(createHash("sha256").update(log).digest("hex"),manifest.log_sha256);
  assert.match(log.toString(),/npm (?:error|ERR!)/i);
  assert.doesNotMatch(JSON.stringify(result),/fixture-only|archive_sha256/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test("pinned real Vitest reporter produces recoverable private assertion diagnostics",{
 skip:process.env.RUNNER_EVIDENCE_REAL_DOCKER!=="1",timeout:180000
},async()=>{
 const {extractPrivateVitestFailures}=await import("../src/private-vitest-failures.ts");
 const {retainFailureEvidence}=await import("../src/failure-evidence.ts");
 const {runnerFixedPhaseCommands}=await import("../src/isolated-executor.ts");
 const root=await mkdtemp(join(tmpdir(),"vitest-real-"));
 const container="vitest-evidence-"+randomBytes(8).toString("hex");
 try{
  await mkdir(join(root,"tests","frontend"),{recursive:true});
  await writeFile(join(root,"package.json"),JSON.stringify({name:"synthetic-vitest-evidence",version:"1.0.0",private:true,type:"module"}));
  await writeFile(join(root,"tests","frontend","actions.test.ts"),
   'import {test,expect} from "vitest"; test("synthetic duplicate transition mismatch",()=>expect(200).toBe(409));\n');
  const archivePath=join(root,"source.tar.gz");
  await exec("tar",["-czf",archivePath,"-C",root,"package.json","tests"]);
  await exec("docker",["create","--name",container,"--workdir","/workspace","node:22.15.0-bookworm","sleep","infinity"]);
  await exec("docker",["start",container]);
  await exec("docker",["cp",join(root,"package.json"),container+":/workspace/package.json"]);
  await exec("docker",["cp",join(root,"tests"),container+":/workspace/tests"]);
  // Exact version from immutable IAM baseline 405748b1 package-lock.json.
  await exec("docker",["exec",container,"npm","install","--ignore-scripts","--no-audit","--no-fund","--save-exact","vitest@3.2.7"],{timeout:120000,maxBuffer:1024*1024});
  const reportPath="/tmp/private-frontend_tests-vitest.json";
  const command=runnerFixedPhaseCommands.find(p=>p.phase==="frontend_tests")!.command+
   " --reporter=default --reporter=json --outputFile="+reportPath;
  let output="",exitCode=0;
  try{const r=await exec("docker",["exec",container,"bash","-lc",command],{timeout:30000});output=r.stdout+r.stderr;}
  catch(error:any){exitCode=error.code;output=String(error.stdout??"")+String(error.stderr??"");}
  assert.equal(exitCode,1,"Expected assertion failure, not an install/CLI error");
  const report=await exec("docker",["exec",container,"cat",reportPath]);
  const diagnostic=extractPrivateVitestFailures(report.stdout,"frontend_tests");
  assert.equal(diagnostic.status,"captured");assert.equal(diagnostic.failures.length,1);
  assert.equal(diagnostic.failures[0].path,"tests/frontend/actions.test.ts");
  assert.match(diagnostic.failures[0].test_id,/synthetic duplicate transition mismatch/);
  assert.match(diagnostic.failures[0].failure_messages[0],/409/);
  const directory=join(root,"evidence");
  await retainFailureEvidence({directory,archivePath,log:output,
   request:{request_id:"synthetic-vitest",repository:"gitea://fixture/o/r",branch:"feature/test",commit_sha:"a".repeat(40),profile:"poc-default"},
   phases:[{phase:"frontend_tests",status:"fail"}],privateVitestFailure:diagnostic});
  const key=randomBytes(32).toString("hex"),sealed=join(root,"assertion.enc");
  assert.equal(await sealDirectory(directory,sealed,key),true);
  await rm(directory,{recursive:true});
  const recovered=JSON.parse(unseal(await readFile(sealed),key));
  const manifest=JSON.parse(Buffer.from(recovered.bundles[0].files["manifest.json"],"base64").toString());
  assert.deepEqual(manifest.private_vitest_failure.failures,diagnostic.failures);
 }finally{
  await exec("docker",["rm","-f",container]).catch(()=>{});
  await rm(root,{recursive:true,force:true});
 }
});
