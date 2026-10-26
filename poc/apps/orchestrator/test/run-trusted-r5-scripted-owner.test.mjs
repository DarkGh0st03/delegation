import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,chmod,symlink,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {spawnSync} from "node:child_process";
import {readFile} from "node:fs/promises";
import {loadProtectedR5ScriptedOwnerInput,
  startProtectedR5ScriptedOwnerSession}
  from "../src/run-trusted-r5-scripted-owner.mjs";
import {bindProtectedR5ScriptedExecution}
  from "../src/trusted-r5-scripted-execution-binding.mjs";

const fixture=async()=>{
  const dir=await mkdtemp(join(tmpdir(),"r5-private-owner-input-"));
  const f=name=>join(dir,name);
  const signer=f("backend.key");
  await writeFile(signer,
    "-----BEGIN PRIVATE KEY-----\noffline-opaque-test-only\n-----END PRIVATE KEY-----\n",
    {mode:0o600});
  const input={
    profile:"scripted_offline",
    snapshot:{
      session_id:"r5-owner-original-session",
      repository:{authority:"gitea.local",owner:"thesis",repository:"iam"},
      base_revision:"a".repeat(40),
      directories:["","src","tests"],
      files:["src/b.ts","src/f.ts"]
    },
    preliminaryRoot:{
      credential_id:"urn:r5:preliminary",
      valid_from:new Date().toISOString(),
      validity_seconds:300,
      credential_status:{
        type:"BitstringStatusListEntry",statusPurpose:"revocation",
        statusListIndex:"401",
        statusListCredential:"https://status.example/roots"
      }
    },
    edits:{backend:["src/b.ts"],frontend:["src/f.ts"]},
    newTestFile:"tests/functional.test.ts",
    requirement:"Account Suspension ACTIVE/SUSPENDED",
    planId:"r5-reviewed-plan",
    agents:{
      backend:{did:"did:example:backend",card_ref:"private:backend"},
      frontend:{did:"did:example:frontend",card_ref:"private:frontend"},
      test:{did:"did:example:test",card_ref:"private:test"}
    },
    gatewayBaseUrl:"http://127.0.0.1:9001",
    backendPrivateKeyFile:signer
  };
  const inputFile=f("planning.json");
  await writeFile(inputFile,JSON.stringify(input),{mode:0o600});
  return {
    input,inputFile,signer,dir,
    async rewrite(value){await writeFile(inputFile,JSON.stringify(value),
      {mode:0o600});},
    close:()=>rm(dir,{recursive:true,force:true})
  };
};
test("R5 protected owner loads exact original signed Planning input from 0600, without exposing signer path",async()=>{
  const f=await fixture();try{
    const value=await loadProtectedR5ScriptedOwnerInput(f.inputFile);
    assert.equal(value.snapshot.base_revision,"a".repeat(40));
    assert.equal(value.profile,undefined);
    assert.equal(value.backendPrivateKeyFile,undefined);
    assert.match(value.backendPrivateKeyPem,/BEGIN PRIVATE KEY/);
    assert.equal(JSON.stringify({
      profile:value.profile,backendPrivateKeyFile:value.backendPrivateKeyFile
    }),"{}");
  }finally{await f.close();}
});
test("R5 owner rejects altered profile, untrusted keys and shared signer input",async()=>{
  const f=await fixture();try{
    for(const change of [
      x=>x.profile="paid_gemini",
      x=>x.unknownAuthorizer="user",
      x=>x.snapshot.hijackedRoot="surprise",
      x=>x.agents.orchestrator={did:"did:evil",card_ref:"private:evil"},
      x=>x.backendPrivateKeyFile=f.inputFile
    ]){
      const value=structuredClone(f.input);change(value);
      await f.rewrite(value);
      await assert.rejects(loadProtectedR5ScriptedOwnerInput(f.inputFile),
        /R5 protected live owner input denied/);
    }
  }finally{await f.close();}
});
test("R5 owner refuses writable signer, writable input and symbolic link",async()=>{
  const f=await fixture();try{
    await chmod(f.signer,0o644);
    await assert.rejects(loadProtectedR5ScriptedOwnerInput(f.inputFile),
      /R5 protected live owner input denied/);
    await chmod(f.signer,0o600);
    await chmod(f.inputFile,0o666);
    await assert.rejects(loadProtectedR5ScriptedOwnerInput(f.inputFile),
      /R5 protected live owner input denied/);
    await chmod(f.inputFile,0o600);
    const sym=join(f.dir,"pointer.json");
    await symlink(f.inputFile,sym);
    await assert.rejects(loadProtectedR5ScriptedOwnerInput(sym),
      /R5 protected live owner input denied/);
  }finally{await f.close();}
});
test("R5 privileged owner refuses GitHub Actions and missing source SHA before any root",async()=>{
  const f=await fixture();try{
    const old=process.env.GITHUB_ACTIONS;
    try{
      process.env.GITHUB_ACTIONS="true";
      await assert.rejects(startProtectedR5ScriptedOwnerSession({
        configPath:"/untrusted",expectedSourceSha:"a".repeat(40),
        inputFile:f.inputFile
      }),/R5 protected live owner input denied/);
    }finally{
      if(old===undefined)delete process.env.GITHUB_ACTIONS;
      else process.env.GITHUB_ACTIONS=old;
    }
    await assert.rejects(startProtectedR5ScriptedOwnerSession({
      configPath:"/untrusted",expectedSourceSha:"invalid",
      inputFile:f.inputFile
    }),/R5 protected live owner input denied/);
  }finally{await f.close();}
});
test("R5 foreground owner CLI never reads a key or starts a listener with missing protected config",()=>{
  const script=new URL("../src/run-trusted-r5-scripted-owner.mjs",import.meta.url);
  const p=spawnSync(process.execPath,[
    "--experimental-strip-types",script.pathname
  ],{
    env:{PATH:process.env.PATH},
    timeout:12000,encoding:"utf8"
  });
  assert.equal(p.status,1);
  assert.equal(p.stdout,"");
  assert.match(p.stderr,/R5 owner startup denied/);
  assert.doesNotMatch(p.stderr,/PRIVATE KEY|token|Bearer|BEGIN CERTIFICATE/);
});

function reviewedExecutionFixture(){
  const planning=Object.freeze({
    gateway:Object.freeze({
      gatewayBaseUrl:"http://127.0.0.1:8091",
      adapterBaseUrl:"http://127.0.0.1:8092",
      adapterToken:"owner-protected-adapter-token"
    })
  });
  const noop=async()=>({status:"completed"});
  const payload={
    runId:"40287572654",
    operationalRoot:{
      credential_id:"urn:offline:operational-root",
      valid_from:new Date().toISOString(),
      validity_seconds:180,
      credential_status:{
        type:"BitstringStatusListEntry",
        statusPurpose:"revocation",
        statusListIndex:"7",
        statusListCredential:"https://status.example/roots"
      }
    },
    ports:{backend:8103,frontend:8104,test:8105},
    handlers:{backend:noop,frontend:noop,test:noop},
    sendProtectedTask:noop,
    childStatusProvisioning:{
      reservationDirectory:"/opt/delegation/private-status",
      statusListCredential:"https://status.example/children",
      indexByTask:{branch:11,backend:12,frontend:13,test:14,pr:15},
      excludedIndices:[1,2,3]
    }
  };
  return {planning,payload};
}
test("R5 owner binds approved GitHub run exclusively to original protected Gateway and Adapter",()=>{
  const f=reviewedExecutionFixture();
  const bound=bindProtectedR5ScriptedExecution(f.planning,f.payload);
  assert.equal(bound.runId,f.payload.runId);
  assert.equal(bound.privateGatewayTransport.adapterToken,
    "owner-protected-adapter-token");
  assert.equal(bound.privateGatewayTransport.gatewayBaseUrl,
    "http://127.0.0.1:8091");
  assert.equal(bound.execution.adapter.bearerToken,
    "owner-protected-adapter-token");
  assert.equal(bound.execution.adapter.adapterBaseUrl,
    "http://127.0.0.1:8092");
  assert.equal(typeof bound.execution.a2a.sendProtectedTask,"function");
  assert.equal(Object.isFrozen(bound.operationalRoot),true);
  assert.equal(Object.isFrozen(bound.operationalRoot.credential_status),true);
  assert.equal(Object.isFrozen(bound.childStatusProvisioning.indexByTask),true);
  f.payload.operationalRoot.credential_status.statusListIndex="999";
  f.payload.childStatusProvisioning.indexByTask.backend=100;
  assert.equal(bound.operationalRoot.credential_status.statusListIndex,"7");
  assert.equal(bound.childStatusProvisioning.indexByTask.backend,12);
});
test("R5 owner rejects arbitrary execution transport, fee-capable config or mismatched protected origin",()=>{
  const f=reviewedExecutionFixture();
  for(const change of [
    ({payload})=>payload.privateGatewayTransport={
      gatewayBaseUrl:"https://evil.example"
    },
    ({payload})=>payload.geminiApiKey="paid-key",
    ({payload})=>payload.execution={authorityForTask:()=>true},
    ({payload})=>payload.runId="0",
    ({payload})=>payload.ports.test=payload.ports.frontend,
    ({payload})=>payload.handlers.backend="a model prompt",
    ({payload})=>payload.sendProtectedTask="user-supplied-URL",
    ({payload})=>payload.childStatusProvisioning.extra="external-run",
    ({planning})=>planning.gateway.adapterBaseUrl="https://evil.example"
  ]){
    const snapshot=reviewedExecutionFixture();
    const mutable={planning:{
      gateway:{...snapshot.planning.gateway}
    },payload:structuredClone({
      ...snapshot.payload,
      handlers:{backend:null,frontend:null,test:null},
      sendProtectedTask:null
    })};
    mutable.payload.handlers={...snapshot.payload.handlers};
    mutable.payload.sendProtectedTask=snapshot.payload.sendProtectedTask;
    change(mutable);
    mutable.planning.gateway=Object.freeze(mutable.planning.gateway);
    mutable.planning=Object.freeze(mutable.planning);
    assert.throws(()=>bindProtectedR5ScriptedExecution(
      mutable.planning,mutable.payload),
      /R5 protected scripted Execution binding denied/);
  }
});
test("R5 operator callback cannot inject forged role fields or unauthorized authority indexes",()=>{
  const f=reviewedExecutionFixture();
  for(const change of [
    p=>p.ports.orchestrator=8009,
    p=>p.handlers.admin=()=>true,
    p=>p.childStatusProvisioning.indexByTask.constructor=99,
    p=>p.childStatusProvisioning.indexByTask.backend={value:5},
    p=>p.childStatusProvisioning.excludedIndices.push({index:12})
  ]){
    const p={...f.payload,
      ports:{...f.payload.ports},
      handlers:{...f.payload.handlers},
      childStatusProvisioning:{
        ...f.payload.childStatusProvisioning,
        indexByTask:{...f.payload.childStatusProvisioning.indexByTask},
        excludedIndices:[...f.payload.childStatusProvisioning.excludedIndices]
      }};
    change(p);
    assert.throws(()=>bindProtectedR5ScriptedExecution(
      f.planning,p),/R5 protected scripted Execution binding denied/);
  }
});

test("R5 owner verifies real Engineer approval BEFORE consuming scripted GitHub OIDC admission",async()=>{
  const source=await readFile(new URL(
    "../src/run-trusted-r5-scripted-owner.mjs",import.meta.url),"utf8");
  const body=source.slice(source.indexOf("async runApprovedScriptedDag(input){"));
  const signed=body.indexOf("await signedReviewReady()");
  const reserve=body.indexOf("dispatchAttempted=true");
  const consume=body.indexOf("host.runReviewedScriptedApprovedDagWithGateway(bound)");
  assert.ok(signed>=0&&reserve>signed&&consume>reserve,
    "valid human Ed25519 review must precede one-shot admission consumption");
  assert.match(body,/dispatchPreparing=true/);
  assert.match(body,/finally\s*{\s*dispatchPreparing=false/);
  assert.match(source,/async reviewReadiness\(\)/);
});
