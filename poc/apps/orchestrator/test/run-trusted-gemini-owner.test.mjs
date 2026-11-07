import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,chmod,symlink,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {loadProtectedGeminiOwnerInput,startProtectedGeminiOwnerSession,
  startProtectedCanonicalGeminiOwnerSession,
  startProtectedCanonicalGeminiOwnerFromPrivateConfig}
  from "../src/run-trusted-gemini-owner.mjs";

const CONFIRMATION="I AUTHORIZE GEMINI API CHARGES";
async function fixture(){
  const dir=await mkdtemp(join(tmpdir(),"gemini-private-owner-"));
  const at=x=>join(dir,x);
  const backendFile=at("backend.key"),modelFile=at("gemini.key");
  await writeFile(backendFile,
    "-----BEGIN PRIVATE KEY-----\nfictional-offline-key\n-----END PRIVATE KEY-----\n",
    {mode:0o600});
  await writeFile(modelFile,"offline-no-network-key\n",{mode:0o600});
  const input={
    profile:"gemini_planning",
    snapshot:{
      session_id:"trusted-gemini-owner-test",
      repository:{authority:"gitea.local",owner:"thesis",repository:"iam"},
      base_revision:"a".repeat(40),
      directories:["","src","tests"],
      files:["src/backend.ts","src/frontend.ts"]
    },
    preliminaryRoot:{
      credential_id:"urn:preliminary:offline-gemini",
      valid_from:new Date().toISOString(),validity_seconds:2700,
      credential_status:{type:"BitstringStatusListEntry",statusPurpose:"revocation",
        statusListIndex:"600",
        statusListCredential:"https://status.test/list"}
    },
    requirement:"Implement an approved department directory search",
    planId:"gemini-review-plan",
    agents:{
      backend:{did:"did:test:backend",card_ref:"trusted:backend"},
      frontend:{did:"did:test:frontend",card_ref:"trusted:frontend"},
      test:{did:"did:test:test",card_ref:"trusted:test"}
    },
    gatewayBaseUrl:"http://127.0.0.1:8080",
    backendPrivateKeyFile:backendFile,
    geminiApiKeyFile:modelFile,
    modelName:"gemini-3.8-flash"
  };
  const ownerFile=at("owner.json");
  async function write(next=input){
    await writeFile(ownerFile,JSON.stringify(next),{mode:0o600});
  }
  await write();
  return {dir,backendFile,modelFile,input,ownerFile,write,
    close:()=>rm(dir,{recursive:true,force:true})};
}

test("Gemini owner loads private 0600 model key only after separate exact billing confirmation",async()=>{
  const f=await fixture();
  try{
    await assert.rejects(loadProtectedGeminiOwnerInput(f.ownerFile),
      /Protected Gemini owner input denied/);
    await assert.rejects(loadProtectedGeminiOwnerInput(f.ownerFile,{
      chargeAuthorization:"yes"
    }),/Protected Gemini owner input denied/);
    const loaded=await loadProtectedGeminiOwnerInput(f.ownerFile,{
      chargeAuthorization:CONFIRMATION
    });
    assert.equal(loaded.modelName,"gemini-3.8-flash");
    assert.equal(loaded.preliminaryRoot.validity_seconds,2700);
    assert.equal(loaded.authorizationInput,CONFIRMATION);
    assert.equal(loaded.geminiApiKey,"offline-no-network-key");
    assert.ok(Object.isFrozen(loaded));
    assert.equal("geminiApiKeyFile" in loaded,false);
    assert.equal("backendPrivateKeyFile" in loaded,false);
    assert.equal("profile" in loaded,false);
  }finally{await f.close();}
});

test("Gemini owner rejects model, root TTL, stale times, extra authority and insecure secrets",async()=>{
  const f=await fixture();
  try{
    const mutate=[
      o=>{o.profile="scripted_offline";},
      o=>{o.modelName="gemini-3.1-pro-preview";},
      o=>{o.userMayApprove=true;},
      o=>{o.preliminaryRoot.validity_seconds=300;},
      o=>{o.preliminaryRoot.validity_seconds=2701;},
      o=>{o.preliminaryRoot.validity_seconds=2220;
        o.preliminaryRoot.valid_from=new Date(Date.now()-10000).toISOString();},
      o=>{o.preliminaryRoot.valid_from=new Date(Date.now()-7200000).toISOString();},
      o=>{o.preliminaryRoot.valid_from=new Date(Date.now()+120000).toISOString();},
      o=>{o.geminiApiKeyFile=o.backendPrivateKeyFile;}
    ];
    for(const patch of mutate){
      const copied=structuredClone(f.input);
      patch(copied);
      await f.write(copied);
      await assert.rejects(loadProtectedGeminiOwnerInput(f.ownerFile,{
        chargeAuthorization:CONFIRMATION
      }),/Protected Gemini owner input denied/);
    }
    await f.write();
    await chmod(f.modelFile,0o644);
    await assert.rejects(loadProtectedGeminiOwnerInput(f.ownerFile,{
      chargeAuthorization:CONFIRMATION
    }),/Protected Gemini owner input denied/);
    await chmod(f.modelFile,0o600);
    const alias=join(f.dir,"gemini-link");
    await symlink(f.modelFile,alias);
    await f.write({...f.input,geminiApiKeyFile:alias});
    await assert.rejects(loadProtectedGeminiOwnerInput(f.ownerFile,{
      chargeAuthorization:CONFIRMATION
    }),/Protected Gemini owner input denied/);
  }finally{await f.close();}
});

test("Gemini owner session refuses GitHub runners and missing source pin before any credential or provider",async()=>{
  const f=await fixture();
  try{
    await assert.rejects(startProtectedGeminiOwnerSession({
      configPath:"/untrusted",expectedSourceSha:"bad",
      inputFile:f.ownerFile,chargeAuthorization:CONFIRMATION
    }),/Protected Gemini owner input denied/);
    await assert.rejects(startProtectedGeminiOwnerSession({
      configPath:"/untrusted",expectedSourceSha:"a".repeat(40),
      inputFile:f.ownerFile,chargeAuthorization:""
    }),/Protected Gemini owner input denied/);
    const previous=process.env.GITHUB_ACTIONS;
    try{
      // Even an explicitly consented run cannot use a source SHA different
      // from the real local Git checkout. This check precedes config/keys.
      process.env.GITHUB_ACTIONS="false";
      await assert.rejects(startProtectedGeminiOwnerSession({
        configPath:"/untrusted",expectedSourceSha:"f".repeat(40),
        inputFile:f.ownerFile,chargeAuthorization:CONFIRMATION
      }),/Protected Gemini owner input denied/);
      process.env.GITHUB_ACTIONS="true";
      await assert.rejects(startProtectedGeminiOwnerSession({
        configPath:"/untrusted",expectedSourceSha:"a".repeat(40),
        inputFile:f.ownerFile,chargeAuthorization:CONFIRMATION
      }),/Protected Gemini owner input denied/);
    }finally{
      if(previous===undefined)delete process.env.GITHUB_ACTIONS;
      else process.env.GITHUB_ACTIONS=previous;
    }
  }finally{await f.close();}
});

test("Gemini foreground CLI cannot silently start paid Planning without protected operator inputs",()=>{
  const program=new URL("../src/run-trusted-gemini-owner.mjs",import.meta.url);
  const result=spawnSync(process.execPath,[
    "--experimental-strip-types",program.pathname
  ],{
    env:{PATH:process.env.PATH},timeout:12000,encoding:"utf8"
  });
  assert.equal(result.status,1);
  assert.equal(result.stdout,"");
  assert.match(result.stderr,/Gemini owner startup denied/);
  assert.doesNotMatch(result.stderr,/PRIVATE KEY|offline-no-network-key|Bearer/);
});

test("R382.6 legacy Gemini CLI cannot start Signed DAG in authority-only mode",async()=>{
 const before=process.env.DELEGATION_GATEWAY_ARCHITECTURE;
 process.env.DELEGATION_GATEWAY_ARCHITECTURE="authority-only";
 try{
  // This must deny BEFORE checking local source, protected files,
  // constructing Gemini or issuing the preliminary Rust Root.
  await assert.rejects(startProtectedGeminiOwnerSession({
   configPath:"/nonexistent",inputFile:"/nonexistent",
   expectedSourceSha:"a".repeat(40),
   chargeAuthorization:CONFIRMATION
  }),/Protected Gemini owner input denied/u);
  delete process.env.DELEGATION_GATEWAY_ARCHITECTURE;
  // An unset architecture is also NOT an implicit legacy fallback.
  await assert.rejects(startProtectedGeminiOwnerSession({
   configPath:"/nonexistent",inputFile:"/nonexistent",
   expectedSourceSha:"a".repeat(40),
   chargeAuthorization:CONFIRMATION
  }),/Protected Gemini owner input denied/u);
 }finally{
  if(before===undefined)delete process.env.DELEGATION_GATEWAY_ARCHITECTURE;
  else process.env.DELEGATION_GATEWAY_ARCHITECTURE=before;
 }
});

test("R382.6 canonical Gemini owner refuses GitHub runner and missing independent billing consent",async()=>{
 const keys=["GITHUB_ACTIONS","DELEGATION_GATEWAY_ARCHITECTURE",
  "APPROVED_RUNNER_NATIVE_MCP"];
 const old=new Map(keys.map(k=>[k,process.env[k]]));
 try{
  process.env.DELEGATION_GATEWAY_ARCHITECTURE="authority-only";
  process.env.APPROVED_RUNNER_NATIVE_MCP="1";
  process.env.GITHUB_ACTIONS="true";
  const params={
   authority:{},inputFile:"/nonexistent",
   expectedSourceSha:"a".repeat(40),
   chargeAuthorization:CONFIRMATION,
   provision:async()=>{throw Error("Must never provision Root");}
  };
  await assert.rejects(startProtectedCanonicalGeminiOwnerSession(params),
   /Protected Gemini owner input denied/u);
  process.env.GITHUB_ACTIONS="false";
  await assert.rejects(startProtectedCanonicalGeminiOwnerSession({
   ...params,chargeAuthorization:"no consent"
  }),/Protected Gemini owner input denied/u);
  await assert.rejects(startProtectedCanonicalGeminiOwnerSession({
   ...params,expectedSourceSha:"0".repeat(40)
  }),/Protected Gemini owner input denied/u);
 }finally{
  for(const [k,v] of old)
   if(v===undefined)delete process.env[k];
   else process.env[k]=v;
 }
});

test("R382.7 protected canonical native entrypoint fails before any paid model, source or manifest read",async()=>{
 const names=["GITHUB_ACTIONS","DELEGATION_GATEWAY_ARCHITECTURE",
  "APPROVED_RUNNER_NATIVE_MCP","ENGINEER_CORE_NATIVE_MODE"];
 const old=new Map(names.map(k=>[k,process.env[k]]));
 const arg={configPath:"/nonexistent/manifest.json",
  inputFile:"/nonexistent/model.json",
  expectedSourceSha:"a".repeat(40),chargeAuthorization:CONFIRMATION,
  provision:async()=>{throw Error("No operational Root may be issued");}};
 try{
  process.env.DELEGATION_GATEWAY_ARCHITECTURE="authority-only";
  process.env.APPROVED_RUNNER_NATIVE_MCP="1";
  process.env.ENGINEER_CORE_NATIVE_MODE="1";
  process.env.GITHUB_ACTIONS="true";
  await assert.rejects(startProtectedCanonicalGeminiOwnerFromPrivateConfig(arg),
   /Protected Gemini owner input denied/u);
  process.env.GITHUB_ACTIONS="false";
  await assert.rejects(startProtectedCanonicalGeminiOwnerFromPrivateConfig({
   ...arg,chargeAuthorization:""
  }),/Protected Gemini owner input denied/u);
  process.env.ENGINEER_CORE_NATIVE_MODE="0";
  await assert.rejects(startProtectedCanonicalGeminiOwnerFromPrivateConfig(arg),
   /Protected Gemini owner input denied/u);
  process.env.ENGINEER_CORE_NATIVE_MODE="1";
  await assert.rejects(startProtectedCanonicalGeminiOwnerFromPrivateConfig({
   ...arg,expectedSourceSha:"bad"
  }),/Protected Gemini owner input denied/u);
 }finally{
  for(const [k,v] of old)
   if(v===undefined)delete process.env[k];
   else process.env[k]=v;
 }
});

test("R382.7 canonical executable rejects noninteractive input before loading deployment code",()=>{
 const result=spawnSync(process.execPath,["--experimental-strip-types",
  new URL("../src/run-trusted-gemini-owner.mjs",import.meta.url).pathname],{
  env:{...process.env,GITHUB_ACTIONS:"false",DELEGATION_GATEWAY_ARCHITECTURE:"authority-only",
   APPROVED_RUNNER_NATIVE_MCP:"1",ENGINEER_CORE_NATIVE_MODE:"1",
   DELEGATION_GEMINI_CHARGE_CONFIRMATION:CONFIRMATION,
   DELEGATION_CANONICAL_OPERATIONAL_MODULE:"poc/missing-deployment.mjs"},
  input:"execute\n",encoding:"utf8",timeout:10000
 });
 assert.equal(result.error,undefined);
 assert.equal(result.status,1);
 assert.equal(result.stdout,"");
 assert.match(result.stderr,/Gemini owner startup denied/u);
});
