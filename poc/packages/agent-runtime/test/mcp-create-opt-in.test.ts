import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {PrivateMcpTaskRegistry,PrivateMcpTaskError} from "../src/private-mcp-task-registry.ts";

function keyPair(){
  const k=generateKeyPairSync("ed25519");
  return {
    privateKey:k.privateKey.export({format:"pem",type:"pkcs8"}).toString(),
    publicKey:k.publicKey.export({format:"pem",type:"spki"}).toString()
  };
}
const args={branch:"feature/account-suspension",
  path:"tests/e2e/account-suspension.spec.ts",content:"test('suspension',()=>{});"};
const request={tool:"create_file",arguments:args};
async function rejects(registry:PrivateMcpTaskRegistry,taskId:string){
  await assert.rejects(
    registry.invoke("Bearer "+registry.bearerFor(taskId),request),
    (err:unknown)=>err instanceof PrivateMcpTaskError&&err.kind==="invalid_tool_call"
  );
}
test("MCP create_file task-local opt-in does not authorize Backend or default Test task",async()=>{
  const key=keyPair();
  let calls=0;
  const fakeClient={invoke:async()=>{calls++;return {revision:"a".repeat(40)};}};
  const backend=new PrivateMcpTaskRegistry({role:"backend",
    signingPrivateKeyPem:key.privateKey,signingPublicKeyPem:key.publicKey});
  backend.begin("backend-task",fakeClient,undefined,{allowCreateFile:true});
  await rejects(backend,"backend-task");
  backend.end("backend-task");
  const testing=new PrivateMcpTaskRegistry({role:"test",
    signingPrivateKeyPem:key.privateKey,signingPublicKeyPem:key.publicKey});
  testing.begin("test-default",fakeClient);
  await rejects(testing,"test-default");
  testing.end("test-default");
  testing.begin("test-enabled",fakeClient,undefined,{allowCreateFile:true});
  await testing.invoke("Bearer "+testing.bearerFor("test-enabled"),request);
  assert.equal(calls,1);
  testing.end("test-enabled");
});
