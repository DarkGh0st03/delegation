import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:net";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createNativeRustChildCryptographyPort,
 createOwnerPrivateMcpChildCryptographyPort,
 createRustAdapterChildCryptographyPort}
 from "../src/trusted-child-crypto-port.ts";

const rights=[{
 resource:"gitea://gitea.local/thesis/project/branches/feature%2Ftest/files/backend/main.ts",
 operation:"update_file"
}] as const;
const request={
 parent_credential_id:"urn:r240:root",
 credential_id:"urn:r240:child",
 delegatee:"backend" as const,
 valid_from:"2026-11-04T15:00:00Z",
 validity_seconds:120,
 credential_status:{
  type:"BitstringStatusListEntry" as const,
  statusPurpose:"revocation" as const,
  statusListIndex:"218",
  statusListCredential:"https://status.example/r240"
 },
 permissions:rights
};

test("R240 same native Rust Child issuer needs token + Unix socket, no Adapter URL",async t=>{
 const directory=mkdtempSync(join(tmpdir(),"r240-native-child-"));
 const socket=join(directory,"issuer.sock");
 const observed:Record<string,unknown>[]=[];
 let forged=false;
 const server=createServer({allowHalfOpen:true},peer=>{
  let input="";
  peer.on("data",c=>input+=c.toString("utf8"));
  peer.on("end",()=>{
   const call=JSON.parse(input) as Record<string,unknown>;
   observed.push(call);
   const body=call.body as Record<string,unknown>;
   const requested=body.permissions as typeof rights;
   const permissions=forged
    ?[{resource:requested[0]!.resource,operation:"create_pull_request"}]
    :requested;
   peer.end(JSON.stringify({ok:true,result:{
    id:body.credential_id,
    credentialSubject:{per:permissions}
   }}));
  });
 });
 await new Promise<void>((resolve,reject)=>{
  server.once("error",reject);server.listen(socket,resolve);
 });
 t.after(async()=>{
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  rmSync(directory,{recursive:true,force:true});
 });
 const port=createNativeRustChildCryptographyPort({
  bearerToken:"TRUSTED_ORCHESTRATOR_BEARER"
 },socket);
 const signed=await port.issueChild(request);
 assert.equal(signed.id,request.credential_id);
 assert.deepEqual(observed[0],{
  token:"TRUSTED_ORCHESTRATOR_BEARER",operation:"issue_child",body:request
 });
 forged=true;
 await assert.rejects(port.issueChild(request),
  /Native Rust Child DC changed signed permissions/u);
 assert.equal(observed.length,2);
});

test("R240 Child issuer never uses implicit historical Adapter HTTP after native guard",()=>{
 assert.throws(()=>createRustAdapterChildCryptographyPort({
  bearerToken:"PRIVATE_ORCHESTRATOR"
 }),/Private Rust Adapter issuance transport unavailable/u);
 const originalFlag=process.env.APPROVED_RUNNER_NATIVE_MCP;
 const originalSocket=process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
 try{
  process.env.APPROVED_RUNNER_NATIVE_MCP="1";
  delete process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
  assert.throws(()=>createOwnerPrivateMcpChildCryptographyPort({
   bearerToken:"PRIVATE_ORCHESTRATOR"
  }),/Canonical signed Child DC requires native Rust issuer socket/u);
 }finally{
  if(originalFlag===undefined)delete process.env.APPROVED_RUNNER_NATIVE_MCP;
  else process.env.APPROVED_RUNNER_NATIVE_MCP=originalFlag;
  if(originalSocket===undefined)delete process.env.ADAPTER_ENGINEER_NATIVE_SOCKET;
  else process.env.ADAPTER_ENGINEER_NATIVE_SOCKET=originalSocket;
 }
});
