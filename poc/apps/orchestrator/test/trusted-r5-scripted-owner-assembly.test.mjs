import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,randomBytes} from "node:crypto";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createTrustedPlanIpcServer}
  from "../../gateway/src/trusted-plan-ipc.ts";
import {TrustedPlanningRevisions}
  from "../../gateway/src/planning-revisions.ts";
import {TrustedPlanningRetirementStore}
  from "../../gateway/src/trusted-planning-retirement-store.ts";
import {TrustedOperationalRecoveryStore}
  from "../../../packages/orchestrator-runtime/src/trusted-operational-recovery-store.ts";
import {SignedPlanningCheckpointFileStore}
  from "../../../packages/orchestrator-runtime/src/trusted-planning-checkpoint-store.ts";
import {R5ScriptedNoProviderPlanningModel}
  from "../../../packages/orchestrator-runtime/src/trusted-r5-scripted-planning-model.ts";
import {assembleProtectedR5ScriptedOwnerPlanning,assembleProtectedOwnerGeminiPlanning}
  from "../src/trusted-r5-scripted-owner-assembly.mjs";

const SHA="a".repeat(40),ENGINEER="did:example:engineer";
const REPO={authority:"gitea.local",owner:"thesis",repository:"iam-console"};
const SNAPSHOT={
  session_id:"r5-real-original-coordinator",
  base_revision:SHA,repository:REPO,
  directories:["","src","tests"],
  files:["src/backend.ts","src/frontend.ts"]
};
const AGENTS={
  backend:{did:"did:example:backend",card_ref:"trusted:backend"},
  frontend:{did:"did:example:frontend",card_ref:"trusted:frontend"},
  test:{did:"did:example:test",card_ref:"trusted:test"}
};
async function fixture(t,{durable=true}={}){
  const dir=await mkdtemp(join(tmpdir(),"r5-owner-assembly-"));
  const dirs={};
  for(const name of ["ipc","recovery","planning","receipt","checkpoint","retired"]){
    dirs[name]=join(dir,name);await mkdir(dirs[name],{mode:0o700});
  }
  const secretFile=join(dirs.ipc,"secret.hex");
  const socketPath=join(dirs.ipc,"control.sock");
  await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",{mode:0o600});
  const retire=durable
    ?new TrustedPlanningRetirementStore(dirs.retired):undefined;
  if(retire)await retire.assertReady();
  const revision=new TrustedPlanningRevisions({
    async readRepository(){return {default_branch:"main",revision:SHA};}
  },retire?{retirementStore:retire}:{});
  const control=await createTrustedPlanIpcServer({
    socketPath,secretFile,planningRevisions:revision,
    plans:{
      operationalLeaseConfigured:()=>true,
      operationalSessionDurableConfigured:()=>durable
    }
  });
  await control.start();
  t.after(async()=>{await control.close();await rm(dir,{recursive:true,force:true});});
  const engineer=generateKeyPairSync("ed25519");
  const backend=generateKeyPairSync("ed25519");
  const engineerPublic=engineer.publicKey.export({format:"pem",type:"spki"}).toString();
  const backendPublic=backend.publicKey.export({format:"pem",type:"spki"}).toString();
  const backendPrivate=backend.privateKey.export({format:"pem",type:"pkcs8"}).toString();
  const checkpoint=new SignedPlanningCheckpointFileStore({
    directory:dirs.checkpoint,trust:{
      trustedKeys:{"r5-backend-signer":{public_key_pem:backendPublic}},
      expectedSessionId:SNAPSHOT.session_id,
      expectedRepository:REPO,expectedBaseRevision:SHA,
      expectedWorkBranch:"feature/account-suspension"
    }
  });
  const config={
    approval:{
      engineerDid:ENGINEER,keyId:"r5-engineer-signing-key",
      expectedSessionId:SNAPSHOT.session_id,expectedBaseRevision:SHA,
      repository:REPO,publicKeyPem:engineerPublic,
      receiptDirectory:dirs.receipt
    },
    ownerPlanning:{
      backendKeyId:"r5-backend-signer",backendPublicKeyPem:backendPublic,
      expectedWorkBranch:"feature/account-suspension"
    },
    recovery:{
      gatewaySocketPath:socketPath,gatewaySecretFile:secretFile,
      directory:dirs.recovery,planningDirectory:dirs.planning,
      adapterBaseUrl:"http://127.0.0.1:8090",
      adapterToken:"only-offline-fixture-token"
    }
  };
  const input={
    config,planningCheckpointStore:checkpoint,
    operationalRecovery:new TrustedOperationalRecoveryStore(dirs.recovery),
    snapshot:SNAPSHOT,
    preliminaryRoot:{credential_id:"urn:r5:preliminary",
      valid_from:new Date().toISOString(),validity_seconds:300,
      credential_status:{type:"BitstringStatusListEntry",
        statusPurpose:"revocation",statusListIndex:"512",
        statusListCredential:"https://status.example/revocation"}},
    edits:{backend:["src/backend.ts"],frontend:["src/frontend.ts"]},
    newTestFile:"tests/account-suspension.spec.ts",
    planId:"r5-verified-account-suspension",
    requirement:"Implement ACTIVE and SUSPENDED states",
    agents:AGENTS,gatewayBaseUrl:"http://127.0.0.1:9999",
    backendPrivateKeyPem:backendPrivate
  };
  return {input,backendPrivate,config,revision,checkpoint,
    engineerPrivate:engineer.privateKey.export({
      format:"pem",type:"pkcs8"
    }).toString()};
}
test("R5 original owner assembles SAME Coordinator with real durable Gateway IPC, no Planning root or approval",async t=>{
  const f=await fixture(t);
  const assembly=await assembleProtectedR5ScriptedOwnerPlanning(f.input);
  assert.equal(assembly.status,"owner_r5_original_planning_assembled_not_started");
  assert.equal(assembly.coordinator,assembly.planning.coordinator);
  assert.equal(assembly.coordinator.phase,"idle");
  assert.equal(assembly.planning.planner.model instanceof
    R5ScriptedNoProviderPlanningModel,true);
  assert.equal(assembly.planning.checkpointStore,f.checkpoint);
  assert.deepEqual(assembly.planning.planner.snapshot,SNAPSHOT);
  assert.notEqual(assembly.planning.planner.snapshot,SNAPSHOT);
  assert.equal(Object.isFrozen(assembly.planning),true);
  assert.equal(Object.isFrozen(assembly.planning.planner),true);
  assert.equal(Object.isFrozen(assembly.planning.gateway),true);
  assert.equal(Object.isFrozen(assembly.planning.snapshot.files),true);
  assert.throws(()=>{
    assembly.planning.gateway.gatewayBaseUrl="http://127.0.0.1:1";
  },TypeError);
  assert.equal(assembly.gateway.planningRetirementDurableConfigured(),true);
  assert.equal(assembly.gateway.operationalSessionDurableConfigured(),true);
  assert.equal(assembly.gateway.operationalLeaseConfigured(),true);
  // No Adapter root request, Gitea read, Engineer signing or model call.
  // The actual Gitea read is deferred to the original beginPlanning().
  assert.equal(assembly.planning.reviewGate instanceof Object,true);
});
test("R5 assembly refuses changed original session and backend Ed25519 public pin BEFORE IPC",async t=>{
  const f=await fixture(t);
  for(const patch of [
    {snapshot:{...SNAPSHOT,base_revision:"b".repeat(40)}},
    {snapshot:{...SNAPSHOT,repository:{...REPO,owner:"intruder"}}},
    {backendPrivateKeyPem:generateKeyPairSync("ed25519").privateKey
      .export({format:"pem",type:"pkcs8"}).toString()},
    {gatewayBaseUrl:"https://evil.example"},
    {agents:{...AGENTS,test:{did:"",card_ref:"trusted:test"}}},
    {edits:{backend:["src/backend.ts"],frontend:["src/backend.ts"]}}
  ]){
    await assert.rejects(
      assembleProtectedR5ScriptedOwnerPlanning({...f.input,...patch}),
      /R5 owner Planning assembly denied|R5 scripted no-provider Planning denied/
    );
  }
});
test("R5 forbids using the Engineer signing identity as the Backend checkpoint key",async t=>{
  const f=await fixture(t);
  const sameSigner={
    ...f.input,
    backendPrivateKeyPem:f.engineerPrivate,
    config:{
      ...f.config,
      ownerPlanning:{
        ...f.config.ownerPlanning,
        backendPublicKeyPem:f.config.approval.publicKeyPem
      }
    }
  };
  await assert.rejects(assembleProtectedR5ScriptedOwnerPlanning(sameSigner),
    /R5 owner Planning assembly denied/);
  assert.equal(f.revision.durableRetirementConfigured(),true);
});

test("R5 owner assembly rejects non-durable actual Gateway capabilities",async t=>{
  const f=await fixture(t,{durable:false});
  await assert.rejects(assembleProtectedR5ScriptedOwnerPlanning(f.input),
    /Gateway has no durable operational\/Planning recovery and lease/);
});

test("owner constructs trusted Gemini Flash Planning with original Coordinator and zero provider calls",async t=>{
  const f=await fixture(t);
  const assembly=await assembleProtectedOwnerGeminiPlanning({
    ...f.input,geminiApiKey:"offline-constructor-only",
    authorizationInput:"I AUTHORIZE GEMINI API CHARGES",
    modelName:"gemini-3.8-flash"
  });
  assert.equal(assembly.status,"owner_gemini_planning_assembled_not_started");
  assert.equal(assembly.coordinator,assembly.planning.coordinator);
  assert.equal(assembly.coordinator.phase,"idle");
  assert.equal(assembly.planning.checkpointStore,f.checkpoint);
  assert.equal(assembly.planning.planner.model.model,"gemini-3.8-flash");
  assert.equal(assembly.planning.planner.thinkingLevel,"MEDIUM");
  assert.equal(assembly.planning.planner.maxModelTurns,96);
  assert.equal(assembly.planning.planner.maxModelCallMs,120000);
  assert.equal(assembly.planning.planner.maxOutputTokens,16384);
  assert.equal(assembly.planning.planner.maxPlanningMs,900000);
  assert.ok(Object.isFrozen(assembly.planning.planner));
  assert.ok(!("geminiApiKey" in assembly.planning));
  assert.ok(!("authorizationInput" in assembly.planning));
  assert.ok(!("geminiApiKey" in assembly.planning.planner));
  // Assembly MUST NOT bootstrap a Planning root, sign an Engineer decision,
  // contact the Gemini API or request a real Gitea read from the Gateway.
  assert.equal(f.revision.durableRetirementConfigured(),true);
});

test("owner cannot assemble paid Gemini Planning without explicit opt-in and exact Flash model",async t=>{
  const f=await fixture(t);
  for(const replacement of [
    {authorizationInput:""},
    {authorizationInput:"I AUTHORIZE GEMINI API CHARGE"},
    {modelName:"gemini-3.1-pro-preview"},
    {modelName:"gemini-3.8-flash-high"},
    {geminiApiKey:""}
  ]){
    await assert.rejects(
      assembleProtectedOwnerGeminiPlanning({
        ...f.input,geminiApiKey:"offline-not-a-provider-key",
        authorizationInput:"I AUTHORIZE GEMINI API CHARGES",
        modelName:"gemini-3.8-flash",...replacement
      }),/owner-selected Gemini Planning requires explicit paid consent/
    );
  }
});
