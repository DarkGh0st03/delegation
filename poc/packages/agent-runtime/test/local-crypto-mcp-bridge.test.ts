import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {createServer} from "node:net";
import {mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {DelegationEvidenceHandler} from "../src/delegation-evidence-handler.ts";
import {LocalCryptoMcpBridge} from "../src/local-crypto-mcp-bridge.ts";
import {PrivateMcpTaskRegistry} from "../src/private-mcp-task-registry.ts";
import {ControlledToolError} from "../src/controlled-errors.ts";

function registry(){
 const kp=generateKeyPairSync("ed25519");
 return new PrivateMcpTaskRegistry({role:"backend",
  signingPrivateKeyPem:kp.privateKey.export({format:"pem",type:"pkcs8"}).toString(),
  signingPublicKeyPem:kp.publicKey.export({format:"pem",type:"spki"}).toString()
 });
}
const prepared=(request_id:string)=>({request_id,
 audience:"cloud-access-gateway",challenge:"trusted-nonce",
 expires_at:new Date(Date.now()+60_000).toISOString(),
 required_permission:{
  operation:"read_file",
  resource:"gitea://gitea.local/thesis/repo/branches/feature%2Ftest/files/src/app.ts"
 }
});

test("R200 in-process MCP produces one private signed VP; no shared MCP or HTTP worker",async()=>{
 const r=registry();let signed=0;
 r.begin("task-local",{invoke:async()=>{throw Error("No Gateway calls");}},undefined,{
  evidenceHandler:{credentialId:"urn:dc:task",presenterId:"did:thesis:backend",
   async createPresentation(value){signed++;assert.equal(value.challenge,"trusted-nonce");
    return "private.signed.vp";}
  }
 });
 const bridge=new LocalCryptoMcpBridge({registry:r,taskId:"task-local"});
 assert.equal(await bridge.createSignedPresentation(prepared("request-1")),"private.signed.vp");
 assert.equal(signed,1);
 await assert.rejects(bridge.createSignedPresentation(prepared("request-1")),"replay denied");
 assert.equal(signed,1);
 r.end("task-local");
 await assert.rejects(bridge.createSignedPresentation(prepared("request-2")),/inactive_task/);
});

test("R200 cancellation prevents signing and hides private Rust failure detail",async()=>{
 const r=registry(),abort=new AbortController();let called=0;
 r.begin("cancel",{invoke:async()=>({})},abort.signal,{
  evidenceHandler:{credentialId:"urn:dc",presenterId:"did:thesis:backend",
   async createPresentation(){called++;return "private.vp";}
  }
 });
 abort.abort();
 await assert.rejects(new LocalCryptoMcpBridge({registry:r,taskId:"cancel"})
  .createSignedPresentation(prepared("request-3")) ,/inactive_task/);
 assert.equal(called,0);
 const f=registry();
 f.begin("fail",{invoke:async()=>({})},undefined,{
  evidenceHandler:{credentialId:"urn:dc",presenterId:"did:thesis:backend",
   async createPresentation(){throw Error("PRIVATE_SIGNING_MATERIAL");}
  }
 });
 await assert.rejects(new LocalCryptoMcpBridge({registry:f,taskId:"fail"})
  .createSignedPresentation(prepared("request-4")),(e:unknown)=>{
   assert.ok(e instanceof ControlledToolError);
   assert.doesNotMatch(String(e),/PRIVATE_SIGNING_MATERIAL/u);
   return true;
  });
 f.end("fail");
});

test("R200 local crypto MCP cannot expose repository or Docker tools",async()=>{
 const {readFileSync}=await import("node:fs");
 const src=readFileSync(new URL("../src/local-crypto-mcp-bridge.ts",import.meta.url),"utf8");
 assert.match(src,/registerTool\("delegation_create_presentation"/u);
 assert.doesNotMatch(src,/registerTool\("(read_file|update_file|create_file|run_tests)"/u);
 const runtime=readFileSync(new URL("../src/server.ts",import.meta.url),"utf8");
 assert.match(runtime,/const mcpTaskRegistry = options\.mcpTaskSigning/u);
 assert.match(runtime,/mcpTaskRegistry \? \{mcpTaskRegistry\}/u);
 assert.doesNotMatch(runtime,/attachPrivateMcpWorker\(/u);
});


/**
 * R381.5: the original Agent's task-local MCP remains the model-facing
 * cryptographic *barrier*. Its trusted registry calls the real presentation
 * handler, which in R381.4 optionally asks a separate private MCP process
 * to invoke the SAME role-authenticated native Rust socket. Never provide a
 * credential or bearer as an ADK tool argument.
 */
async function privateNativeSocket(t:import("node:test").TestContext,
 reply:(request:Record<string,unknown>)=>unknown){
 const dir=await mkdtemp(join(tmpdir(),"r3815-private-agent-"));
 const socketPath=join(dir,"rust.sock");
 const calls:Record<string,unknown>[]=[];
 const server=createServer({allowHalfOpen:true},socket=>{
  let input="";
  socket.on("data",bytes=>input+=bytes.toString("utf8"));
  socket.on("end",()=>{
   try{
    const request=JSON.parse(input) as Record<string,unknown>;
    calls.push(request);
    socket.end(JSON.stringify(reply(request)));
   }catch{socket.end(JSON.stringify({ok:false}));}
  });
 });
 await new Promise<void>((resolve,reject)=>{
  server.once("error",reject);
  server.listen(socketPath,()=>{server.off("error",reject);resolve();});
 });
 t.after(async()=>{
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  await rm(dir,{recursive:true,force:true});
 });
 return {socketPath,calls};
}

test("R381.5 three original Task registries route Gateway challenge through private MCP to one Rust signer",async t=>{
 const rust=await privateNativeSocket(t,request=>({
  ok:true,result:{signed_vp:"private_rust_vp_"+
   (request.body as {credential_id:string}).credential_id}
 }));
 let http=0;
 for(const role of ["backend","frontend","test"] as const){
  const kp=generateKeyPairSync("ed25519");
  const reg=new PrivateMcpTaskRegistry({
   role,
   signingPrivateKeyPem:kp.privateKey.export({format:"pem",type:"pkcs8"}).toString(),
   signingPublicKeyPem:kp.publicKey.export({format:"pem",type:"spki"}).toString()
  });
  const task="r3815-original-task-"+role;
  const child="urn:r3815:approved:"+role;
  const handler=new DelegationEvidenceHandler({
   adapterToken:"PRIVATE_"+role.toUpperCase()+"_SOCKET_BEARER",
   nativeSocketPath:rust.socketPath,
   nativePresentationTransport:"mcp-stdio",
   evidence:{credential:"opaque-signed-child",credential_id:child,
    presenter_id:"did:thesis:"+role},
   fetchFn:(async()=>{
    http++;throw Error("Forbidden HTTP fallback");
   }) as typeof fetch
  });
  reg.begin(task,{invoke:async()=>{throw Error("Forbidden direct effect");}},
   undefined,{evidenceHandler:handler});
  const challenge=prepared("r3815-request-"+role);
  const bridge=new LocalCryptoMcpBridge({registry:reg,taskId:task});
  assert.equal(await bridge.createSignedPresentation(challenge),
   "private_rust_vp_"+child);
  assert.equal(reg.completedCryptoProofs,1);
  assert.equal(rust.calls.length,["backend","frontend","test"].indexOf(role)+1);
  const call=rust.calls.at(-1)!;
  assert.equal(call.operation,"create_presentation");
  assert.equal(call.token,"PRIVATE_"+role.toUpperCase()+"_SOCKET_BEARER");
  assert.deepEqual(call.body,{
   credential_id:child,
   disclosed_permissions:[challenge.required_permission],
   audience:challenge.audience,challenge:challenge.challenge
  });
  await assert.rejects(bridge.createSignedPresentation(challenge),
   /invalid_tool_call/u);
  assert.equal(reg.completedCryptoProofs,1);
  reg.end(task);
  await assert.rejects(bridge.createSignedPresentation(
   prepared("r3815-post-close-"+role)),/inactive_task/u);
 }
 assert.equal(rust.calls.length,3);
 assert.equal(http,0);
});

test("R381.5 private Rust denial cannot leak native secrets or trigger HTTP retry",async t=>{
 const rust=await privateNativeSocket(t,()=>({
  ok:false,error:"PRIVATE_R3815_NATIVE_KEY_MUST_NOT_LEAK"
 }));
 const r=registry(),task="r3815-negative";
 const handler=new DelegationEvidenceHandler({
  adapterToken:"PRIVATE_BACKEND",nativeSocketPath:rust.socketPath,
  nativePresentationTransport:"mcp-stdio",
  evidence:{credential:"opaque-child",credential_id:"urn:r3815:backend",
   presenter_id:"did:thesis:backend"},
  fetchFn:(async()=>{throw Error("HTTP fallback forbidden");}) as typeof fetch
 });
 r.begin(task,{invoke:async()=>{throw Error("Forbidden effect");}},
  undefined,{evidenceHandler:handler});
 const bridge=new LocalCryptoMcpBridge({registry:r,taskId:task});
 const challenge=prepared("r3815-native-denied");
 await assert.rejects(bridge.createSignedPresentation(challenge),error=>{
  assert.ok(error instanceof ControlledToolError);
  assert.doesNotMatch(String(error),/PRIVATE_R3815_NATIVE_KEY/u);
  assert.match(String(error),/Trusted local cryptographic presentation unavailable/u);
  return true;
 });
 assert.equal(rust.calls.length,1);
 assert.equal(r.completedCryptoProofs,0);
 await assert.rejects(bridge.createSignedPresentation(challenge),
  /invalid_tool_call/u);
 assert.equal(rust.calls.length,1);
 r.end(task);
});
