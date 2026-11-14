import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,randomBytes} from "node:crypto";
import {execFileSync} from "node:child_process";
import {mkdtemp,mkdir,writeFile,chmod,symlink,rm,readdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {
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
  "ADAPTER_ENGINEER_NATIVE_SOCKET","ADAPTER_ADDITIONAL_SPECIALISTS",
  "ADAPTER_ID_REVIEWER","ADAPTER_CALLER_REVIEWER",
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
 return {root,at,config,configPath,save};
}
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

