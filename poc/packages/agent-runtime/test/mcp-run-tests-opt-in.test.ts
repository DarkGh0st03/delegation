import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {PrivateMcpTaskRegistry,PrivateMcpTaskError} from "../src/private-mcp-task-registry.ts";
function pair(){
  const p=generateKeyPairSync("ed25519");
  return {privateKey:p.privateKey.export({type:"pkcs8",format:"pem"}).toString(),
    publicKey:p.publicKey.export({type:"spki",format:"pem"}).toString()};
}
const args={branch:"feature/account-suspension",profile:"poc-default"};
async function denied(registry:PrivateMcpTaskRegistry,id:string){
  await assert.rejects(registry.invoke("Bearer "+registry.bearerFor(id),
    {tool:"run_tests",arguments:args}),
    (e:unknown)=>e instanceof PrivateMcpTaskError&&e.kind==="invalid_tool_call");
}
test("private run_tests requires Test role and separate task-local opt-in",async()=>{
  const k=pair();
  let calls=0;
  const gateway={invoke:async()=>{calls++;return {status:"pass"};}};
  const backend=new PrivateMcpTaskRegistry({role:"backend",
    signingPrivateKeyPem:k.privateKey,signingPublicKeyPem:k.publicKey});
  backend.begin("wrong-role",gateway,undefined,{allowRunTests:true});
  await denied(backend,"wrong-role");
  backend.end("wrong-role");
  const testing=new PrivateMcpTaskRegistry({role:"test",
    signingPrivateKeyPem:k.privateKey,signingPublicKeyPem:k.publicKey});
  testing.begin("default-task",gateway);
  await denied(testing,"default-task");
  testing.end("default-task");
  testing.begin("allowed-task",gateway,undefined,{allowRunTests:true});
  await testing.invoke("Bearer "+testing.bearerFor("allowed-task"),
    {tool:"run_tests",arguments:args});
  assert.equal(calls,1);
  testing.end("allowed-task");
});
