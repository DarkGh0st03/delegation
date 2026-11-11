/**
 * A separate FREE, network-disabled Docker proof for original three-role
 * Rust socket TRANSPORT. Its upstream listener is an explicit FAKE, not
 * Rust: no signature, Root, Gateway VP or paid Gemini claim is made.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtemp,mkdir,chmod,chown,rm} from "node:fs/promises";
import {join} from "node:path";

const RUST_WIRE="file:///work/poc/mcp-shared/src/native-rust-transport.mjs";
const OWNER=String.raw`
import {createServer} from "node:net";
import {chmod} from "node:fs/promises";
import {startDisposableOriginalNativeRustPresentationRelays}
 from "file:///work/poc/apps/orchestrator/src/disposable-gemini-original-native-rust-presentation-relays.mjs";
const data=JSON.parse(process.argv[1]);
const allowed=new Map(),roles=["backend","frontend","test"];
let fakeRustCalls=0;
const original=createServer({allowHalfOpen:true},socket=>{
 void(async()=>{
  const chunks=[];
  for await(const chunk of socket)chunks.push(chunk);
  const req=JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if(req.operation!=="create_presentation"||
     !roles.some(role=>data.roleTokens[role]===req.token))
   throw Error("no native signature in synthetic upstream");
  fakeRustCalls++;
  socket.end(JSON.stringify({ok:true,result:{
   signed_vp:"SYNTHETIC_ONLY_NOT_A_RUST_SIGNATURE"
  }}));
 })().catch(()=>socket.end(JSON.stringify({ok:false,error:"offline_stub"})));
});
await new Promise((resolve,reject)=>{
 original.once("error",reject);
 original.listen(data.originalNativeSocketPath,resolve);
});
await chmod(data.originalNativeSocketPath,0o600);
const relays=await startDisposableOriginalNativeRustPresentationRelays({
 ...data,offlineSyntheticOnly:true,
 authorizeNativePresentation:({role,credentialId})=>{
  if(allowed.get(role)!==credentialId)throw Error("offline original Task not active");
  return true;
 }
});
process.once("SIGTERM",()=>void(async()=>{
 await relays.close();
 await new Promise(resolve=>original.close(resolve));
 process.exit(0);
})().catch(()=>process.exit(1)));
process.on("message",message=>{
 if(message?.type==="grant"&&roles.includes(message.role)){
  allowed.set(message.role,message.credentialId);
  process.send?.({type:"grant_ack",role:message.role});
 }
 if(message?.type==="revoke"&&roles.includes(message.role)){
  allowed.delete(message.role);
  process.send?.({type:"revoke_ack",role:message.role});
 }
 if(message?.type==="snapshot"){
  process.send?.({type:"snapshot_result",
   report:{...relays.snapshot(),fakeRustCalls}});
 }
});
process.stdout.write("READY\n");
`;

const PROBE=String.raw`
const {invokeNativeCryptoWire}=await import(process.argv[1]);
const socketPath=process.argv[2],token=process.argv[3];
const operation=process.argv[4],credentialId=process.argv[5];
const body={credential_id:credentialId,
 disclosed_permissions:[{resource:"gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/apps/backend/account.ts",operation:"read_file"}],
 audience:"cloud-access-gateway",challenge:"offline-gateway-challenge"};
try{
 const result=await invokeNativeCryptoWire({
  socketPath,token,timeoutMs:6000
 },operation,body);
 if(result?.signed_vp!=="SYNTHETIC_ONLY_NOT_A_RUST_SIGNATURE")
  throw Error("no synthetic receipt");
 process.stdout.write("ALLOWED");
}catch{process.stdout.write("DENIED");}
`;

function spawnAs(uid,gid,groups,args,ipc=false){
 return spawn("/usr/bin/setpriv",[
  "--reuid",String(uid),"--regid",String(gid),
  ...(groups.length?["--groups",groups.join(",")]:["--clear-groups"]),
  "--no-new-privs","--bounding-set=-all",
  process.execPath,...args
 ],{
  stdio:ipc?["ignore","pipe","pipe","ipc"]:["ignore","pipe","pipe"],
  env:{PATH:"/usr/bin:/bin",LANG:"C.UTF-8",TZ:"UTC",HOME:"/nonexistent"}
 });
}
const ready=child=>new Promise((resolve,reject)=>{
 let stdout="",stderr="",done=false;
 const timer=setTimeout(()=>finish(Error("offline rust role Owner timeout")),12000);
 const finish=(error)=>{
  if(done)return;done=true;clearTimeout(timer);
  if(error)reject(error);else resolve();
 };
 child.stdout.on("data",b=>{
  stdout+=b;
  if(stdout.includes("READY\n"))finish();
 });
 child.stderr.on("data",b=>stderr+=b);
 child.once("exit",code=>finish(Error("offline rust owner exited "+
  code+" "+stderr.slice(0,250))));
 child.once("error",finish);
});
async function exchange(child,request,type){
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>finish(Error("offline role relay IPC timeout")),6000);
  const finish=(error,payload)=>{
   clearTimeout(timer);child.off("message",onMessage);
   if(error)reject(error);else resolve(payload);
  };
  const onMessage=value=>{if(value?.type===type&&
    (request.role===undefined||value.role===request.role))
   finish(null,value);
  };
  child.on("message",onMessage);
  child.send(request,error=>{if(error)finish(error);});
 });
}
async function probe(uid,gid,path,token,op,childId){
 const p=spawnAs(uid,gid,[],[
  "--input-type=module","-e",PROBE,
  RUST_WIRE,path,token,op,childId
 ]);
 return new Promise((resolve,reject)=>{
  let stdout="",stderr="";
  p.stdout.on("data",x=>stdout+=x);
  p.stderr.on("data",x=>stderr+=x);
  p.once("error",reject);
  p.once("close",code=>{
   if(code!==0)reject(Error("native role probe exit "+code+
    " "+stderr.slice(0,200)));
   else resolve(stdout);
  });
 });
}
async function closeOwner(owner){
 if(owner.exitCode!==null||owner.signalCode!==null)return;
 owner.kill("SIGTERM");
 await new Promise(resolve=>{
  const timer=setTimeout(()=>{
   owner.kill("SIGKILL");resolve();
  },6000);
  owner.once("exit",()=>{clearTimeout(timer);resolve();});
 });
}

test("one fake Rust wire, three original UID/GID relays: deny before Task, foreign groups, Child replay and root ops",async t=>{
 if(process.platform!=="linux"||process.getuid()!==0){
  t.skip("explicit no-network Docker privileged Linux fixture only");return;
 }
 const root=await mkdtemp("/tmp/delegation-rust-role-relays-");
 let owner;
 try{
  await chmod(root,0o755);
  const ownerDir=join(root,"owner");
  await mkdir(ownerDir,{mode:0o700});
  await chown(ownerDir,1001,1101);
  await chmod(ownerDir,0o700);
  const originalNativeSocketPath=join(ownerDir,"engineer-rust.sock");
  const rows=[
   ["backend",1002,2301],["frontend",1003,2302],["test",1004,2303]
  ];
  const roleSockets={},roleTokens={},scopes={};
  for(const [role,uid,gid] of rows){
   const dir=join(root,role);
   await mkdir(dir,{mode:0o700});
   await chown(dir,1001,gid);
   await chmod(dir,0o2750);
   roleSockets[role]=join(dir,"rust-vp.sock");
   roleTokens[role]="offline-native-role-"+role+"-20261111";
   scopes[role]={role,ownerUid:1001,workerUid:uid,roleGid:gid};
  }
  const setup={originalNativeSocketPath,roleSockets,roleTokens,scopes};
  owner=spawnAs(1001,1101,[2301,2302,2303],[
   "--input-type=module","-e",OWNER,JSON.stringify(setup)
  ],true);
  await ready(owner);
  const childIds=Object.fromEntries(rows.map(([role])=>
   [role,"urn:offline:child:"+role]));
  // Own HMAC-equivalent Rust Caller token without a R323 grant: denied.
  for(const [role,uid,gid] of rows){
   assert.equal(await probe(uid,gid,roleSockets[role],roleTokens[role],
    "create_presentation",childIds[role]),"DENIED");
  }
  // Linux GID denies another specialist's supposedly shared signer.
  assert.equal(await probe(1002,2301,roleSockets.frontend,roleTokens.frontend,
   "create_presentation",childIds.frontend),"DENIED");
  const initial=(await exchange(owner,{type:"snapshot"},"snapshot_result")).report;
  assert.equal(initial.fakeRustCalls,0);
  assert.equal(initial.original_rust_signature_verified_here,false);
  for(const [role,uid,gid] of rows){
   await exchange(owner,{type:"grant",role,credentialId:childIds[role]},"grant_ack");
   // The transport refuses native root/child issuance, even with role token.
   assert.equal(await probe(uid,gid,roleSockets[role],roleTokens[role],
    "issue_child",childIds[role]),"DENIED");
   assert.equal(await probe(uid,gid,roleSockets[role],roleTokens[role],
    "create_presentation","urn:foreign:child"),"DENIED");
   assert.equal(await probe(uid,gid,roleSockets[role],roleTokens[role],
    "create_presentation",childIds[role]),"ALLOWED");
   await exchange(owner,{type:"revoke",role},"revoke_ack");
   assert.equal(await probe(uid,gid,roleSockets[role],roleTokens[role],
    "create_presentation",childIds[role]),"DENIED");
  }
  const report=(await exchange(owner,{type:"snapshot"},"snapshot_result")).report;
  assert.equal(report.fakeRustCalls,3);
  assert.deepEqual(report.forwarded,{backend:1,frontend:1,test:1});
  assert.equal(report.paid_gemini_authorized,false);
  assert.equal(report.original_rust_signature_verified_here,false);
 }finally{
  if(owner)await closeOwner(owner);
  await rm(root,{recursive:true,force:true});
 }
});
