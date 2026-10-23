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


test("private MCP bearer cannot escape signed Task path ceiling before Gateway",async()=>{
 const k=keys();let gateway=0;
 const reg=new PrivateMcpTaskRegistry({
   role:"backend",signingPrivateKeyPem:k.priv,signingPublicKeyPem:k.pub
 });
 const allowed="apps/backend/src/users/user.service.ts";
 const denied="apps/backend/src/users/user.controller.ts";
 reg.begin("signed-backend",{
   invoke:async()=>{gateway++;return {status:"ok"};}
 },undefined,{allowUpdateFile:true,allowedPaths:[allowed]});
 const token="Bearer "+reg.bearerFor("signed-backend");
 await assert.rejects(reg.invoke(token,{
   tool:"read_file",arguments:{branch:"feature/account-suspension",
     path:denied}
 }),/invalid_tool_call/);
 await assert.rejects(reg.invoke(token,{
   tool:"update_file",arguments:{branch:"feature/account-suspension",
     path:denied,content:"blocked"}
 }),/invalid_tool_call/);
 assert.equal(gateway,0);
 await reg.invoke(token,{
   tool:"update_file",arguments:{branch:"feature/account-suspension",
     path:allowed,content:"authorized"}
 });
 assert.equal(gateway,1);
 reg.end("signed-backend");
});

test("private MCP signed Test Task permits run_tests but no repository file calls",async()=>{
 const k=keys();let calls=0;
 const reg=new PrivateMcpTaskRegistry({
   role:"test",signingPrivateKeyPem:k.priv,signingPublicKeyPem:k.pub
 });
 reg.begin("signed-test",{
   invoke:async(tool)=>{calls++;assert.equal(tool,"run_tests");return {};}
 },undefined,{allowedPaths:[],allowRunTests:true});
 const token="Bearer "+reg.bearerFor("signed-test");
 await assert.rejects(reg.invoke(token,{
   tool:"read_file",arguments:{branch:"feature/account-suspension",
     path:"tests/backend/user.service.test.ts"}
 }),/invalid_tool_call/);
 await reg.invoke(token,{tool:"run_tests",arguments:{
   branch:"feature/account-suspension",profile:"poc-default"
 }});
 assert.equal(calls,1);
 reg.end("signed-test");
});

test("malformed signed MCP path ceiling is rejected before token issuance",()=>{
 const k=keys();
 const reg=new PrivateMcpTaskRegistry({
   role:"backend",signingPrivateKeyPem:k.priv,signingPublicKeyPem:k.pub
 });
 for(const p of ["../secrets","/tmp/file","apps//backend","x\\secret",
   "apps/./file","apps/file\u0000.ts"]){
   assert.throws(()=>reg.begin("task-A",{invoke:async()=>({})},undefined,{
     allowedPaths:[p]
   }),/invalid_tool_call/);
 }
});


test("MCP enforces operation-specific grants: read context yes, write context no",async()=>{
 const k=keys();let count=0;
 const registry=new PrivateMcpTaskRegistry({
   role:"backend",signingPrivateKeyPem:k.priv,signingPublicKeyPem:k.pub
 });
 const writable="apps/backend/src/users/user.service.ts";
 const context="apps/backend/src/users/user.controller.ts";
 registry.begin("approved-read-write",{
   invoke:async(tool,args)=>{
     count++;
     return {tool,path:args.path};
   }
 },undefined,{
   allowUpdateFile:true,allowedPaths:[writable,context],
   allowedFilePermissions:[
     {operation:"read_file",path:writable},
     {operation:"update_file",path:writable},
     {operation:"read_file",path:context}
   ]
 });
 const bearer="Bearer "+registry.bearerFor("approved-read-write");
 const msg=(tool:string,path:string)=>({tool,arguments:{
   branch:"feature/account-suspension",path,
   ...(tool==="update_file"?{content:"allowed only for writable"}:{})
 }});
 assert.deepEqual(await registry.invoke(bearer,msg("read_file",context)),
   {tool:"read_file",path:context});
 await assert.rejects(registry.invoke(bearer,msg("update_file",context)),
   /invalid_tool_call/);
 await registry.invoke(bearer,msg("update_file",writable));
 assert.equal(count,2);
 registry.end("approved-read-write");
});

test("MCP cannot infer read_file from a write grant on the same Task path",async()=>{
 const k=keys();let count=0;
 const registry=new PrivateMcpTaskRegistry({
   role:"backend",signingPrivateKeyPem:k.priv,signingPublicKeyPem:k.pub
 });
 const path="apps/backend/src/users/user.service.ts";
 registry.begin("write-only",{
   invoke:async()=>{count++;return {};}
 },undefined,{
   allowUpdateFile:true,allowedPaths:[path],
   allowedFilePermissions:[{operation:"update_file",path}]
 });
 const auth="Bearer "+registry.bearerFor("write-only");
 await assert.rejects(registry.invoke(auth,{tool:"read_file",arguments:{
   branch:"feature/account-suspension",path
 }}),/invalid_tool_call/);
 assert.equal(count,0);
 registry.end("write-only");
});

test("signed dynamic MCP branch denies cross-branch, path, operation and legacy bypass",async()=>{
 const k=keys(),reg=new PrivateMcpTaskRegistry({
   role:"backend",signingPrivateKeyPem:k.priv,signingPublicKeyPem:k.pub
 });
 const path="src/billing/invoice.ts",branch="feature/invoice-sort";
 const calls:string[]=[];
 const client={invoke:async(tool:string,args:{branch:string;path:string})=>{
   calls.push(tool+":"+args.branch+":"+args.path);
   return {provider:"gitea",performed:true};
 }};
 assert.throws(()=>reg.begin("unbound",client as never,undefined,{
   approvedBranch:branch,allowedPaths:[path]
 }),/invalid_tool_call/);
 reg.begin("signed",client as never,undefined,{
   approvedBranch:branch,allowedPaths:[path],allowUpdateFile:true,
   allowedFilePermissions:[
     {operation:"read_file",path},{operation:"update_file",path}
   ]
 });
 reg.begin("legacy",client as never);
 const auth="Bearer "+reg.bearerFor("signed");
 const call=(tool:string,branchName:string,p=path)=>({
   tool,arguments:{branch:branchName,path:p,
     ...(tool==="update_file"?{content:"export const ok=true;"}:{})}
 });
 await reg.invoke(auth,call("read_file",branch));
 await reg.invoke(auth,call("update_file",branch));
 for(const denied of [
   call("read_file","feature/another"),call("update_file","main"),
   call("update_file",branch,"src/billing/tax.ts"),call("create_file",branch)
 ])await assert.rejects(reg.invoke(auth,denied),/invalid_tool_call/);
 await assert.rejects(reg.invoke("Bearer "+reg.bearerFor("legacy"),
   call("read_file",branch)),/invalid_tool_call/);
 assert.deepEqual(calls,[
   "read_file:"+branch+":"+path,"update_file:"+branch+":"+path
 ]);
 reg.end("signed");reg.end("legacy");
});

test("signed Test task may create exact approved file and run tests on its branch",async()=>{
 const k=keys(),reg=new PrivateMcpTaskRegistry({
   role:"test",signingPrivateKeyPem:k.priv,signingPublicKeyPem:k.pub
 });
 const path="tests/e2e/invoice-sort.spec.ts",branch="feature/invoice-sort";
 const seen:string[]=[];
 reg.begin("signed-test",{invoke:async(name)=>{seen.push(name);return {ok:true};}},
   undefined,{approvedBranch:branch,allowedPaths:[path],
     allowedFilePermissions:[{operation:"create_file",path}],
     allowCreateFile:true,allowRunTests:true});
 const auth="Bearer "+reg.bearerFor("signed-test");
 await reg.invoke(auth,{tool:"create_file",arguments:{
   branch,path,content:"test('invoice',()=>{});"
 }});
 await reg.invoke(auth,{tool:"run_tests",arguments:{branch,profile:"poc-default"}});
 await assert.rejects(reg.invoke(auth,{tool:"create_file",arguments:{
   branch,path:"tests/e2e/unapproved.spec.ts",content:"bad"
 }}),/invalid_tool_call/);
 await assert.rejects(reg.invoke(auth,{tool:"run_tests",arguments:{
   branch:"feature/account-suspension",profile:"poc-default"
 }}),/invalid_tool_call/);
 assert.deepEqual(seen,["create_file","run_tests"]);
 reg.end("signed-test");
});
