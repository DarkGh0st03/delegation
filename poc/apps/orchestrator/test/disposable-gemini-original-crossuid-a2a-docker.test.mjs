import test from "node:test";
import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {resolve} from "node:path";
const exec=promisify(execFile);
test("offline real Backend A2A under cross-UID model/stage/bind HMAC channels (no AI)",async t=>{
 if(process.env.DELEGATION_ORIGINAL_CROSSUID_A2A_DOCKER!=="1"){
  t.skip("Explicit free Docker safety test only");return;
 }
 if(process.platform!=="linux")throw Error("Linux required");
 const repo=resolve(process.cwd(),"poc");
 const args=["run","--rm","--network=none","--read-only",
  "--pids-limit=96",
  "--tmpfs","/tmp:rw,nosuid,nodev,mode=1777,size=32m",
  "--mount","type=bind,source="+repo+",target=/work/poc,readonly",
  "--workdir","/work","node:22.15.0-bookworm",
  "node","--experimental-strip-types","--test",
  "/work/poc/apps/orchestrator/test/disposable-gemini-original-crossuid-a2a-docker-fixture.mjs"
 ];
 const {stdout,stderr}=await exec("docker",args,{
  timeout:110_000,maxBuffer:1024*1024,
  env:{PATH:process.env.PATH??"/usr/bin:/bin",
   HOME:process.env.HOME??"/tmp"}
 });
 assert.match(stdout,/pass 1/u,stderr.slice(-1200));
 assert.match(stdout,/fail 0/u,stderr.slice(-1200));
});
