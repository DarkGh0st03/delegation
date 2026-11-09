import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,randomBytes} from "node:crypto";
import {mkdtemp,mkdir,writeFile,chmod,symlink,rm,readdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {
 loadProtectedCanonicalOwnerManifest,assembleProtectedCanonicalOwnerAuthority,
 createProtectedCanonicalOperationalProvision
} from "../src/trusted-authority-only-owner-bootstrap.mjs";

import {TrustedOperationalSessionStore}
 from "../../gateway/src/trusted-operational-session-store.ts";
import {TrustedAuthorityOnlyCompletionObserver}
 from "../../../packages/orchestrator-runtime/src/trusted-authority-only-completion-observer.ts";

const SHA="a".repeat(40);
const ROLES=["backend","frontend","test","orchestrator"];
async function fixture(t){
 const envNames=["GITHUB_ACTIONS","DELEGATION_GATEWAY_ARCHITECTURE",
  "APPROVED_RUNNER_NATIVE_MCP","ENGINEER_CORE_NATIVE_MODE",
  "ADAPTER_ENGINEER_NATIVE_SOCKET",
  ...ROLES.map(x=>"ADAPTER_ID_"+x.toUpperCase())];
 const previous=new Map(envNames.map(x=>[x,process.env[x]]));
 t.after(()=>{
  for(const [key,value] of previous)
   if(value===undefined)delete process.env[key];
   else process.env[key]=value;
 });
 process.env.GITHUB_ACTIONS="false";
 process.env.DELEGATION_GATEWAY_ARCHITECTURE="authority-only";
 process.env.APPROVED_RUNNER_NATIVE_MCP="1";
 process.env.ENGINEER_CORE_NATIVE_MODE="1";
 const root=await mkdtemp(join(tmpdir(),"r3827-private-"));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const at=n=>join(root,n);
 process.env.ADAPTER_ENGINEER_NATIVE_SOCKET=at("original-rust.sock");
 const directories=Object.fromEntries([
  "checkpoint","activation","tasks","recovery","operationalSessions","receipts"
 ].map(k=>[k,at(k)]));
 for(const path of Object.values(directories))
  await mkdir(path,{mode:0o700});
 const backend=generateKeyPairSync("ed25519");
 const engineer=generateKeyPairSync("ed25519");
 const file=async (name,value)=>{
  const path=at(name);
  await writeFile(path,value,{mode:0o600});
  return path;
 };
 const backendPub=await file("backend.pub.pem",
  backend.publicKey.export({format:"pem",type:"spki"}));
 const engineerPub=await file("engineer.pub.pem",
  engineer.publicKey.export({format:"pem",type:"spki"}));
 const engineerPrivate=await file("engineer.private.pem",
  engineer.privateKey.export({format:"pem",type:"pkcs8"}));
 const salt=await file("salt.hex",randomBytes(16).toString("hex"));
 const scrypt=await file("scrypt.hex",randomBytes(64).toString("hex"));
 const originalGatewayToken=await file("gateway-private.token","PRIVATE_GATEWAY_TOKEN");
 const originalRustToken=await file("rust-private.token","PRIVATE_RUST_TOKEN");
 const originalGatewaySecret=await file("gateway-private.key","f".repeat(64));
 const native={
  gatewaySocketPath:at("original-gateway.sock"),
  gatewaySecretFile:originalGatewaySecret,
  engineerRustTokenFile:originalRustToken,
  gatewayAdapterTokenFile:originalGatewayToken
 };
 const trustedAgentRegistry=Object.fromEntries(ROLES.map((role,i)=>{
  const did="did:ethr:0x7a69:0x"+String(i+1).padStart(40,"0");
  process.env["ADAPTER_ID_"+role.toUpperCase()]=did;
  return [role,{did,card_ref:"trusted:r3827:"+role,
   capabilities:role==="orchestrator"
    ?["create_branch","create_pull_request"]
    :role==="test"?["read_file","run_tests"]
     :["read_file","update_file"]}];
 }));
 const snapshot={
  session_id:"r3827-original-authority-session",
  repository:{authority:"gitea.local",owner:"thesis",repository:"iam"},
  base_revision:"b".repeat(40),
  directories:["","src","tests"],files:["src/account.ts","tests/account.test.ts"]
 };
 const preliminaryRoot={
  credential_id:"urn:r3827:preliminary",
  valid_from:"2026-11-07T16:00:00.000Z",
  validity_seconds:2700,
  credential_status:{type:"BitstringStatusListEntry",
   statusPurpose:"revocation",statusListIndex:"4",
   statusListCredential:"https://status.invalid/list"}
 };
 const config={
  schema:"r3827-original-authority-only-v1",
  source_sha:SHA,snapshot,
  requirement:"Implement account suspension through signed original Reviewer",
  workBranch:"feature/account-suspension",preliminaryRoot,
  planner:{planId:"r3827-authority-only"},
  trustedAgentRegistry,
  gateway:{gatewayBaseUrl:"http://127.0.0.1:8130",
   adapterBaseUrl:"http://127.0.0.1:8230"},
  checkpoint:{backendKeyId:"owner",backendPublicKeyFile:backendPub},
  approval:{engineerDid:"did:ethr:0x7a69:0x"+"9".repeat(40),
   keyId:"engineer",publicKeyFile:engineerPub,
   privateKeyFile:engineerPrivate,
   passwordSaltHexFile:salt,passwordScryptHexFile:scrypt},
  directories,native
 };
 const configPath=at("authority.json");
 async function save(value=config){await writeFile(configPath,JSON.stringify(value),
  {mode:0o600});}
 await save();
 return {root,at,config,configPath,save,load:()=>loadProtectedCanonicalOwnerManifest(
  configPath,{expectedSourceSha:SHA})};
}
test("R382.7 accepts only original owner-protected 0600 source-pinned native manifest",async t=>{
 const f=await fixture(t);
 const verified=await f.load();
 assert.equal(verified.pins.snapshot.session_id,f.config.snapshot.session_id);
 assert.equal(verified.pins.source_sha,SHA);
 assert.equal(verified.pins.workBranch,f.config.workBranch);
 assert.equal(verified.pins.trustedAgentRegistry.backend.did,
  process.env.ADAPTER_ID_BACKEND);
 assert.equal(verified.pins.directories.recovery,f.config.directories.recovery);
 assert.ok(verified.backendPublicKeyPem.includes("PUBLIC KEY"));
 assert.ok(verified.engineerPublicKeyPem.includes("PUBLIC KEY"));
 assert.equal(verified.passwordSaltHex.length,32);
 assert.equal(verified.passwordScryptHex.length,128);
 assert.ok(Object.isFrozen(verified.pins)&&Object.isFrozen(verified.pins.native));
 assert.equal("credentials" in verified,false);
 assert.equal("geminiApiKey" in verified,false);
 assert.equal("backendPrivateKeyPem" in verified,false);
 assert.equal("engineerPrivateKeyPem" in verified,false);
 assert.deepEqual(await readdir(f.config.directories.activation),[]);
 assert.deepEqual(await readdir(f.config.directories.checkpoint),[]);
});
test("R382.7 rejects source replay, forged role DID, disallowed grant and config keys",async t=>{
 const f=await fixture(t);
 const mutations=[
  x=>{x.source_sha="0".repeat(40);},
  x=>{x.schema="legacy-signed-dag";},
  x=>{x.untrustedModel={execute:true};},
  x=>{x.trustedAgentRegistry.frontend.did=
   x.trustedAgentRegistry.backend.did;},
  x=>{x.trustedAgentRegistry.orchestrator.capabilities.push("update_file");},
  x=>{x.workBranch="main";},
  x=>{x.gateway.gatewayBaseUrl="http://evil.invalid";},
  x=>{x.gateway.adapterBaseUrl="http://127.0.0.1:8230/unsafe";},
  x=>{x.directories.tasks=x.directories.activation;},
  x=>{x.native.additionalBearerToken="untrusted";},
  x=>{x.checkpoint.backendKeyId=""},
  x=>{x.approval.passwordSaltHexFile="../../etc/passwd";}
 ];
 for(const mutate of mutations){
  const changed=structuredClone(f.config);
  mutate(changed);
  await f.save(changed);
  await assert.rejects(f.load(),/Protected canonical authority bootstrap denied/u);
 }
 await f.save();
 assert.equal((await f.load()).pins.source_sha,SHA);
});
test("R382.7 refuses world-readable and symlinked manifest and foreign signer",async t=>{
 const f=await fixture(t);
 await chmod(f.configPath,0o644);
 await assert.rejects(f.load(),/Protected canonical authority bootstrap denied/u);
 await chmod(f.configPath,0o600);
 const link=f.at("aliased.json");
 await symlink(f.configPath,link);
 await assert.rejects(loadProtectedCanonicalOwnerManifest(link,{
  expectedSourceSha:SHA
 }),/Protected canonical authority bootstrap denied/u);
 process.env.ADAPTER_ID_BACKEND="did:ethr:wrong";
 await assert.rejects(f.load(),/Protected canonical authority bootstrap denied/u);
});
test("R382.7 independently rejects an Engineer private key mismatched to signed review public key",async t=>{
 const f=await fixture(t);
 const foreign=generateKeyPairSync("ed25519");
 await writeFile(f.config.approval.privateKeyFile,
  foreign.privateKey.export({format:"pem",type:"pkcs8"}),{mode:0o600});
 await assert.rejects(f.load(),/Protected canonical authority bootstrap denied/u);
});

test("R382.7 forbids CI, missing native Rust, no explicit architecture and forged loaded authority",async t=>{
 const f=await fixture(t);
 process.env.GITHUB_ACTIONS="true";
 await assert.rejects(f.load(),/Protected canonical authority bootstrap denied/u);
 process.env.GITHUB_ACTIONS="false";
 process.env.ENGINEER_CORE_NATIVE_MODE="0";
 await assert.rejects(f.load(),/Protected canonical authority bootstrap denied/u);
 process.env.ENGINEER_CORE_NATIVE_MODE="1";
 delete process.env.DELEGATION_GATEWAY_ARCHITECTURE;
 await assert.rejects(f.load(),/Protected canonical authority bootstrap denied/u);
 process.env.DELEGATION_GATEWAY_ARCHITECTURE="authority-only";
 await assert.rejects(assembleProtectedCanonicalOwnerAuthority({
  pins:f.config
 }),/Protected canonical authority bootstrap denied/u);
});

test("operational bootstrap reuses the original session store and reserves the Root at most once",async t=>{
 const f=await fixture(t);
 const journalDirectory=f.at("operational");
 await mkdir(journalDirectory,{mode:0o700});
 for(const name of ["gateway-tasks","issuer-children","gateway-children","effect-fences","sequences"])
  await mkdir(join(journalDirectory,name),{mode:0o700});
 const orchestratorTokenFile=f.at("orchestrator.token");
 await writeFile(orchestratorTokenFile,"ORIGINAL_ORCHESTRATOR_TOKEN",{mode:0o600});
 const authority={
  workBranch:f.config.workBranch,
  operationalSessionStore:new TrustedOperationalSessionStore(f.config.directories.operationalSessions)
 };
 let reservations=0;
 const root={credential_id:"urn:operational-root"};
 const operational={
  journalDirectory,orchestratorTokenFile,
  workflow:{createBranch:{branch:authority.workBranch,baseBranch:"main"}},
  reserveRoot:async()=>{reservations++;return root;},
  completionObserver:new TrustedAuthorityOnlyCompletionObserver({
   readVerifiedCompletion:async()=>{throw Error("unexpected provider call");}
  }),
  prepareNativeEffects:async()=>{throw Error("unexpected native binding");}
 };
 await assert.rejects(createProtectedCanonicalOperationalProvision(authority,{
  ...operational,workflow:{createBranch:{branch:"feature/foreign",baseBranch:"main"}}
 }),/bootstrap denied/u);
 await chmod(orchestratorTokenFile,0o644);
 await assert.rejects(createProtectedCanonicalOperationalProvision(authority,operational),
  /bootstrap denied/u);
 await chmod(orchestratorTokenFile,0o600);
 const provision=await createProtectedCanonicalOperationalProvision(authority,operational);
 assert.equal(reservations,0);
 const result=await provision();
 assert.equal(result.root,root);
 assert.equal(result.dependencies.operationalSessionStore,authority.operationalSessionStore);
 assert.notEqual(result.dependencies.issuerChildJournal,result.dependencies.gatewayChildJournal);
 assert.equal(result.dependencies.nativeCryptoPort.kind,"rust-native");
 assert.equal(typeof result.dependencies.nativeCryptoPort.issueChildViaPrivateMcp,"function");
 await assert.rejects(provision(),/bootstrap denied/u);
 assert.equal(reservations,1);

 const directories=Object.fromEntries([
  "mutationIntent","giteaReceipts","runnerIntent","runnerFailureReceipts","runnerPassReceipts"
 ].map(name=>[name,f.at(name)]));
 await Promise.all(Object.values(directories).map(dir=>mkdir(dir,{mode:0o700})));
 const {prepareNativeEffects,...base}=operational;
 const builtIn={
  ...base,workflow:{
   createBranch:{...operational.workflow.createBranch,
    permission:{resource:"gitea://gitea.local/thesis/iam",operation:"create_branch"}},
   draftPullRequest:{headBranch:authority.workBranch,baseBranch:"main",
    permission:{resource:"gitea://gitea.local/thesis/iam",operation:"create_pull_request"}}
  },
  nativeEffects:{store:{},giteaClient:{},independentGiteaClient:{},runnerClient:{},
   runnerPassObserver:{},directories,evidenceKey:Buffer.alloc(32),
   installAuthorization(){throw Error("must wait for native binding");}},
  rootGateway:{audit:{},verifier:{},policy:{},executor:{}}
 };
 const pinnedAuthority={...authority,snapshot:f.config.snapshot};
 await assert.rejects(createProtectedCanonicalOperationalProvision(pinnedAuthority,{
  ...builtIn,workflow:{...builtIn.workflow,createBranch:{
   ...builtIn.workflow.createBranch,prepare(){throw Error("foreign transport");}
  }}
 }),/bootstrap denied/u);
 const builtInProvision=await createProtectedCanonicalOperationalProvision(pinnedAuthority,builtIn);
 assert.equal(reservations,1);
 const prepared=await builtInProvision();
 assert.equal(reservations,2);
 await assert.rejects(prepared.workflow.createBranch.prepare({
  agent_role:"orchestrator",tool:"create_branch"
 }),/bootstrap denied/u);
 assert.equal(typeof prepared.workflow.draftPullRequest.execute,"function");

 // R383.9: CREATE is opt-in ONLY when BOTH separately protected owner
 // directories exist. Reusing UPDATE receipts or an untrusted path is a deny.
 const createIntent=f.at("createIntent"),createReceipts=f.at("createReceipts");
 await mkdir(createIntent,{mode:0o700});
 await mkdir(createReceipts,{mode:0o700});
 const withNativeCreate={...directories,createIntent,createReceipts};
 const createOptions={...builtIn,nativeEffects:{
  ...builtIn.nativeEffects,directories:withNativeCreate
 }};
 const createProvision=await createProtectedCanonicalOperationalProvision(
  pinnedAuthority,createOptions);
 assert.equal(typeof createProvision,"function");
 await assert.rejects(createProtectedCanonicalOperationalProvision(
  pinnedAuthority,{...createOptions,nativeEffects:{
   ...createOptions.nativeEffects,directories:{...directories,createIntent}
  }}
 ),/bootstrap denied/u);
 await chmod(createReceipts,0o755);
 await assert.rejects(createProtectedCanonicalOperationalProvision(
  pinnedAuthority,createOptions),/bootstrap denied/u);
 await chmod(createReceipts,0o700);
 await assert.rejects(createProtectedCanonicalOperationalProvision(
  pinnedAuthority,{...createOptions,nativeEffects:{
   ...createOptions.nativeEffects,directories:{
    ...directories,createIntent,createReceipts:directories.giteaReceipts
   }
  }}
 ),/bootstrap denied/u);

 const reservationDirectory=f.at("status-reservations");
 await mkdir(reservationDirectory,{mode:0o700});
 const {reserveRoot,...nativeOptions}=operational;
 const rootAuthority={...pinnedAuthority,preliminaryRoot:f.config.preliminaryRoot};
 const rootReservation={directory:reservationDirectory,index:"19",validitySeconds:600};
 await assert.rejects(createProtectedCanonicalOperationalProvision(rootAuthority,{
  ...nativeOptions,rootReservation:{...rootReservation,index:f.config.preliminaryRoot.credential_status.statusListIndex}
 }),/bootstrap denied/u);
 const provisioners=await Promise.all([1,2].map(()=>
  createProtectedCanonicalOperationalProvision(rootAuthority,{...nativeOptions,rootReservation})));
 assert.deepEqual(await readdir(reservationDirectory),[]);
 const attempts=await Promise.allSettled(provisioners.map(make=>make()));
 const successes=attempts.filter(result=>result.status==="fulfilled");
 assert.equal(successes.length,1);
 assert.equal(successes[0].value.root.credential_status.statusListIndex,"19");
 assert.match(attempts.find(result=>result.status==="rejected").reason.message,/already reserved/u);
 assert.equal((await readdir(reservationDirectory)).length,1);

});

test("canonical deployment rejects extra configuration and missing billing consent before native startup",async t=>{
 const f=await fixture(t);
 const {prepareOperational}=await import("../src/canonical-owner-deployment.mjs");
 const deployment=f.at("deployment.json");
 await writeFile(deployment,JSON.stringify({unexpected:true}),{mode:0o600});
 for(const [name,value] of Object.entries({
  DELEGATION_ENGINEER_SERVICE_CONFIG:f.configPath,
  DELEGATION_CANONICAL_DEPLOYMENT_CONFIG:deployment
 })){
  const previous=process.env[name];
  t.after(()=>{if(previous===undefined)delete process.env[name];else process.env[name]=previous;});
  process.env[name]=value;
 }
 await assert.rejects(prepareOperational({expectedSourceSha:SHA}),/configuration denied/u);
 await assert.rejects(prepareOperational({
  expectedSourceSha:SHA,chargeAuthorization:"I AUTHORIZE GEMINI API CHARGES"
 }),/configuration denied/u);
});

test("Protected 0600 manifest admits one Owner-pinned additional read specialist, never inferred power",async t=>{
 const f=await fixture(t);
 const name="reviewer",key="ADAPTER_ID_REVIEWER";
 const previous=process.env[key];
 t.after(()=>{if(previous===undefined)delete process.env[key];
  else process.env[key]=previous;});
 const did="did:ethr:0x7a69:0x"+"7".repeat(40);
 process.env[key]=did;
 const pin={did,card_ref:"trusted:source-reviewer",capabilities:["read_file"]};
 const baseline=structuredClone(f.config);
 baseline.trustedAgentRegistry.reviewer=pin;
 await f.save(baseline);
 const accepted=await f.load();
 assert.deepEqual(accepted.pins.trustedAgentRegistry.reviewer,pin);
 assert.equal(Object.isFrozen(accepted.pins.trustedAgentRegistry.reviewer),true);
 const bad=[
  value=>{value.trustedAgentRegistry.reviewer.capabilities=["run_tests"];},
  value=>{value.trustedAgentRegistry.reviewer.capabilities=["update_file"];},
  value=>{value.trustedAgentRegistry.reviewer.capabilities=["read_file","read_file"];},
  value=>{value.trustedAgentRegistry.reviewer.did=value.trustedAgentRegistry.backend.did;},
  value=>{value.trustedAgentRegistry.reviewer.nativeSignerPrivateKey="forbidden";},
  value=>{value.trustedAgentRegistry.constructor={...pin};},
  value=>{value.trustedAgentRegistry.orchestrator.capabilities.push("read_file");}
 ];
 for(const mutate of bad){
  const changed=structuredClone(baseline);mutate(changed);
  await f.save(changed);
  await assert.rejects(f.load(),/Protected canonical authority bootstrap denied/u);
 }
 await f.save(baseline);
 delete process.env[key];
 await assert.rejects(f.load(),/Protected canonical authority bootstrap denied/u);
 process.env[key]=did;
 assert.ok((await f.load()).pins.trustedAgentRegistry.reviewer);
});
