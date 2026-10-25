import test from "node:test";
import assert from "node:assert/strict";
import {fork} from "node:child_process";
import {randomBytes,generateKeyPairSync} from "node:crypto";
import {mkdtemp,mkdir,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {makeApproval,planDigest}
  from "../../../packages/plan-contracts/src/plan.mjs";
import {signEngineerApproval}
  from "../../../packages/plan-contracts/src/signed-approval.mjs";
import {SignedEngineerApprovalFileStore}
  from "../../../packages/orchestrator-runtime/src/signed-approval-store.ts";
import {RUST_OPERATIONS} from "../src/operation-catalog.ts";
import {TrustedApprovedExecutionPlans} from "../src/approved-execution-plans.ts";
import {GatewayCorroboratedTaskAttestor}
  from "../src/trusted-task-observation.ts";
import {TrustedPlanningRevisions} from "../src/planning-revisions.ts";
import {TrustedPlanningRetirementStore}
  from "../src/trusted-planning-retirement-store.ts";
import {TrustedPlanIpcClient,createTrustedPlanIpcServer}
  from "../src/trusted-plan-ipc.ts";

const REPO={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const URI="gitea://gitea.local/thesis/iam-console-poc";
const SESSION="sigkill-engineer-handoff",SHA="a".repeat(40);
const DID="did:thesis:engineer",KEY_ID="process-crash-key";
const PLAN={
  schema_version:"1.0.0",plan_id:"sigkill-signed-review",
  session_id:SESSION,version:1,repository:REPO,base_revision:SHA,
  requirement:"Create feature branch with independently signed approval",
  candidate_agents:[{
    agent_id:"backend",did:"did:thesis:backend",card_ref:"trusted:backend"
  }],
  tasks:[{
    id:"branch",agent_id:"orchestrator",title:"Create isolated branch",
    description:"Approved main-derived branch",depends_on:[],resources:[URI]
  }],
  requested_permissions:[{
    id:"permission-branch",task_id:"branch",agent_id:"orchestrator",
    resource:URI,operation:"create_branch",reason:"Bounded human approval"
  }],
  assumptions:[],uncertainties:[]
};
function child(mode:string,configPath:string){
  const cp=fork(fileURLToPath(new URL("./fixtures/trusted-two-root-crash-worker.ts",
    import.meta.url)),[],{
    execArgv:["--experimental-strip-types"],
    env:{...process.env,TWO_ROOT_CRASH_CONFIG:configPath,
      TWO_ROOT_CRASH_MODE:mode},
    stdio:["ignore","pipe","pipe","ipc"]
  });
  let stderr="";
  cp.stderr?.on("data",x=>{stderr+=String(x).slice(0,2500);});
  return {cp,error:()=>stderr};
}
async function result(worker:ReturnType<typeof child>){
  return new Promise<any>((resolve,reject)=>{
    const timer=setTimeout(()=>{
      worker.cp.kill("SIGKILL");
      reject(Error("Engineer crash worker timed out: "+worker.error()));
    },20000);
    function done(value:unknown){
      clearTimeout(timer);
      worker.cp.off("exit",early);
      resolve(value);
    }
    function early(code:number|null,signal:string|null){
      clearTimeout(timer);
      worker.cp.off("message",done);
      reject(Error("Engineer process exited "+code+"/"+signal+": "+worker.error()));
    }
    worker.cp.once("message",done);
    worker.cp.once("exit",early);
  });
}
async function terminate(cp:ReturnType<typeof child>["cp"]){
  if(cp.exitCode!==null||cp.signalCode!==null)return;
  const exited=new Promise<void>(resolve=>cp.once("exit",()=>resolve()));
  cp.kill("SIGKILL");
  await exited;
}
test("SIGKILL Engineer PID after signed operational issuance; independent PIDs recover without reissue",async t=>{
  const home=await mkdtemp(join(tmpdir(),"trusted-engineer-sigkill-"));
  const privateDir=join(home,"private"),approvalDir=join(home,"approvals"),
    planningDir=join(home,"planning"),operationalDir=join(home,"operational"),
    retirementDir=join(home,"gateway-retirements");
  for(const dir of [privateDir,approvalDir,planningDir,operationalDir,retirementDir])
    await mkdir(dir,{mode:0o700});
  const secretFile=join(privateDir,"ipc-secret.hex");
  const socketPath=join(privateDir,"trusted.sock");
  const configFile=join(privateDir,"worker.json");
  const revocationLog=join(privateDir,"scripted-rust-revocation.log");
  const keys=generateKeyPairSync("ed25519");
  const publicKey=keys.publicKey.export({format:"pem",type:"spki"}).toString();
  const privateKey=keys.privateKey.export({format:"pem",type:"pkcs8"}).toString();
  const now=new Date();
  const approval=makeApproval(PLAN,{
    allowedOperations:new Set(RUST_OPERATIONS),
    decision_id:"sigkill-human-decision",
    approved_by:DID,approved_at:now.toISOString(),
    approved_permission_ids:["permission-branch"]
  });
  const receipt=signEngineerApproval({
    plan:PLAN,approval,engineerDid:DID,keyId:KEY_ID,
    privateKeyPem:privateKey,issuedAt:now.toISOString(),
    expiresAt:new Date(now.getTime()+600000).toISOString()
  });
  await writeFile(join(approvalDir,SESSION+".json"),
    JSON.stringify(receipt),{mode:0o600});
  await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",{mode:0o600});
  const cfg={approvalDir,socketPath,secretFile,retirementDir,
    repository:REPO,engineerDid:DID,keyId:KEY_ID,publicKey,
    planningDir,operationalDir,revocationLog,baseRevision:SHA,
    sessionId:SESSION,planningRoot:"urn:process-kill:provisional",
    operationalRoot:"urn:process-kill:operational"};
  await writeFile(configFile,JSON.stringify(cfg),{mode:0o600});
  const workers:ReturnType<typeof child>[]=[];
  let gateway:Awaited<ReturnType<typeof createTrustedPlanIpcServer>>|undefined;
  t.after(async()=>{
    for(const worker of workers)await terminate(worker.cp);
    await gateway?.close();
    await rm(home,{recursive:true,force:true});
  });
  const store=new SignedEngineerApprovalFileStore({
    directory:approvalDir,engineerDid:DID,
    trustedKeys:{[KEY_ID]:{engineer_did:DID,public_key_pem:publicKey}}
  });
  assert.equal(planDigest((await store.loadAuthenticatedApproval(SESSION)).plan),
    planDigest(PLAN));
  const durable=new TrustedPlanningRetirementStore(retirementDir);
  await durable.assertReady();
  const revisions=new TrustedPlanningRevisions({
    async readRepository(){return {default_branch:"main",revision:SHA};}
  },{retirementStore:durable});
  const plans=new TrustedApprovedExecutionPlans({
    repository:REPO,engineerDid:DID,approvals:store,
    operationalLeaseMs:120000,
    completionAttestor:new GatewayCorroboratedTaskAttestor()
  });
  gateway=await createTrustedPlanIpcServer({
    socketPath,secretFile,plans,planningRevisions:revisions
  });
  await gateway.start();
  const ipc=await TrustedPlanIpcClient.connect({socketPath,secretFile});
  assert.equal(ipc.planningRetirementDurableConfigured(),true);
  const start=async(mode:string)=>{
    const worker=child(mode,configFile);
    workers.push(worker);
    return {worker,data:await result(worker)};
  };
  const issuer=await start("issue");
  assert.equal(issuer.data.phase,"issued");
  assert.notEqual(issuer.data.pid,process.pid);
  const processExit=new Promise<string|null>(resolve=>
    issuer.worker.cp.once("exit",(_code,signal)=>resolve(signal)));
  issuer.worker.cp.kill("SIGKILL");
  assert.equal(await processExit,"SIGKILL");
  const uncertain=await start("uncertain");
  assert.equal(uncertain.data.phase,"uncertain");
  assert.notEqual(uncertain.data.pid,issuer.data.pid);
  assert.deepEqual(uncertain.data.events,[
    "gateway:"+SESSION,"revoke:"+cfg.operationalRoot
  ]);
  const restored=await start("recover");
  assert.equal(restored.data.phase,"recovered");
  assert.notEqual(restored.data.pid,issuer.data.pid);
  assert.deepEqual(restored.data.events,[
    "gateway:"+SESSION,"revoke:"+cfg.operationalRoot
  ]);
  assert.equal(await readFile(revocationLog,"utf8"),
    "revoked:"+cfg.operationalRoot+"\n");
  const repeat=await start("repeat");
  assert.equal(repeat.data.phase,"replay-blocked");
  assert.deepEqual(repeat.data.events,[]);
  await assert.rejects(ipc.activate(SESSION,SHA),/Gateway trusted control denied/);
  // Original Gateway instance already has an in-memory retired session.
  await assert.rejects(revisions.begin(SESSION,5000),
    /Planning session already registered/);
  // A genuinely fresh registry must still deny the session from the
  // fsynced Planning retirement tombstone, not from the old Map.
  const restartedRevisions=new TrustedPlanningRevisions({
    async readRepository(){return {default_branch:"main",revision:SHA};}
  },{retirementStore:new TrustedPlanningRetirementStore(retirementDir)});
  await assert.rejects(restartedRevisions.begin(SESSION,5000),
    /retired Planning session cannot be registered/);
});
