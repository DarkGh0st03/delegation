import assert from "node:assert/strict";
import test from "node:test";
import {generateKeyPairSync} from "node:crypto";
import {PrivateMcpTaskRegistry,PrivateMcpTaskError} from "../src/private-mcp-task-registry.ts";

function pair(){
  const p=generateKeyPairSync("ed25519");
  return {
    privateKey:p.privateKey.export({format:"pem",type:"pkcs8"}).toString(),
    publicKey:p.publicKey.export({format:"pem",type:"spki"}).toString()
  };
}
test("MCP write defaults DENIED inside private worker even for signed task bearer",async()=>{
  const b=pair();
  const active=new PrivateMcpTaskRegistry({role:"backend",
    signingPrivateKeyPem:b.privateKey,signingPublicKeyPem:b.publicKey});
  let invokes=0;
  const client={invoke:async()=>{invokes++;return {revision:"a".repeat(40)};}};
  const args={branch:"feature/account-suspension",
    path:"apps/backend/src/users/user.service.ts",content:"changed"};
  active.begin("read-only-task",client);
  await assert.rejects(active.invoke("Bearer "+active.bearerFor("read-only-task"),
    {tool:"update_file",arguments:args}),
    (e:unknown)=>e instanceof PrivateMcpTaskError&&e.kind==="invalid_tool_call");
  assert.equal(invokes,0);
  active.end("read-only-task");
  active.begin("write-enabled",client,undefined,{allowUpdateFile:true});
  const result=await active.invoke("Bearer "+active.bearerFor("write-enabled"),
    {tool:"update_file",arguments:args});
  assert.equal((result as {revision:string}).revision,"a".repeat(40));
  assert.equal(invokes,1);
  active.end("write-enabled");
});
