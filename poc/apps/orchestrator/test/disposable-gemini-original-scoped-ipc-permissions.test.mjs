import test from "node:test";
import assert from "node:assert/strict";
import {evaluateDisposableOriginalScopedIpcPermissions,
 inspectDisposableOriginalScopedIpcPermissions}
 from "../src/disposable-gemini-original-scoped-ipc-permissions.mjs";
const DENY=/Disposable original role-scoped IPC permissions NO-GO/u;
const meta=(path,kind,uid,gid,mode,nlink=1)=>({
 path,stat:{kind,uid,gid,mode,nlink}
});
const fixture=()=>{
 const ownerUid=1001,workerUid=1002,roleGid=2301,ownerPrimaryGid=1001;
 const channels={};
 for(const name of ["model","stage","bind"]){
  const dir="/var/run/delegation-"+name+"-backend";
  const bind=name==="bind",serverUid=bind?workerUid:ownerUid;
  channels[name]={
   directory:meta(dir,"directory",serverUid,roleGid,
    bind?0o2770:0o2750,2),
   socket:meta(dir+"/"+name+".sock","socket",serverUid,roleGid,0o660),
   secretFile:meta(dir+"/"+name+".hex","file",ownerUid,roleGid,0o640)
  };
 }
 return {
  role:"backend",ownerUid,workerUid,roleGid,ownerPrimaryGid,
  workerPrimaryGid:roleGid,ownerGroups:[1001,roleGid],
  workerGroups:[roleGid],channels,
  ownerPrivate:{
   directory:meta("/var/run/delegation-owner-private","directory",
    ownerUid,ownerPrimaryGid,0o700,2),
   keyFile:meta("/var/run/delegation-owner-private/gemini-key","file",
    ownerUid,ownerPrimaryGid,0o600)
  }
 };
};
const evalCase=override=>evaluateDisposableOriginalScopedIpcPermissions({
 ...fixture(),...override
});
test("dedicated role group can traverse only its own Unix channels while owner key remains private",()=>{
 const r=evalCase({});
 assert.equal(r.layoutPotentiallyUsable,true);
 assert.equal(Object.values(r.conditions).every(Boolean),true);
 assert.equal(r.osIsolationVerified,false);
 assert.equal(r.nativeRustRoleSignerVerified,false);
 assert.equal(r.ownerCredentialsProtectedFromWorkerVerified,false);
 assert.equal(r.paidGeminiAdmission,false);
});
test("original owner-only 0700 and 0600 channel modes fail cross-UID access design without relaxing them",()=>{
 const f=fixture();
 const c=structuredClone(f.channels);
 c.model.directory.stat.mode=0o700;
 c.stage.socket.stat.mode=0o600;
 c.bind.secretFile.stat.mode=0o600;
 const r=evalCase({channels:c});
 assert.equal(r.layoutPotentiallyUsable,false);
 assert.equal(r.conditions.modelDirectory,false);
 assert.equal(r.conditions.stageSocket,false);
 assert.equal(r.conditions.bindHmacSecret,false);
});
test("group/world-writable owner socket, secret and directory are rejected",()=>{
 for(const [channel,field,mode] of [
  ["model","secretFile",0o664],
  ["stage","socket",0o666],
  ["bind","directory",0o2777],
  ["stage","directory",0o2770],
  ["bind","secretFile",0o660]
 ]){
  const f=fixture(),channels=structuredClone(f.channels);
  channels[channel][field].stat.mode=mode;
  const r=evalCase({channels});
  assert.equal(r.layoutPotentiallyUsable,false,
   channel+" "+field+" "+mode.toString(8));
 }
});
test("another specialist, unexpected supplementary group or role GID reuse is a NO-GO",()=>{
 for(const extra of [
  {role:"planner"},
  {ownerUid:1002},
  {workerPrimaryGid:2302},
  {ownerGroups:[1001]},
  {workerGroups:[2301,2302]},
  {roleGid:1001},
  {workerUid:0},
  {ownerUid:0}
 ]){
  if(extra.role==="planner"||extra.workerUid===0||
     extra.ownerUid===0)
   assert.throws(()=>evalCase(extra),DENY);
  else assert.equal(evalCase(extra).layoutPotentiallyUsable,false);
 }
});
test("role bind server must be worker-owned, while all HMAC secrets remain owner-owned",()=>{
 const c=structuredClone(fixture().channels);
 c.bind.socket.stat.uid=1001;
 assert.equal(evalCase({channels:c}).layoutPotentiallyUsable,false);
 const d=structuredClone(fixture().channels);
 d.bind.secretFile.stat.uid=1002;
 assert.equal(evalCase({channels:d}).layoutPotentiallyUsable,false);
 const e=structuredClone(fixture().channels);
 e.model.secretFile.stat.nlink=2;
 assert.equal(evalCase({channels:e}).layoutPotentiallyUsable,false);
});
test("a role group cannot traverse the original Gemini/Engineer private directory",()=>{
 const f=fixture();
 const exposed=structuredClone(f.ownerPrivate);
 exposed.directory.stat.mode=0o750;
 assert.equal(evalCase({ownerPrivate:exposed}).layoutPotentiallyUsable,false);
 const ownerGroupKey=structuredClone(f.ownerPrivate);
 ownerGroupKey.keyFile.stat.mode=0o640;
 assert.equal(evalCase({ownerPrivate:ownerGroupKey})
  .layoutPotentiallyUsable,false);
 const channels=structuredClone(f.channels);
 channels.model.directory.path=f.ownerPrivate.directory.path;
 channels.model.socket.path=channels.model.directory.path+"/model.sock";
 channels.model.secretFile.path=channels.model.directory.path+"/model.hex";
 assert.equal(evalCase({channels}).layoutPotentiallyUsable,false);
});
test("symlinks and malformed socket paths cannot be used as role IPC metadata",()=>{
 const f=fixture(),invalid=structuredClone(f.channels);
 invalid.model.socket.stat.kind="symlink";
 assert.equal(evalCase({channels:invalid}).layoutPotentiallyUsable,false);
 const traversal=structuredClone(f.channels);
 traversal.stage.socket.path="/var/run/../secret.sock";
 assert.throws(()=>evalCase({channels:traversal}),DENY);
});
test("live audit cannot use its own PID or an unrelated unbound process as a signed worker",async t=>{
 if(process.platform!=="linux"){t.skip("Linux-only");return;}
 await assert.rejects(inspectDisposableOriginalScopedIpcPermissions({
  role:"backend",workerPid:process.pid,
  ownerPrivateDirectory:"/tmp",ownerPrivateKeyFile:"/tmp/no-key"
 }),DENY);
 await assert.rejects(inspectDisposableOriginalScopedIpcPermissions({
  role:"backend",workerPid:2147483647,
  ownerPrivateDirectory:"/tmp",ownerPrivateKeyFile:"/tmp/no-key"
 }),DENY);
});
