import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,chmod,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {assessOriginalScopedModelRoleProcess,
 readOriginalScopedModelSecret,assertOriginalScopedModelSocket}
 from "../src/disposable-gemini-original-scoped-model-channel.mjs";
import {startDisposableOwnerModelIpcServer,
 connectDisposableWorkerModelIpcClient}
 from "../src/disposable-gemini-owner-worker-ipc.mjs";
const DENY=/Disposable original scoped model IPC NO-GO/u;
const scope={role:"backend",ownerUid:1101,workerUid:1102,roleGid:2201};
test("strict model role contract distinguishes trusted owner from a single unprivileged worker group",()=>{
 if(process.platform!=="linux")return;
 assert.equal(assessOriginalScopedModelRoleProcess({
  role:"backend",scope,side:"owner",
  actualUid:1101,actualPrimaryGid:1101,actualGroups:[1101,2201]
 }).matches,true);
 assert.equal(assessOriginalScopedModelRoleProcess({
  role:"backend",scope,side:"worker",
  actualUid:1102,actualPrimaryGid:2201,actualGroups:[2201]
 }).matches,true);
 assert.equal(assessOriginalScopedModelRoleProcess({
  role:"backend",scope,side:"worker",
  actualUid:1102,actualPrimaryGid:2201,actualGroups:[2201]
 }).paidGeminiAdmission,false);
});
test("same UID, role spoof, supplemental privileged groups and untrusted caller claims are NO-GO",()=>{
 if(process.platform!=="linux")return;
 for(const invalid of [
  {role:"frontend"},
  {scope:{...scope,workerUid:1101}},
  {scope:{...scope,role:"test"}},
  {actualUid:1101},
  {actualGroups:[2201,1101]},
  {actualPrimaryGid:1101},
  {actualGroups:[2201,0]},
  {side:"orchestrator"}
 ]){
  const args={role:"backend",scope,side:"worker",
   actualUid:1102,actualPrimaryGid:2201,actualGroups:[2201],
   ...invalid};
  if(invalid.actualGroups?.includes(0)||
     invalid.role||invalid.scope||invalid.side)
   assert.throws(()=>assessOriginalScopedModelRoleProcess(args),DENY);
  else assert.equal(assessOriginalScopedModelRoleProcess(args).matches,
   false);
 }
});
test("original private 0700/0600 model channel is never silently reinterpreted as a 2750/0640 cross-UID channel",async t=>{
 if(process.platform!=="linux"){t.skip("Linux-only");return;}
 const dir=await mkdtemp(join(tmpdir(),"original-scoped-model-reject-"));
 const secretFile=join(dir,"model.hex"),socketPath=join(dir,"model.sock");
 await writeFile(secretFile,"a".repeat(64)+"\n",
  {mode:0o600,flag:"wx"});
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const pretend={role:"backend",
  ownerUid:Math.max(1,process.getuid()),
  workerUid:Math.max(1,process.getuid())+1,
  roleGid:Math.max(1,process.getgid())};
 await assert.rejects(readOriginalScopedModelSecret({
  role:"backend",scope:pretend,side:"owner",socketPath,secretFile
 }),DENY);
 await assert.rejects(assertOriginalScopedModelSocket({
  role:"backend",scope:pretend,side:"owner",socketPath,secretFile
 }),DENY);
 await assert.rejects(startDisposableOwnerModelIpcServer({
  role:"backend",socketPath,secretFile,originalScopedModelRole:pretend,
  authorizeSignedTask:()=>true,invokeModel:()=>({chunks:[]})
 }),DENY);
 await assert.rejects(connectDisposableWorkerModelIpcClient({
  role:"backend",socketPath,secretFile,originalScopedModelRole:pretend
 }),DENY);
});
test("scoped mode rejects a worker running as the same owner UID rather than handing out a provider capability",async t=>{
 if(process.platform!=="linux"||process.getuid()===0){
  t.skip("root/current platform does not support meaningful unprivileged test");
  return;
 }
 const dir=await mkdtemp(join(tmpdir(),"original-model-no-sameuid-"));
 const socketPath=join(dir,"model.sock");
 const secretFile=join(dir,"model.hex");
 await writeFile(secretFile,"c".repeat(64)+"\n",
  {mode:0o600,flag:"wx"});
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const s={role:"backend",ownerUid:process.getuid(),
  workerUid:process.getuid()+1,roleGid:process.getgid()};
 await assert.rejects(connectDisposableWorkerModelIpcClient({
  role:"backend",socketPath,secretFile,originalScopedModelRole:s
 }),DENY);
});
