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
import {TrustedPlanningRecoveryStore}
  from "../../../packages/orchestrator-runtime/src/trusted-planning-recovery-store.ts";
import {startTrustedEngineerLocalHost}
  from "../src/trusted-engineer-host.mjs";
import {SignedEngineerApprovalFileStore}
  from "../../../packages/orchestrator-runtime/src/signed-approval-store.ts";
import {planDigest} from "../../../packages/plan-contracts/src/plan.mjs";
import {signTrustedPlanningCheckpoint}
  from "../../../packages/orchestrator-runtime/src/trusted-planning-checkpoint.ts";
import {SignedPlanningCheckpointFileStore}
  from "../../../packages/orchestrator-runtime/src/trusted-planning-checkpoint-store.ts";

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


async function disposableMtls(tlsDir,serverIp="127.0.0.1"){
  const {execFileSync}=await import("node:child_process");
  const {X509Certificate}=await import("node:crypto");
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
  const server=signed("server","/CN="+serverIp,"serverAuth",
    "subjectAltName=IP:"+serverIp+"\n");
  const client=signed("trusted","/CN=trusted-runner","clientAuth");
  const rogue=signed("rogue","/CN=rogue-runner","clientAuth");
  const ca=readFileSync(join(tlsDir,"ca.pem"),"utf8");
  const tls={ca,cert:client.cert,key:client.key,
    expectedServerFingerprint256:
      new X509Certificate(server.cert).fingerprint256};
  const serverTls={ca,cert:server.cert,key:server.key,
    expectedClientFingerprint256:
      new X509Certificate(client.cert).fingerprint256};
  return {ca,client,rogue,tls,serverTls,X509Certificate};
}
test("mTLS private submission authenticates runner transport plus OIDC but never Engineer approval",async t=>{
  const f=await fixture(t);
  // Disposable local-only certificate fixture. Deployment requires separate
  // server/client keys, a protected CA and a private route, never this cert.
  const {dirname}=await import("node:path");
  const tlsDir=join(dirname(f.admissions),"tls-fixtures");
  const {ca,rogue,tls,serverTls,X509Certificate}=
    await disposableMtls(tlsDir);
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
  let unpinnedOidcRequests=0;
  await assert.rejects(submitTrustedGithubOidcFromRunner({
    ...submission,tls:{...tls,expectedServerFingerprint256:""},
    oidcFetchFn:async()=>{
      unpinnedOidcRequests++;
      throw Error("OIDC should not be fetched");
    }
  }),/admission denied/);
  assert.equal(unpinnedOidcRequests,0);
  await assert.rejects(submitTrustedGithubOidcFromRunner({
    ...submission,tls:{...tls,expectedServerFingerprint256:
      new X509Certificate(rogue.cert).fingerprint256}
  }),/admission denied/);
  assert.equal((await readdir(f.replays)).length,0);
  await assert.rejects(submitTrustedGithubOidcFromRunner({
    ...submission,tls:{...tls,ca:"invalid-ca"}
  }),/admission denied/);
  assert.equal((await readdir(f.replays)).length,0);
  // This cert is signed by the SAME CA but cannot impersonate the pinned
  // client. TLS accepts it; the Engineer admission boundary must reject it.
  await assert.rejects(submitTrustedGithubOidcFromRunner({
    ...submission,tls:{...tls,cert:rogue.cert,key:rogue.key}
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
  const checkpointDir=join(home,"checkpoints");
  const planningDir=join(home,"planning-recovery");
  for(const dir of [recoveryDir,ipcDir,checkpointDir,planningDir])
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
  const {serverTls}=await disposableMtls(join(home,"mtls"));
  const config={...f.config,
    oidc:{...f.config.oidc,tls:serverTls},
    recovery:{
      directory:recoveryDir,planningDirectory:planningDir,
      gatewaySocketPath:socketPath,
      gatewaySecretFile:secretFile,adapterBaseUrl,
      adapterToken:"offline-adapter-token"
    }
  };
  // Exercise the actual operator-owned JSON + local-file bootstrap,
  // rather than calling the recovering host with in-memory fixtures only.
  const {startConfiguredTrustedEngineerService}=await import(
    "../src/trusted-engineer-service.mjs");
  const ownerConfigFile=join(home,"operator-service.json");
  const ownerFiles={
    public:join(home,"engineer-public.pem"),
    backendPublic:join(home,"planning-backend-public.pem"),
    github:join(home,"github-rest.token"),
    hmac:join(home,"admission-hmac.hex"),
    ca:join(home,"admission-ca.pem"),
    cert:join(home,"admission-server.pem"),
    key:join(home,"admission-server.key"),
    adapter:join(home,"adapter-bearer.token")
  };
  const backend=generateKeyPairSync("ed25519");
  const backendKeyId="active-planning-backend";
  const backendPublicPem=backend.publicKey.export({
    format:"pem",type:"spki"
  }).toString();
  const ticket=signTrustedPlanningCheckpoint({
    snapshot:{session_id:f.plan.session_id,
      repository:f.plan.repository,base_revision:f.plan.base_revision,
      directories:[""],files:[]},
    expectedWorkBranch:"feature/account-suspension",
    proposal:{status:"unapproved_proposal",plan:f.plan,
      digest:planDigest(f.plan),verified_source_reads:1},
    keyId:backendKeyId,
    privateKeyPem:backend.privateKey.export({
      format:"pem",type:"pkcs8"
    }).toString(),
    issuedAt:new Date().toISOString(),
    expiresAt:new Date(Date.now()+600000).toISOString()
  });
  const checkpoints=new SignedPlanningCheckpointFileStore({
    directory:checkpointDir,
    trust:{
      trustedKeys:{[backendKeyId]:{public_key_pem:backendPublicPem}},
      expectedSessionId:f.plan.session_id,
      expectedRepository:f.plan.repository,
      expectedBaseRevision:f.plan.base_revision,
      expectedWorkBranch:"feature/account-suspension"
    }
  });
  await checkpoints.persistVerified(ticket);
  const operationalConfig={...config,approval:{
    ...config.approval,planningCheckpointStore:checkpoints
  }};
  for(const [file,data] of [
    [ownerFiles.public,config.approval.publicKeyPem],
    [ownerFiles.backendPublic,backendPublicPem],
    [ownerFiles.github,config.oidc.githubApiToken],
    [ownerFiles.hmac,config.oidc.hmacSecret.toString("hex")],
    [ownerFiles.ca,config.oidc.tls.ca],
    [ownerFiles.cert,config.oidc.tls.cert],
    [ownerFiles.key,config.oidc.tls.key],
    [ownerFiles.adapter,config.recovery.adapterToken]
  ])await writeFile(file,data,{mode:0o600});
  const {publicKeyPem,...reviewFields}=config.approval;
  const {githubApiToken,hmacSecret,tls,githubApiFetchFn,
    oidcJwksFetchFn,...oidcFields}=config.oidc;
  const {adapterToken,...recoveryFields}=config.recovery;
  const fileConfig={
    approval:{...reviewFields,publicKeyPemFile:ownerFiles.public,
      checkpoint:{
        directory:checkpointDir,backendKeyId,
        backendPublicKeyPemFile:ownerFiles.backendPublic,
        expectedWorkBranch:"feature/account-suspension"
      }},
    oidc:{...oidcFields,
      githubApiTokenFile:ownerFiles.github,
      hmacSecretHexFile:ownerFiles.hmac,
      tls:{caFile:ownerFiles.ca,certFile:ownerFiles.cert,
        keyFile:ownerFiles.key,
        expectedClientFingerprint256:tls.expectedClientFingerprint256}},
    recovery:{...recoveryFields,adapterTokenFile:ownerFiles.adapter},
    approvalPort:0,oidcPort:0
  };
  await writeFile(ownerConfigFile,JSON.stringify(fileConfig),{mode:0o600});
  // A production-like recovering host must NEVER silently fall back to
  // unauthenticated plaintext, even if the IPC and Adapter are configured.
  await assert.rejects(startTrustedEngineerRecoveringHost({
    ...config,oidc:{...config.oidc,tls:undefined}
  }),/requires pinned mutual TLS/);
  assert.equal(adapterCalls,0);
  // A direct in-process recovering bootstrap cannot bypass the verified
  // Planning checkpoint that the strict file loader already requires.
  await assert.rejects(startTrustedEngineerRecoveringHost(config),
    /requires verified backend-signed Planning checkpoint/);
  assert.equal(adapterCalls,0);
  // Boot is rejected while the real Adapter cannot confirm revocation.
  await assert.rejects(startConfiguredTrustedEngineerService(ownerConfigFile),
    /manual reconciliation required/);
  assert.equal(adapterCalls,1);
  assert.deepEqual(retired,[oldSession]);
  assert.equal((await journal.pending()).length,1);
  // Retrying the *same* cold boot after Adapter recovery is allowed. No
  // previous OIDC admission or human approval is replayed automatically.
  shouldFail=false;
  const host=await startConfiguredTrustedEngineerService(ownerConfigFile);
  t.after(()=>host.close());
  assert.equal(adapterCalls,2);
  assert.deepEqual(retired,[oldSession,oldSession]);
  await journal.assertClean();
  assert.equal(host.operationalRecoveryStore instanceof
    TrustedOperationalRecoveryStore,true);
  assert.match(host.engineerUrl,/^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal((await fetch(host.engineerUrl+"/api/plan")).status,401);
  // A separate root session cannot borrow this checkpoint, even if the
  // signed ticket itself is valid and the operator controls the config.
  await assert.rejects(startTrustedEngineerRecoveringHost({
    ...operationalConfig,approval:{
      ...operationalConfig.approval,expectedSessionId:oldSession
    }
  }),/checkpoint differs from pinned Engineer session/);
  // Retain an independent assertion that successful revocation tombstones
  // cannot be used for a later trusted Coordinator session.
  await assert.rejects(journal.assertFreshSession(oldSession),
    /reconciled session cannot be reused/);
  assert.equal(adapterCalls,2);
  assert.throws(()=>host.startReviewedHandoff({runId}),
    /trusted Coordinator recovery journal required/);
  await host.close();
});



test("Engineer host refuses wildcard OIDC binding and keeps Engineer login private",async t=>{
  const f=await fixture(t);
  await assert.rejects(startTrustedEngineerLocalHost({
    ...f.config,oidc:{...f.config.oidc,bindAddress:"0.0.0.0"}
  }),/public\/wildcard interface prohibited/);
  await assert.rejects(startTrustedEngineerLocalHost({
    ...f.config,oidc:{...f.config.oidc,bindAddress:"10.10.0.5"}
  }),/requires pinned mTLS/);
  const host=await startTrustedEngineerLocalHost({
    ...f.config,oidc:{...f.config.oidc,bindAddress:"127.0.0.1"}
  });
  t.after(()=>host.close());
  assert.match(host.engineerUrl,/^http:\/\/127\.0\.0\.1:\d+$/);
  assert.match(host.oidcAdmissionEndpoint,
    /^http:\/\/127\.0\.0\.1:\d+\/v1\/trusted\/github\/oidc-admission$/);
  assert.equal((await fetch(host.engineerUrl+"/api/plan")).status,401);
});


test("two OS processes exchange pinned private-IP mTLS OIDC and reject replay or server drift",async t=>{
  const {networkInterfaces}=await import("node:os");
  const interfaces=Object.values(networkInterfaces()).flat().filter(Boolean);
  const selected=interfaces.find(x=>{
    if(x.family!=="IPv4"||x.internal)return false;
    const [first,second]=x.address.split(".").map(Number);
    return first===10||first===172&&second>=16&&second<=31||
      first===192&&second===168;
  });
  if(!selected){
    // Do not disguise loopback as a successfully tested private network.
    t.skip("No OS-assigned RFC1918 interface; cross-process private route not exercised");
    return;
  }
  const f=await fixture(t);
  const home=await mkdtemp(join(tmpdir(),"private-ip-oidc-"));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const {ca,tls,serverTls,rogue,X509Certificate}=
    await disposableMtls(join(home,"certificates"),selected.address);
  const actualWorkflow=".github/workflows/trusted-private-github-admission.yml";
  const workflowRef=repository+"/"+actualWorkflow+"@"+ref;
  const eventPrivate={...event};
  const signedJwt=jwt({workflow_ref:workflowRef});
  const hostConfig={
    ...f.config,
    oidc:{
      ...f.config.oidc,
      pinned:{...f.config.oidc.pinned,workflowPath:actualWorkflow},
      bindAddress:selected.address,tls:serverTls,
      githubApiFetchFn:async()=>new Response(JSON.stringify({
        id:Number(runId),event:"workflow_dispatch",run_attempt:1,
        status:"in_progress",head_sha:sha,
        head_branch:ref.slice("refs/heads/".length),path:actualWorkflow,
        head_repository:{full_name:repository},
        created_at:new Date().toISOString()
      }),{status:200})
    }
  };
  const host=await startTrustedEngineerLocalHost(hostConfig);
  t.after(()=>host.close());
  assert.match(host.engineerUrl,/^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(new URL(host.oidcAdmissionEndpoint).hostname,selected.address);
  assert.equal((await fetch(host.engineerUrl+"/api/plan")).status,401);

  const storeDir=join(home,"runner-secret-store");
  await mkdir(storeDir,{mode:0o700});
  const paths={
    config:join(storeDir,"client.json"),
    ca:join(storeDir,"ca.pem"),
    cert:join(storeDir,"client.pem"),
    key:join(storeDir,"client.key"),
    event:join(storeDir,"github-event.json"),
    payload:join(storeDir,"offline-fixture.json")
  };
  for(const [target,textValue] of [
    [paths.ca,ca],[paths.cert,tls.cert],[paths.key,tls.key],
    [paths.event,JSON.stringify(eventPrivate)]
  ])await writeFile(target,textValue,{mode:0o600});
  const settings={
    expectedRepository:repository,expectedRef:ref,
    expectedWorkflowPath:actualWorkflow,expectedSourceSha:sha,
    intakeUrl:host.oidcAdmissionEndpoint,
    audience:aud,
    expectedServerFingerprint256:tls.expectedServerFingerprint256,
    caFile:paths.ca,clientCertFile:paths.cert,clientKeyFile:paths.key
  };
  await writeFile(paths.config,JSON.stringify(settings),{mode:0o600});
  const environment={
    ...env,GITHUB_WORKFLOW_REF:workflowRef,
    GITHUB_EVENT_PATH:paths.event,
    DELEGATION_RUNNER_OIDC_CONFIG:paths.config,
    ACTIONS_ID_TOKEN_REQUEST_URL:
      "https://token.actions.githubusercontent.com/oidc",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN:"offline-only-token-not-real"
  };
  await writeFile(paths.payload,JSON.stringify({
    environment,oidcJwt:signedJwt
  }),{mode:0o600});
  const {promisify}=await import("node:util");
  const {execFile}=await import("node:child_process");
  const run=promisify(execFile);
  const child=new URL("./fixtures/private-oidc-child.mjs",import.meta.url);
  const options={env:{
    ...process.env,PRIVATE_OIDC_OFFLINE_FIXTURE:paths.payload
  },timeout:20000,maxBuffer:8192};
  const {stdout,stderr}=await run(process.execPath,[
    "--experimental-strip-types",child.pathname
  ],options);
  // Node 22 may print its standard experimental type-stripping warning.
  // The runner itself must not leak any private token, key or denial text.
  assert.doesNotMatch(stderr,/Offline private runner admission denied|offline-only-token-not-real|disposable-key|uncaught exception/iu);
  assert.deepEqual(JSON.parse(stdout),{
    status:"authenticated_only_not_engineer_approved",
    run_id:runId,source_sha:sha,
    engineer_approval:"not_checked",
    operational_credential:"not_issued",gemini_calls:0
  });
  assert.equal((await readdir(f.admissions)).length,1);
  assert.equal((await readdir(f.replays)).length,1);
  // Restart the Engineer process: the one-use job and durable admission
  // receipt must retain their meaning after a new listener comes online.
  await host.close();
  const restarted=await startTrustedEngineerLocalHost(hostConfig);
  t.after(()=>restarted.close());
  assert.equal((await fetch(restarted.engineerUrl+"/api/plan")).status,401);
  const afterRestart={...settings,
    intakeUrl:restarted.oidcAdmissionEndpoint};
  await writeFile(paths.config,JSON.stringify(afterRestart),{mode:0o600});
  await assert.rejects(run(process.execPath,[
    "--experimental-strip-types",child.pathname
  ],options),/Command failed/);
  assert.equal((await readdir(f.admissions)).length,1);
  // New runner-side pin cannot be replaced with another CA-signed leaf.
  await writeFile(paths.config,JSON.stringify({
    ...afterRestart,expectedServerFingerprint256:
      new X509Certificate(rogue.cert).fingerprint256
  }),{mode:0o600});
  await assert.rejects(run(process.execPath,[
    "--experimental-strip-types",child.pathname
  ],options),/Command failed/);
  assert.equal((await readdir(f.admissions)).length,1);
  const record=await restarted.consumeAuthenticatedRun(runId);
  assert.equal(record.session_id,f.plan.session_id);
  assert.ok(!("approved_permission_ids" in record));
  assert.ok(!("operational_root_id" in record));
});


test("Engineer cold startup requires Gateway Planning retirement and Rust revocation",async t=>{
  const f=await fixture(t);
  const home=await mkdtemp(join(tmpdir(),"planning-cold-restart-"));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const operational=join(home,"operational"),planning=join(home,"planning");
  await mkdir(operational,{mode:0o700});
  await mkdir(planning,{mode:0o700});
  const journal=new TrustedPlanningRecoveryStore(planning);
  const crashed="crashed-planning-before-checkpoint";
  const root="urn:provisional:possibly-issued";
  await journal.recordIntent({
    sessionId:crashed,baseRevision:f.plan.base_revision,credentialId:root
  });
  const actions=[];
  let blockGateway=true;
  const gateway={
    async retireSession(){throw Error("unexpected operational tombstone");},
    async retirePlanning(id){
      actions.push("planning:"+id);
      if(blockGateway)throw Error("Gateway retirement unconfirmed");
    }
  };
  const credentials={
    async revokeRoot(id){actions.push("rust:"+id);}
  };
  const config={...f.config,recovery:{
    directory:operational,gateway,credentials,
    planning:{directory:planning,gateway,credentials}
  }};
  await assert.rejects(startTrustedEngineerLocalHost(config),
    /manual reconciliation required/);
  assert.deepEqual(actions,["planning:"+crashed,"rust:"+root]);
  assert.equal((await journal.pending()).length,1);
  blockGateway=false;
  const host=await startTrustedEngineerLocalHost(config);
  t.after(()=>host.close());
  assert.deepEqual(actions,[
    "planning:"+crashed,"rust:"+root,
    "planning:"+crashed,"rust:"+root
  ]);
  await journal.assertClean();
  await assert.rejects(journal.assertFreshSession(crashed),
    /retired session cannot be reused/);
  assert.equal(host.planningRecoveryStore instanceof
    TrustedPlanningRecoveryStore,true);
  assert.equal((await fetch(host.engineerUrl+"/api/plan")).status,401);
  await host.close();
});
