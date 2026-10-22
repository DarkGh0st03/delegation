import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign,randomBytes,scryptSync} from "node:crypto";
import {mkdtemp,mkdir,writeFile,rm,readdir} from "node:fs/promises";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {startTrustedEngineerLocalHost}
  from "../src/trusted-engineer-host.mjs";
import {SignedEngineerApprovalFileStore}
  from "../../../packages/orchestrator-runtime/src/signed-approval-store.ts";
import {planDigest} from "../../../packages/plan-contracts/src/plan.mjs";

const repository="DarkGh0st03/delegation";
const ref="refs/heads/refactor/post-prof-plan-contracts-20261021";
const workflow=".github/workflows/trusted-gemini-dispatch-preflight.yml";
const sha="a".repeat(40),runId="39898765432";
const ownerId="150908952",repositoryId="1374168963";
const aud="urn:delegation:trusted-engineer-private-host";
const subject="repo:DarkGh0st03@"+ownerId+
  "/delegation@"+repositoryId+":ref:"+ref;
const key=generateKeyPairSync("rsa",{modulusLength:2048});
const publicJwk=key.publicKey.export({format:"jwk"});
const issuer=(async()=>new Response(JSON.stringify({
  keys:[{...publicJwk,kid:"unit-test-oidc-key",alg:"RS256",use:"sig"}]
}),{status:200}));
const runLookup=(async()=>new Response(JSON.stringify({
  id:Number(runId),event:"workflow_dispatch",run_attempt:1,
  status:"in_progress",head_sha:sha,
  head_branch:ref.slice("refs/heads/".length),
  path:workflow,head_repository:{full_name:repository},
  created_at:new Date().toISOString()
}),{status:200}));
function jwt(claimOverrides={}){
  const now=Math.floor(Date.now()/1000);
  const header=Buffer.from(JSON.stringify({
    alg:"RS256",kid:"unit-test-oidc-key",typ:"JWT"
  })).toString("base64url");
  const payload=Buffer.from(JSON.stringify({
    iss:"https://token.actions.githubusercontent.com",aud,sub:subject,
    iat:now-20,nbf:now-10,exp:now+180,
    jti:"unique-oidc-private-host-test-"+now+"-"+randomBytes(8).toString("hex"),
    repository,repository_id:repositoryId,repository_owner_id:ownerId,
    ref,ref_type:"branch",sha,workflow_sha:sha,
    workflow_ref:repository+"/"+workflow+"@"+ref,
    event_name:"workflow_dispatch",run_id:runId,run_attempt:"1",
    ...claimOverrides
  })).toString("base64url");
  const data=header+"."+payload;
  return data+"."+sign("RSA-SHA256",Buffer.from(data),
    key.privateKey).toString("base64url");
}
const env={
  GITHUB_ACTIONS:"true",GITHUB_EVENT_NAME:"workflow_dispatch",
  GITHUB_RUN_ATTEMPT:"1",GITHUB_REPOSITORY:repository,GITHUB_REF:ref,
  GITHUB_WORKFLOW_REF:repository+"/"+workflow+"@"+ref,
  GITHUB_SHA:sha,GITHUB_RUN_ID:runId
};
const event={
  repository:{full_name:repository},ref,
  inputs:{authorization:"I AUTHORIZE GEMINI API CHARGES",
    model:"gemini-3.8-flash",max_model_turns:"12",
    max_output_tokens:"16000",max_model_call_ms:"120000"}
};

async function fixture(t){
  const home=await mkdtemp(join(tmpdir(),"engineer-oidc-unified-"));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const secrets=join(home,"private"),replays=join(home,"replays"),
    admissions=join(home,"admissions"),receipts=join(home,"receipts");
  for(const dir of [secrets,replays,admissions,receipts])
    await mkdir(dir,{mode:0o700});
  const sandbox={};
  runInNewContext(readFileSync(new URL("../../../workflow-ui/mock-plan.js",
    import.meta.url),"utf8"),sandbox);
  const plan=JSON.parse(JSON.stringify(sandbox.DELEGATION_MOCK_PLAN));
  const planFile=join(secrets,"plan.json"),keyFile=join(secrets,"key.pem");
  const signing=generateKeyPairSync("ed25519");
  const publicKeyPem=signing.publicKey.export({
    format:"pem",type:"spki"
  }).toString();
  await writeFile(planFile,JSON.stringify(plan),{mode:0o600});
  await writeFile(keyFile,signing.privateKey.export({
    format:"pem",type:"pkcs8"
  }),{mode:0o600});
  const salt=randomBytes(16),password="offline-engineer-secret";
  const did="did:thesis:software-engineer",keyId="engineer-host-test";
  const config={
    approval:{
      engineerDid:did,keyId,trustedPlanFile:planFile,
      expectedSessionId:plan.session_id,
      expectedBaseRevision:plan.base_revision,
      repository:plan.repository,privateKeyFile:keyFile,
      publicKeyPem,receiptDirectory:receipts,
      passwordSaltHex:salt.toString("hex"),
      passwordScryptHex:scryptSync(password,salt,64).toString("hex")
    },
    oidc:{
      pinned:{repository,ref,workflowPath:workflow,sourceSha:sha},
      trust:{expectedAudience:aud,expectedSubject:subject,
        expectedRepositoryId:repositoryId,expectedOwnerId:ownerId},
      githubApiToken:"offline-test-actions-read",
      replayDirectory:replays,admissionDirectory:admissions,
      hmacSecret:randomBytes(32),
      githubApiFetchFn:runLookup,oidcJwksFetchFn:issuer
    },approvalPort:0,oidcPort:0
  };
  return {plan,password,did,keyId,publicKeyPem,receipts,replays,admissions,config};
}

test("same persistent Engineer session holds separate real-verified OIDC intake and signed human approval",async t=>{
  const f=await fixture(t);
  // Separate trusted identities: code SHA is never substituted for Gitea.
  assert.notEqual(f.config.oidc.pinned.sourceSha,
    f.config.approval.expectedBaseRevision);
  const host=await startTrustedEngineerLocalHost(f.config);
  t.after(()=>host.close());
  assert.match(host.engineerUrl,/^http:\/\/127\.0\.0\.1:\d+$/);
  assert.match(host.oidcAdmissionEndpoint,
    /^http:\/\/127\.0\.0\.1:\d+\/v1\/trusted\/github\/oidc-admission$/);
  const intake=body=>fetch(host.oidcAdmissionEndpoint,{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify(body)
  });
  const fake=await intake({env,event,oidcJwt:jwt({sub:"attacker"})});
  assert.equal(fake.status,403);
  assert.equal((await readdir(f.admissions)).length,0);
  const accepted=await intake({env,event,oidcJwt:jwt()});
  assert.equal(accepted.status,200);
  const data=await accepted.json();
  assert.equal(data.engineer_approval,"not_checked");
  assert.equal(data.gemini_calls,0);
  assert.equal((await readdir(f.admissions)).length,1);
  assert.equal((await readdir(f.replays)).length,1);

  // Even authenticated CI cannot approve a plan through either endpoint.
  assert.equal((await fetch(host.engineerUrl+"/api/plan")).status,401);
  const login=await fetch(host.engineerUrl+"/api/login",{
    method:"POST",
    headers:{"content-type":"application/json",origin:host.engineerUrl},
    body:JSON.stringify({password:f.password})
  });
  assert.equal(login.status,200);
  const cookie=login.headers.get("set-cookie").split(";")[0];
  const info=await (await fetch(host.engineerUrl+"/api/plan",{
    headers:{cookie}
  })).json();
  const approve=await fetch(host.engineerUrl+"/api/approve",{
    method:"POST",headers:{
      "content-type":"application/json",origin:host.engineerUrl,
      cookie,"x-csrf-token":info.csrf_token
    },
    body:JSON.stringify({
      plan_digest:planDigest(f.plan),approved_permission_ids:["p1"],
      confirmation:"APPROVE "+planDigest(f.plan)
    })
  });
  assert.equal(approve.status,201);
  const verified=await new SignedEngineerApprovalFileStore({
    directory:f.receipts,engineerDid:f.did,
    trustedKeys:{[f.keyId]:{
      engineer_did:f.did,public_key_pem:f.publicKeyPem
    }}
  }).loadAuthenticatedApproval(f.plan.session_id);
  assert.deepEqual(verified.approval.approved_permission_ids,["p1"]);

  const consumed=await host.consumeAuthenticatedRun(runId);
  assert.equal(consumed.session_id,f.plan.session_id);
  assert.equal(consumed.source_sha,sha);
  assert.equal(consumed.model_name,"gemini-3.8-flash");
  assert.equal(consumed.status,"github_oidc_admitted_only_not_engineer_approved");
  assert.ok(!("approved_permission_ids" in consumed));
  await assert.rejects(host.consumeAuthenticatedRun(runId),/already consumed/);
  // No Gemini key was provided; no root issuance or inference is possible.
  await host.close();
  assert.throws(()=>host.consumeAuthenticatedRun(runId),/host closed/);
});

test("host rejects insecure persistent directories and never starts unsafe ports",async t=>{
  const f=await fixture(t);
  await assert.rejects(startTrustedEngineerLocalHost({
    ...f.config,oidc:{...f.config.oidc,admissionDirectory:f.replays}
  }),/separate owner-only/);
  await assert.rejects(startTrustedEngineerLocalHost({
    ...f.config,oidcPort:65536
  }),/independently pinned/);
  await assert.rejects(startTrustedEngineerLocalHost({
    ...f.config,oidc:{...f.config.oidc,hmacSecret:Buffer.from("bad")}
  }),/independently pinned/);
});
