import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,randomBytes} from "node:crypto";
import {mkdtemp,mkdir,writeFile,chmod,symlink,rm,readdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {
 loadProtectedCanonicalOwnerManifest,assembleProtectedCanonicalOwnerAuthority
} from "../src/trusted-authority-only-owner-bootstrap.mjs";

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
