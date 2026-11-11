import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {assessTrustedOriginalScopedEffectIdentity,
 loadTrustedOriginalScopedEffectSecret}
 from "../src/trusted-effect-staging-scoped-linux.ts";
import {createTrustedOwnerEffectStagingServer,
 TrustedOwnerEffectStagingRegistry,
 connectTrustedOwnerEffectStagingClient,
 createTrustedEffectAgentBindingServer,
 connectTrustedEffectAgentBindingClient}
 from "../src/trusted-effect-staging-unix-ipc.ts";
import {TrustedEffectStagingTaskRegistry}
 from "../src/trusted-effect-staging-task-registry.ts";
const DENY=/Trusted original scoped effect IPC NO-GO/u;
const scope={role:"backend" as const,ownerUid:1101,
 workerUid:1102,roleGid:2301};
test("stage owner and bind owner require owner UID and pinned role group; worker has only its role GID",()=>{
 if(process.platform!=="linux")return;
 for(const channel of ["stage","bind"] as const){
  assert.equal(assessTrustedOriginalScopedEffectIdentity({
   channel,side:"owner",scope,actualUid:1101,
   actualPrimaryGid:1101,actualGroups:[1101,2301]
  }).matches,true);
  assert.equal(assessTrustedOriginalScopedEffectIdentity({
   channel,side:"worker",scope,actualUid:1102,
   actualPrimaryGid:2301,actualGroups:[2301]
  }).matches,true);
 }
});
test("wrong UID, unexpected supplemental group and role expansion are rejected before HMAC operations",()=>{
 if(process.platform!=="linux")return;
 for(const channel of ["stage","bind"] as const){
  for(const actualGroups of [[1101,2301],[2301,2302]]){
   assert.equal(assessTrustedOriginalScopedEffectIdentity({
    channel,side:"worker",scope,actualUid:1102,
    actualPrimaryGid:2301,actualGroups
   }).matches,false);
  }
  assert.throws(()=>assessTrustedOriginalScopedEffectIdentity({
   channel,side:"worker",scope:{...scope,role:"orchestrator"} as never,
   actualUid:1102,actualPrimaryGid:2301,actualGroups:[2301]
  }),DENY);
  assert.throws(()=>assessTrustedOriginalScopedEffectIdentity({
   channel,side:"owner",scope:{...scope,ownerUid:1102},
   actualUid:1102,actualPrimaryGid:2301,actualGroups:[2301]
  }),DENY);
 }
});
test("cross-UID effect IPC cannot silently loosen the current private owner-only directory and file modes",async t=>{
 if(process.platform!=="linux"){t.skip("Linux only");return;}
 const dir=await mkdtemp(join(tmpdir(),"original-effect-scoped-deny-"));
 const secretFile=join(dir,"bind.hex"),socketPath=join(dir,"bind.sock");
 await writeFile(secretFile,"a".repeat(64)+"\n",
  {mode:0o600,flag:"wx"});
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const own=Math.max(1,process.getuid());
 const fake={role:"backend" as const,ownerUid:own,
  workerUid:own+1,roleGid:Math.max(1,process.getgid())};
 await assert.rejects(loadTrustedOriginalScopedEffectSecret({
  channel:"bind",side:"worker",scope:fake,socketPath,secretFile
 }),DENY);
 const client=await assert.rejects(
  connectTrustedEffectAgentBindingClient({
   socketPath,secretFile,expectedRole:"backend",
   originalScopedEffectRole:fake
  }),DENY);
 const reg=new TrustedOwnerEffectStagingRegistry();
 await assert.rejects(createTrustedOwnerEffectStagingServer({
  socketPath,secretFile,registry:reg,expectedRole:"backend",
  originalScopedEffectRole:fake
 }),DENY);
 const stage=await assert.rejects(
  connectTrustedOwnerEffectStagingClient({
   socketPath,secretFile,expectedRole:"backend",
   originalScopedEffectRole:fake
  }),DENY);
 const effectRegistry=new TrustedEffectStagingTaskRegistry();
 await assert.rejects(createTrustedEffectAgentBindingServer({
  socketPath,secretFile,registry:effectRegistry,
  ownerStageClient:{async stage(){}},
  expectedRole:"backend",originalScopedEffectRole:fake
 }),DENY);
});
test("scoped role cannot be passed without an explicitly matching original staging/bind role",async()=>{
 const reg=new TrustedOwnerEffectStagingRegistry();
 await assert.rejects(createTrustedOwnerEffectStagingServer({
  socketPath:"/tmp/absent.sock",secretFile:"/tmp/absent.hex",
  registry:reg,expectedRole:"frontend",
  originalScopedEffectRole:scope
 }),/Trusted authority-only effect IPC NO-GO/u);
 await assert.rejects(connectTrustedOwnerEffectStagingClient({
  socketPath:"/tmp/absent.sock",secretFile:"/tmp/absent.hex",
  expectedRole:"test",originalScopedEffectRole:scope
 }),/Trusted authority-only effect IPC NO-GO/u);
 await assert.rejects(connectTrustedEffectAgentBindingClient({
  socketPath:"/tmp/absent.sock",secretFile:"/tmp/absent.hex",
  expectedRole:"frontend",originalScopedEffectRole:scope
 }),/Trusted authority-only effect IPC NO-GO/u);
});
