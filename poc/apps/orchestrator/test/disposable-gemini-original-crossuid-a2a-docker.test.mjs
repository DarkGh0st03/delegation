import test from "node:test";
import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {resolve} from "node:path";
const exec=promisify(execFile);
test("offline real Backend, Frontend and Test A2A under distinct role-scoped Linux credentials (no AI)",async t=>{
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
 let stdout,stderr;
 try{
  ({stdout,stderr}=await exec("docker",args,{
   timeout:110_000,maxBuffer:1024*1024,
   env:{PATH:process.env.PATH??"/usr/bin:/bin",
    HOME:process.env.HOME??"/tmp"}
  }));
 }catch(error){
  // No provider key or private credential is mounted in this Docker test.
  // Still print ONLY TAP failure metadata, never stdout wholesale.
  const lines=String(error?.stdout??"").split("\n");
  // The inner TAP stack is essential for distinguishing a launcher
  // ReferenceError from a role HMAC or Rust security denial. Include
  // bounded, credential-free file:line frames, never raw stdout or stderr.
  const diagnostic=lines.filter(line=>
   /(?:not ok [0-9]|failureType:|error:|code:|original three-role|native NO-GO|owner exited|The input did not match|The error is expected|Expected values|^\s+at (?:TestContext|file:|async |startDisposable|Object\.)|^\s+stack:|^\s+(?:expected:|actual:))/u.test(line)
  ).map(line=>line.slice(0,260)).slice(0,20);
  throw Error("Offline original cross-UID Docker test failed: "+
   (diagnostic.join(" | ")||String(error?.code??"unknown")));
 }
 assert.match(stdout,/pass 5/u,stderr.slice(-1200));
 assert.match(stdout,/fail 0/u,stderr.slice(-1200));
});
