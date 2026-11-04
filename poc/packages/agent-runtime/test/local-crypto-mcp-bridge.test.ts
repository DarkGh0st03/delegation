import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
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
 assert.match(runtime,/mcpTaskRegistry&&options\.adk\?\.mcpCryptoUrl/u);
});
