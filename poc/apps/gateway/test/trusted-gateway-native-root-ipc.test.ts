import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:net";
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {TrustedGatewayNativeRootStatusReader}
 from "../src/trusted-gateway-native-root-status.ts";

const ROOT_ID="urn:r231:gateway-root";
const GATEWAY_TOKEN="r231-private-gateway-token";
const rights=[{resource:"gitea://gitea.local/thesis/iam-console-poc",
 operation:"read_repository"}];
const ns=BigInt(Date.now())*1000000n;
const base={
 credential_id:ROOT_ID,issuer_id:"did:thesis:engineer",
 delegatee_id:"did:thesis:orchestrator",
 iat_ns:(ns-1_000_000_000n).toString(),
 exp_ns:(ns+3_600_000_000_000n).toString(),
 permissions:rights,source:"adapter_local_issued_root"
};

test("R231 Gateway reads real native issuer observation API without Adapter HTTP",async t=>{
 const folder=mkdtempSync(join(tmpdir(),"r231-root-native-"));
 const socketPath=join(folder,"issuer.sock");
 let revoked=false,deny=false;
 const calls:{token:string;operation:string;body:{credential_id:string}}[]=[];
 const server=createServer({allowHalfOpen:true},socket=>{
  let input="";
  socket.on("data",chunk=>input+=chunk.toString("utf8"));
  socket.on("end",()=>{
   try{
    const request=JSON.parse(input);
    calls.push(request);
    if(request.token!==GATEWAY_TOKEN||request.body.credential_id!==ROOT_ID||
       !["read_issued_root","read_credential_status"].includes(request.operation)||
       deny||revoked&&request.operation==="read_issued_root"){
      socket.end(JSON.stringify({ok:false,error:"engineer_native_denied"}));
      return;
    }
    const status={
     credential_id:ROOT_ID,status_purpose:"revocation",
     status_set:revoked,source:"evm_anchored_signed_jwt",anchor_version:4
    };
    const result=request.operation==="read_issued_root"
      ? {...base,status}:status;
    socket.end(JSON.stringify({ok:true,result}));
   }catch{socket.destroy();}
  });
 });
 await new Promise<void>((resolve,reject)=>{
  server.once("error",reject);
  server.listen(socketPath,resolve);
 });
 t.after(async()=>{
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  rmSync(folder,{recursive:true,force:true});
 });
 const reader=new TrustedGatewayNativeRootStatusReader({
  gatewayToken:GATEWAY_TOKEN,
  nativeSocketPath:socketPath,timeoutMs:1000
 });
 const issued=await reader.readIssuedRoot(ROOT_ID);
 assert.deepEqual(issued.permissions,rights);
 assert.equal(issued.credential_id,ROOT_ID);
 assert.equal(issued.issuer_id,base.issuer_id);
 assert.equal(issued.delegatee_id,base.delegatee_id);
 assert.equal(issued.anchor_version,4);
 assert.equal(issued.execution_authorized,false);
 const active=await reader.readActiveRoot(ROOT_ID);
 assert.equal(active.anchor_version,4);
 assert.equal(active.execution_authorized,false);
 revoked=true;
 await assert.rejects(reader.readIssuedRoot(ROOT_ID),/Native Rust root status NO-GO/u);
 const retired=await reader.readRevokedRoot(ROOT_ID);
 assert.equal(retired.anchor_version,4);
 assert.equal(retired.execution_authorized,false);
 await assert.rejects(reader.readActiveRoot(ROOT_ID),
  /root is missing, revoked/u);
 deny=true;
 await assert.rejects(reader.readRevokedRoot(ROOT_ID),
  /Native Rust root status NO-GO/u);
 assert.deepEqual(calls.map(c=>c.operation),[
  "read_issued_root","read_credential_status","read_issued_root",
  "read_credential_status","read_credential_status","read_credential_status"
 ]);
 assert.ok(calls.every(c=>c.token===GATEWAY_TOKEN));
});

test("R231 malformed socket and dual-transport Gateway issuer config reject at startup",()=>{
 assert.throws(()=>new TrustedGatewayNativeRootStatusReader({
  baseUrl:"http://127.0.0.1:8090",gatewayToken:GATEWAY_TOKEN,
  nativeSocketPath:"relative.sock"
 }),/native issuer socket/u);
 assert.throws(()=>new TrustedGatewayNativeRootStatusReader({
  baseUrl:"http://127.0.0.1:8090",gatewayToken:GATEWAY_TOKEN,
  nativeSocketPath:"/tmp/r231-native.sock",
  fetchFn:async()=>{throw Error("HTTP must not be called");}
 }),/native issuer socket/u);
});

test("R231 canonical embedded Engineer owner never downgrades Gateway root inspection to HTTP",()=>{
 const prevMode=process.env.ENGINEER_CORE_NATIVE_MODE;
 const prevSocket=process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
 process.env.ENGINEER_CORE_NATIVE_MODE="1";
 delete process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
 try{
  assert.throws(()=>new TrustedGatewayNativeRootStatusReader({
   baseUrl:"http://127.0.0.1:8090",gatewayToken:GATEWAY_TOKEN,
   fetchFn:async()=>{throw Error("Adapter HTTP must not be used");}
  }),/canonical Engineer Core mode requires native issuer inspection socket/u);
  process.env.ADAPTER_ENGINEER_NATIVE_SOCKET="/tmp/r231-forced-native.sock";
  assert.throws(()=>new TrustedGatewayNativeRootStatusReader({
   baseUrl:"http://127.0.0.1:8090",gatewayToken:GATEWAY_TOKEN,
   fetchFn:async()=>{throw Error("Adapter HTTP must not be used");}
  }),/native issuer socket must be an absolute/u);
 }finally{
  if(prevMode===undefined)delete process.env.ENGINEER_CORE_NATIVE_MODE;
  else process.env.ENGINEER_CORE_NATIVE_MODE=prevMode;
  if(prevSocket===undefined)delete process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
  else process.env.ADAPTER_ENGINEER_NATIVE_SOCKET=prevSocket;
 }
});
