import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {PrivateMcpTaskRegistry} from "../src/private-mcp-task-registry.ts";
import {issueTaskToken} from "../../../mcp-shared/src/task-token.ts";

function keys() {
  const pair = generateKeyPairSync("ed25519");
  return {priv:pair.privateKey.export({format:"pem",type:"pkcs8"}).toString(),
    pub:pair.publicKey.export({format:"pem",type:"spki"}).toString()};
}
const request = {tool:"read_file",arguments:{branch:"feature/account-suspension",path:"apps/backend/src/users/user.model.ts"}};

test("task A dispatches only to its private Gateway client",async()=>{
  const k=keys();let n=0;
  const reg=new PrivateMcpTaskRegistry({role:"backend",signingPrivateKeyPem:k.priv,signingPublicKeyPem:k.pub});
  reg.begin("task-A",{invoke:async(tool,args)=>{n++;assert.equal(tool,"read_file");assert.equal(args.path,request.arguments.path);return {content:"real gateway result"};}});
  assert.deepEqual(await reg.invoke("Bearer "+reg.bearerFor("task-A"),request),{content:"real gateway result"});
  assert.equal(n,1);reg.end("task-A");
  await assert.rejects(reg.invoke("Bearer "+issueTaskToken(k.priv,"backend","task-A"),request),/inactive_task/);
});

test("role and task isolation is independent from Gemini arguments",async()=>{
  const a=keys(),b=keys(); let n=0;
  const reg=new PrivateMcpTaskRegistry({role:"backend",signingPrivateKeyPem:a.priv,signingPublicKeyPem:a.pub});
  reg.begin("task-A",{invoke:async()=>{n++;return {};}});
  await assert.rejects(reg.invoke("Bearer "+issueTaskToken(b.priv,"frontend","task-A"),request),/unauthorized/);
  await assert.rejects(reg.invoke("Bearer "+issueTaskToken(a.priv,"backend","task-B"),request),/inactive_task/);
  await assert.rejects(reg.invoke("Bearer "+reg.bearerFor("task-A"),{...request,task_id:"task-B"}),/invalid_tool_call/);
  assert.equal(n,0);
});

test("concurrent same-role tasks remain bound to distinct Gateway clients",async()=>{
  const k=keys();const reg=new PrivateMcpTaskRegistry({role:"backend",signingPrivateKeyPem:k.priv,signingPublicKeyPem:k.pub});
  reg.begin("A",{invoke:async()=> "A result"});reg.begin("B",{invoke:async()=> "B result"});
  assert.equal(await reg.invoke("Bearer "+reg.bearerFor("A"),request),"A result");
  assert.equal(await reg.invoke("Bearer "+reg.bearerFor("B"),request),"B result");
  assert.notEqual(reg.bearerFor("A"),reg.bearerFor("B"));
  reg.end("A");
  await assert.rejects(reg.invoke("Bearer "+issueTaskToken(k.priv,"backend","A"),request),/inactive_task/);
  assert.equal(await reg.invoke("Bearer "+reg.bearerFor("B"),request),"B result");
});

test("cancelled task and late responses fail closed",async()=>{
  const k=keys(),controller=new AbortController();
  const reg=new PrivateMcpTaskRegistry({role:"backend",signingPrivateKeyPem:k.priv,signingPublicKeyPem:k.pub});
  let done!: (x:string)=>void;
  const pending=new Promise<string>(resolve=>{done=resolve;});
  reg.begin("task-A",{invoke:async()=>pending},controller.signal);
  const token=reg.bearerFor("task-A");
  const call=reg.invoke("Bearer "+token,request);
  controller.abort();done("too late");
  await assert.rejects(call,/inactive_task/);
  await assert.rejects(reg.invoke("Bearer "+token,request),/inactive_task/);
});
