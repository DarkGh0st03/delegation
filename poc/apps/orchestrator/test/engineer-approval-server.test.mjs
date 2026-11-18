import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,chmod} from "node:fs/promises";
import {request as httpRequest} from "node:http";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash,scryptSync,randomBytes,generateKeyPairSync} from "node:crypto";
import {createAuthenticatedEngineerServer} from "../src/engineer-approval-server.mjs";
import {compileAuthorityOnlyPlanningProposal}
  from "../../../packages/orchestrator-runtime/src/authority-only-planning-proposal.ts";
import {signAuthorityPlanningCheckpoint,AuthorityPlanningCheckpointStore}
  from "../../../packages/orchestrator-runtime/src/trusted-authority-planning-checkpoint.ts";
import {verifyAuthorityOnlyGrant}
  from "../../../packages/plan-contracts/src/authority-only-approval.mjs";
import {RUST_OPERATIONS} from "../../gateway/src/operation-catalog.ts";

// The review host opens this loopback API after the backend has signed the
// Planner's permission proposal. The console logs in with the Engineer
// password and submits the selected permission IDs; the server signs them.
const DID="did:thesis:software-engineer",PASSWORD="a-local-operator-test-password";
const KEYID="engineer-test-key";
const snapshot={session_id:"engineer-review",
  repository:{authority:"gitea.local",owner:"thesis",repository:"demo-app"},
  base_revision:"a".repeat(40),directories:["","src","test"],files:["src/app.js","test/app.test.js"]};
const BRANCH="feature/session-work",REQUIREMENT="Add a search box";
const proposal={...compileAuthorityOnlyPlanningProposal({requested_permissions:[
  {operation:"update_file",resource_type:"directory",path:"src"},
  {operation:"create_file",resource_type:"directory",path:"test"}
],assumptions:[],uncertainties:[]},{snapshot,requirement:REQUIREMENT,workBranch:BRANCH}),
verified_source_reads:1};

async function environment(t,{rejectPlanning,planningIsActive=()=>true}={}){
  const home=await mkdtemp(join(tmpdir(),"engineer-review-"));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const dir=join(home,"protected"),receipts=join(home,"receipts"),checkpoints=join(home,"checkpoints");
  for(const d of [dir,receipts,checkpoints])await mkdir(d,{mode:0o700});
  const keyFile=join(dir,"key.pem");
  const keys=generateKeyPairSync("ed25519");
  await writeFile(keyFile,keys.privateKey.export({format:"pem",type:"pkcs8"}).toString(),{mode:0o600});
  const backend=generateKeyPairSync("ed25519");
  const store=new AuthorityPlanningCheckpointStore({directory:checkpoints,trust:{
    trustedKeys:{backend:{public_key_pem:backend.publicKey.export({format:"pem",type:"spki"}).toString()}},
    expectedSessionId:snapshot.session_id,expectedRepository:snapshot.repository,
    expectedBaseRevision:snapshot.base_revision,expectedWorkBranch:BRANCH,
    expectedRequirement:REQUIREMENT}});
  const now=Date.now();
  await store.persistVerified(signAuthorityPlanningCheckpoint({snapshot,proposal,keyId:"backend",
    privateKeyPem:backend.privateKey.export({format:"pem",type:"pkcs8"}).toString(),
    issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+300000).toISOString()}));
  const salt=randomBytes(16);
  const config={
    architecture:"authority-only",engineerDid:DID,keyId:KEYID,
    expectedSessionId:snapshot.session_id,expectedBaseRevision:snapshot.base_revision,
    repository:snapshot.repository,expectedWorkBranch:BRANCH,expectedRequirement:REQUIREMENT,
    authorityCheckpointStore:store,privateKeyFile:keyFile,
    publicKeyPem:keys.publicKey.export({format:"pem",type:"spki"}).toString(),
    receiptDirectory:receipts,passwordSaltHex:salt.toString("hex"),
    passwordScryptHex:scryptSync(PASSWORD,salt,64).toString("hex"),
    planningIsActive,...(rejectPlanning?{rejectPlanning}:{})
  };
  const server=await createAuthenticatedEngineerServer(config);
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const root="http://127.0.0.1:"+server.address().port;
  const post=(path,body,cookie,csrf,origin=root)=>fetch(root+path,{
    method:"POST",headers:{"Content-Type":"application/json",Origin:origin,
      ...(cookie?{Cookie:cookie}:{}),...(csrf?{"X-CSRF-Token":csrf}:{})},
    body:JSON.stringify(body)});
  const login=async()=>{
    const result=await post("/api/login",{password:PASSWORD});
    assert.equal(result.status,200);
    return result.headers.get("set-cookie").split(";")[0];
  };
  const review=async cookie=>(await fetch(root+"/api/authorization",{headers:{Cookie:cookie}})).json();
  const receipt=join(receipts,snapshot.session_id+".json");
  return {config,receipts,receipt,keyFile,checkpoints,root,post,login,review};
}
const approve=(digest,ids=["permission-1"])=>({proposal_digest:digest,approved_permission_ids:ids,
  confirmation:"APPROVE "+digest});
const reject=digest=>({proposal_digest:digest,confirmation:"REJECT "+digest});
const noReceipt=path=>assert.rejects(readFile(path),error=>error.code==="ENOENT");

test("login, exact digest and CSRF are required; the receipt signs only the selected subset",async t=>{
  const e=await environment(t);
  assert.equal((await fetch(e.root+"/api/authorization")).status,401);
  assert.equal((await e.post("/api/login",{password:"wrong"})).status,401);
  assert.equal((await e.post("/api/login",{password:PASSWORD},null,null,"https://evil.example")).status,403);
  const cookie=await e.login();
  const info=await e.review(cookie);
  assert.equal(info.protocol,"authority-only");
  assert.deepEqual(info.permissions.map(p=>p.id),["permission-1","permission-2"]);
  const payload=approve(info.proposal_digest);
  assert.equal((await e.post("/api/approve",payload,cookie)).status,403);
  assert.equal((await e.post("/api/approve",approve("0".repeat(64)),cookie,info.csrf_token)).status,403);
  assert.equal((await e.post("/api/approve",approve(info.proposal_digest,["permission-1","bogus"]),
    cookie,info.csrf_token)).status,409);
  const signed=await e.post("/api/approve",payload,cookie,info.csrf_token);
  assert.equal(signed.status,201);
  const outcome=await signed.json();
  assert.equal(outcome.signed,true);
  assert.equal(outcome.permission_count,1);
  assert.equal(outcome.operational_credential_issued,false);
  const grant=verifyAuthorityOnlyGrant(JSON.parse(await readFile(e.receipt,"utf8")),{
    expectedEngineerDid:DID,allowedOperations:new Set(RUST_OPERATIONS),
    trustedKeys:{[KEYID]:{engineer_did:DID,public_key_pem:e.config.publicKeyPem}}});
  assert.deepEqual(grant.authorization.permissions,[proposal.proposal.requested_permissions[0]]);
  // The session is consumed; a second approval cannot replace the receipt.
  assert.equal((await e.post("/api/approve",payload,cookie,info.csrf_token)).status,401);
  const next=await e.login();
  assert.equal((await e.post("/api/approve",payload,next,(await e.review(next)).csrf_token)).status,409);
});

test("host, origin and configuration are pinned to loopback and owner-only files",async t=>{
  const e=await environment(t);
  const hostProbe=await new Promise((resolve,reject)=>{
    const req=httpRequest(e.root+"/api/authorization",{headers:{Host:"evil.example"}},res=>{
      res.resume();res.on("end",()=>resolve(res.statusCode));
    });
    req.on("error",reject);req.end();
  });
  assert.equal(hostProbe,403);
  assert.equal((await fetch(e.root+"/")).status,401);
  assert.equal((await e.post("/api/approve",{},null,null)).status,401);
  await assert.rejects(createAuthenticatedEngineerServer({...e.config,host:"0.0.0.0"}),/Invalid local/);
  await assert.rejects(createAuthenticatedEngineerServer({...e.config,architecture:undefined}),
    /authority-only architecture/);
  await chmod(e.keyFile,0o644);
  await assert.rejects(createAuthenticatedEngineerServer(e.config),/owner-only/);
});

test("a mutated backend checkpoint is refused at review and at signing",async t=>{
  const e=await environment(t);
  const cookie=await e.login();
  const info=await e.review(cookie);
  const [file]=await readdir(e.checkpoints);
  const signed=JSON.parse(await readFile(join(e.checkpoints,file),"utf8"));
  signed.proposal.requested_permissions[0].path="test";
  await writeFile(join(e.checkpoints,file),JSON.stringify(signed),{mode:0o600});
  assert.notEqual((await fetch(e.root+"/api/authorization",{headers:{Cookie:cookie}})).status,200);
  assert.notEqual((await e.post("/api/approve",approve(info.proposal_digest),cookie,info.csrf_token)).status,201);
  await noReceipt(e.receipt);
});

test("a retired Planning root cannot be reviewed or signed",async t=>{
  let active=true;
  const e=await environment(t,{planningIsActive:()=>active});
  const cookie=await e.login();
  const info=await e.review(cookie);
  active=false;
  assert.equal((await fetch(e.root+"/api/authorization",{headers:{Cookie:cookie}})).status,409);
  assert.equal((await e.post("/api/approve",approve(info.proposal_digest),cookie,info.csrf_token)).status,409);
  await noReceipt(e.receipt);
});

test("rejection is CSRF-bound, terminal and retires Planning once",async t=>{
  let revoked=0;
  const e=await environment(t,{rejectPlanning:async()=>{revoked++;}});
  const cookie=await e.login();
  const info=await e.review(cookie);
  assert.equal(info.reject_enabled,true);
  const payload=reject(info.proposal_digest);
  assert.equal((await e.post("/api/reject",payload,cookie)).status,403);
  assert.equal((await e.post("/api/reject",{...payload,confirmation:"APPROVE "+info.proposal_digest},
    cookie,info.csrf_token)).status,403);
  assert.equal((await e.post("/api/reject",reject("0".repeat(64)),cookie,info.csrf_token)).status,403);
  assert.equal(revoked,0);
  const rejected=await e.post("/api/reject",payload,cookie,info.csrf_token);
  assert.equal(rejected.status,200);
  assert.deepEqual(await rejected.json(),{rejected:true,provisional_credential_revoked:true,
    operational_credential_issued:false,proposal_digest:info.proposal_digest});
  assert.equal(revoked,1);
  const fresh=await e.login();
  assert.equal((await fetch(e.root+"/api/authorization",{headers:{Cookie:fresh}})).status,409);
  await noReceipt(e.receipt);
  // A restart cannot reopen a rejected session.
  await assert.rejects(createAuthenticatedEngineerServer(e.config),
    /prior Engineer rejection intent forbids restarting review/);
});

test("rejection without a retirement hook is unavailable",async t=>{
  const e=await environment(t);
  const cookie=await e.login();
  const info=await e.review(cookie);
  assert.equal(info.reject_enabled,false);
  assert.equal((await e.post("/api/reject",reject(info.proposal_digest),cookie,info.csrf_token)).status,404);
});

test("an unconfirmed retirement permanently blocks signing, also after restart",async t=>{
  let attempts=0;
  const e=await environment(t,{rejectPlanning:async()=>{attempts++;throw Error("revocation unavailable");}});
  const cookie=await e.login();
  const info=await e.review(cookie);
  assert.equal((await e.post("/api/reject",reject(info.proposal_digest),cookie,info.csrf_token)).status,500);
  assert.equal(attempts,1);
  assert.equal((await e.post("/api/reject",reject(info.proposal_digest),cookie,info.csrf_token)).status,409);
  assert.equal((await e.post("/api/approve",approve(info.proposal_digest),cookie,info.csrf_token)).status,409);
  await noReceipt(e.receipt);
  await assert.rejects(createAuthenticatedEngineerServer(e.config),
    /prior Engineer rejection intent forbids restarting review/);
});

test("a signed approval cannot be undone by a later rejection",async t=>{
  let attempts=0;
  const e=await environment(t,{rejectPlanning:async()=>{attempts++;}});
  const cookie=await e.login();
  const info=await e.review(cookie);
  assert.equal((await e.post("/api/approve",approve(info.proposal_digest),cookie,info.csrf_token)).status,201);
  const fresh=await e.login();
  assert.equal((await e.post("/api/reject",reject(info.proposal_digest),fresh,
    (await e.review(fresh)).csrf_token)).status,409);
  assert.equal(attempts,0);
});

test("a partial or tampered rejection intent never allows replay",async t=>{
  const e=await environment(t);
  const name=createHash("sha256").update(snapshot.session_id).digest("hex")+".rejection-intent.json";
  const file=join(e.receipts,name);
  // Emulate a crash after exclusive creation but before complete fsync.
  await writeFile(file,"{",{mode:0o600});
  await assert.rejects(createAuthenticatedEngineerServer(e.config),
    /prior Engineer rejection intent forbids restarting review/);
  assert.equal(await readFile(file,"utf8"),"{");
});
