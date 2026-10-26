import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFileSync,spawnSync} from "node:child_process";
import {verifyR5ScriptedEngineerHostReadiness as check,
  verifyProtectedR5EngineerHostConfig}
  from "../r5-scripted-host-deployment-preflight.mjs";
import {loadTrustedEngineerServiceConfig,
  prepareConfiguredOwnerEngineerBootstrap,
  prepareConfiguredR5ScriptedEngineerBootstrap}
  from "../../apps/orchestrator/src/trusted-engineer-service.mjs";
import {R5ScriptedNoProviderPlanningModel}
  from "../../packages/orchestrator-runtime/src/trusted-r5-scripted-planning-model.ts";

const SHA="a".repeat(40);
const REF="refs/heads/refactor/post-prof-plan-contracts-20261021";
const REPO="DarkGh0st03/delegation";
const FP1=Array(32).fill("11").join(":");
const FP2=Array(32).fill("22").join(":");
function openssl(args){
  execFileSync("openssl",args,{stdio:"ignore",timeout:12000});
}
async function fixture(){
  const dir=await mkdtemp(join(tmpdir(),"r5-host-offline-config-"));
  const f=name=>join(dir,name);
  try{
    openssl(["req","-x509","-newkey","ec","-pkeyopt",
      "ec_paramgen_curve:P-256","-nodes","-keyout",f("ca.key"),
      "-out",f("ca.crt"),"-days","2","-subj","/CN=OfflineR5TestCA",
      "-addext","basicConstraints=critical,CA:TRUE",
      "-addext","keyUsage=critical,keyCertSign,cRLSign"]);
    openssl(["req","-new","-newkey","ec","-pkeyopt",
      "ec_paramgen_curve:P-256","-nodes","-keyout",f("host.key"),
      "-out",f("host.csr"),"-subj","/CN=10.27.10.4"]);
    await writeFile(f("host.ext"),[
      "subjectAltName=IP:10.27.10.4",
      "basicConstraints=critical,CA:FALSE",
      "keyUsage=digitalSignature,keyEncipherment",
      "extendedKeyUsage=serverAuth",""
    ].join("\n"));
    openssl(["x509","-req","-in",f("host.csr"),
      "-CA",f("ca.crt"),"-CAkey",f("ca.key"),
      "-CAcreateserial","-out",f("host.crt"),
      "-days","2","-extfile",f("host.ext")]);
    const tls={
      ca:await readFile(f("ca.crt"),"utf8"),
      cert:await readFile(f("host.crt"),"utf8"),
      key:await readFile(f("host.key"),"utf8"),
      expectedClientFingerprint256:FP1
    };
    const config={
      approvalPort:8101,oidcPort:8102,scriptedOidcPort:8103,
      oidc:{
        pinned:{repository:REPO,ref:REF,sourceSha:SHA},
        trust:{expectedAudience:"urn:paid-r5-test-audience"},
        bindAddress:"127.0.0.1",
        tls:{expectedClientFingerprint256:FP2}
      },
      scriptedOidc:{
        pinned:{repository:REPO,ref:REF,sourceSha:SHA,
          workflowPath:".github/workflows/trusted-scripted-offline-session-hold.yml"},
        trust:{
          expectedAudience:"urn:scripted-only-test-audience",
          expectedSubject:"repo:DarkGh0st03@150908952/delegation@1374168963:ref:"+REF,
          expectedRepositoryId:"1374168963",expectedOwnerId:"150908952"
        },
        bindAddress:"10.27.10.4",tls
      }
    };
    return {dir,config,close:()=>rm(dir,{recursive:true,force:true})};
  }catch(e){await rm(dir,{recursive:true,force:true});throw e;}
}
test("R5 valid pinned scripted Engineer deployment is configuration-only, never operational GO",async()=>{
  const f=await fixture();try{
    const r=check(f.config,{expectedSourceSha:SHA});
    assert.deepEqual(r,{
      status:"scripted_host_config_verified_only_not_deployed",
      source_sha:SHA,model_api_calls:0,
      active_planning_proven:false,private_runner_connected:false
    });
    assert.equal(JSON.stringify(r).includes("PRIVATE KEY"),false);
  }finally{await f.close();}
});
test("R5 refuses mismatched source, workflow, OIDC subject and independent audience",async()=>{
  const f=await fixture();try{
    for(const change of [
      x=>x.scriptedOidc.pinned.sourceSha="b".repeat(40),
      x=>x.scriptedOidc.pinned.workflowPath=".github/workflows/paid.yml",
      x=>x.scriptedOidc.pinned.repository="fake/delegation",
      x=>x.oidc.pinned.ref="refs/heads/main",
      x=>x.scriptedOidc.trust.expectedSubject="repo:someone-else",
      x=>x.scriptedOidc.trust.expectedRepositoryId="2",
      x=>x.scriptedOidc.trust.expectedAudience=x.oidc.trust.expectedAudience
    ]){
      const c=structuredClone(f.config);change(c);
      assert.throws(()=>check(c,{expectedSourceSha:SHA}),
        /R5 scripted host deployment NO-GO/);
    }
    assert.throws(()=>check(f.config,{expectedSourceSha:"invalid"}),
      /source SHA pin missing/);
  }finally{await f.close();}
});
test("R5 rejects publicly bound, colliding or cross-profile host listeners",async()=>{
  const f=await fixture();try{
    for(const change of [
      x=>x.scriptedOidc.bindAddress="8.8.8.8",
      x=>x.scriptedOidc.bindAddress="127.0.0.1",
      x=>x.oidc.bindAddress="10.27.10.3",
      x=>x.scriptedOidcPort=0,
      x=>x.scriptedOidcPort=x.approvalPort,
      x=>x.scriptedOidc.tls.expectedClientFingerprint256=FP2
    ]){
      const c=structuredClone(f.config);change(c);
      assert.throws(()=>check(c,{expectedSourceSha:SHA}),
        /R5 scripted host deployment NO-GO/);
    }
  }finally{await f.close();}
});
test("R5 rejects expired, wrong-IP, untrusted and mismatched server TLS material",async()=>{
  const f=await fixture();try{
    const late=Date.now()+5*86400000;
    assert.throws(()=>check(f.config,{expectedSourceSha:SHA,nowMs:late}),
      /not currently valid/);
    const wrongIp=structuredClone(f.config);
    wrongIp.scriptedOidc.bindAddress="10.27.10.5";
    assert.throws(()=>check(wrongIp,{expectedSourceSha:SHA}),
      /not valid for pinned private IPv4/);
    const mismatched=structuredClone(f.config);
    mismatched.scriptedOidc.tls.key=mismatched.scriptedOidc.tls.ca;
    assert.throws(()=>check(mismatched,{expectedSourceSha:SHA}),
      /invalid protected mTLS certificate or private key/);
    const alternateKey=join(f.dir,"alternate-ec.key");
    openssl(["genpkey","-algorithm","EC","-pkeyopt",
      "ec_paramgen_curve:P-256","-out",alternateKey]);
    const mismatchedValidKey=structuredClone(f.config);
    mismatchedValidKey.scriptedOidc.tls.key=await readFile(alternateKey,"utf8");
    assert.throws(()=>check(mismatchedValidKey,{expectedSourceSha:SHA}),
      /server certificate and protected private key mismatch/);
    const badCert=structuredClone(f.config);
    badCert.scriptedOidc.tls.cert="NOT A CERT";
    assert.throws(()=>check(badCert,{expectedSourceSha:SHA}),
      /invalid protected mTLS certificate or private key/);
  }finally{await f.close();}
});

test("R5 pre-Planning host preflight requires absent plan and real owner-protected settings",async()=>{
  const f=await fixture();
  try{
    const directories={};
    for(const item of [
      "approval","checkpoint","oidc-replay","oidc-admission",
      "scripted-replay","scripted-admission","recovery","planning"
    ]){
      directories[item]=join(f.dir,item);
      await mkdir(directories[item],{mode:0o700});
    }
    const file=async(name,value)=>{
      const p=join(f.dir,name);
      await writeFile(p,value,{mode:0o600});
      return p;
    };
    const privateKey=await file("engineer.key","test-private-signer");
    const publicKey=await file("engineer.pub",
      "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----");
    const backend=await file("backend.pub",
      "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----");
    const paidToken=await file("paid.token","test-readonly-token");
    const scriptedToken=await file("scripted.token","test-scripted-token");
    const paidMac=await file("paid.mac","ab".repeat(32));
    const scriptedMac=await file("scripted.mac","cd".repeat(32));
    const adapterToken=await file("adapter.token","test-adapter-token");
    const gatewaySecret=await file("gateway.secret","ef".repeat(32));
    const ca=await file("host.ca",f.config.scriptedOidc.tls.ca);
    const cert=await file("host.cert",f.config.scriptedOidc.tls.cert);
    const key=await file("host.key",f.config.scriptedOidc.tls.key);
    const plan=join(f.dir,"reviewed-plan.json");
    const configPath=join(f.dir,"engineer-service.json");
    const scripted=f.config.scriptedOidc;
    const cfg={
      approval:{
        engineerDid:"did:example:engineer",keyId:"owner-key",
        expectedSessionId:"r5-pending-session",
        expectedBaseRevision:"c".repeat(40),
        repository:{authority:"gitea.local",owner:"demo",repository:"repo"},
        receiptDirectory:directories.approval,
        trustedPlanFile:plan,privateKeyFile:privateKey,
        publicKeyPemFile:publicKey,
        passwordSaltHex:"ab".repeat(16),
        passwordScryptHex:"ab".repeat(64),
        checkpoint:{
          directory:directories.checkpoint,backendKeyId:"backend-key",
          backendPublicKeyPemFile:backend,
          expectedWorkBranch:"feature/scripted-test"
        }
      },
      oidc:{
        pinned:{repository:REPO,ref:REF,sourceSha:SHA,
          workflowPath:".github/workflows/trusted-private-github-admission.yml"},
        trust:{expectedAudience:"urn:paid-r5-test-audience",
          expectedSubject:scripted.trust.expectedSubject,
          expectedRepositoryId:"1374168963",
          expectedOwnerId:"150908952"},
        replayDirectory:directories["oidc-replay"],
        admissionDirectory:directories["oidc-admission"],
        bindAddress:"127.0.0.1",githubApiTokenFile:paidToken,
        hmacSecretHexFile:paidMac,
        tls:{caFile:ca,certFile:cert,keyFile:key,
          expectedClientFingerprint256:FP2}
      },
      scriptedOidc:{
        pinned:scripted.pinned,trust:scripted.trust,
        replayDirectory:directories["scripted-replay"],
        admissionDirectory:directories["scripted-admission"],
        bindAddress:scripted.bindAddress,
        githubApiTokenFile:scriptedToken,hmacSecretHexFile:scriptedMac,
        tls:{caFile:ca,certFile:cert,keyFile:key,
          expectedClientFingerprint256:FP1}
      },
      recovery:{
        directory:directories.recovery,
        planningDirectory:directories.planning,
        gatewaySocketPath:join(f.dir,"gateway.sock"),
        gatewaySecretFile:gatewaySecret,
        adapterBaseUrl:"http://127.0.0.1:8090",
        adapterTokenFile:adapterToken
      },
      approvalPort:8101,oidcPort:8102,scriptedOidcPort:8103
    };
    await writeFile(configPath,JSON.stringify(cfg),{mode:0o600});
    await assert.rejects(loadTrustedEngineerServiceConfig(configPath),
      /configuration denied/,
      "cold-recovery mode must refuse missing signed plan");
    const verified=await verifyProtectedR5EngineerHostConfig({
      configPath,expectedSourceSha:SHA
    });
    assert.equal(verified.status,
      "scripted_host_config_verified_only_not_deployed");
    assert.equal(verified.active_planning_proven,false);
    // Crucially, the SAME protected config must be revalidated while the
    // real owner bootstrap is prepared, not only in a separate CLI probe.
    const owner=await prepareConfiguredR5ScriptedEngineerBootstrap(configPath,{
      expectedSourceSha:SHA
    });
    assert.equal(typeof owner.start,"function");
    assert.equal(typeof owner.assemblePlanning,"function");
    assert.equal(typeof owner.planningCheckpointStore.load,"function");
    // No arbitrary constructed Planner/Coordinator, including a paid
    // provider, may skip the protected SAME-INSTANCE assembly.
    await assert.rejects(owner.start({
      planner:{model:{model:"gemini-paid"}}
    }),/requires its original assembled Planning input/);
    await assert.rejects(owner.start({
      planner:{model:{model:"gemini-paid"}}
    }),/single-use/);
    const ownerValid=await prepareConfiguredR5ScriptedEngineerBootstrap(configPath,{
      expectedSourceSha:SHA
    });
    const snapshot={session_id:"r5-pending-session",
      repository:cfg.approval.repository,
      base_revision:cfg.approval.expectedBaseRevision,
      directories:["","src","tests"],
      files:["src/backend.ts","src/frontend.ts"]};
    const model=new R5ScriptedNoProviderPlanningModel({
      snapshot,workBranch:"feature/scripted-test",
      edits:{backend:["src/backend.ts"],frontend:["src/frontend.ts"]},
      newTestFile:"tests/status.test.ts"
    });
    await assert.rejects(ownerValid.start({
      snapshot,checkpointStore:ownerValid.planningCheckpointStore,
      planner:{model,snapshot,workBranch:"feature/scripted-test"},
      coordinator:{phase:"idle"}
    }),/requires its original assembled Planning input/);
    await assert.rejects(prepareConfiguredR5ScriptedEngineerBootstrap(configPath,{
      expectedSourceSha:"invalid"
    }),/R5 scripted owner source SHA pin required/);
    await assert.rejects(prepareConfiguredR5ScriptedEngineerBootstrap(configPath,{
      expectedSourceSha:"b".repeat(40)
    }),/R5 scripted host deployment NO-GO/);
    const oldSha=cfg.scriptedOidc.pinned.sourceSha;
    cfg.scriptedOidc.pinned.sourceSha="b".repeat(40);
    cfg.oidc.pinned.sourceSha="b".repeat(40);
    await writeFile(configPath,JSON.stringify(cfg),{mode:0o600});
    await assert.rejects(prepareConfiguredR5ScriptedEngineerBootstrap(configPath,{
      expectedSourceSha:SHA
    }),/R5 scripted host deployment NO-GO/);
    cfg.scriptedOidc.pinned.sourceSha=oldSha;
    cfg.oidc.pinned.sourceSha=oldSha;
    await writeFile(configPath,JSON.stringify(cfg),{mode:0o600});
    await writeFile(plan,'{"stale":"unsigned"}',{mode:0o600});
    await assert.rejects(verifyProtectedR5EngineerHostConfig({
      configPath,expectedSourceSha:SHA
    }),/configuration denied/,
    "pre-Planning mode must reject existing unsigned/stale review plan");
    const cold=await loadTrustedEngineerServiceConfig(configPath);
    assert.equal(typeof cold.approval.planningCheckpointStore.load,"function");
  }finally{await f.close();}
});

test("R5 standalone host preflight never starts listeners without operator config",()=>{
  const script=new URL("../r5-scripted-host-deployment-preflight.mjs",import.meta.url);
  const env={PATH:process.env.PATH};
  const child=spawnSync(process.execPath,["--experimental-strip-types",script.pathname],{
    env,encoding:"utf8",timeout:12000
  });
  assert.equal(child.status,1);
  assert.equal(child.stdout,"");
  assert.match(child.stderr,/configuration NO-GO/);
  assert.doesNotMatch(child.stderr,/private key|Bearer |10\.27\./i);
});
