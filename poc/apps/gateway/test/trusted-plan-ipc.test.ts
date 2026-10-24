import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,rm,readFile,readdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {randomBytes,generateKeyPairSync,createHmac,createHash,scryptSync} from "node:crypto";
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
import {TrustedOperationalRecoveryStore,reconcileOrphanedOperationalRoots}
  from "../../../packages/orchestrator-runtime/src/trusted-operational-recovery-store.ts";
import {TrustedPlanIpcClient,createTrustedPlanIpcServer}
  from "../src/trusted-plan-ipc.ts";
import {TrustedPlanningRevisions} from "../src/planning-revisions.ts";
import {RUST_OPERATIONS} from "../src/operation-catalog.ts";
import {TrustedApprovedA2ADispatcher} from
  "../../../packages/orchestrator-runtime/src/trusted-approved-a2a-dispatcher.ts";
import {GatewayControlledToolClient} from
  "../../../packages/agent-runtime/src/gateway-tool-client.ts";
import {createServer as createTcpServer} from "node:net";
import {createAuthenticatedEngineerServer}
  from "../../orchestrator/src/engineer-approval-server.mjs";

const REPO={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const URI="gitea://gitea.local/thesis/iam-console-poc";
const DID="did:thesis:engineer",SHA="a".repeat(40);
const KEY_ID="engineer-ipc-test-key";
const OPERATIONS=new Set<string>(RUST_OPERATIONS);
function fixturePlan(){
  return {
    schema_version:"1.0.0",plan_id:"plan-ipc-1",session_id:"session-ipc-1",
    version:1,repository:REPO,base_revision:SHA,
    requirement:"Create an isolated branch and update one authorized backend file",
    candidate_agents:[{
      agent_id:"backend",did:"did:thesis:backend",card_ref:"trusted:backend"
    }],
    tasks:[{
      id:"branch",agent_id:"orchestrator",title:"Create feature branch",
      description:"Create one approved branch",depends_on:[],resources:[URI]
    },{
      id:"backend",agent_id:"backend",title:"Update backend file",
      description:"Make approved changes only after branch completion",
      depends_on:["branch"],
      resources:[URI+"/branches/feature%2Fapproved/files/apps/backend/user.ts"]
    }],
    requested_permissions:[{
      id:"permission-branch",task_id:"branch",agent_id:"orchestrator",
      resource:URI,operation:"create_branch",reason:"Prepare work branch"
    },{
      id:"permission-backend",task_id:"backend",agent_id:"backend",
      resource:URI+"/branches/feature%2Fapproved/files/apps/backend/user.ts",
      operation:"update_file",reason:"Implement approved change"
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
async function setup(
  t:import("node:test").TestContext,
  options:{operationalLeaseMs?:number;approvalViaUi?:boolean}={}
){
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
  const planFile=join(privateDir,"engineer-plan.json");
  const signerFile=join(privateDir,"engineer-signer.pem");
  if(options.approvalViaUi){
    await writeFile(planFile,JSON.stringify(p),{mode:0o600});
    await writeFile(signerFile,priv,{mode:0o600});
  }
  const issuedAt=new Date(),expiry=new Date(issuedAt.getTime()+30*60*1000);
  const approval=makeApproval(p,{
    allowedOperations:OPERATIONS,decision_id:"decision-ipc-1",
    approved_by:DID,approved_at:issuedAt.toISOString(),
    approved_permission_ids:["permission-branch","permission-backend"]
  });
  const signed=signEngineerApproval({
    plan:p,approval,engineerDid:DID,keyId:KEY_ID,privateKeyPem:priv,
    issuedAt:issuedAt.toISOString(),expiresAt:expiry.toISOString()
  });
  if(!options.approvalViaUi)
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
      TRUSTED_PLAN_PUBLIC_KEY_FILE:publicKeyFile,
      ...(options.operationalLeaseMs===undefined
        ?{}:{TRUSTED_PLAN_OPERATIONAL_LEASE_MS:String(options.operationalLeaseMs)})
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
  return {
    p,trace,authority,credentials,client,store,publicUrl,socketPath,secret,
    receipts,planFile,signerFile,publicKeyPem:pub
  };
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
  await coordinator.bindDispatchedTask("backend","a2a-backend-1","backend");
  const backendCall={
    task_id:"a2a-backend-1",agent_role:"backend" as const,
    tool:"update_file",arguments:{
      branch:"feature/approved",path:"apps/backend/user.ts",content:"export const ok=true;"
    }
  };
  // A valid delegated permission still cannot bypass DAG predecessor status.
  assert.equal((await post(e.publicUrl,"/v1/authorization/prepare",backendCall)).status,403);
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
  const backendPrepare=await post(e.publicUrl,"/v1/authorization/prepare",backendCall);
  assert.equal(backendPrepare.status,201);
  const request=await backendPrepare.json();
  const backendObs={
    source:"trusted_a2a_poll" as const,runtime_task_id:"a2a-backend-1",
    role:"backend" as const,state:"completed" as const,
    artifact:{
      branch:"feature/approved",revision:SHA,commit_sha:SHA,
      files_modified:["apps/backend/user.ts"],files_created:[],
      test_outcome:"not_run" as const
    }
  };
  // Agent claims alone do not unlock the approved backend Task.
  await assert.rejects(coordinator.confirmTask("a2a-backend-1",backendObs),/denied/);
  const backendExecute=await post(e.publicUrl,"/v1/authorization/execute",{
    request_id:request.request_id,signed_vp:"fixture-vp"
  });
  assert.equal(backendExecute.status,200);
  await assert.rejects(coordinator.confirmTask("a2a-backend-1",{
    ...backendObs,artifact:{
      ...backendObs.artifact,revision:"c".repeat(40),commit_sha:"c".repeat(40)
    }
  }),/denied/);
  await coordinator.confirmTask("a2a-backend-1",backendObs);
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


// The Gateway's no-dependency policy test deliberately does not install the
// A2A SDK. The dedicated private IPC CI installs the pinned A2A SDK and
// executes this opt-in integration test in full; absence is an explicit skip.
const a2aSdkAvailable=(()=>{
  try{import.meta.resolve("@a2a-js/sdk");return true;}
  catch{return false;}
})();
test("signed DAG dispatches a real A2A SDK Task to a separate-process Gateway via trusted prebinding",
  {skip:a2aSdkAvailable?false:"A2A SDK absent; full test runs in trusted IPC CI"},
  async t=>{
  const {DelegatedA2ARoleRunner}=await import(
    "../../../packages/orchestrator-runtime/src/a2a-workflow.ts");
  const {DeterministicA2AOrchestrator}=await import(
    "../../../packages/agent-runtime/src/orchestrator.ts");
  const {startSpecializedAgentServer}=await import(
    "../../../packages/agent-runtime/src/server.ts");
  const e=await setup(t);
  const coordinator=new TrustedExecutionCoordinator({
    authority:e.authority,approvedGatewayPlans:e.client,credentials:e.credentials,
    sessionId:e.p.session_id,baseRevision:SHA
  });
  await coordinator.beginPlanning(root("urn:ipc:a2a-read-root","201"));
  const operational=await coordinator.beginExecution(root("urn:ipc:a2a-work-root","202"));
  assert.equal(operational.plan_digest,planDigest(e.p));

  // Assign an ephemeral local port, never a public Agent endpoint.
  const probe=createTcpServer();
  await new Promise<void>(resolve=>probe.listen(0,"127.0.0.1",resolve));
  const port=(probe.address() as import("node:net").AddressInfo).port;
  await new Promise<void>(resolve=>probe.close(()=>resolve()));
  let observedPrivateId:string|undefined;
  const server=await startSpecializedAgentServer({
    role:"backend",host:"127.0.0.1",port,delegatedAuthorization:true,
    taskHandler:async context=>{
      observedPrivateId=context.trusted_gateway_task_id;
      // No Gemini/ADK inference. Scripted offline tool behavior still calls
      // the REAL gateway process, with its frozen plan and evidence registry.
      const client=new GatewayControlledToolClient({
        gatewayBaseUrl:e.publicUrl,agentRole:"backend",
        taskId:context.trusted_gateway_task_id??context.task_id,
        evidenceHandler:{
          async createPresentation(){return "fixture-vp";}
        } as unknown as import("../../../packages/agent-runtime/src/delegation-evidence-handler.ts").DelegationEvidenceHandler
      });
      const value=await client.invoke("update_file",{
        branch:context.subtask.branch,path:"apps/backend/user.ts",
        content:"export const approved=true;"
      }) as {commit_sha:string};
      return {
        role:"backend",summary:"Scripted successful Gateway tool execution",
        branch:context.subtask.branch,
        files_modified:["apps/backend/user.ts"],files_created:[],
        revision:value.commit_sha,commit_sha:value.commit_sha,
        test_outcome:"not_run",errors:[]
      };
    }
  });
  t.after(()=>server.close());
  const roleRunner=new DelegatedA2ARoleRunner({
    authorityIssuer:{
      assertActiveBeforeA2ASend(){
        // This IPC fixture uses an unsigned stub for the child DC but must
        // still enforce the actual Coordinator's operational-root lifetime.
        assert.equal(coordinator.phase,"execution");
        assert.equal(
          coordinator.trustedOperationalAuthority().credential_id,
          operational.credential_id
        );
      },
      async issueSpecializedChild(input){
        return {role:input.selection.role,credential:{
          "@context":["https://www.w3.org/ns/credentials/v2"],
          type:["VerifiableCredential","DelegationCredential"],
          id:input.credential_id,issuer:"did:thesis:orchestrator",
          validFrom:input.valid_from,
          credentialSubject:{sub:"did:thesis:backend",per:[]}
        }};
      }
    },
    a2a:new DeterministicA2AOrchestrator({
      deadlineMs:6000,initialIntervalMs:20,maxIntervalMs:110
    })
  });
  const dispatcher=await TrustedApprovedA2ADispatcher.load({
    approvals:e.store,coordinator,roleRunner,
    sessionId:e.p.session_id,baseRevision:SHA,
    expectedPlanDigest:operational.plan_digest,expectedEngineerDid:DID,
    agentBaseUrls:{backend:server.baseUrl,frontend:"http://127.0.0.1:1",
      test:"http://127.0.0.1:1"},
    async authorityForTask(taskId,role){
      assert.equal(taskId,"backend");
      assert.equal(role,"backend");
      return {
        ...root("urn:ipc:a2a-backend-child","203"),
        parent_credential_id:operational.credential_id
      };
    }
  });
  assert.equal(dispatcher.approvedBranch,"feature/approved");
  await assert.rejects(dispatcher.dispatch("backend"),/dependencies not verified/);

  await dispatcher.runOrchestratorTask("branch",async taskId=>{
    const prepared=await post(e.publicUrl,"/v1/authorization/prepare",{
      task_id:taskId,agent_role:"orchestrator",
      tool:"create_branch",arguments:{base_branch:"main",branch:"feature/approved"}
    });
    assert.equal(prepared.status,201);
    const body=await prepared.json();
    const executed=await post(e.publicUrl,"/v1/authorization/execute",{
      request_id:body.request_id,signed_vp:"fixture-vp"
    });
    assert.equal(executed.status,200);
  });
  const result=await dispatcher.dispatch("backend");
  assert.equal(result.role,"backend");
  assert.equal(result.artifact.branch,"feature/approved");
  assert.equal(result.artifact.revision,SHA);
  assert.match(observedPrivateId||"",/^dispatch_[A-Za-z0-9_-]{22}$/u);
  assert.notEqual(result.task_id,observedPrivateId);
  assert.deepEqual(dispatcher.completedTaskIds,["branch","backend"]);

  await coordinator.closeExecution();
  assert.equal(e.trace.at(-1),"revoke:urn:ipc:a2a-work-root");
});


test("independent Gateway child expires operational authority after Engineer crash without any close message",async t=>{
  // Real separate processes, same Gateway enforcement instance as provider.
  // A 10-second minimum lease is used; Engineer intentionally stops renewing.
  const e=await setup(t,{operationalLeaseMs:10_000});
  assert.equal(e.client.operationalLeaseConfigured(),true);
  const coordinator=new TrustedExecutionCoordinator({
    authority:e.authority,approvedGatewayPlans:e.client,credentials:e.credentials,
    sessionId:e.p.session_id,baseRevision:SHA
  });
  coordinator.assertOperationalLeaseConfigured();
  await coordinator.beginPlanning(root("urn:lease:read-root","700"));
  await coordinator.beginExecution(root("urn:lease:work-root","701"));
  await coordinator.bindDispatchedTask("branch","a2a-crash-branch","orchestrator");
  const call={
    task_id:"a2a-crash-branch",agent_role:"orchestrator",
    tool:"create_branch",arguments:{
      base_branch:"main",branch:"feature/approved"
    }
  };
  const prepared=await post(e.publicUrl,"/v1/authorization/prepare",call);
  assert.equal(prepared.status,201);
  const challenge=await prepared.json();
  await assert.rejects(
    e.client.renewLease(e.p.session_id,"e".repeat(64)),/denied/);
  await coordinator.renewExecutionLease();
  // Simulate abrupt host termination: do NOT notify Gateway or call close.
  // The independent Gateway clock expires the lease with no Engineer timers.
  await new Promise(resolve=>setTimeout(resolve,10_100));
  const execute=await post(e.publicUrl,"/v1/authorization/execute",{
    request_id:challenge.request_id,signed_vp:"fixture-vp"
  });
  assert.equal(execute.status,403);
  assert.equal((await post(e.publicUrl,"/v1/authorization/prepare",call)).status,403);
  await assert.rejects(coordinator.renewExecutionLease(),/denied/);
  // Cleanup remains possible, but must never resurrect authorization.
  await coordinator.closeExecution();
  assert.equal(e.trace.at(-1),"revoke:urn:lease:work-root");
  assert.equal((await post(e.publicUrl,"/v1/authorization/prepare",call)).status,403);
});

test("legacy private plan-control cannot impersonate a Gateway lease policy",async t=>{
  const e=await setup(t);
  assert.equal(e.client.operationalLeaseConfigured(),false);
  const coordinator=new TrustedExecutionCoordinator({
    authority:e.authority,approvedGatewayPlans:e.client,credentials:e.credentials,
    sessionId:e.p.session_id,baseRevision:SHA
  });
  assert.throws(()=>coordinator.assertOperationalLeaseConfigured(),
    /Gateway-side operational lease/);
  await assert.rejects(e.client.renewLease(e.p.session_id,
    planDigest(e.p)),/no operational lease/);
});


test("new Engineer process reconciles orphaned root by terminal Gateway IPC tombstone and confirmed Rust revocation",async t=>{
  const e=await setup(t);
  const dir=await mkdtemp(join(tmpdir(),"operational-recovery-cross-process-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const credentialId="urn:ipc:possibly-issued-orphan";
  const recorded=new TrustedOperationalRecoveryStore(dir);
  // This operation occurs BEFORE any external issuance call. Imagine a
  // SIGKILL immediately afterward: the original Coordinator is gone.
  await recorded.recordIntent({
    sessionId:e.p.session_id,baseRevision:SHA,credentialId
  });
  const fresh=new TrustedOperationalRecoveryStore(dir);
  await assert.rejects(fresh.assertClean(),/orphaned root intent/);
  let revokeAttempts=0;
  const intermittent={
    async revokeRoot(id:string){
      assert.equal(id,credentialId);
      revokeAttempts++;
      if(revokeAttempts===1)throw Error("Adapter inaccessible");
      await e.credentials.revokeRoot(id);
    }
  };
  await assert.rejects(reconcileOrphanedOperationalRoots({
    store:fresh,gateway:e.client,credentials:intermittent
  }),/manual reconciliation required/);
  await assert.rejects(fresh.assertClean(),/orphaned root intent/);
  // The Gateway has a durable-for-process tombstone that prevents a delayed
  // activation from the old trusted host before Rust revocation succeeds.
  await assert.rejects(e.client.activate(e.p.session_id,SHA),/denied/);
  assert.equal(await reconcileOrphanedOperationalRoots({
    store:fresh,gateway:e.client,credentials:intermittent
  }),1);
  assert.equal(revokeAttempts,2);
  assert.equal(e.trace.at(-1),"revoke:"+credentialId);
  await fresh.assertClean();
  assert.equal(await reconcileOrphanedOperationalRoots({
    store:fresh,gateway:e.client,credentials:intermittent
  }),0);
  await assert.rejects(fresh.recordIntent({
    sessionId:e.p.session_id,baseRevision:SHA,credentialId
  }),/reconciled session cannot be reused/);
  assert.equal((await post(e.publicUrl,"/v1/private-plan-control",{
    action:"retire",session_id:e.p.session_id
  })).status,404);
});


test("complete offline chain: Engineer login + CSRF + Ed25519 approval -> separate Gateway + root lease -> provider evidence -> revocation",async t=>{
  // One composed test across ACTUAL loopback Engineer UI, a distinct
  // Gateway child process and authenticated owner-only Unix IPC.
  // Only credentials, provider calls and VP verification are fixtures.
  const e=await setup(t,{operationalLeaseMs:45_000,approvalViaUi:true});
  const recoveryDir=await mkdtemp(join(tmpdir(),"trusted-composed-recovery-"));
  t.after(()=>rm(recoveryDir,{recursive:true,force:true}));
  const recovery=new TrustedOperationalRecoveryStore(recoveryDir);
  const coordinator=new TrustedExecutionCoordinator({
    authority:e.authority,approvedGatewayPlans:e.client,credentials:e.credentials,
    sessionId:e.p.session_id,baseRevision:SHA,operationalRecovery:recovery
  });
  coordinator.assertOperationalLeaseConfigured();
  coordinator.assertOperationalRecoveryConfigured();

  const branchCall={
    task_id:"a2a-engineer-reviewed-branch",agent_role:"orchestrator" as const,
    tool:"create_branch",
    arguments:{base_branch:"main",branch:"feature/approved"}
  };
  assert.equal((await post(e.publicUrl,"/v1/authorization/prepare",branchCall)).status,403);
  await coordinator.beginPlanning(root("urn:reviewed:planning","810"));
  // Provisional root does not authorize a provider write.
  assert.equal((await post(e.publicUrl,"/v1/authorization/prepare",branchCall)).status,403);
  assert.equal((await readdir(e.receipts)).length,0);
  assert.equal((await recovery.pending()).length,0);

  const salt=randomBytes(16),password="offline-review-only";
  const ui=await createAuthenticatedEngineerServer({
    host:"127.0.0.1",engineerDid:DID,keyId:KEY_ID,
    trustedPlanFile:e.planFile,expectedSessionId:e.p.session_id,
    expectedBaseRevision:SHA,repository:REPO,
    privateKeyFile:e.signerFile,publicKeyPem:e.publicKeyPem,
    receiptDirectory:e.receipts,
    passwordSaltHex:salt.toString("hex"),
    passwordScryptHex:scryptSync(password,salt,64).toString("hex")
  });
  await new Promise<void>(resolve=>ui.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise<void>((resolve,reject)=>ui.close(error=>error?reject(error):resolve())));
  const uiUrl="http://127.0.0.1:"+(ui.address() as import("node:net").AddressInfo).port;
  assert.equal((await fetch(uiUrl+"/api/plan")).status,401);
  const login=await fetch(uiUrl+"/api/login",{
    method:"POST",headers:{"content-type":"application/json",origin:uiUrl},
    body:JSON.stringify({password})
  });
  assert.equal(login.status,200);
  const cookie=login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  const review=await (await fetch(uiUrl+"/api/plan",{headers:{cookie}})).json();
  assert.equal(review.plan_digest,planDigest(e.p));
  assert.equal(review.plan.base_revision,SHA);
  const requestApproval=(input:object,csrf=review.csrf_token)=>
    fetch(uiUrl+"/api/approve",{
      method:"POST",headers:{
        "content-type":"application/json",origin:uiUrl,
        cookie,"x-csrf-token":csrf
      },body:JSON.stringify(input)
    });
  const approvedIds=["permission-branch","permission-backend"];
  const decision={
    plan_digest:planDigest(e.p),approved_permission_ids:approvedIds,
    confirmation:"APPROVE "+planDigest(e.p)
  };
  assert.equal((await requestApproval(decision,"wrong-csrf")).status,403);
  assert.equal((await requestApproval({
    ...decision,approved_permission_ids:[...approvedIds,"permission-foreign"]
  })).status,403);
  assert.equal((await readdir(e.receipts)).length,0);
  const approved=await requestApproval(decision);
  assert.equal(approved.status,201);
  assert.equal((await approved.json()).operational_credential_issued,false);
  const receipt=await e.store.loadAuthenticatedApproval(e.p.session_id);
  assert.deepEqual(receipt.approval.approved_permission_ids,approvedIds);
  // The initial authenticated browser session cannot issue another approval.
  assert.equal((await requestApproval(decision)).status,401);

  const activated=await coordinator.beginExecution(root("urn:reviewed:operational","811"));
  assert.equal(activated.plan_digest,planDigest(e.p));
  assert.equal((await recovery.pending()).length,1);
  assert.deepEqual(e.trace.slice(0,3),[
    "issue:urn:reviewed:planning",
    "revoke:urn:reviewed:planning",
    "issue:urn:reviewed:operational"
  ]);
  await coordinator.renewExecutionLease();
  await coordinator.bindDispatchedTask(
    "branch",branchCall.task_id,"orchestrator");
  await coordinator.bindDispatchedTask(
    "backend","a2a-engineer-reviewed-backend","backend");
  const backendCall={
    task_id:"a2a-engineer-reviewed-backend",agent_role:"backend" as const,
    tool:"update_file",arguments:{
      branch:"feature/approved",path:"apps/backend/user.ts",
      content:"export const approved=true;"
    }
  };
  // Signed approval does not skip plan task dependencies.
  assert.equal((await post(e.publicUrl,"/v1/authorization/prepare",backendCall)).status,403);
  const branchPrep=await post(e.publicUrl,"/v1/authorization/prepare",branchCall);
  assert.equal(branchPrep.status,201);
  const branchRequest=await branchPrep.json();
  assert.equal((await post(e.publicUrl,"/v1/authorization/execute",{
    request_id:branchRequest.request_id,signed_vp:"fixture-vp"
  })).status,200);
  await coordinator.confirmTask(branchCall.task_id,{
    source:"trusted_orchestrator",runtime_task_id:branchCall.task_id,
    role:"orchestrator",state:"completed"
  });
  const backPrep=await post(e.publicUrl,"/v1/authorization/prepare",backendCall);
  assert.equal(backPrep.status,201);
  const backRequest=await backPrep.json();
  assert.equal((await post(e.publicUrl,"/v1/authorization/execute",{
    request_id:backRequest.request_id,signed_vp:"fixture-vp"
  })).status,200);
  await coordinator.confirmTask(backendCall.task_id,{
    source:"trusted_a2a_poll",runtime_task_id:backendCall.task_id,
    role:"backend",state:"completed",
    artifact:{
      branch:"feature/approved",revision:SHA,commit_sha:SHA,
      files_modified:["apps/backend/user.ts"],files_created:[],
      test_outcome:"not_run"
    }
  });
  await coordinator.closeExecution();
  assert.equal((await recovery.pending()).length,0);
  assert.deepEqual(e.trace.slice(-1),["revoke:urn:reviewed:operational"]);
  assert.equal((await post(e.publicUrl,"/v1/authorization/prepare",branchCall)).status,403);
  await assert.rejects(recovery.assertFreshSession(e.p.session_id),
    /reconciled session cannot be reused/);
  await assert.rejects(coordinator.renewExecutionLease(),
    /outside execution/);
});


test("private IPC retires the actual Gateway Planning registry and reserves unknown sessions",async t=>{
  const home=await mkdtemp(join(tmpdir(),"planning-registry-ipc-"));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const privateDir=join(home,"private");
  await mkdir(privateDir,{mode:0o700});
  const socketPath=join(privateDir,"control.sock");
  const secretFile=join(privateDir,"secret.hex");
  const secret=randomBytes(32).toString("hex");
  await writeFile(secretFile,secret+"\n",{mode:0o600});
  let resolveGitea:(value:any)=>void=()=>{};
  const registry=new TrustedPlanningRevisions({
    readRepository:()=>new Promise(resolve=>{resolveGitea=resolve;})
  } as any);
  const server=await createTrustedPlanIpcServer({
    socketPath,secretFile,
    plans:{operationalLeaseConfigured:()=>true} as any,
    planningRevisions:registry
  });
  await server.start();
  t.after(()=>server.close());
  const trusted=await TrustedPlanIpcClient.connect({socketPath,secretFile});
  // Retire BEFORE the pending authenticated Gitea read resolves.
  const pending=registry.begin("late-planning",5000);
  await trusted.retirePlanning("late-planning");
  resolveGitea({default_branch:"main",revision:SHA});
  await assert.rejects(pending,/retired during Gitea discovery/);
  await assert.rejects(registry.begin("late-planning",5000),
    /already registered/);
  // A missing ID must also be tombstoned to prevent delayed registration.
  await trusted.retirePlanning("missing-after-crash");
  await trusted.retirePlanning("missing-after-crash");
  await assert.rejects(registry.begin("missing-after-crash",5000),
    /already registered/);
  // No operational activation or model invocation is triggered.
});

test("private Planning retirement is denied without actual Gateway registry",async t=>{
  const home=await mkdtemp(join(tmpdir(),"planning-ipc-no-registry-"));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const secretFile=join(home,"secret.hex"),socketPath=join(home,"control.sock");
  await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",{mode:0o600});
  const server=await createTrustedPlanIpcServer({
    socketPath,secretFile,plans:{operationalLeaseConfigured:()=>true} as any
  });
  await server.start();
  t.after(()=>server.close());
  const trusted=await TrustedPlanIpcClient.connect({socketPath,secretFile});
  await assert.rejects(trusted.retirePlanning("orphan-session"),/denied/);
});
