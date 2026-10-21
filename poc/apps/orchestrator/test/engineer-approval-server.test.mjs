import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,readFile,rm,chmod} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {scryptSync,randomBytes,generateKeyPairSync} from "node:crypto";
import {runInNewContext} from "node:vm";
import {readFileSync} from "node:fs";
import {createAuthenticatedEngineerServer} from "../src/engineer-approval-server.mjs";
import {SignedEngineerApprovalFileStore} from
  "../../../packages/orchestrator-runtime/src/signed-approval-store.ts";
import {planDigest} from "../../../packages/plan-contracts/src/plan.mjs";

const SOURCE=new URL("../../../workflow-ui/mock-plan.js",import.meta.url);
function plan(){
  const context={};
  runInNewContext(readFileSync(SOURCE,"utf8"),context);
  return JSON.parse(JSON.stringify(context.DELEGATION_MOCK_PLAN));
}
const DID="did:thesis:software-engineer",PASSWORD="a-local-operator-test-password";
const KEYID="engineer-test-key";

async function environment(t){
  const home=await mkdtemp(join(tmpdir(),"engineer-ui-"));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const dir=join(home,"protected"),receipts=join(home,"receipts");
  const {mkdir}=await import("node:fs/promises");
  await mkdir(dir,{mode:0o700});await mkdir(receipts,{mode:0o700});
  const p=plan();
  const planFile=join(dir,"plan.json"),keyFile=join(dir,"key.pem");
  const keys=generateKeyPairSync("ed25519");
  const priv=keys.privateKey.export({format:"pem",type:"pkcs8"}).toString();
  const pub=keys.publicKey.export({format:"pem",type:"spki"}).toString();
  await writeFile(planFile,JSON.stringify(p),{mode:0o600});
  await writeFile(keyFile,priv,{mode:0o600});
  const salt=randomBytes(16);
  const config={
    engineerDid:DID,keyId:KEYID,trustedPlanFile:planFile,
    expectedSessionId:p.session_id,expectedBaseRevision:p.base_revision,
    repository:p.repository,privateKeyFile:keyFile,publicKeyPem:pub,
    receiptDirectory:receipts,passwordSaltHex:salt.toString("hex"),
    passwordScryptHex:scryptSync(PASSWORD,salt,64).toString("hex")
  };
  const server=await createAuthenticatedEngineerServer(config);
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const root="http://127.0.0.1:"+server.address().port;
  const post=(path,body,cookie,csrf,origin=root)=>fetch(root+path,{
    method:"POST",headers:{
      "Content-Type":"application/json",Origin:origin,
      ...(cookie?{Cookie:cookie}:{}),...(csrf?{"X-CSRF-Token":csrf}:{})
    },body:JSON.stringify(body)
  });
  const login=async()=>{
    const result=await post("/api/login",{password:PASSWORD});
    assert.equal(result.status,200);
    return result.headers.get("set-cookie").split(";")[0];
  };
  return {p,config,receipts,planFile,keyFile,root,post,login};
}

test("local GUI requires credentials, then exact digest/CSRF, and writes verified Ed25519 approval",async t=>{
  const e=await environment(t);
  assert.equal((await fetch(e.root+"/api/plan")).status,401);
  assert.equal((await e.post("/api/login",{password:"wrong"})).status,401);
  assert.equal((await e.post("/api/login",{password:PASSWORD},null,null,"https://evil.example")).status,403);
  const cookie=await e.login();
  const result=await fetch(e.root+"/api/plan",{headers:{Cookie:cookie}});
  assert.equal(result.status,200);
  const info=await result.json();
  assert.equal(info.plan_digest,planDigest(e.p));
  const selected=["p1","p2"];
  const payload={plan_digest:info.plan_digest,approved_permission_ids:selected,
    confirmation:"APPROVE "+info.plan_digest};
  assert.equal((await e.post("/api/approve",payload,cookie)).status,403);
  assert.equal((await e.post("/api/approve",{...payload,plan_digest:"0".repeat(64)},
    cookie,info.csrf_token)).status,403);
  assert.equal((await e.post("/api/approve",{...payload,approved_permission_ids:["p1","bogus"]},
    cookie,info.csrf_token)).status,403);
  const signed=await e.post("/api/approve",payload,cookie,info.csrf_token);
  assert.equal(signed.status,201);
  const outcome=await signed.json();
  assert.equal(outcome.signed,true);
  assert.equal(outcome.operational_credential_issued,false);
  assert.equal((await e.post("/api/approve",payload,cookie,info.csrf_token)).status,401);
  const store=new SignedEngineerApprovalFileStore({
    directory:e.receipts,engineerDid:DID,
    trustedKeys:{[KEYID]:{engineer_did:DID,public_key_pem:e.config.publicKeyPem}}
  });
  const verified=await store.loadAuthenticatedApproval(e.p.session_id);
  assert.deepEqual(verified.approval.approved_permission_ids,selected);
  assert.equal(verified.approval.plan_digest,planDigest(e.p));
  const nextCookie=await e.login();
  const nextPlan=await (await fetch(e.root+"/api/plan",{headers:{Cookie:nextCookie}})).json();
  assert.equal((await e.post("/api/approve",payload,nextCookie,nextPlan.csrf_token)).status,409);
});

test("server refuses plan change, altered SHA, signer permissions, and non-loopback config",async t=>{
  const e=await environment(t);
  const cookie=await e.login();
  const info=await (await fetch(e.root+"/api/plan",{headers:{Cookie:cookie}})).json();
  const p=structuredClone(e.p);
  p.requirement="Malicious change";
  await writeFile(e.planFile,JSON.stringify(p));
  const attempt=await e.post("/api/approve",{
    plan_digest:info.plan_digest,approved_permission_ids:["p1"],
    confirmation:"APPROVE "+info.plan_digest
  },cookie,info.csrf_token);
  assert.equal(attempt.status,409);
  await assert.rejects(createAuthenticatedEngineerServer({
    ...e.config,host:"0.0.0.0"
  }),/Invalid local/);
  await chmod(e.keyFile,0o644);
  await assert.rejects(createAuthenticatedEngineerServer(e.config),/owner-only/);
});

test("UI resources cannot read private signing keys and remain script-sanitized",async t=>{
  const e=await environment(t);
  assert.equal((await fetch(e.root+"/")).status,200);
  const client=await (await fetch(e.root+"/authenticated.js")).text();
  assert.doesNotMatch(client,/innerHTML|eval\(/u);
  assert.doesNotMatch(client,/privateKeyPem|scryptSync/u);
  assert.equal((await fetch(e.root+"/../../private.pem")).status,404);
  assert.equal((await fetch(e.root+"/api/plan",{headers:{Host:"evil.example"}})).status,403);
  assert.equal((await e.post("/api/approve",{},null,null)).status,401);
});
