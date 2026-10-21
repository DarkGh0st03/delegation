import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {randomBytes,generateKeyPairSync,createHmac,createHash} from "node:crypto";
import {fork} from "node:child_process";
import {request as httpRequest} from "node:http";
import {makeApproval,planDigest} from "../../../packages/plan-contracts/src/plan.mjs";
import {signEngineerApproval} from "../../../packages/plan-contracts/src/signed-approval.mjs";
import {SignedEngineerApprovalFileStore} from
  "../../../packages/orchestrator-runtime/src/signed-approval-store.ts";
import {TrustedEngineerAuthoritySession} from
  "../../../packages/orchestrator-runtime/src/trusted-engineer-authority.ts";
import {TrustedExecutionCoordinator} from
  "../../../packages/orchestrator-runtime/src/trusted-execution-coordinator.ts";
import {TrustedPlanIpcClient} from "../src/trusted-plan-ipc.ts";
import {RUST_OPERATIONS} from "../src/operation-catalog.ts";

const REPO={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const URI="gitea://gitea.local/thesis/iam-console-poc";
const DID="did:thesis:engineer",SHA="a".repeat(40);
const KEY_ID="engineer-ipc-test-key";
const OPERATIONS=new Set<string>(RUST_OPERATIONS);
function fixturePlan(){
  return {
    schema_version:"1.0.0",plan_id:"plan-ipc-1",session_id:"session-ipc-1",
    version:1,repository:REPO,base_revision:SHA,
    requirement:"Create one approved isolated feature branch",
    candidate_agents:[{
      agent_id:"backend",did:"did:thesis:backend",card_ref:"trusted:backend"
    }],
    tasks:[{
      id:"branch",agent_id:"orchestrator",title:"Create feature branch",
      description:"Create one approved branch",depends_on:[],resources:[URI]
    }],
    requested_permissions:[{
      id:"permission-branch",task_id:"branch",agent_id:"orchestrator",
      resource:URI,operation:"create_branch",reason:"Prepare work branch"
    }],
    assumptions:[],uncertainties:[]
  };
}
function root(id:string,index:string){
  return {
    credential_id:id,valid_from:new Date(Date.now()-2000).toISOString(),
    validity_seconds:600,
    credential_status:{
      type:"BitstringStatusListEntry",statusPurpose:"revocation",
      statusListIndex:index,statusListCredential:"https://status.example/ipc-test"
    }
  };
}
async function setup(t:import("node:test").TestContext){
  const home=await mkdtemp(join(tmpdir(),"trusted-plan-ipc-"));
  const privateDir=join(home,"private"),receipts=join(home,"receipts");
  await mkdir(privateDir,{mode:0o700});
  await mkdir(receipts,{mode:0o700});
  const secretFile=join(privateDir,"ipc-secret.hex");
  const socketPath=join(privateDir,"control.sock");
  const secret=randomBytes(32).toString("hex");
  await writeFile(secretFile,secret+"\n",{mode:0o600});
  const p=fixturePlan();
  const key=generateKeyPairSync("ed25519");
  const priv=key.privateKey.export({format:"pem",type:"pkcs8"}).toString();
  const pub=key.publicKey.export({format:"pem",type:"spki"}).toString();
  const publicKeyFile=join(privateDir,"engineer-public.pem");
  await writeFile(publicKeyFile,pub,{mode:0o600});
  const issuedAt=new Date(),expiry=new Date(issuedAt.getTime()+30*60*1000);
  const approval=makeApproval(p,{
    allowedOperations:OPERATIONS,decision_id:"decision-ipc-1",
    approved_by:DID,approved_at:issuedAt.toISOString(),
    approved_permission_ids:["permission-branch"]
  });
  const signed=signEngineerApproval({
    plan:p,approval,engineerDid:DID,keyId:KEY_ID,privateKeyPem:priv,
    issuedAt:issuedAt.toISOString(),expiresAt:expiry.toISOString()
  });
  await writeFile(join(receipts,p.session_id+".json"),
    JSON.stringify(signed),{mode:0o600});
  const configFile=join(privateDir,"config.json");
  await writeFile(configFile,JSON.stringify({
    approvalDir:receipts,socketPath,secretFile,repository:REPO,
    engineerDid:DID,keyId:KEY_ID,publicKey:pub
  }),{mode:0o600});
  const child=fork(fileURLToPath(new URL("./fixtures/trusted-plan-ipc-child.ts",
    import.meta.url)),[],{
    execArgv:["--experimental-strip-types"],
    env:{
      ...process.env,IPC_TEST_CONFIG:configFile,
      TRUSTED_PLAN_IPC_SOCKET:socketPath,
      TRUSTED_PLAN_IPC_SECRET_FILE:secretFile,
      TRUSTED_PLAN_APPROVAL_DIR:receipts,
      TRUSTED_PLAN_ENGINEER_DID:DID,
      TRUSTED_PLAN_KEY_ID:KEY_ID,
      TRUSTED_PLAN_PUBLIC_KEY_FILE:publicKeyFile
    },
    stdio:["ignore","pipe","pipe","ipc"]
  });
  let stderr="";
  child.stderr?.on("data",data=>{stderr+=String(data);});
  t.after(async()=>{
    if(child.exitCode===null){
      child.kill("SIGTERM");
      await new Promise(resolve=>child.once("exit",resolve));
    }
    await rm(home,{recursive:true,force:true});
  });
  const ready=await new Promise<any>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error("Gateway child startup timed out: "+stderr)),15000);
    child.once("message",message=>{clearTimeout(timer);resolve(message);});
    child.once("exit",code=>{
      clearTimeout(timer);reject(Error("Gateway child exited "+code+": "+stderr));
    });
  });
  assert.equal(ready.ready,true);
  assert.notEqual(ready.pid,process.pid);
  const publicUrl="http://127.0.0.1:"+ready.port;
  const client=await TrustedPlanIpcClient.connect({socketPath,secretFile});
  const store=new SignedEngineerApprovalFileStore({
    directory:receipts,engineerDid:DID,
    trustedKeys:{[KEY_ID]:{engineer_did:DID,public_key_pem:pub}}
  });
  const trace:string[]=[];
  const credentials={
    async issueScopedOrchestratorRoot(req:any){
      trace.push("issue:"+req.credential_id);
      return {
        id:req.credential_id,issuer:DID,
        credentialSubject:{sub:"did:thesis:orchestrator",per:req.permissions}
      };
    },
    async revokeRoot(id:string){trace.push("revoke:"+id);}
  };
  const authority=new TrustedEngineerAuthoritySession({
    snapshot:{
      session_id:p.session_id,repository:REPO,base_revision:SHA,
      directories:[""],files:[]
    },
    credentials,approvals:store,authenticatedEngineerDid:DID
  });
  return {p,trace,authority,credentials,client,publicUrl,socketPath,secret};
}
async function post(base:string,path:string,data:unknown){
  return fetch(base+path,{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify(data)
  });
}
async function rawSocket(path:string,body:string,headers:Record<string,string>){
  return new Promise<number>((resolve,reject)=>{
    const request=httpRequest({
      socketPath:path,path:"/v1/private-plan-control",method:"POST",
      headers:{"content-type":"application/json","content-length":Buffer.byteLength(body),
        ...headers}
    },response=>{
      response.resume();response.once("end",()=>resolve(response.statusCode||0));
    });
    request.once("error",reject);request.end(body);
  });
}

test("separate-process Coordinator activates signed plan only after revoke, binds task and closes it",async t=>{
  const e=await setup(t);
  const call={task_id:"a2a-branch-1",agent_role:"orchestrator",
    tool:"create_branch",arguments:{base_branch:"main",branch:"feature/approved"}};
  const before=await post(e.publicUrl,"/v1/authorization/prepare",call);
  assert.equal(before.status,403);
  assert.equal((await post(e.publicUrl,"/v1/private-plan-control",{
    action:"activate",session_id:e.p.session_id,base_revision:SHA
  })).status,404);
  assert.equal(await rawSocket(e.socketPath,
    JSON.stringify({action:"activate",session_id:e.p.session_id,base_revision:SHA}),{}),403);
  const coordinator=new TrustedExecutionCoordinator({
    authority:e.authority,approvedGatewayPlans:e.client,credentials:e.credentials,
    sessionId:e.p.session_id,baseRevision:SHA
  });
  await coordinator.beginPlanning(root("urn:ipc:read-root","100"));
  const active=await coordinator.beginExecution(root("urn:ipc:work-root","101"));
  assert.equal(active.plan_digest,planDigest(e.p));
  assert.deepEqual(e.trace.slice(0,3),[
    "issue:urn:ipc:read-root","revoke:urn:ipc:read-root","issue:urn:ipc:work-root"
  ]);
  await assert.rejects(e.client.bindTask(e.p.session_id,"branch",
    "a2a-branch-1","backend"),/denied/);
  await coordinator.bindDispatchedTask("branch","a2a-branch-1","orchestrator");
  const prepared=await post(e.publicUrl,"/v1/authorization/prepare",call);
  assert.equal(prepared.status,201);
  const data=await prepared.json();
  assert.match(data.request_id,/^[A-Za-z0-9]/u);
  const completion={
    source:"trusted_orchestrator" as const,runtime_task_id:"a2a-branch-1",
    role:"orchestrator" as const,state:"completed" as const
  };
  // HMAC-authenticated Coordinator alone is insufficient without Gateway I/O.
  await assert.rejects(coordinator.confirmTask("a2a-branch-1",completion),/denied/);
  await assert.rejects(coordinator.confirmTask("a2a-branch-1"),/observation/);
  const executed=await post(e.publicUrl,"/v1/authorization/execute",{
    request_id:data.request_id,signed_vp:"fixture-vp"
  });
  assert.equal(executed.status,200);
  // Untrusted completion role or wrong Task ID still cannot unlock a DAG node.
  await assert.rejects(coordinator.confirmTask("a2a-branch-1",{
    ...completion,runtime_task_id:"other"
  }),/denied/);
  await coordinator.confirmTask("a2a-branch-1",completion);
  await assert.rejects(coordinator.confirmTask("a2a-branch-1",completion),/denied/);
  await coordinator.closeExecution();
  assert.equal(e.trace.at(-1),"revoke:urn:ipc:work-root");
  assert.equal((await post(e.publicUrl,"/v1/authorization/prepare",call)).status,403);
});

test("remote activation mismatch revokes operational DC and remains fail-closed",async t=>{
  const e=await setup(t);
  const coordinator=new TrustedExecutionCoordinator({
    authority:e.authority,approvedGatewayPlans:e.client,credentials:e.credentials,
    sessionId:e.p.session_id,baseRevision:"b".repeat(40)
  });
  await coordinator.beginPlanning(root("urn:ipc:read-root","100"));
  await assert.rejects(coordinator.beginExecution(root("urn:ipc:work-root","101")),
    /Gateway trusted control denied/);
  assert.equal(coordinator.phase,"failed_closed");
  assert.deepEqual(e.trace,[
    "issue:urn:ipc:read-root","revoke:urn:ipc:read-root",
    "issue:urn:ipc:work-root","revoke:urn:ipc:work-root"
  ]);
});

test("wrong HMAC, reused nonce, and stale timestamp are rejected",async t=>{
  const e=await setup(t);
  const body=JSON.stringify({action:"close",session_id:"not-active"});
  const stamp=String(Date.now());
  const nonce=randomBytes(16).toString("base64url");
  const hash=createHash("sha256").update(body).digest("hex");
  const signature=createHmac("sha256",Buffer.from(e.secret,"hex"))
    .update(["delegation.plan.ipc.v1","POST","/v1/private-plan-control",stamp,nonce,hash]
      .join("\n")).digest("hex");
  const valid={
    "x-trusted-timestamp":stamp,"x-trusted-nonce":nonce,"x-trusted-mac":signature
  };
  assert.equal(await rawSocket(e.socketPath,body,{...valid,
    "x-trusted-mac":"0".repeat(64)}),403);
  assert.equal(await rawSocket(e.socketPath,body,valid),403);
  assert.equal(await rawSocket(e.socketPath,body,valid),409);
  assert.equal(await rawSocket(e.socketPath,body,{
    ...valid,"x-trusted-timestamp":String(Date.now()-120000)
  }),403);
});
