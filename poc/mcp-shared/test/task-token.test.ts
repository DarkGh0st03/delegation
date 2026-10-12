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
