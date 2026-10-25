import test from "node:test";
import assert from "node:assert/strict";
import {fork} from "node:child_process";
import {generateKeyPairSync,randomBytes} from "node:crypto";
import {mkdtemp,mkdir,writeFile,rm,lstat,unlink,readdir} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {makeApproval,planDigest}
  from "../../../packages/plan-contracts/src/plan.mjs";
import {signEngineerApproval}
  from "../../../packages/plan-contracts/src/signed-approval.mjs";
import {RUST_OPERATIONS} from "../src/operation-catalog.ts";
import {TrustedPlanIpcClient} from "../src/trusted-plan-ipc.ts";
import {TrustedOperationalSessionStore}
  from "../src/trusted-operational-session-store.ts";

const REPO={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const URI="gitea://gitea.local/thesis/iam-console-poc";
const SHA="a".repeat(40),SESSION="gateway-reboot-signed-session";
const DID="did:thesis:engineer",KEY_ID="gateway-reboot-test";
const PLAN={
  schema_version:"1.0.0",plan_id:"gateway-process-kill",
  session_id:SESSION,version:1,repository:REPO,base_revision:SHA,
  requirement:"Create one branch under authenticated Engineer approval",
  candidate_agents:[{
    agent_id:"backend",did:"did:thesis:backend",card_ref:"trusted:backend"
  }],
  tasks:[{
    id:"branch",agent_id:"orchestrator",
    title:"Prepare branch",description:"One authorized branch",
    depends_on:[],resources:[URI]
  }],
  requested_permissions:[{
    id:"p-branch",task_id:"branch",agent_id:"orchestrator",
    resource:URI,operation:"create_branch",reason:"Explicit Engineer grant"
  }],
  assumptions:[],uncertainties:[]
};
const fixtureUrl=new URL("./fixtures/trusted-plan-ipc-child.ts",import.meta.url);
function child(configFile:string,secretFile:string,socketPath:string){
  const cp=fork(fileURLToPath(fixtureUrl),[],{
    execArgv:["--experimental-strip-types"],
    env:{...process.env,IPC_TEST_CONFIG:configFile,
      TRUSTED_PLAN_IPC_SOCKET:socketPath,
      TRUSTED_PLAN_IPC_SECRET_FILE:secretFile,
      TRUSTED_PLAN_OPERATIONAL_LEASE_MS:"120000"},
    stdio:["ignore","pipe","pipe","ipc"]
  });
  let stderr="";
  cp.stderr?.on("data",x=>{stderr+=String(x).slice(0,2000);});
  return {cp,error:()=>stderr};
}
function ready(proc:ReturnType<typeof child>):Promise<any>{
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{
      proc.cp.kill("SIGKILL");
      reject(Error("Gateway restart fixture timed out: "+proc.error()));
    },20000);
    const onExit=(code:number|null,signal:string|null)=>{
      clearTimeout(timer);
      proc.cp.off("message",onMessage);
      reject(Error("Gateway exited "+code+"/"+signal+": "+proc.error()));
    };
    const onMessage=(value:unknown)=>{
      clearTimeout(timer);
      proc.cp.off("exit",onExit);resolve(value);
    };
    proc.cp.once("exit",onExit);
    proc.cp.once("message",onMessage);
  });
}
async function kill(cp:ReturnType<typeof child>["cp"]){
  if(cp.exitCode!==null||cp.signalCode!==null)return;
  const completed=new Promise<void>(resolve=>cp.once("exit",()=>resolve()));
  cp.kill("SIGKILL");
  await completed;
}

test("SIGKILL genuine Gateway IPC process does not replay signed operational activation after restart",async t=>{
  const home=await mkdtemp(join(tmpdir(),"gateway-real-sigkill-reboot-"));
  const secrets=join(home,"secrets"),receipts=join(home,"receipts"),
    operational=join(home,"gateway-operational"),
    retirement=join(home,"gateway-planning");
  for(const dir of [secrets,receipts,operational,retirement])
    await mkdir(dir,{mode:0o700});
  const socketPath=join(secrets,"trusted.sock");
  const secretFile=join(secrets,"hmac-secret.hex");
  const configFile=join(secrets,"gateway.json");
  const key=generateKeyPairSync("ed25519");
  const privatePem=key.privateKey.export({format:"pem",type:"pkcs8"}).toString();
  const publicPem=key.publicKey.export({format:"pem",type:"spki"}).toString();
  const now=new Date();
  const signed=signEngineerApproval({
    plan:PLAN,
    approval:makeApproval(PLAN,{
      allowedOperations:new Set(RUST_OPERATIONS),
      decision_id:"gateway-reboot-signed-decision",approved_by:DID,
      approved_at:now.toISOString(),approved_permission_ids:["p-branch"]
    }),
    engineerDid:DID,keyId:KEY_ID,privateKeyPem:privatePem,
    issuedAt:now.toISOString(),
    expiresAt:new Date(now.getTime()+600000).toISOString()
  });
  await writeFile(join(receipts,SESSION+".json"),
    JSON.stringify(signed),{mode:0o600});
  await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",{mode:0o600});
  await writeFile(configFile,JSON.stringify({
    approvalDir:receipts,socketPath,secretFile,retirementDir:retirement,
    operationalDir:operational,repository:REPO,repositoryBaseSha:SHA,
    engineerDid:DID,keyId:KEY_ID,publicKey:publicPem
  }),{mode:0o600});
  const workers:ReturnType<typeof child>[]=[];
  t.after(async()=>{
    for(const item of workers)await kill(item.cp);
    await rm(home,{recursive:true,force:true});
  });
  const boot=async()=>{
    const proc=child(configFile,secretFile,socketPath);
    workers.push(proc);
    const message=await ready(proc);
    assert.equal(message.ready,true);
    return {proc,pid:message.pid,
      ipc:await TrustedPlanIpcClient.connect({socketPath,secretFile})};
  };
  const first=await boot();
  assert.equal(first.ipc.operationalSessionDurableConfigured(),true);
  assert.equal(await first.ipc.activate(SESSION,SHA),planDigest(PLAN));
  const ledger=new TrustedOperationalSessionStore(operational);
  await ledger.assertReady();
  assert.equal((await readdir(operational)).length,1);
  // This is a REAL SIGKILL of the Gateway OS process, not a reallocated
  // in-memory registry. Unix socket cleanup happens only AFTER confirmed
  // process death; the test never removes a socket still owned by a peer.
  await kill(first.proc.cp);
  const stale=await lstat(socketPath);
  assert.equal(stale.isSocket(),true);
  await unlink(socketPath);
  const second=await boot();
  assert.notEqual(second.pid,first.pid);
  await assert.rejects(second.ipc.activate(SESSION,SHA),
    /Gateway trusted control denied/);
  // A recovery process may still terminally retire an already activated
  // session. The HMAC acknowledgement requires a durable ledger read.
  await second.ipc.retireSession(SESSION);
  await kill(second.proc.cp);
  const stale2=await lstat(socketPath);
  assert.equal(stale2.isSocket(),true);
  await unlink(socketPath);
  const third=await boot();
  assert.notEqual(third.pid,first.pid);
  await assert.rejects(third.ipc.activate(SESSION,SHA),
    /Gateway trusted control denied/);
  await third.ipc.retireSession(SESSION);
  assert.equal((await readdir(operational)).length,1);
  await ledger.assertReady();
  // No Rust, paid model, actual Gitea provider or EVM operation here.
  // The independent Rust/Adapter recovery intent must still be reconciled.
});
