import assert from "node:assert/strict";
import test from "node:test";
import {generateKeyPairSync} from "node:crypto";
import {mkdtemp,writeFile,chmod,symlink,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {SignedAuthorityOnlyFileStore}
 from "../src/signed-authority-only-store.ts";
import {selectAuthorityOnlyGrant,signAuthorityOnlyGrant}
 from "../../../packages/plan-contracts/src/authority-only-approval.mjs";

const REPO={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const ROOT="gitea://gitea.local/thesis/iam-console-poc";
const BRANCH="feature/account-suspension";
const FILE=ROOT+"/branches/feature%2Faccount-suspension/files/apps/backend/src/user.ts";
const OPERATIONS=new Set(["create_branch","read_file","update_file"]);
const KEY_ID="trusted-key",DID="did:example:engineer";
const KEYS=generateKeyPairSync("ed25519");
const TRUSTED={[KEY_ID]:{
 engineer_did:DID,public_key_pem:KEYS.publicKey.export({format:"pem",type:"spki"})
}};
const privateKeyPem=KEYS.privateKey.export({format:"pem",type:"pkcs8"});
function receipt(session_id="session-authority"){
 const proposal={
  schema_version:"1.0.0",session_id,repository:REPO,branch:BRANCH,
  base_revision:"a".repeat(40),requirement:"Implement approved feature",
  requested_permissions:[
   {resource:ROOT,operation:"create_branch"},
   {resource:FILE,operation:"read_file"},
   {resource:FILE,operation:"update_file"}
  ]
 };
 return signAuthorityOnlyGrant({
  authorization:selectAuthorityOnlyGrant(proposal,
    proposal.requested_permissions,{allowedOperations:OPERATIONS}),
  engineerDid:DID,keyId:KEY_ID,privateKeyPem,
  issuedAt:"2026-11-05T07:00:00Z",
  expiresAt:"2026-11-05T08:00:00Z",
  allowedOperations:OPERATIONS
 });
}
async function fixture(run){
 const dir=await mkdtemp(join(tmpdir(),"delegation-authority-only-"));
 await chmod(dir,0o700);
 const store=(nowMs=Date.parse("2026-11-05T07:15:00Z"),trustedKeys=TRUSTED)=>
  new SignedAuthorityOnlyFileStore({
   directory:dir,engineerDid:DID,trustedKeys,nowMs:()=>nowMs
  });
 const save=async(name,data=receipt(),mode=0o600)=>{
  const file=join(dir,name+".json");
  await writeFile(file,typeof data==="string"?data:JSON.stringify(data),{mode});
  await chmod(file,mode);
  return file;
 };
 try{return await run({dir,store,save});}
 finally{await rm(dir,{force:true,recursive:true});}
}
test("R284 trusted receipt store loads only Engineer-signed authority, not signed Task DAG",async()=>{
 await fixture(async({store,save})=>{
  await save("session-authority");
  const trusted=await store().loadAuthenticatedAuthority("session-authority");
  assert.equal(trusted.authenticated,true);
  assert.equal(trusted.authenticated_engineer_did,DID);
  assert.equal(trusted.authorization.session_id,"session-authority");
  assert.equal(trusted.authorization.permissions.length,3);
  assert.equal("tasks" in trusted.authorization,false);
  assert.equal("candidate_agents" in trusted.authorization,false);
  assert.equal(trusted.authority_digest.length,64);
 });
});
test("R284 store rejects wrong session, private-key mismatch, tampering and expiry",async()=>{
 await fixture(async({store,save})=>{
  await save("different-session",receipt("session-authority"));
  await assert.rejects(store().loadAuthenticatedAuthority("different-session"),/session differs/);
  const altered=receipt();
  altered.authorization.permissions[0].operation="update_file";
  await save("session-authority",altered);
  await assert.rejects(store().loadAuthenticatedAuthority("session-authority"));
  await save("session-authority",receipt());
  await assert.rejects(store(Date.parse("2026-11-05T08:00:00Z"))
   .loadAuthenticatedAuthority("session-authority"),/expired/);
  await assert.rejects(store(Date.parse("2026-11-05T07:15:00Z"),{
    "other-key":TRUSTED[KEY_ID]
  }).loadAuthenticatedAuthority("session-authority"),/untrusted/);
 });
});
test("R284 store rejects untrusted paths and insecure receipt filesystem objects",async()=>{
 await fixture(async({dir,store,save})=>{
  await assert.rejects(store().loadAuthenticatedAuthority("../outside"),/Invalid authority session/);
  await save("session-authority",receipt(),0o644);
  await assert.rejects(store().loadAuthenticatedAuthority("session-authority"),/owner-only/);
  await save("session-authority",receipt(),0o600);
  await assert.rejects(store().loadAuthenticatedAuthority("missing-session"));
  const target=await save("other-session",receipt());
  await symlink(target,join(dir,"linked-session.json"));
  await assert.rejects(store().loadAuthenticatedAuthority("linked-session"));
  await chmod(dir,0o755);
  await assert.rejects(store().loadAuthenticatedAuthority("session-authority"),/private real directory/);
 });
});
