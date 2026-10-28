import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {mkdtemp,writeFile,readFile,rm,chmod,symlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {signEngineerApproval} from "../../plan-contracts/src/signed-approval.mjs";
import {makeApproval,planDigest} from "../../plan-contracts/src/plan.mjs";
import {RUST_OPERATIONS} from "../../../apps/gateway/src/operation-catalog.ts";
import {TrustedApprovedExecutionPlans} from "../../../apps/gateway/src/approved-execution-plans.ts";
import {GatewayRuntime} from "../../../apps/gateway/src/runtime.ts";
import {InMemoryAuditSink} from "../../../apps/gateway/src/prepare.ts";
import {SignedEngineerApprovalFileStore} from "../src/signed-approval-store.ts";
import {TrustedEngineerAuthoritySession} from "../src/trusted-engineer-authority.ts";
import {TrustedExecutionCoordinator} from "../src/trusted-execution-coordinator.ts";
import {prepareTrustedFreshPlanningIntake,
  startTrustedFreshRepairPlanningReview}
  from "../src/trusted-fresh-planning-intake.ts";
import type {EngineerCredentialPort,RootParameters} from "../src/trusted-engineer-authority.ts";
import type {IssuedDelegationCredential} from "../src/authority-client.ts";
import type {DelegatedPermission} from "../src/permission-templates.ts";

const REPO={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const REPO_URI="gitea://gitea.local/thesis/iam-console-poc";
const FILE_URI=REPO_URI+"/branches/feature%2Fapproved/files/apps/backend/user.ts";
const ENGINEER="did:thesis:engineer",SHA="a".repeat(40);
const ISSUED="2026-10-21T12:00:00Z",EXPIRES="2026-10-21T13:00:00Z";
const NOW=Date.parse("2026-10-21T12:05:00Z");
const OPERATIONS=new Set<string>(RUST_OPERATIONS);
const STATUS="https://status.example/lists/signed-approval-e2e";

function fixturePlan(){
  return {
    schema_version:"1.0.0",plan_id:"plan-signed-1",
    session_id:"session-signed-1",version:1,repository:REPO,
    base_revision:SHA,requirement:"Create the reviewed branch and edit one authorized file",
    candidate_agents:[{
      agent_id:"backend",did:"did:thesis:backend",card_ref:"trusted:backend"
    }],
    tasks:[
      {id:"branch",agent_id:"orchestrator",title:"Create branch",
       description:"Create isolated feature branch",depends_on:[],resources:[REPO_URI]},
      {id:"backend",agent_id:"backend",title:"Approved edit",
       description:"Modify one backend file only",depends_on:["branch"],resources:[FILE_URI]}
    ],
    requested_permissions:[
      {id:"p-branch",task_id:"branch",agent_id:"orchestrator",
       operation:"create_branch",resource:REPO_URI,reason:"Create approved branch"},
      {id:"p-backend",task_id:"backend",agent_id:"backend",
       operation:"update_file",resource:FILE_URI,reason:"Only approved code change"}
    ],
    assumptions:[],uncertainties:[]
  };
}
function fakeKeys(){
  const keys=generateKeyPairSync("ed25519");
  return {
    priv:keys.privateKey.export({format:"pem",type:"pkcs8"}).toString(),
    pub:keys.publicKey.export({format:"pem",type:"spki"}).toString()
  };
}
function receipt(privateKeyPem:string,mutator?:(p:ReturnType<typeof fixturePlan>)=>void){
  const p=fixturePlan();
  mutator?.(p);
  const approval=makeApproval(p,{
    allowedOperations:OPERATIONS,decision_id:"decision-signed-1",
    approved_by:ENGINEER,approved_at:"2026-10-21T11:59:00Z",
    approved_permission_ids:["p-branch","p-backend"]
  });
  return signEngineerApproval({
    plan:p,approval,engineerDid:ENGINEER,keyId:"engineer-signing-key-1",
    privateKeyPem,issuedAt:ISSUED,expiresAt:EXPIRES
  });
}
function root(id:string,index:string,ttl:number):RootParameters{
  return {
    credential_id:id,valid_from:ISSUED,validity_seconds:ttl,
    credential_status:{
      type:"BitstringStatusListEntry",statusPurpose:"revocation",
      statusListIndex:index,statusListCredential:STATUS
    }
  };
}

class CredentialPort implements EngineerCredentialPort {
  calls:string[]=[];
  async issueScopedOrchestratorRoot(input:RootParameters & {
    permissions:readonly DelegatedPermission[]
  }):Promise<IssuedDelegationCredential>{
    this.calls.push("issue:"+input.credential_id);
    const credential={
      "@context":["https://www.w3.org/ns/credentials/v2"],
      type:["VerifiableCredential","DelegationCredential"],
      id:input.credential_id,issuer:ENGINEER,validFrom:input.valid_from,
      credentialSubject:{
        sub:"did:thesis:orchestrator",per:structuredClone(input.permissions)
      }
    };
    return credential;
  }
  async revokeRoot(id:string):Promise<void>{
    this.calls.push("revoke:"+id);
  }
}

test("signed receipts: trusted key, correct plan digest, Engineer DID and expiry are mandatory",async(t)=>{
  const temp=await mkdtemp(join(tmpdir(),"signed-approval-"));
  t.after(()=>rm(temp,{recursive:true,force:true}));
  const {priv,pub}=fakeKeys();
  const approved=receipt(priv);
  const filename=join(temp,"session-signed-1.json");
  await writeFile(filename,JSON.stringify(approved),{encoding:"utf8",mode:0o600});
  const config={directory:temp,engineerDid:ENGINEER,
    trustedKeys:{"engineer-signing-key-1":{
      engineer_did:ENGINEER,public_key_pem:pub
    }}
  };
  const store=new SignedEngineerApprovalFileStore({...config,nowMs:()=>NOW});
  const validated=await store.loadAuthenticatedApproval("session-signed-1");
  assert.equal(validated.authenticated_engineer_did,ENGINEER);
  assert.equal(planDigest(validated.plan),planDigest(fixturePlan()));
  assert.equal(validated.approval.plan_digest,planDigest(fixturePlan()));

  for(const tamper of [
    (x:any)=>{x.plan.tasks[0].title="hidden escalation";},
    (x:any)=>{x.approval.approved_permission_ids=["p-branch"];},
    (x:any)=>{x.engineer_did="did:thesis:attacker";},
    (x:any)=>{x.signature="A".repeat(86);},
    (x:any)=>{x.key_id="attacker-key";},
    (x:any)=>{x.expires_at="2026-10-21T12:03:00Z";},
    (x:any)=>{x.unapproved=true;}
  ]){
    const altered=structuredClone(approved);
    tamper(altered);
    await writeFile(filename,JSON.stringify(altered));
    await assert.rejects(store.loadAuthenticatedApproval("session-signed-1"));
  }
  await writeFile(filename,JSON.stringify(approved));
  await chmod(filename,0o644);
  await assert.rejects(store.loadAuthenticatedApproval("session-signed-1"),
    /owner-only regular file/);
  await chmod(filename,0o600);

  // Never traverse a symlink masquerading as the signed receipt.
  await rm(filename);
  await symlink(join(temp,"safe-receipt.json"),filename);
  await writeFile(join(temp,"safe-receipt.json"),JSON.stringify(approved),{mode:0o600});
  await assert.rejects(store.loadAuthenticatedApproval("session-signed-1"));
  await rm(filename);
  await writeFile(filename,JSON.stringify(approved),{mode:0o600});

  await chmod(temp,0o755);
  await assert.rejects(store.loadAuthenticatedApproval("session-signed-1"),
    /owner-only directory/);
  await chmod(temp,0o700);

  await assert.rejects(new SignedEngineerApprovalFileStore({
    ...config,nowMs:()=>Date.parse(EXPIRES)
  }).loadAuthenticatedApproval("session-signed-1"),/expired/);
  await assert.rejects(store.loadAuthenticatedApproval("../escape"),/Invalid approved/);
  await assert.rejects(new SignedEngineerApprovalFileStore({
    ...config,trustedKeys:{"engineer-signing-key-1":{
      engineer_did:ENGINEER,public_key_pem:fakeKeys().pub
    }},nowMs:()=>NOW
  }).loadAuthenticatedApproval("session-signed-1"),/signature/);
});

test("actual signed file connects Engineer two-root handoff to Gateway plan enforcement and A2A DAG",async(t)=>{
  const temp=await mkdtemp(join(tmpdir(),"signed-approved-gateway-"));
  t.after(()=>rm(temp,{recursive:true,force:true}));
  const {priv,pub}=fakeKeys();
  await writeFile(join(temp,"session-signed-1.json"),JSON.stringify(receipt(priv)),{mode:0o600});
  const approvals=new SignedEngineerApprovalFileStore({
    directory:temp,engineerDid:ENGINEER,
    trustedKeys:{"engineer-signing-key-1":{
      engineer_did:ENGINEER,public_key_pem:pub
    }},
    nowMs:()=>NOW
  });
  const credentials=new CredentialPort();
  const trace:string[]=[];
  const originalIssue=credentials.issueScopedOrchestratorRoot.bind(credentials);
  credentials.issueScopedOrchestratorRoot=async(x)=>{
    trace.push("issue:"+x.credential_id);
    return originalIssue(x);
  };
  const originalRevoke=credentials.revokeRoot.bind(credentials);
  credentials.revokeRoot=async(id)=>{
    trace.push("revoke:"+id);
    return originalRevoke(id);
  };
  const authority=new TrustedEngineerAuthoritySession({
    snapshot:{
      session_id:"session-signed-1",repository:REPO,base_revision:SHA,
      directories:[""],files:[]
    },
    credentials,approvals,authenticatedEngineerDid:ENGINEER,
    planningRevisions:{
      async begin(taskId,ttlMs){
        trace.push("planning-sha-begin");
        assert.equal(taskId,"session-signed-1");
        assert.equal(ttlMs,600_000);
        return {task_id:taskId,base_revision:SHA,expires_at:EXPIRES};
      },
      end(){trace.push("planning-sha-end");}
    }
  });
  const plans=new TrustedApprovedExecutionPlans({
    repository:REPO,engineerDid:ENGINEER,approvals,
    completionAttestor:{async confirmCompleted(ev){
      assert.equal(ev.session_id,"session-signed-1");
      assert.equal(ev.plan_digest,planDigest(fixturePlan()));
      assert.ok(ev.successful_gateway_request_ids.length);
      trace.push("trusted-completion:"+ev.plan_task_id);
      return true; // offline trusted test attestor, NOT real A2A evidence.
    }}
  });
  const coordinator=new TrustedExecutionCoordinator({
    authority,approvedGatewayPlans:plans,credentials,
    sessionId:"session-signed-1",baseRevision:SHA
  });
  const pre=await coordinator.beginPlanning(root("urn:signed:read-root","100",600));
  assert.equal(pre.phase,"planning");
  assert.deepEqual(pre.permissions.map(p=>p.operation),
    ["read_repository","list_directory"]);
  const active=await coordinator.beginExecution(root("urn:signed:work-root","101",3600));
  assert.equal(active.plan_digest,planDigest(fixturePlan()));
  assert.equal(coordinator.phase,"execution");
  assert.deepEqual(trace.slice(0,5),[
    "planning-sha-begin","issue:urn:signed:read-root",
    "planning-sha-end","revoke:urn:signed:read-root",
    "issue:urn:signed:work-root"
  ]);

  await assert.rejects(
    coordinator.freshPlanningIntakeAfterClosure("session-signed-2"),
    /terminal closure/,
    "A still-active execution cannot stage even an unapproved next-session packet"
  );
  coordinator.bindDispatchedTask("branch","task-create-branch","orchestrator");
  coordinator.bindDispatchedTask("backend","task-edit-backend","backend");
  let calls=0;
  const audit=new InMemoryAuditSink();
  const runtime=new GatewayRuntime({
    bind_host:"127.0.0.1",bind_port:0,
    prepare:{audience:"cloud-access-gateway",request_ttl_ms:120_000,repository:REPO},
    adapter_url:"http://disabled",adapter_gateway_token:"disabled",
    opa_url:"http://disabled",opa_timeout_ms:1000,
    provider_mode:"mock",gitea_timeout_ms:1000
  },{
    approvedPlans:plans,audit,
    verifier:{async verify(req){
      return {
        presenter_id:"did:thesis:"+req.presenter,issuer_id:ENGINEER,
        credential_id:active.credential_id,
        permissions:[req.required_permission],
        hierarchy_depth:1,expiration:EXPIRES
      };
    }},
    policy:{async evaluate(){return {allow:true,policy_version:"OPA-offline"};}},
    executor:{
      provider:"gitea",async execute(record){
        calls++;
        if(record.request.tool==="create_branch"){
          return {provider:"gitea",performed:true,tool:"create_branch",
            branch:"feature/approved",base_branch:"main",revision:SHA,commit_sha:SHA};
        }
        if(record.request.tool==="update_file"){
          return {provider:"gitea",performed:true,tool:"update_file",
            branch:"feature/approved",path:"apps/backend/user.ts",
            revision:SHA,commit_sha:SHA,blob_sha:"b",precondition_blob_sha:"a"};
        }
        throw Error("Unplanned operation");
      }
    }
  });
  assert.throws(()=>runtime.prepare({
    task_id:"task-edit-backend",agent_role:"backend",tool:"update_file",
    arguments:{branch:"feature/approved",path:"apps/backend/user.ts",content:"x"}
  }),/approved/);
  const branch=runtime.prepare({
    task_id:"task-create-branch",agent_role:"orchestrator",
    tool:"create_branch",arguments:{base_branch:"main",branch:"feature/approved"}
  });
  await runtime.execute({request_id:branch.request_id,signed_vp:"jwt-test"});
  await coordinator.confirmTask("task-create-branch");
  const backend=runtime.prepare({
    task_id:"task-edit-backend",agent_role:"backend",tool:"update_file",
    arguments:{branch:"feature/approved",path:"apps/backend/user.ts",content:"x"}
  });
  await runtime.execute({request_id:backend.request_id,signed_vp:"jwt-test"});
  await coordinator.confirmTask("task-edit-backend");
  assert.equal(calls,2);
  await coordinator.closeExecution();
  assert.equal(coordinator.phase,"closed");
  assert.equal(trace.at(-1),"revoke:urn:signed:work-root");
  const referral=await coordinator.freshPlanningIntakeAfterClosure("session-signed-2");
  assert.deepEqual(referral,{
    state:"needs_fresh_planning",
    previous_session_id:"session-signed-1",
    previous_base_revision:SHA,
    proposed_next_session_id:"session-signed-2",
    planning_authorized:false,
    engineer_approved:false,
    operational_credentials_issued:false
  });
  assert.ok(Object.isFrozen(referral));

  // The NEXT Planning root is independently pinned by trusted Gitea reads;
  // the first approved DAG cannot authenticate or authorize a new one.
  const newerSha="c".repeat(40);
  const nextSnapshot={session_id:"session-signed-2",repository:REPO,
    base_revision:newerSha,directories:[""],files:["apps/backend/user.ts"]};
  const nextCredentials=new CredentialPort();
  const nextAuthority=new TrustedEngineerAuthoritySession({
    snapshot:nextSnapshot,credentials:nextCredentials,
    approvals,authenticatedEngineerDid:ENGINEER,
    planningRevisions:{
      async begin(id,ttlMs){
        assert.equal(id,nextSnapshot.session_id);
        assert.equal(ttlMs,600_000);
        return {task_id:id,base_revision:newerSha,expires_at:EXPIRES};
      },
      end(){}
    }
  });
  const nextCoordinator=new TrustedExecutionCoordinator({
    authority:nextAuthority,approvedGatewayPlans:plans,
    credentials:nextCredentials,sessionId:nextSnapshot.session_id,
    baseRevision:newerSha
  });
  let trustedReads=0;
  const discovery={async readPinnedMainSnapshot(){
    trustedReads++;
    return {repository:REPO,base_revision:newerSha,
      directories:[""],files:["apps/backend/user.ts"]};
  }};
  const intake=await prepareTrustedFreshPlanningIntake({
    previousCoordinator:coordinator,nextCoordinator,
    nextSessionId:"session-signed-2",trustedGitea:discovery
  });
  assert.deepEqual(intake,{
    state:"awaiting_fresh_planning_root",
    previous_session_id:"session-signed-1",
    previous_base_revision:SHA,
    snapshot:nextSnapshot,
    planning_authorized:false,
    engineer_approved:false,
    operational_credentials_issued:false
  });
  assert.equal(trustedReads,1);
  assert.ok(Object.isFrozen(intake.snapshot));
  assert.ok(Object.isFrozen(intake.snapshot.files));
  assert.deepEqual(nextCredentials.calls,[],
    "A referral cannot issue or automatically authorize new credentials");
  const noRootPlanning={
    planner:{snapshot:nextSnapshot,requirement:"Repair prior TypeScript failure"},
    gateway:{gatewayBaseUrl:"http://127.0.0.1:1",
      adapterBaseUrl:"http://127.0.0.1:2",adapterToken:"offline-test"}
  };
  // A mismatched or unreviewed fresh requirement is rejected before ANY
  // provisional credential, model call, or backend checkpoint can occur.
  await assert.rejects(startTrustedFreshRepairPlanningReview({
    previousCoordinator:coordinator,nextCoordinator,
    nextSessionId:nextSnapshot.session_id,trustedGitea:discovery,
    planning:{...noRootPlanning,planner:{
      ...noRootPlanning.planner,snapshot:{...nextSnapshot,
        base_revision:"b".repeat(40)}
    }} as never
  }),/independently pinned Gitea snapshot/);
  await assert.rejects(startTrustedFreshRepairPlanningReview({
    previousCoordinator:coordinator,nextCoordinator,
    nextSessionId:nextSnapshot.session_id,trustedGitea:discovery,
    planning:{...noRootPlanning,planner:{
      ...noRootPlanning.planner,requirement:""}
    } as never
  }),/explicitly supplied by the owner/);
  // Valid fresh snapshot reaches the existing authenticated owner
  // bootstrap, which then rejects absent signing/recovery components.
  await assert.rejects(startTrustedFreshRepairPlanningReview({
    previousCoordinator:coordinator,nextCoordinator,
    nextSessionId:nextSnapshot.session_id,trustedGitea:discovery,
    planning:noRootPlanning as never
  }),/independent Planning components and idle Coordinator required/);
  assert.deepEqual(nextCredentials.calls,[],
    "Preflight and missing owner services cannot issue a fresh root");
  await assert.rejects(prepareTrustedFreshPlanningIntake({
    previousCoordinator:coordinator,nextCoordinator,
    nextSessionId:"session-signed-2",
    trustedGitea:{async readPinnedMainSnapshot(){
      return {...nextSnapshot,session_id:undefined};
    }}
  }),/invalid shape/);
  await assert.rejects(prepareTrustedFreshPlanningIntake({
    previousCoordinator:coordinator,nextCoordinator,
    nextSessionId:"session-signed-2",
    trustedGitea:{async readPinnedMainSnapshot(){
      return {...nextSnapshot,session_id:undefined,
        repository:{...REPO,repository:"attacker"}};
    }}
  }),/invalid shape/);
  await assert.rejects(prepareTrustedFreshPlanningIntake({
    previousCoordinator:coordinator,nextCoordinator,
    nextSessionId:"session-signed-2",
    trustedGitea:{async readPinnedMainSnapshot(){
      return {repository:REPO,base_revision:"d".repeat(40),
        directories:[""],files:[]};
    }}
  }),/matching snapshot pins/);
  await assert.rejects(prepareTrustedFreshPlanningIntake({
    previousCoordinator:coordinator,nextCoordinator,
    nextSessionId:"session-signed-2",
    trustedGitea:{async readPinnedMainSnapshot(){
      return {repository:{...REPO,repository:"attacker"},
        base_revision:newerSha,directories:[""],files:[]};
    }}
  }),/original pinned repository/);
  const nextReadOnly=await nextCoordinator.beginPlanning(
    root("urn:signed:fresh-planning-root","105",600));
  assert.equal(nextReadOnly.phase,"planning");
  assert.deepEqual(nextReadOnly.permissions.map(p=>p.operation),
    ["read_repository","list_directory","read_file"]);
  assert.deepEqual(nextCredentials.calls,["issue:urn:signed:fresh-planning-root"]);
  assert.equal(nextCoordinator.phase,"planning");
  // The new Coordinator is only in preliminary Planning. No operational
  // permission or Engineer approval is supplied by the handoff.
  assert.throws(()=>nextCoordinator.trustedOperationalAuthority(),
    /Verified operational root is not active/);
  assert.equal(nextCredentials.calls.some(x=>x.includes("work-root")),false);
  // Explicit trusted cancellation still revokes this independent read-only
  // root; neither the old Coordinator nor a model can silently do so.
  await nextCoordinator.closePlanning();
  assert.equal(nextCoordinator.phase,"closed");
  assert.deepEqual(nextCredentials.calls,[
    "issue:urn:signed:fresh-planning-root",
    "revoke:urn:signed:fresh-planning-root"
  ]);

  await assert.rejects(
    coordinator.freshPlanningIntakeAfterClosure("session-signed-1"),
    /distinct valid session ID/);
  await assert.rejects(
    coordinator.freshPlanningIntakeAfterClosure("../another-session"),
    /distinct valid session ID/);
  await assert.rejects(
    coordinator.beginPlanning(root("urn:signed:reuse-old-root","104",600)),
    /phase|closed|Planning/i,
    "A referral is NOT authority to re-enter the old Coordinator"
  );
  assert.throws(()=>runtime.prepare({
    task_id:"task-create-branch",agent_role:"orchestrator",
    tool:"create_branch",arguments:{base_branch:"main",branch:"feature/approved"}
  }),(error:unknown)=>error!==null && typeof error==="object" &&
      "code" in error && error.code==="approved_plan_denied");
});

test("if Gateway cannot activate a matching signed plan, independently issued operational DC is revoked",async(t)=>{
  const temp=await mkdtemp(join(tmpdir(),"signed-failed-handoff-"));
  t.after(()=>rm(temp,{recursive:true,force:true}));
  const {priv,pub}=fakeKeys();
  await writeFile(join(temp,"session-signed-1.json"),JSON.stringify(receipt(priv)),{mode:0o600});
  const approvals=new SignedEngineerApprovalFileStore({
    directory:temp,engineerDid:ENGINEER,
    trustedKeys:{"engineer-signing-key-1":{engineer_did:ENGINEER,public_key_pem:pub}},
    nowMs:()=>NOW
  });
  const creds=new CredentialPort();
  const authority=new TrustedEngineerAuthoritySession({
    snapshot:{session_id:"session-signed-1",repository:REPO,base_revision:SHA,
      directories:[""],files:[]},
    credentials:creds,approvals,authenticatedEngineerDid:ENGINEER
  });
  const gate=new TrustedApprovedExecutionPlans({
    repository:REPO,engineerDid:ENGINEER,approvals,
    completionAttestor:{async confirmCompleted(){return false;}}
  });
  const coordinator=new TrustedExecutionCoordinator({
    authority,approvedGatewayPlans:gate,credentials:creds,
    sessionId:"session-signed-1",baseRevision:"b".repeat(40)
  });
  await coordinator.beginPlanning(root("urn:signed:read-root","100",600));
  await assert.rejects(coordinator.beginExecution(root("urn:signed:work-root","101",3600)),
    /trusted Gitea snapshot/);
  assert.equal(coordinator.phase,"failed_closed");
  assert.deepEqual(creds.calls,[
    "issue:urn:signed:read-root","revoke:urn:signed:read-root",
    "issue:urn:signed:work-root","revoke:urn:signed:work-root"
  ]);
});
