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
