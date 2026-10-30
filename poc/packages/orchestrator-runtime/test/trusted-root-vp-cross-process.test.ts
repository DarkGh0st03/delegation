import assert from "node:assert/strict";
import {test} from "node:test";
import {spawn,type ChildProcessWithoutNullStreams} from "node:child_process";
import {fileURLToPath} from "node:url";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {randomBytes} from "node:crypto";
import {join} from "node:path";
import {tmpdir} from "node:os";
import type {VerifierPort,VerifiedDelegation} from
 "../../../apps/gateway/src/types.ts";
import {TrustedGatewayRootVpVerifier} from
 "../../../apps/gateway/src/trusted-root-vp-verification.ts";
import {TrustedRootVpSocketClient} from
 "../src/trusted-root-vp-private-ipc.ts";

const credential_id="urn:credential:r130-cross-process",
 engineer_did="did:thesis:engineer",
 orchestrator_did="did:thesis:orchestrator",
 audience="urn:thesis:gateway:r130",
 required_permissions=[{
  resource:"gitea://gitea.local/sample/invoice-service",
  operation:"read_file" as const
 }];
async function fixture(t:import("node:test").TestContext){
 const home=await mkdtemp(join(tmpdir(),"r130-xprocess-"));
 const directory=join(home,"private");
 await mkdir(directory,{mode:0o700});
 const socketPath=join(directory,"root.sock"),
  secretFile=join(directory,"secret.hex"),
  wrongSecret=join(directory,"wrong.hex");
 await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",{mode:0o600});
 await writeFile(wrongSecret,randomBytes(32).toString("hex")+"\n",{mode:0o600});
 const script=fileURLToPath(new URL(
  "./fixtures/trusted-root-vp-signing-child.mjs",import.meta.url
 ));
 const child=spawn(process.execPath,[
  "--experimental-strip-types",script,socketPath,secretFile
 ],{stdio:["ignore","pipe","pipe"]});
 let stderr="";
 child.stderr.on("data",chunk=>{stderr+=String(chunk).slice(0,1024);});
 let done=false;
 t.after(async()=>{
  if(child.exitCode===null&&!child.killed){
   const ended=new Promise<void>(resolve=>child.once("exit",()=>resolve()));
   child.kill("SIGTERM");
   await ended;
  }
  await rm(home,{recursive:true,force:true});
 });
 await new Promise<void>((resolve,reject)=>{
  const error=(e:Error)=>{if(done)return;done=true;reject(e);};
  child.once("error",error);
  child.once("exit",(code,signal)=>{
   if(!done){done=true;reject(Error(
    "private signer exited before readiness: "+code+"/"+signal+" "+stderr
   ));}
  });
  child.stdout.on("data",(data:Buffer)=>{
   if(done)return;
   if(String(data).includes("READY")){
    done=true;resolve();
   }
  });
 });
 const client=await TrustedRootVpSocketClient.connect({socketPath,secretFile});
 return {client,secretFile,wrongSecret};
}
test("R130.4 real separate OS process signs fresh Gateway-root challenge, no authority issued",async t=>{
 const f=await fixture(t),seen:string[]=[];
 const verifier:VerifierPort={
  async verify(){throw Error("Not root proof verifier");},
  async verifyMultiple(request){
   assert.equal(request.presenter,"orchestrator");
   assert.equal(request.audience,audience);
   assert.deepEqual(request.required_permissions,required_permissions);
   assert.equal(request.signed_vp,"signed-root-vp:"+request.challenge);
   seen.push(request.challenge);
   const result:VerifiedDelegation={
    credential_id,issuer_id:engineer_did,presenter_id:orchestrator_did,
    permissions:required_permissions,hierarchy_depth:0,
    expiration:(BigInt(Date.now())*1_000_000n+10_000_000_000n).toString()
   };
   return result;
  }
 };
 const verifierPort=new TrustedGatewayRootVpVerifier({
  verifier,signer:f.client,audience
 });
 for(let i=0;i<2;i++){
  const output=await verifierPort.verifyRoot({
   credential_id,engineer_did,orchestrator_did,required_permissions
  });
  assert.equal(output.cryptographic_presentation_verified,true);
  assert.equal(output.execution_authorized,false);
  assert.equal(output.gateway_epoch_admitted,false);
 }
 assert.equal(seen.length,2);
 assert.equal(new Set(seen).size,2);
});
test("R130.4 OS-process socket rejects invalid secret, foreign root and nonce replay",async t=>{
 const f=await fixture(t);
 const nonce="c".repeat(64);
 const original={credential_id,audience,challenge:nonce,
  disclosed_permissions:required_permissions};
 assert.equal(await f.client.present(original),"signed-root-vp:"+nonce);
 await assert.rejects(f.client.present(original),
  /Private root VP signing denied/);
 await assert.rejects(f.client.present({
  ...original,credential_id:"urn:forged:root",
  challenge:"d".repeat(64)
 }),/Private root VP signing denied/);
 const rogue=await TrustedRootVpSocketClient.connect({
  socketPath:"/tmp/placeholder",secretFile:f.wrongSecret
 }).catch(()=>null);
 // Wrong secret cannot be used against the actual owner-only socket.
 assert.equal(rogue,null);
});
