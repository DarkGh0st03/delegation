import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,chmod,symlink,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {loadProtectedGeminiOwnerInput,startProtectedGeminiOwnerSession}
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
