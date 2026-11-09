import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {issueTaskToken, verifyTaskToken, bearerToken} from "../src/task-token.ts";
function keys() {
  const p=generateKeyPairSync("ed25519");
  return {
    pub:p.publicKey.export({format:"pem",type:"spki"}).toString(),
    priv:p.privateKey.export({format:"pem",type:"pkcs8"}).toString()
  };
}
test("authentic role and A2A task are bound by a signature",()=>{
  const k=keys(), t=issueTaskToken(k.priv,"backend","task-A",1000,120);
  const c=verifyTaskToken(t,{backend:k.pub},1100);
  assert.equal(c.role,"backend");assert.equal(c.task_id,"task-A");
  assert.equal(bearerToken("Bearer "+t),t);
});
test("wrong role key, altered claims and expiry fail closed",()=>{
  const a=keys(),b=keys();
  const t=issueTaskToken(a.priv,"backend","task-A",1000,120);
  assert.throws(()=>verifyTaskToken(t,{backend:b.pub},1100));
  assert.throws(()=>verifyTaskToken(t,{backend:a.pub},1120));
  const parts=t.split(".");
  const payload=JSON.parse(Buffer.from(parts[1]!,"base64url").toString("utf8"));
  payload.role="frontend";
  const forged=parts[0]+"."+Buffer.from(JSON.stringify(payload)).toString("base64url")+"."+parts[2];
  assert.throws(()=>verifyTaskToken(forged,{backend:a.pub,frontend:b.pub},1100));
  assert.throws(()=>bearerToken("Basic bad"));
});
test("cannot mint empty tasks or overlong tokens",()=>{
  const k=keys();
  assert.throws(()=>issueTaskToken(k.priv,"backend","",1000));
  assert.throws(()=>issueTaskToken(k.priv,"backend","task",1000,601));
});

test("additional Owner-keyed roles bind MCP crypto tokens to their own signing identity",()=>{
 const reviewer=keys(),backend=keys();
 const token=issueTaskToken(reviewer.priv,"reviewer","task-native-reviewer",1000,120);
 const accepted=verifyTaskToken(token,{backend:backend.pub,reviewer:reviewer.pub},1100);
 assert.equal(accepted.role,"reviewer");
 assert.equal(accepted.task_id,"task-native-reviewer");
 assert.throws(()=>verifyTaskToken(token,{backend:backend.pub},1100),/invalid_task_signature/u);
 assert.throws(()=>verifyTaskToken(token,{reviewer:backend.pub},1100),/invalid_task_signature/u);
 assert.throws(()=>verifyTaskToken(token,{reviewer:reviewer.pub},1120),/expired_or_invalid_task_scope/u);
 const pieces=token.split(".");
 const modified=JSON.parse(Buffer.from(pieces[1]!,"base64url").toString("utf8"));
 modified.role="backend";
 const swapped=pieces[0]+"."+Buffer.from(JSON.stringify(modified)).toString("base64url")+
  "."+pieces[2];
 assert.throws(()=>verifyTaskToken(swapped,{
  reviewer:reviewer.pub,backend:backend.pub
 },1100),/invalid_task_signature/u);
});
test("extra MCP role names reject reserved/prototype/path roles before signing or lookup",()=>{
 const reviewer=keys();
 for(const role of ["orchestrator","constructor","prototype","__proto__",
  "../backend","backend/test","BACKEND","admin.danger","x".repeat(25),""]){
  assert.throws(()=>issueTaskToken(reviewer.priv,role,"task",1000,120),
   /Invalid task token parameters/u);
 }
 const token=issueTaskToken(reviewer.priv,"reviewer","task",1000,120);
 const inherited=Object.create({reviewer:reviewer.pub}) as Record<string,string>;
 assert.throws(()=>verifyTaskToken(token,inherited,1100),/invalid_task_signature/u);
});
