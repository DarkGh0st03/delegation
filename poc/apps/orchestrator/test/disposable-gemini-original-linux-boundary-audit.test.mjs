import test from "node:test";
import assert from "node:assert/strict";
import {readFile,readlink} from "node:fs/promises";
import {evaluateDisposableOriginalLinuxBoundary,
 inspectDisposableOriginalLinuxBoundary}
 from "../src/disposable-gemini-original-linux-boundary-audit.mjs";
const DENY=/Disposable original Linux worker boundary NO-GO/u;
const status=({pid,ppid,uid,gid,cap="0000000000000000",nnp=1})=>
 [`Name:\tsynthetic`,`Pid:\t${pid}`,`PPid:\t${ppid}`,
 `Uid:\t${uid}\t${uid}\t${uid}\t${uid}`,
 `Gid:\t${gid}\t${gid}\t${gid}\t${gid}`,
 `CapEff:\t${cap}`,`NoNewPrivs:\t${nnp}`].join("\n")+"\n";
const fixture=()=>({
 ownerPid:111,workerPid:222,
 ownerStatus:status({pid:111,ppid:1,uid:1001,gid:1001}),
 workerStatus:status({pid:222,ppid:111,uid:1002,gid:1002}),
 ownerMountNs:"mnt:[4026531840]",workerMountNs:"mnt:[4026532048]",
 ownerCanaryReadable:false
});
test("only independent Linux UID, secure mount and privilege preconditions pass, but never attest a native signer",()=>{
 const value=evaluateDisposableOriginalLinuxBoundary(fixture());
 assert.equal(value.requiredKernelConditionsPassed,true);
 assert.equal(value.status,
  "kernel_preconditions_passed_not_isolation_attestation");
 assert.equal(value.osIsolationVerified,false);
 assert.equal(value.nativeRustSignerVerified,false);
 assert.equal(value.signedTaskBindingVerified,false);
 assert.equal(value.conditions.differentUid,true);
 assert.equal(value.conditions.distinctMountNamespace,true);
});
test("a worker in the original owner UID/mount with readable 0600 owner file fails kernel security gate",()=>{
 const f=fixture();
 const outcome=evaluateDisposableOriginalLinuxBoundary({
  ...f,workerStatus:status({pid:222,ppid:111,uid:1001,gid:1001,nnp:0}),
  workerMountNs:f.ownerMountNs,ownerCanaryReadable:true
 });
 assert.equal(outcome.requiredKernelConditionsPassed,false);
 assert.equal(outcome.conditions.differentUid,false);
 assert.equal(outcome.conditions.workerNoNewPrivs,false);
 assert.equal(outcome.conditions.distinctMountNamespace,false);
 assert.equal(outcome.conditions.canaryDeniedToWorker,false);
});
test("root worker, effective capabilities, UID change, wrong parent and inherited privilege all fail closed",()=>{
 const f=fixture();
 const variants=[
  {workerStatus:status({pid:222,ppid:111,uid:0,gid:0})},
  {workerStatus:status({pid:222,ppid:111,uid:1002,gid:1002,
   cap:"0000000000200000"})},
  {workerStatus:status({pid:222,ppid:555,uid:1002,gid:1002})},
  {workerStatus:status({pid:222,ppid:111,uid:1002,gid:1002,nnp:0})},
  {ownerStatus:status({pid:111,ppid:1,uid:0,gid:0})}
 ];
 for(const variant of variants)
  assert.equal(evaluateDisposableOriginalLinuxBoundary({...f,...variant})
   .requiredKernelConditionsPassed,false);
});
test("malformed proc identity, fake namespace, PID or truncated UID fail closed",()=>{
 const f=fixture();
 for(const variant of [
  {workerStatus:f.workerStatus.replace("CapEff:","Broken:")},
  {workerStatus:f.workerStatus.replace("1002\t1002\t1002\t1002","1002")},
  {workerMountNs:"user:[4026532048]"},
  {workerPid:-1},{ownerCanaryReadable:"false"}
 ])assert.throws(()=>evaluateDisposableOriginalLinuxBoundary({...f,...variant}),DENY);
});
test("live proc inspector refuses self as child and missing process rather than fabricating a positive result",async t=>{
 if(process.platform!=="linux"||typeof process.getuid!=="function"){
  t.skip("Linux-only kernel status");
  return;
 }
 await assert.rejects(inspectDisposableOriginalLinuxBoundary({
  workerPid:process.pid,ownerCanaryReadable:false
 }),DENY);
 await assert.rejects(inspectDisposableOriginalLinuxBoundary({
  workerPid:2147483647,ownerCanaryReadable:false
 }),DENY);
});
