import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign,randomBytes,scryptSync} from "node:crypto";
import {mkdtemp,mkdir,writeFile,rm,readdir} from "node:fs/promises";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createServer} from "node:http";
import {createTrustedPlanIpcServer}
  from "../../gateway/src/trusted-plan-ipc.ts";
import {TrustedOperationalRecoveryStore}
  from "../../../packages/orchestrator-runtime/src/trusted-operational-recovery-store.ts";
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
  assert.throws(()=>host.startReviewedHandoff({runId}),
    /startup operational recovery mandatory/);
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


test("mTLS private submission authenticates runner transport plus OIDC but never Engineer approval",async t=>{
  const f=await fixture(t);
  // Disposable local-only certificate fixture. Deployment requires separate
  // server/client keys, a protected CA and a private route, never this cert.
  const {execFileSync}=await import("node:child_process");
  const {X509Certificate}=await import("node:crypto");
  const {dirname}=await import("node:path");
  // CA and three independent leaves. The untrusted client is CA-signed,
  // proving that mTLS trust alone is insufficient without the leaf pin.
  const tlsDir=join(dirname(f.admissions),"tls-fixtures");
  await mkdir(tlsDir,{mode:0o700});
  const cmd=(args)=>execFileSync("openssl",args,{stdio:"ignore",cwd:tlsDir});
  cmd(["req","-x509","-newkey","rsa:2048","-nodes","-days","1",
    "-subj","/CN=Thesis disposable CA","-addext",
    "basicConstraints=critical,CA:TRUE","-keyout","ca.key",
    "-out","ca.pem"]);
  const {writeFileSync}=await import("node:fs");
  const signed=(role,subject,usage,extra="")=>{
    cmd(["req","-newkey","rsa:2048","-nodes","-subj",subject,
      "-keyout",role+".key","-out",role+".csr"]);
    writeFileSync(join(tlsDir,role+".ext"),
      "basicConstraints=critical,CA:FALSE\n"+
      "keyUsage=critical,digitalSignature,keyEncipherment\n"+
      "extendedKeyUsage="+usage+"\n"+
      extra,{mode:0o600});
    cmd(["x509","-req","-days","1","-in",role+".csr",
      "-CA","ca.pem","-CAkey","ca.key","-CAcreateserial",
      "-out",role+".pem","-extfile",role+".ext"]);
    return {
      cert:readFileSync(join(tlsDir,role+".pem"),"utf8"),
      key:readFileSync(join(tlsDir,role+".key"),"utf8")
    };
  };
  const server=signed("server","/CN=127.0.0.1","serverAuth",
    "subjectAltName=IP:127.0.0.1\n");
  const client=signed("trusted","/CN=trusted-runner","clientAuth");
  const rogue=signed("rogue","/CN=rogue-runner","clientAuth");
  const ca=readFileSync(join(tlsDir,"ca.pem"),"utf8");
  const expectedClientFingerprint256=
    new X509Certificate(client.cert).fingerprint256;
  const tls={ca,cert:client.cert,key:client.key};
  const serverTls={ca,cert:server.cert,key:server.key,
    expectedClientFingerprint256};
  const host=await startTrustedEngineerLocalHost({
    ...f.config,oidc:{...f.config.oidc,tls:serverTls}
  });
  t.after(()=>host.close());
  assert.match(host.oidcAdmissionEndpoint,
    /^https:\/\/127\.0\.0\.1:\d+\/v1\/trusted\/github\/oidc-admission$/);
  const {submitTrustedGithubOidcFromRunner}=await import(
    "../../../packages/orchestrator-runtime/src/trusted-github-oidc-submit.ts");
  const submission={
    tokenRequestUrl:"https://pipelines.actions.githubusercontent.com/oidc",
    tokenRequestBearer:"offline-local-oidc-bearer",audience:aud,
    intakeUrl:host.oidcAdmissionEndpoint,tls,env,event,
    oidcFetchFn:(async(url,opts)=>{
      assert.equal(url.searchParams.get("audience"),aud);
      assert.equal(opts.headers.authorization,"Bearer offline-local-oidc-bearer");
      return new Response(JSON.stringify({value:jwt()}),{status:200});
    })
  };
  await assert.rejects(submitTrustedGithubOidcFromRunner({
    ...submission,tokenRequestUrl:"https://attacker.example/token"
  }),/admission denied/);
  await assert.rejects(submitTrustedGithubOidcFromRunner({
    ...submission,tokenRequestUrl:"https://pipelines.actions.githubusercontent.com:8443/token"
  }),/admission denied/);
  // GitHub supplies the request URL at runtime: all recognized GitHub
  // infrastructure hosts may be used without broad arbitrary-URL fetches.
  for(const requestHost of [
    "token.actions.githubusercontent.com",
    "vstoken.actions.githubusercontent.com"
  ]){
    let tokenRequested=false;
    await assert.rejects(submitTrustedGithubOidcFromRunner({
      ...submission,
      tokenRequestUrl:"https://"+requestHost+"/oidc?api-version=2.0",
      tls:{...tls,ca:"invalid-ca"},
      oidcFetchFn:(async(url,options)=>{
        tokenRequested=true;
        assert.equal(url.hostname,requestHost);
        assert.equal(url.searchParams.get("audience"),aud);
        assert.equal(options.redirect,"error");
        return new Response(JSON.stringify({value:jwt()}),{status:200});
      })
    }),/admission denied/);
    assert.equal(tokenRequested,true);
  }
  assert.equal((await readdir(f.replays)).length,0);
  await assert.rejects(submitTrustedGithubOidcFromRunner({
    ...submission,tls:{...tls,ca:"invalid-ca"}
  }),/admission denied/);
  assert.equal((await readdir(f.replays)).length,0);
  // This cert is signed by the SAME CA but cannot impersonate the pinned
  // client. TLS accepts it; the Engineer admission boundary must reject it.
  await assert.rejects(submitTrustedGithubOidcFromRunner({
    ...submission,tls:{ca,cert:rogue.cert,key:rogue.key}
  }),/admission denied/);
  assert.equal((await readdir(f.replays)).length,0);
  const result=await submitTrustedGithubOidcFromRunner(submission);
  assert.deepEqual(result,{
    status:"authenticated_only_not_engineer_approved",
    run_id:runId,source_sha:sha
  });
  assert.equal((await readdir(f.replays)).length,1);
  // The second valid JWT is new, but the same workflow RUN is one-use.
  await assert.rejects(submitTrustedGithubOidcFromRunner(submission),
    /admission denied/);
  assert.equal((await readdir(f.replays)).length,2);
  assert.equal((await readdir(f.admissions)).length,1);
  assert.equal((await fetch(host.engineerUrl+"/api/plan")).status,401);
  const record=await host.consumeAuthenticatedRun(runId);
  assert.equal(record.session_id,f.plan.session_id);
  assert.ok(!("approved_permission_ids" in record));
  assert.ok(!("operational_root_id" in record));
});


test("strict Engineer bootstrap completes real private IPC + Adapter recovery before listeners and forbids reused sessions",async t=>{
  const f=await fixture(t);
  const home=await mkdtemp(join(tmpdir(),"engineer-real-bootstrap-"));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const recoveryDir=join(home,"recovery"),ipcDir=join(home,"ipc");
  for(const dir of [recoveryDir,ipcDir])
    await mkdir(dir,{mode:0o700});
  const secretFile=join(ipcDir,"secret.hex"),socketPath=join(ipcDir,"plan.sock");
  await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",
    {mode:0o600});
  const oldSession="session-orphan-crashed-2026";
  const rootId="urn:operational:old-orphan";
  const journal=new TrustedOperationalRecoveryStore(recoveryDir);
  await journal.recordIntent({
    sessionId:oldSession,baseRevision:f.plan.base_revision,
    credentialId:rootId
  });
  const retired=[];
  const ipc=await createTrustedPlanIpcServer({
    socketPath,secretFile,
    plans:{
      operationalLeaseConfigured:()=>true,
      retireSession:id=>{retired.push(id);}
    }
  });
  await ipc.start();
  t.after(()=>ipc.close());
  let shouldFail=true,adapterCalls=0;
  const adapter=createServer(async(req,res)=>{
    const chunks=[];
    for await(const chunk of req)chunks.push(chunk);
    const request=JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert.equal(req.url,"/v1/credentials/status");
    assert.equal(req.method,"POST");
    assert.equal(req.headers.authorization,"Bearer offline-adapter-token");
    assert.deepEqual(request,{credential_id:rootId,status_set:true});
    adapterCalls++;
    res.setHeader("content-type","application/json");
    if(shouldFail){
      res.writeHead(503).end(JSON.stringify({error:"revocation-unconfirmed"}));
      return;
    }
    res.writeHead(200).end(JSON.stringify({
      credential_id:rootId,status_purpose:"revocation",status_set:true
    }));
  });
  await new Promise(resolve=>adapter.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>adapter.close(resolve)));
  const adapterBaseUrl="http://127.0.0.1:"+adapter.address().port;
  const {startTrustedEngineerRecoveringHost}=await import(
    "../src/trusted-engineer-host.mjs");
  const config={...f.config,recovery:{
    directory:recoveryDir,gatewaySocketPath:socketPath,
    gatewaySecretFile:secretFile,adapterBaseUrl,
    adapterToken:"offline-adapter-token"
  }};
  // Boot is rejected while the real Adapter cannot confirm revocation.
  await assert.rejects(startTrustedEngineerRecoveringHost(config),
    /manual reconciliation required/);
  assert.equal(adapterCalls,1);
  assert.deepEqual(retired,[oldSession]);
  assert.equal((await journal.pending()).length,1);
  // Retrying the *same* cold boot after Adapter recovery is allowed. No
  // previous OIDC admission or human approval is replayed automatically.
  shouldFail=false;
  const host=await startTrustedEngineerRecoveringHost(config);
  t.after(()=>host.close());
  assert.equal(adapterCalls,2);
  assert.deepEqual(retired,[oldSession,oldSession]);
  await journal.assertClean();
  assert.equal(host.operationalRecoveryStore instanceof
    TrustedOperationalRecoveryStore,true);
  assert.match(host.engineerUrl,/^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal((await fetch(host.engineerUrl+"/api/plan")).status,401);
  await assert.rejects(startTrustedEngineerRecoveringHost({
    ...config,approval:{
      ...config.approval,expectedSessionId:oldSession
    }
  }),/reconciled session cannot be reused/);
  assert.equal(adapterCalls,2);
  assert.throws(()=>host.startReviewedHandoff({runId}),
    /Cannot read properties|recovery journal/);
  await host.close();
});
