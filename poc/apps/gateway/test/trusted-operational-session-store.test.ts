import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,chmod,writeFile,readdir,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {makeApproval,planDigest}
  from "../../../packages/plan-contracts/src/plan.mjs";
import {RUST_OPERATIONS} from "../src/operation-catalog.ts";
import {TrustedOperationalSessionStore}
  from "../src/trusted-operational-session-store.ts";
import {TrustedApprovedExecutionPlans}
  from "../src/approved-execution-plans.ts";

const REPO={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const URI="gitea://gitea.local/thesis/iam-console-poc";
const SHA="a".repeat(40),DID="did:thesis:engineer";
const SESSION="engineer-operational-reboot";
const plan={
  schema_version:"1.0.0",plan_id:"operational-fence-test",
  session_id:SESSION,version:1,repository:REPO,base_revision:SHA,
  requirement:"Create one isolated branch",
  candidate_agents:[{
    agent_id:"backend",did:"did:thesis:backend",card_ref:"trusted:backend"
  }],
  tasks:[{
    id:"branch",agent_id:"orchestrator",
    title:"Prepare approved branch",description:"Single scoped operation",
    depends_on:[],resources:[URI]
  }],
  requested_permissions:[{
    id:"p-branch",task_id:"branch",agent_id:"orchestrator",
    resource:URI,operation:"create_branch",reason:"Engineer authorizes branch"
  }],
  assumptions:[],uncertainties:[]
};
async function fixture(){
  const directory=await mkdtemp(join(tmpdir(),"gateway-operational-durable-"));
  const store=new TrustedOperationalSessionStore(directory);
  return {directory,store,close:()=>rm(directory,{recursive:true,force:true})};
}
function registry(store:TrustedOperationalSessionStore,
  load=async()=>({
    plan:structuredClone(plan),approval:makeApproval(plan,{
      allowedOperations:new Set(RUST_OPERATIONS),
      decision_id:"signed-engineer-decision",approved_by:DID,
      approved_at:new Date().toISOString(),
      approved_permission_ids:["p-branch"]
    }),authenticated_engineer_did:DID
  })){
  return new TrustedApprovedExecutionPlans({
    repository:REPO,engineerDid:DID,
    approvals:{loadAuthenticatedApproval:load},
    completionAttestor:{async confirmCompleted(){return true;}},
    operationalLeaseMs:120000,operationalSessionStore:store
  });
}
test("disk-fsynced activation fence prevents signed approval replay after Gateway restart",async()=>{
  const f=await fixture();
  try{
    await f.store.assertReady();
    const initial=registry(f.store);
    assert.equal(await initial.activate(SESSION,SHA),planDigest(plan));
    const fresh=registry(new TrustedOperationalSessionStore(f.directory));
    await assert.rejects(fresh.activate(SESSION,SHA),
      /operational session already used or retired/);
    // A recovered Engineer can still send idempotent retirement, but no
    // second activation is possible even if a signed receipt remains valid.
    await fresh.retireSession(SESSION);
    await fresh.retireSession(SESSION);
    await assert.rejects(registry(new TrustedOperationalSessionStore(
      f.directory)).activate(SESSION,SHA),/already used or retired/);
    assert.equal((await readdir(f.directory)).length,1);
  }finally{await f.close();}
});
test("retire-before-activation remains durable without ever loading human consent",async()=>{
  const f=await fixture();
  try{
    let loads=0;
    const initial=registry(f.store,async()=>{
      loads++;throw Error("approval must not be loaded");
    });
    await initial.retireSession(SESSION);
    await assert.rejects(initial.activate(SESSION,SHA),/already installed or closed/);
    await assert.rejects(registry(new TrustedOperationalSessionStore(
      f.directory),async()=>{
        loads++;throw Error("approval must not be loaded");
      }).activate(SESSION,SHA),/already used or retired/);
    assert.equal(loads,0);
    assert.equal((await readdir(f.directory)).length,1);
  }finally{await f.close();}
});
test("concurrent retirement fences an awaiting signed-approval activation",async()=>{
  const f=await fixture();
  try{
    let entered!:()=>void;
    const loading=new Promise<void>(resolve=>{entered=resolve;});
    let release!:(x:any)=>void;
    const hold=new Promise<any>(resolve=>{release=resolve;});
    const same=registry(f.store,async()=>{
      entered();return hold;
    });
    const attempting=same.activate(SESSION,SHA);
    const rejected=assert.rejects(attempting,/retired while verifying signed approval/);
    await loading; // Durable activation intent already fsynced.
    await same.retireSession(SESSION);
    release({
      plan:structuredClone(plan),approval:makeApproval(plan,{
        allowedOperations:new Set(RUST_OPERATIONS),
        decision_id:"legitimate-late-approval",approved_by:DID,
        approved_at:new Date().toISOString(),
        approved_permission_ids:["p-branch"]
      }),authenticated_engineer_did:DID
    });
    await rejected;
    await assert.rejects(registry(new TrustedOperationalSessionStore(
      f.directory)).activate(SESSION,SHA),/already used or retired/);
  }finally{await f.close();}
});
test("corrupted, incomplete or shared Gateway operational journal fails before startup",async()=>{
  const f=await fixture();
  try{
    await f.store.reserveActivation(SESSION);
    const [entry]=await readdir(f.directory);
    assert.match(entry,/^[a-f0-9]{64}\.json$/u);
    const file=join(f.directory,entry);
    const original=await readFile(file,"utf8");
    assert.equal(JSON.parse(original).event,"activation_reserved");
    await writeFile(file,"{");
    await assert.rejects(new TrustedOperationalSessionStore(
      f.directory).assertReady(),/unsafe or incomplete operational journal/);
    await writeFile(file,"{"+" ".repeat(90));
    await assert.rejects(f.store.assertReady(),/corrupt operational journal JSON/);
    await writeFile(file,original);
    await chmod(f.directory,0o755);
    await assert.rejects(f.store.assertReady(),/directory must be owner-only/);
  }finally{await f.close();}
});
