/**
 * Offline integrated scoped delegation check against the REAL EVM Rust
 * Adapter, Native Core Gateway, live OPA and A2A SDK (model scripted).
 *
 * Runs AFTER the independent native-real-evm-e2e test on the existing
 * disposable Anvil/OPA/Adapter. It creates its own isolated, approved
 * Gateway process and signed Engineer receipt. Provider stays MOCK,
 * therefore Task completion MUST fail closed and revoke operational root.
 * This is NOT a real Gitea/Docker Runner E2E or a paid Gemini test.
 */
import assert from "node:assert/strict";
import {generateKeyPairSync,randomBytes} from "node:crypto";
import {mkdtemp,writeFile,rm,mkdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawn} from "node:child_process";
import {makeApproval,planDigest} from "../../../packages/plan-contracts/src/plan.mjs";
import {signEngineerApproval} from "../../../packages/plan-contracts/src/signed-approval.mjs";
import {RUST_OPERATIONS} from "../src/operation-catalog.ts";
import {SignedEngineerApprovalFileStore} from
  "../../../packages/orchestrator-runtime/src/signed-approval-store.ts";
import {SoftwareEngineerAuthorityBootstrap} from
  "../../../packages/orchestrator-runtime/src/authority-client.ts";
import {TrustedEngineerAuthoritySession} from
  "../../../packages/orchestrator-runtime/src/trusted-engineer-authority.ts";
import {TrustedExecutionCoordinator} from
  "../../../packages/orchestrator-runtime/src/trusted-execution-coordinator.ts";
import {TrustedOperationalRecoveryStore,reconcileOrphanedOperationalRoots}
  from "../../../packages/orchestrator-runtime/src/trusted-operational-recovery-store.ts";
import {TrustedPlanningRecoveryStore}
  from "../../../packages/orchestrator-runtime/src/trusted-planning-recovery-store.ts";
import {TrustedApprovedA2ADispatcher} from
  "../../../packages/orchestrator-runtime/src/trusted-approved-a2a-dispatcher.ts";
import {TrustedPlanIpcClient} from "../src/trusted-plan-ipc.ts";
import {DeterministicA2AOrchestrator} from
  "../../../packages/agent-runtime/src/orchestrator.ts";
import {startSpecializedAgentServer} from
  "../../../packages/agent-runtime/src/server.ts";

const adapter="http://127.0.0.1:8090",gateway="http://127.0.0.1:18081";
const ENGINEER=process.env.ADAPTER_ID_ENGINEER;
const BACKEND=process.env.ADAPTER_ID_BACKEND;
const engineerToken=process.env.ADAPTER_CALLER_ENGINEER;
const orchestratorToken=process.env.ADAPTER_CALLER_ORCHESTRATOR;
const backendToken=process.env.ADAPTER_CALLER_BACKEND;
for(const [name,value] of Object.entries({
  ENGINEER,BACKEND,engineerToken,orchestratorToken,backendToken
})){
  if(!value)throw Error("Missing scoped EVM fixture: "+name);
}
const repo={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const baseSha="a".repeat(40); // fixture SHA: NOT fetched from live Gitea
const session="scoped-evm-session";
// The real OPA policy intentionally remains fixed to this legacy branch.
const branch="feature/account-suspension";
const file="apps/backend/src/users/user.service.ts";
const uri="gitea://gitea.local/thesis/iam-console-poc/branches/"+
  encodeURIComponent(branch)+"/files/"+file;
const permission={resource:uri,operation:"update_file"};
const plan={
  schema_version:"1.0.0",plan_id:"scoped-evm-plan",session_id:session,
  version:1,repository:repo,base_revision:baseSha,
  requirement:"Change only the approved backend file using a scoped child DC",
  candidate_agents:[{agent_id:"backend",did:BACKEND,card_ref:"trusted:backend"}],
  tasks:[{
    id:"backend-task",agent_id:"backend",title:"Approved backend edit",
    description:"Update only the approved backend service",depends_on:[],
    resources:[uri,
      "gitea://gitea.local/thesis/iam-console-poc/branches/"+
      encodeURIComponent(branch)+"/files/apps/backend/src/users/other.ts"]
  }],
  requested_permissions:[
    {id:"backend-approved",task_id:"backend-task",agent_id:"backend",
      resource:uri,operation:"update_file",reason:"Engineer approved this file"},
    {id:"backend-proposed-but-denied",task_id:"backend-task",agent_id:"backend",
      resource:"gitea://gitea.local/thesis/iam-console-poc/branches/"+
        encodeURIComponent(branch)+"/files/apps/backend/src/users/other.ts",
      operation:"create_file",reason:"An unapproved proposal"}
  ],
  assumptions:[],uncertainties:[]
};
const issuedAt=new Date().toISOString();
const approved=makeApproval(plan,{
  allowedOperations:new Set(RUST_OPERATIONS),
  decision_id:"scoped-evm-approval",approved_by:ENGINEER,
  approved_at:issuedAt,approved_permission_ids:["backend-approved"]
});
const temp=await mkdtemp(join(tmpdir(),"dgn-"));
const socket=join(temp,"ctl.sock"),secret=join(temp,"secret.hex");
const publicFile=join(temp,"pinned.pem"),receiptFile=join(temp,session+".json");
const keys=generateKeyPairSync("ed25519");
const pub=keys.publicKey.export({format:"pem",type:"spki"}).toString();
const priv=keys.privateKey.export({format:"pem",type:"pkcs8"}).toString();
await writeFile(publicFile,pub,{mode:0o600});
await writeFile(secret,randomBytes(32).toString("hex")+"\n",{mode:0o600});
const keyId="scoped-evm-engineer-v1";
const receipt=signEngineerApproval({
  plan,approval:approved,engineerDid:ENGINEER,keyId,privateKeyPem:priv,
  issuedAt,expiresAt:new Date(Date.now()+30*60*1000).toISOString()
});
await writeFile(receiptFile,JSON.stringify(receipt),{mode:0o600});
const approvals=new SignedEngineerApprovalFileStore({
  directory:temp,engineerDid:ENGINEER,
  trustedKeys:{[keyId]:{engineer_did:ENGINEER,public_key_pem:pub}}
});
const loaded=await approvals.loadAuthenticatedApproval(session);
assert.equal(planDigest(loaded.plan),planDigest(plan));
assert.deepEqual(loaded.approval.approved_permission_ids,["backend-approved"]);

const gatewayChild=spawn(process.execPath,[
  "--experimental-strip-types",
  "poc/apps/gateway/native-test/fixtures/native-scoped-mock-gateway.ts"
],{cwd:process.cwd(),env:{
  ...process.env,GATEWAY_BIND_ADDR:"127.0.0.1:18081",
  GATEWAY_VERIFIER_MODE:"core-rust",GATEWAY_PROVIDER_MODE:"mock",
  TRUSTED_PLAN_IPC_SOCKET:socket,
  TRUSTED_PLAN_IPC_SECRET_FILE:secret,
  TRUSTED_PLAN_APPROVAL_DIR:temp,
  TRUSTED_PLAN_ENGINEER_DID:ENGINEER,
  TRUSTED_PLAN_KEY_ID:keyId,
  TRUSTED_PLAN_PUBLIC_KEY_FILE:publicFile,
  TRUSTED_PLAN_OPERATIONAL_LEASE_MS:"300000"
},stdio:["ignore","pipe","pipe"]});
let logs="";
for(const stream of [gatewayChild.stdout,gatewayChild.stderr]){
  stream.on("data",chunk=>{logs+=String(chunk).slice(0,2000);});
}
async function post(url,path,body,token){
  const response=await fetch(url+path,{
    method:"POST",headers:{"content-type":"application/json",
      ...(token?{authorization:"Bearer "+token}:{})},
    body:JSON.stringify(body),signal:AbortSignal.timeout(15_000)
  });
  const raw=await response.text();
  let decoded;
  try{decoded=JSON.parse(raw);}catch{throw Error("Invalid JSON from "+path);}
  return {status:response.status,body:decoded};
}
async function awaitGateway(){
  for(let i=0;i<100;i++){
    if(gatewayChild.exitCode!==null)throw Error("Scoped Gateway exited: "+logs);
    try{
      const response=await fetch(gateway+"/health",
        {signal:AbortSignal.timeout(500)});
      if(response.ok)return;
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,150));
  }
  throw Error("Scoped Gateway never became healthy: "+logs);
}
function root(id,index,ttl=600){
  return {
    credential_id:id,valid_from:new Date(Date.now()-1000).toISOString(),
    validity_seconds:ttl,credential_status:{
      type:"BitstringStatusListEntry",statusPurpose:"revocation",
      statusListIndex:String(index),
      statusListCredential:"https://status.example/lists/scoped-native-evm"
    }
  };
}
let server;
let coordinator;
let executedMock=false,deniedExtra=false;
try{
  await awaitGateway();
  const credentials=new SoftwareEngineerAuthorityBootstrap({
    adapterBaseUrl:adapter,bearerToken:engineerToken,timeoutMs:30_000
  });
  const authority=new TrustedEngineerAuthoritySession({
    snapshot:{session_id:session,repository:repo,base_revision:baseSha,
      directories:[""],files:[]},
    credentials,approvals,authenticatedEngineerDid:ENGINEER
  });
  const ipc=await TrustedPlanIpcClient.connect({
    socketPath:socket,secretFile:secret
  });
  coordinator=new TrustedExecutionCoordinator({
    authority,approvedGatewayPlans:ipc,credentials,
    sessionId:session,baseRevision:baseSha
  });
  const preview=await coordinator.beginPlanning(root(
    "urn:scoped-native:preliminary-root","17210",180));
  assert.equal(preview.phase,"planning");
  assert(preview.permissions.every(p=>p.operation==="read_repository"||
    p.operation==="list_directory"||p.operation==="read_file"));
  const active=await coordinator.beginExecution(root(
    "urn:scoped-native:operational-root","17211",600));
  assert.equal(active.plan_digest,planDigest(plan));
  const operational=coordinator.trustedOperationalAuthority();
  assert.deepEqual(operational.permissions,[permission]);

  server=await startSpecializedAgentServer({
    role:"backend",host:"127.0.0.1",port:18120,
    delegatedAuthorization:true,
    taskHandler:async context=>{
      const taskId=context.trusted_gateway_task_id;
      assert.match(taskId??"",/^dispatch_[A-Za-z0-9_-]{22}$/u);
      assert.equal(context.subtask.branch,branch);
      assert.equal(context.delegation_evidence.presenter_id,BACKEND);
      const disallowed=await post(gateway,"/v1/authorization/prepare",{
        task_id:taskId,agent_role:"backend",tool:"create_file",
        arguments:{branch,path:"apps/backend/src/users/other.ts",content:"denied"}
      });
      assert.equal(disallowed.status,403);
      deniedExtra=true;

      const prepared=await post(gateway,"/v1/authorization/prepare",{
        task_id:taskId,agent_role:"backend",tool:"update_file",
        arguments:{branch,path:file,content:"export const scoped=true;"}
      });
      assert.equal(prepared.status,201,JSON.stringify(prepared.body));
      assert.deepEqual(prepared.body.required_permission,permission);
      const vp=await post(adapter,"/v1/presentations",{
        credential_id:context.delegation_evidence.credential_id,
        disclosed_permissions:[permission],
        audience:prepared.body.audience,challenge:prepared.body.challenge
      },backendToken);
      assert.equal(vp.status,200,JSON.stringify(vp.body));
      const executed=await post(gateway,"/v1/authorization/execute",{
        request_id:prepared.body.request_id,signed_vp:vp.body.signed_vp
      });
      assert.equal(executed.status,200,JSON.stringify(executed.body));
      assert.equal(executed.body.execution.provider,"mock");
      assert.equal(executed.body.execution.performed,false);
      executedMock=true;
      return {
        role:"backend",branch,revision:baseSha,commit_sha:baseSha,
        files_modified:[file],files_created:[],test_outcome:"not_run",
        summary:"Native Rust scoped child VP accepted; mock provider not attested",
        errors:[]
      };
    }
  });
  const dispatcher=await TrustedApprovedA2ADispatcher.loadWithScopedChildAuthority({
    approvals,coordinator,sessionId:session,
    expectedEngineerDid:ENGINEER,baseRevision:baseSha,
    expectedPlanDigest:active.plan_digest,
    agentBaseUrls:{
      backend:server.baseUrl,
      frontend:"http://127.0.0.1:1",test:"http://127.0.0.1:1"
    },
    adapter:{
      adapterBaseUrl:adapter,bearerToken:orchestratorToken,
      timeoutMs:30_000
    },
    a2a:new DeterministicA2AOrchestrator({
      deadlineMs:30_000,initialIntervalMs:80,maxIntervalMs:200
    }),
    async authorityForTask(taskId,role){
      assert.equal(taskId,"backend-task");
      assert.equal(role,"backend");
      return {
        ...root("urn:scoped-native:backend-child","17212",300),
        parent_credential_id:active.credential_id
      };
    }
  });
  assert.equal(dispatcher.approvedBranch,branch);
  // Gateway denied-only completion: mocked Gitea never proves actual effects.
  await assert.rejects(dispatcher.dispatch("backend-task"),
    /Gateway trusted control denied/);
  assert(executedMock&&deniedExtra,
    "A real scoped child VP must be accepted and excessive authority denied");
  assert.deepEqual(dispatcher.completedTaskIds,[]);
  assert.equal(coordinator.phase,"closed");
  const afterClose=await post(gateway,"/v1/authorization/prepare",{
    task_id:"dispatch_"+randomBytes(16).toString("base64url"),
    agent_role:"backend",tool:"update_file",
    arguments:{branch,path:file,content:"never"}
  });
  assert.equal(afterClose.status,403);

  /**
   * Independently signed SECOND Engineer decision using ACTUAL Rust/EVM
   * credential issuance and revocation, but disposable mock Gitea provider.
   *
   * Model an Engineer-process crash immediately AFTER operational issuance:
   * discard the original Coordinator reference, reopen its on-disk journal,
   * and perform only revocations through a fresh trusted recovery instance.
   */
  const crashSession=session+"-crash-recovery";
  const crashPlan={...plan,session_id:crashSession,
    plan_id:"scoped-evm-crash-recovery"};
  const crashSignedAt=new Date().toISOString();
  const crashApproval=makeApproval(crashPlan,{
    allowedOperations:new Set(RUST_OPERATIONS),
    decision_id:"scoped-evm-crash-recovery-approval",
    approved_by:ENGINEER,approved_at:crashSignedAt,
    approved_permission_ids:["backend-approved"]
  });
  await writeFile(join(temp,crashSession+".json"),JSON.stringify(
    signEngineerApproval({
      plan:crashPlan,approval:crashApproval,
      engineerDid:ENGINEER,keyId,privateKeyPem:priv,
      issuedAt:crashSignedAt,
      expiresAt:new Date(Date.now()+30*60*1000).toISOString()
    })
  ),{mode:0o600});
  const independentlySigned=await approvals.loadAuthenticatedApproval(crashSession);
  assert.equal(planDigest(independentlySigned.plan),planDigest(crashPlan));
  const intentHome=join(temp,"crash-intents");
  const preliminaryHome=join(intentHome,"preliminary");
  const operationalHome=join(intentHome,"operational");
  for(const dir of [intentHome,preliminaryHome,operationalHome])
    await mkdir(dir,{mode:0o700});
  const planningJournal=new TrustedPlanningRecoveryStore(preliminaryHome);
  const operationalJournal=new TrustedOperationalRecoveryStore(operationalHome);
  const crashedAuthority=new TrustedEngineerAuthoritySession({
    snapshot:{session_id:crashSession,repository:repo,
      base_revision:baseSha,directories:[""],files:[]},
    credentials,approvals,authenticatedEngineerDid:ENGINEER
  });
  const crashedCoordinator=new TrustedExecutionCoordinator({
    authority:crashedAuthority,approvedGatewayPlans:ipc,credentials,
    sessionId:crashSession,baseRevision:baseSha,
    planningRecovery:planningJournal,operationalRecovery:operationalJournal
  });
  const crashPreliminaryId="urn:scoped-native:crash-preliminary";
  const crashOperationalId="urn:scoped-native:crash-operational";
  await crashedCoordinator.beginPlanning(root(crashPreliminaryId,"17213",180));
  assert.equal((await planningJournal.pending()).length,1);
  const activated=await crashedCoordinator.beginExecution(
    root(crashOperationalId,"17214",600));
  assert.equal(activated.plan_digest,planDigest(crashPlan));
  assert.equal(crashedCoordinator.phase,"execution");
  await planningJournal.assertClean();
  await assert.rejects(planningJournal.assertFreshSession(crashSession),
    /retired session cannot be reused/);
  const firstRecovery=new TrustedOperationalRecoveryStore(operationalHome);
  assert.equal((await firstRecovery.pending()).length,1);
  // Gateway tombstones even an ambiguous or timed-out Rust revocation.
  // Keep the actual root ID in the journal until EVM acknowledges it.
  await assert.rejects(reconcileOrphanedOperationalRoots({
    store:firstRecovery,
    gateway:{retireSession:id=>ipc.retireSession(id)},
    credentials:{async revokeRoot(id){
      assert.equal(id,crashOperationalId);
      throw Error("simulated lost native revocation acknowledgement");
    }}
  }),/manual reconciliation required/);
  assert.equal((await firstRecovery.pending()).length,1);
  await assert.rejects(firstRecovery.recordIntent({
    sessionId:crashSession,baseRevision:baseSha,
    credentialId:"urn:scoped-native:unauthorized-second-operational"
  }),/orphaned root intent/);
  // Reconstruct the store (as on Engineer restart), NOT the Coordinator.
  // Native Adapter really revokes the Rust-issued EVM operational root.
  const freshRecovery=new TrustedOperationalRecoveryStore(operationalHome);
  let gatewayRetirements=0,nativeRevocations=0;
  assert.equal(await reconcileOrphanedOperationalRoots({
    store:freshRecovery,
    gateway:{async retireSession(id){
      assert.equal(id,crashSession);
      gatewayRetirements++;
      await ipc.retireSession(id);
    }},
    credentials:{async revokeRoot(id){
      assert.equal(id,crashOperationalId);
      nativeRevocations++;
      await credentials.revokeRoot(id);
    }}
  }),1);
  assert.equal(gatewayRetirements,1);
  assert.equal(nativeRevocations,1);
  await freshRecovery.assertClean();
  await assert.rejects(freshRecovery.assertFreshSession(crashSession),
    /reconciled session cannot be reused/);
  await assert.rejects(freshRecovery.recordIntent({
    sessionId:crashSession,baseRevision:baseSha,
    credentialId:"urn:scoped-native:second-issuance-denied"
  }),/reconciled session cannot be reused/);
  assert.equal(await reconcileOrphanedOperationalRoots({
    store:new TrustedOperationalRecoveryStore(operationalHome),
    gateway:{async retireSession(){throw Error("must not repeat");}},
    credentials:{async revokeRoot(){throw Error("must not repeat");}}
  }),0);
  const afterCrash=await post(gateway,"/v1/authorization/prepare",{
    task_id:"dispatch_"+randomBytes(16).toString("base64url"),
    agent_role:"backend",tool:"update_file",
    arguments:{branch,path:file,content:"never after signed crash"}
  });
  assert.equal(afterCrash.status,403);
  process.stdout.write(JSON.stringify({
    result:"signed-plan-scoped-child-native-evm-pass",
    engineer_approval_ed25519:true,independent_roots:true,
    preliminary_root_revoked:true,child_dc_issued_by_rust:true,
    native_core_vp_verified:true,real_opa_evaluated:true,
    a2a_sdk_task_completed:true,unapproved_permission_denied:true,
    mock_provider_effects_not_attested:true,operational_root_revoked:true,
    real_gitea_operations:0,paid_model_calls:0,
    crash_recovery_signed_engineer_receipt:true,
    crash_recovery_real_evm_root_reissued:false,
    crash_recovery_actual_rust_status_revoked:true,
    crash_recovery_gateway_retired:true,
    crash_recovery_persistent_tombstone:true
  },null,2)+"\n");
}finally{
  if(server)await server.close().catch(()=>{});
  gatewayChild.kill("SIGTERM");
  await Promise.race([
    new Promise(resolve=>gatewayChild.once("exit",resolve)),
    new Promise(resolve=>setTimeout(resolve,3000))
  ]);
  if(gatewayChild.exitCode===null)gatewayChild.kill("SIGKILL");
  await rm(temp,{recursive:true,force:true});
}
