/**
 * Native, offline pre-approval Planning integration. This runs only after
 * Anvil, EVM trust, the actual Rust Adapter and native Core addon are online.
 *
 * REAL: Rust-issued EVM-root DC, signed JWT VP, independent Core Rust verifier,
 * live OPA policy, Planning revision registry, Google ADK/A2A-independent
 * read-only Planner, and on-chain root revocation.
 * FIXTURE mode: pinned Gitea read snapshot.
 * DISPOSABLE mode: real read-only Gitea from existing isolated Docker test.
 * Both use a controlled ADK model and embedded Gateway HTTP transport.
 * No external LLM, user approval, writes to main or persistent Gitea.
 */
import assert from "node:assert/strict";
import {randomBytes,randomInt,generateKeyPairSync} from "node:crypto";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {makeApproval,assertApprovedPlanScope}
  from "../../../packages/plan-contracts/src/plan.mjs";
import {signEngineerApproval} from "../../../packages/plan-contracts/src/signed-approval.mjs";
import {RUST_OPERATIONS} from "../src/operation-catalog.ts";
import {SignedEngineerApprovalFileStore} from
  "../../../packages/orchestrator-runtime/src/signed-approval-store.ts";
import {TrustedPlanningReviewGate} from
  "../../../packages/orchestrator-runtime/src/trusted-planning-review-gate.ts";
import {TrustedApprovedExecutionPlans} from "../src/approved-execution-plans.ts";
import {TrustedApprovedA2ADispatcher} from
  "../../../packages/orchestrator-runtime/src/trusted-approved-a2a-dispatcher.ts";
import {GatewayCorroboratedTaskAttestor} from
  "../src/trusted-task-observation.ts";
import {runNativePositiveApprovedDag} from "./native-approved-planner-dag-positive.mjs";
import {OfflineApprovedAdkModel} from "./offline-approved-adk-model.mjs";
import {SourceWitnessedOfflineAdkModel}
  from "./source-witnessed-offline-adk-model.mjs";
import {SourceDerivedRouteOfflineAdkModel}
  from "./source-derived-route-offline-adk-model.mjs";
import {buildOfflineAdkScriptsFromApprovedPlan}
  from "./approved-plan-offline-adk-call-scripts.mjs";
import {getApprovedOfflineScenario} from
  "../../test-runner-controller/fixtures/approved-scenarios.mjs";
import {makeOfflineReviewableDag} from
  "../../../packages/orchestrator-runtime/test/fixtures/offline-planning-dag.mjs";
import {BaseLlm} from "@google/adk";
import {GatewayRuntime} from "../src/runtime.ts";
import {loadDirectCoreRustVerifier} from "../src/direct-core-loader.ts";
import {GiteaReadOnlyExecutor} from "../src/gitea-read-executor.ts";
import {GiteaClient} from "../src/gitea-client.ts";
import {OpaPolicyClient} from "../src/policy-client.ts";
import {TrustedPlanningRevisions} from "../src/planning-revisions.ts";
import {InMemoryAuditSink} from "../src/prepare.ts";
import {SoftwareEngineerAuthorityBootstrap} from
  "../../../packages/orchestrator-runtime/src/authority-client.ts";
import {TrustedEngineerAuthoritySession} from
  "../../../packages/orchestrator-runtime/src/trusted-engineer-authority.ts";
import {TrustedExecutionCoordinator} from
  "../../../packages/orchestrator-runtime/src/trusted-execution-coordinator.ts";
import {TrustedPlanningGatewayReadPort} from
  "../../../packages/orchestrator-runtime/src/trusted-planning-gateway-port.ts";
import {TrustedAdkReadOnlyPlanner} from
  "../../../packages/orchestrator-runtime/src/trusted-adk-planner.ts";

if(process.env.ADAPTER_TRUST_PROFILE!=="evm" ||
   process.env.GATEWAY_VERIFIER_MODE!=="core-rust")
  throw Error("This test requires live EVM trust and native Core Rust verification");
const token=process.env.ADAPTER_CALLER_ORCHESTRATOR;
const engineerToken=process.env.ADAPTER_CALLER_ENGINEER;
const engineerDid=process.env.ADAPTER_ID_ENGINEER;
for(const v of [token,engineerToken,engineerDid]){
  if(typeof v!=="string"||!v)throw Error("Missing trusted EVM fixture setting");
}
const repo={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const scenario=getApprovedOfflineScenario(process.env.APPROVED_RUNNER_SCENARIO);
const referenceFiles=scenario.files;
const file="apps/backend/src/users/user.service.ts";
const frontendFile="apps/frontend/src/pages/UserDetailPage.tsx";
const disposableBase=process.env.PLANNING_DISPOSABLE_GITEA_URL;
const disposableToken=process.env.PLANNING_DISPOSABLE_GITEA_READ_TOKEN;
const disposableSha=process.env.PLANNING_DISPOSABLE_GITEA_MAIN_SHA;
const realGitea=[disposableBase,disposableToken,disposableSha]
  .some(v=>v!==undefined);
const signedHandoff=process.env.PLANNING_NATIVE_SIGNED_HANDOFF==="1";
const positiveDag=process.env.PLANNING_NATIVE_POSITIVE_DAG==="1";
const writerToken=process.env.PLANNING_DISPOSABLE_GITEA_WRITE_TOKEN;
if(positiveDag&&(!signedHandoff||!realGitea||!writerToken||
   !process.env.ADAPTER_CALLER_BACKEND))
  throw Error("Native positive DAG requires signed handoff and disposable writer");
if(signedHandoff&&!realGitea)
  throw Error("Native signed handoff requires verified disposable Gitea");
if(realGitea&&[disposableBase,disposableToken,disposableSha]
  .some(v=>typeof v!=="string"||!v))
  throw Error("Disposable Planning Gitea requires URL, read token and immutable SHA");
if(realGitea&&!/^http:\/\/127\.0\.0\.1:\d+$/u.test(disposableBase))
  throw Error("Disposable Planning Gitea must use temporary localhost port");
if(realGitea&&!/^[a-f0-9]{40}$/u.test(disposableSha))
  throw Error("Disposable Planning Gitea needs a full trusted SHA");
const liveClient=realGitea?new GiteaClient({
  baseUrl:disposableBase,token:disposableToken,owner:"thesis",
  repository:"iam-console-poc",timeoutMs:10000
}):undefined;
const originalMain=liveClient?await liveClient.readRepository():undefined;
if(liveClient&&(originalMain?.default_branch!=="main"||
    originalMain?.revision!==disposableSha||
    originalMain?.full_name!=="thesis/iam-console-poc"))
  throw Error("Actual disposable Gitea main SHA/identity does not match fixture bootstrap");
const baseSha=originalMain?.revision??"a".repeat(40);
const originalFeature=liveClient?
  (await liveClient.getBranchMetadata(scenario.fixtureBranch)).commit_sha:undefined;
const session="native-read-plan-"+randomBytes(5).toString("hex");
const rootId="urn:native:planning-only-"+randomBytes(7).toString("hex");
// The 11-file deterministic reference fixture is NEVER a source of
// authority; the signed plan and the snapshot explicitly enumerate every
// permitted path. One E2E spec is absent on main and must be created by the
// separately scoped Test role, not by Backend/Frontend.
const roleFiles=scenario.planning_intent.edits;
const newTestFile=scenario.planning_intent.newTestFile;
const existingFiles=[...roleFiles.backend,...roleFiles.frontend];
assert.deepEqual([...existingFiles,newTestFile].sort(),
  Object.keys(referenceFiles).sort());
const approvedDirectories=new Set([""]);
for(const path of [...existingFiles,newTestFile]){
  const parts=path.split("/");
  for(let i=1;i<parts.length;i++)
    approvedDirectories.add(parts.slice(0,i).join("/"));
}
const snapshot={
  session_id:session,repository:repo,base_revision:baseSha,
  directories:positiveDag?[...approvedDirectories]:[
    "","apps","apps/backend","apps/backend/src","apps/backend/src/users",
    "apps/frontend","apps/frontend/src","apps/frontend/src/pages"
  ],
  files:positiveDag?existingFiles:[file,frontendFile]
};
const agentDids={
  backend:process.env.ADAPTER_ID_BACKEND,
  frontend:process.env.ADAPTER_ID_FRONTEND,
  test:process.env.ADAPTER_ID_TEST
};
for(const did of Object.values(agentDids)){
  if(typeof did!=="string"||!did.startsWith("did:"))throw Error("Missing Agent DID");
}
const agents=Object.fromEntries(Object.entries(agentDids).map(([role,did])=>
  [role,{did,card_ref:"trusted:"+role}]));
const workBranch=positiveDag?scenario.workBranch:"feature/native-planning-read";
const legacyPlanSketch={
  tasks:[
    {id:"branch",agent_id:"orchestrator",title:"Create isolated work branch",
      description:"Keep all changes out of main",depends_on:[],
      permissions:[{operation:"create_branch",path:null,reason:"Separate workflow"}]},
    {id:"backend",agent_id:"backend",title:"Update approved service",
      description:"Implement the bounded requirement",depends_on:["branch"],
      permissions:[
        {operation:"read_file",path:file,reason:"Inspect existing code"},
        {operation:"update_file",path:file,reason:"Apply the approved edit"}
      ]},
    {id:"frontend",agent_id:"frontend",title:"Update approved page",
      description:"Implement approved Frontend behavior",depends_on:["backend"],
      permissions:[
        {operation:"read_file",path:frontendFile,reason:"Inspect existing page"},
        {operation:"update_file",path:frontendFile,reason:"Apply approved page edit"}
      ]},
    ...(positiveDag?[{id:"test",agent_id:"test",title:"Run pinned Docker acceptance",
      description:"Verify final Frontend SHA through the real controlled Runner",
      depends_on:["frontend"],
      permissions:[{operation:"run_tests",path:null,
        reason:"Execute tests and independent acceptance on approved branch"}]}]:[])
  ],assumptions:[],uncertainties:[]
};
const planSketch=positiveDag?
  makeOfflineReviewableDag({
    snapshot,edits:roleFiles,newTestFile,
    taskInstructions:scenario.planning_intent.taskInstructions
  }):legacyPlanSketch;
class ScriptedReadPlanner extends BaseLlm{
  turns=0; requests=[];
  constructor(){super({model:"native-planning-offline-script"});}
  async *generateContentAsync(req){
    this.requests.push(req);this.turns++;
    // Exercise the same bounded, read-only repository discovery tools that
    // a real Planner may use. No scripted source write or approval occurs.
    // The original negative/handoff fixture keeps its single pinned read.
    const exploration=positiveDag?[
      // Gemini requires the repository selector in its tool declaration.
      // Runtime still authorizes an argument-free, pinned read_repository.
      {name:"read_repository",args:{repository:repo.repository}},
      {name:"list_directory",args:{branch:"main",path:""}},
      {name:"read_file",args:{branch:"main",path:file}},
      {name:"read_file",args:{branch:"main",path:frontendFile}}
    ]:[{name:"read_file",args:{branch:"main",path:file}}];
    if(this.turns<=exploration.length){
      const call=exploration[this.turns-1];
      yield {content:{role:"model",parts:[{functionCall:{
        id:"planning-discovery-"+this.turns,
        name:call.name,args:call.args
      }}]}};
      return;
    }
    yield {content:{role:"model",parts:[{text:JSON.stringify(planSketch)}]}};
  }
  connect(){return Promise.reject(Error("Live LLM forbidden in offline test"));}
}
const adapterUrl="http://127.0.0.1:8090";
const opaUrl=process.env.OPA_URL??"http://127.0.0.1:8181";
const log={giteaReads:0,adapterPresentations:0,prepares:0,executions:0};
const fixtureGitea={
  async readRepository(pinned){
    log.giteaReads++;
    return {full_name:"thesis/iam-console-poc",default_branch:"main",
      revision:pinned??baseSha};
  },
  async readTextFile(branch,path,revision){
    log.giteaReads++;
    assert.equal(branch,"main");
    assert.ok([file,frontendFile].includes(path));
    assert.equal(revision,baseSha);
    return {path,branch,revision,blob_sha:"b".repeat(40),
      last_commit_sha:baseSha,size:32,encoding:"utf-8",
      content:"export const authorizedSource = true;\n"};
  },
  async listDirectory(branch,path,revision){
    log.giteaReads++;
    assert.equal(branch,"main");assert.equal(revision,baseSha);
    return {branch,path,revision,entries:[]};
  }
};
const gitea=liveClient?{
  async readRepository(pinned){
    log.giteaReads++;
    return liveClient.readRepository(pinned);
  },
  async readTextFile(branch,path,revision){
    log.giteaReads++;
    return liveClient.readTextFile(branch,path,revision);
  },
  async listDirectory(branch,path,revision){
    log.giteaReads++;
    return liveClient.listDirectory(branch,path,revision);
  }
}:fixtureGitea;
const revisions=new TrustedPlanningRevisions(gitea);
const audit=new InMemoryAuditSink();
// This offline-only fixture provisions an ephemeral Engineer signing key.
// Production code must use a separately authenticated Engineer with a
// protected signer; the Planner never receives or invokes the private key.
const receiptDir=signedHandoff?
  await mkdtemp(join(tmpdir(),"native-planning-engineer-review-")):undefined;
const signer=signedHandoff?generateKeyPairSync("ed25519"):undefined;
const keyId="isolated-native-review-key";
const signerPublic=signer?.publicKey.export({
  format:"pem",type:"spki"
}).toString();
const signerPrivate=signer?.privateKey.export({
  format:"pem",type:"pkcs8"
}).toString();
const signedStore=receiptDir?new SignedEngineerApprovalFileStore({
  directory:receiptDir,engineerDid,trustedKeys:{
    [keyId]:{engineer_did:engineerDid,public_key_pem:signerPublic}
  }
}):undefined;
let coordinator;
const reviewGate=signedStore?new TrustedPlanningReviewGate({
  snapshot,expectedWorkBranch:workBranch,
  authenticatedEngineerDid:engineerDid,signedApprovals:signedStore,
  planningIsActive:()=>coordinator?.phase==="planning"
}):undefined;
const approvedPlans=reviewGate?new TrustedApprovedExecutionPlans({
  repository:repo,engineerDid,approvals:reviewGate,
  completionAttestor:positiveDag?new GatewayCorroboratedTaskAttestor():{
    async confirmCompleted(){
      // Negative suite never accepts a remote completion claim.
      return false;
    }
  }
}):undefined;
const config={bind_host:"127.0.0.1",bind_port:0,
  prepare:{audience:"cloud-access-gateway",request_ttl_ms:120000,repository:repo},
  opa_url:opaUrl,opa_timeout_ms:15000,
  provider_mode:"mock",gitea_timeout_ms:15000};
const runtime=new GatewayRuntime(config,{
  planningRevisions:revisions,audit,
  ...(approvedPlans?{approvedPlans}:{}),
  verifier:loadDirectCoreRustVerifier(),
  policy:new OpaPolicyClient({baseUrl:opaUrl,timeoutMs:15000}),
  // This read-only Gitea provider remains intentionally INCAPABLE of writes
  // even after genuine operational authority is issued by Rust.
  executor:new GiteaReadOnlyExecutor(gitea)
});
const authorityClient=new SoftwareEngineerAuthorityBootstrap({
  adapterBaseUrl:adapterUrl,bearerToken:engineerToken,timeoutMs:60000
});
const authority=new TrustedEngineerAuthoritySession({
  snapshot,credentials:authorityClient,
  approvals:reviewGate??{async loadAuthenticatedApproval(){
    throw Error("An unapproved Planning proposal must never activate Execution");
  }},
  authenticatedEngineerDid:engineerDid,
  planningRevisions:revisions
});
coordinator=new TrustedExecutionCoordinator({
  authority,credentials:authorityClient,
  sessionId:session,baseRevision:baseSha,
  approvedGatewayPlans:approvedPlans??{
    async activate(){throw Error("Execution prohibited before Engineer approval");},
    bindTask(){throw Error("Execution prohibited");},
    async confirmTaskCompletion(){throw Error("Execution prohibited");},
    closeSession(){throw Error("Execution prohibited");}
  }
});
const json=(object,status=200)=>new Response(JSON.stringify(object),{
  status,headers:{"content-type":"application/json"}
});
const transport=async(url,options)=>{
  const endpoint=String(url);
  if(endpoint.startsWith(adapterUrl+"/")){
    if(endpoint.endsWith("/v1/presentations"))log.adapterPresentations++;
    return fetch(url,options);
  }
  const body=JSON.parse(String(options.body));
  try{
    if(endpoint==="http://native-planning-gateway/v1/authorization/prepare"){
      log.prepares++;
      return json(runtime.prepare(body),201);
    }
    if(endpoint==="http://native-planning-gateway/v1/authorization/execute"){
      log.executions++;
      return json(await runtime.execute(body));
    }
  }catch{
    return json({error:"protected_operation_denied"},403);
  }
  throw Error("Unexpected Planning transport destination");
};
const root={
  credential_id:rootId,valid_from:new Date(Date.now()-1000).toISOString(),
  validity_seconds:600,
  credential_status:{type:"BitstringStatusListEntry",
    statusPurpose:"revocation",statusListIndex:String(randomInt(51000,61000)),
    statusListCredential:"https://status.example/lists/native-planning-read"}
};
let issued=false,revoked=false;
try{
  const started=await coordinator.beginPlanning(root);
  issued=true;
  assert.equal(started.phase,"planning");
  assert.equal(started.credential_id,rootId);
  assert.equal(coordinator.trustedPlanningAuthority().permissions.length,
    1+snapshot.directories.length+snapshot.files.length);
  const port=new TrustedPlanningGatewayReadPort({
    coordinator,snapshot,
    gatewayBaseUrl:"http://native-planning-gateway",
    adapterBaseUrl:adapterUrl,adapterToken:token,
    fetchFn:transport,timeoutMs:60000
  });
  const noWrite=log.adapterPresentations;
  await assert.rejects(port.invoke("update_file",{
    branch:"main",path:file,content:"malicious"
  }));
  await assert.rejects(port.invoke("read_file",{
    branch:"main",path:"private/credentials.env"
  }));
  assert.equal(log.adapterPresentations,noWrite);
  const model=new ScriptedReadPlanner();
  const proposed=await new TrustedAdkReadOnlyPlanner({
    model,snapshot,workBranch,
    requirement:positiveDag?scenario.requirement:"Improve authorized backend behavior",
    planId:"native-planning-proposal",agents,readPort:port
  }).propose();
  assert.equal(proposed.status,"unapproved_proposal");
  assert.equal(proposed.verified_source_reads,positiveDag?2:1);
  assert.equal(proposed.plan.base_revision,baseSha);
  assert.equal(proposed.plan.repository.repository,"iam-console-poc");
  assert.equal(proposed.plan.requested_permissions.length,
    positiveDag?(2*existingFiles.length+4):5); // read+write per file; branch, create, tests, PR
  assert.equal(log.adapterPresentations,positiveDag?4:1);
  assert.equal(log.prepares,positiveDag?4:1);
  assert.equal(log.executions,positiveDag?4:1);
  assert.equal(log.giteaReads,positiveDag?5:2);
  // Trusted SHA bootstrap plus bounded real read-only model discovery.
  if(liveClient){
    // Read-only PAT and the provider are backed by the disposable Gitea,
    // never the public baseline or an in-memory repository emulator.
    const fileAtSha=await liveClient.readTextFile("main",file,baseSha);
    assert.ok(fileAtSha.content.includes("listUsers"));
    assert.equal(fileAtSha.revision,baseSha);
  }
  const executed=audit.events.filter(e=>e.event==="authorization_executed");
  assert.equal(executed.length,positiveDag?4:1);
  for(const effect of executed){
    assert.equal(effect.decision,"allow");
    assert.equal(effect.policy_decision,"allow");
    assert.equal(effect.pinned_revision,baseSha);
    assert.equal(effect.provider_result,"success");
  }
  if(positiveDag){
    assert.deepEqual(executed.map(e=>e.tool),[
      "read_repository","list_directory","read_file","read_file"
    ]);
    assert.deepEqual(proposed.plan.tasks.find(t=>t.id==="frontend")?.depends_on,
      ["branch"]);
    assert.deepEqual(proposed.plan.tasks.find(t=>t.id==="test")?.depends_on,
      ["backend","frontend"]);
  }
  const visible=JSON.stringify(model.requests);
  for(const secret of [rootId,token,engineerToken,
    "signed_vp","delegation_evidence","credential_status"]){
    assert.ok(!visible.includes(secret),"Planner leaked private authority");
  }
  // Obtain a second bounded challenge and JWT BEFORE revocation, so the
  // post-revocation failure exercises the native Rust verifier directly,
  // not merely the Adapter refusing to issue another JWT.
  const waiting=runtime.prepare({task_id:session,agent_role:"orchestrator",
    tool:"read_file",arguments:{branch:"main",path:file}});
  const jwtResponse=await fetch(adapterUrl+"/v1/presentations",{
    method:"POST",
    headers:{authorization:"Bearer "+token,"content-type":"application/json"},
    body:JSON.stringify({
      credential_id:rootId,
      disclosed_permissions:[waiting.required_permission],
      audience:waiting.audience,challenge:waiting.challenge
    })
  });
  assert.equal(jwtResponse.status,200);
  const signedBeforeRevoke=(await jwtResponse.json()).signed_vp;
  assert.ok(typeof signedBeforeRevoke==="string"&&signedBeforeRevoke.length>100);
  let operationalRootId,revocationChecked=false;
  if(signedHandoff){
    const packet=reviewGate.stageTrustedProposal(proposed);
    assert.equal(packet.status,"awaiting_engineer_signature");
    assert.equal(packet.plan_digest,proposed.digest);
    assert.equal(packet.base_revision,baseSha);
    assert.equal(packet.work_branch,workBranch);
    // The isolated Engineer fixture explicitly signs only a SUBSET:
    // create_branch and update_file, but NOT read_file. A model-proposed
    // permission without Engineer consent must never appear in the new root.
    const selected=positiveDag
      ?proposed.plan.requested_permissions.map(p=>p.id)
      :["permission-1","permission-3","permission-5"];
    const now=new Date(),approvedAt=now.toISOString();
    const approval=makeApproval(packet.plan,{
      allowedOperations:new Set(RUST_OPERATIONS),
      decision_id:"isolated-human-review-fixture",
      approved_by:engineerDid,approved_at:approvedAt,
      approved_permission_ids:selected
    });
    const receipt=signEngineerApproval({
      plan:packet.plan,approval,engineerDid,keyId,
      privateKeyPem:signerPrivate,issuedAt:approvedAt,
      expiresAt:new Date(now.getTime()+600_000).toISOString()
    });
    await writeFile(join(receiptDir,session+".json"),
      JSON.stringify(receipt),{mode:0o600});
    const trustedReceipt=await reviewGate.loadAuthenticatedApproval(session);
    assert.deepEqual(trustedReceipt.approval.approved_permission_ids,selected);
    assert.equal(trustedReceipt.authenticated_engineer_did,engineerDid);
    const opId="urn:native:operational-"+randomBytes(7).toString("hex");
    const active=await coordinator.beginExecution({
      credential_id:opId,
      valid_from:new Date(Date.now()-1000).toISOString(),
      validity_seconds:600,
      credential_status:{
        type:"BitstringStatusListEntry",
        statusPurpose:"revocation",
        statusListIndex:String(randomInt(61001,65000)),
        statusListCredential:"https://status.example/lists/native-planning-read"
      }
    });
    revoked=true; // Coordinator confirmed EVM revocation before activation
    // Test the PRE-revocation signed VP immediately while its challenge
    // is still live. Docker can exceed the short Prepare TTL; checking after
    // the full E2E would only prove request expiry (410), not EVM revocation.
    const revocationReadCount=log.giteaReads;
    await assert.rejects(
      runtime.execute({request_id:waiting.request_id,
        signed_vp:signedBeforeRevoke}),
      e=>e?.code==="verification_rejected"
    );
    assert.equal(log.giteaReads,revocationReadCount);
    revocationChecked=true;
    operationalRootId=active.credential_id;
    assert.equal(active.plan_digest,packet.plan_digest);
    assert.equal(coordinator.phase,"execution");
    const operational=coordinator.trustedOperationalAuthority();
    assert.equal(operational.credential_id,opId);
    assert.deepEqual(operational.permissions.map(p=>p.operation),
      positiveDag?proposed.plan.requested_permissions.map(p=>p.operation):
        ["create_branch","update_file","update_file"]);
    if(positiveDag){
      let approvedAgentModelFactory;
      if(process.env.APPROVED_RUNNER_HOST_SELECTED_ADK_MODELS==="1"){
        // The MODEL FACTORY is now separate from the signed native runner.
        // This CI producer still uses deterministic implementation fixtures,
        // but only inside this owner test host, NOT as an agent permission
        // source or as data supplied to the model binding.
        const reviewed=await reviewGate.loadAuthenticatedApproval(session);
        const approvedRows=assertApprovedPlanScope(
          reviewed.plan,reviewed.approval,{
            allowedOperations:new Set(RUST_OPERATIONS),
            expectedEngineerDid:engineerDid
          });
        // In route mode, no final implementation bytes for user.routes.ts
        // enter the script compiler OR the Backend model constructor.
        const deriveRoutes=
          process.env.APPROVED_RUNNER_SOURCE_DERIVED_ROUTES==="1";
        const targetRoute="apps/backend/src/users/user.routes.ts";
        const otherImplementations={...referenceFiles};
        if(deriveRoutes)delete otherImplementations[targetRoute];
        const offlineCalls=buildOfflineAdkScriptsFromApprovedPlan({
          plan:reviewed.plan,approvedRows,repo,branch:workBranch,
          implementationContents:deriveRoutes?otherImplementations:referenceFiles,
          ...(deriveRoutes?{sourceDerivedPaths:[targetRoute]}:{})
        });
        approvedAgentModelFactory=context=>{
          const expected=approvedRows.filter(g=>
            g.agent_id===context.role).map(g=>({
              task_id:g.task_id,operation:g.operation,resource:g.resource
            }));
          assert.deepEqual(context.approved_permissions,expected);
          assert.equal(Object.hasOwn(context,"implementationContents"),false);
          if(context.role==="backend"&&deriveRoutes)
            return new SourceDerivedRouteOfflineAdkModel({
              context,calls:offlineCalls[context.role]
            });
          if(context.role==="frontend"&&
             process.env.APPROVED_RUNNER_NATIVE_SOURCE_WITNESS==="1")
            return new SourceWitnessedOfflineAdkModel({
              context,calls:offlineCalls[context.role]
            });
          return new OfflineApprovedAdkModel(
            context.role,offlineCalls[context.role]);
        };
      }
      globalThis.__nativeDagPositive=await runNativePositiveApprovedDag({
        coordinator,reviewGate,approvedPlans,
        ...(approvedAgentModelFactory?{approvedAgentModelFactory}:{}),
        sessionId:session,planDigest:packet.plan_digest,baseSha,
        operationalRootId,branch:workBranch,
        referenceFiles:approvedAgentModelFactory?undefined:referenceFiles,
        scenarioId:scenario.id,repo,
        giteaBase:disposableBase,readerToken:disposableToken,
        writerToken,opaUrl,engineerDid,orchestratorToken:token,
        agentTokens:{
          backend:process.env.ADAPTER_CALLER_BACKEND,
          frontend:process.env.ADAPTER_CALLER_FRONTEND,
          test:process.env.ADAPTER_CALLER_TEST
        }
      });
      assert.equal(globalThis.__nativeDagPositive.signed_dag_completed,true);
      const sourceWitnessMode=
        process.env.APPROVED_RUNNER_NATIVE_SOURCE_WITNESS==="1";
      const derivedRoutesMode=
        process.env.APPROVED_RUNNER_SOURCE_DERIVED_ROUTES==="1";
      assert.equal(globalThis.__nativeDagPositive.model_source,
        derivedRoutesMode
          ? "host_supplied_source_derived_routes_with_remaining_fixtures"
          : sourceWitnessMode
            ? "host_supplied_hybrid_source_witness_and_fixture"
            : approvedAgentModelFactory
              ? "host_supplied_scripted_tool_calls"
              : "inline_scripted_tool_calls");
      assert.equal(globalThis.__nativeDagPositive
        .source_derived_functional_route_verified,derivedRoutesMode);
      assert.equal(globalThis.__nativeDagPositive
        .source_derived_functional_file_count,derivedRoutesMode?1:0);
      assert.equal(globalThis.__nativeDagPositive
        .source_witnessed_native_dag_verified,sourceWitnessMode);
      // A host-selected BaseLlm can still encapsulate golden implementation
      // bytes. Do not let a provider-green E2E claim model independence.
      assert.equal(globalThis.__nativeDagPositive.scripted_adk_no_paid_model,true);
      assert.equal(globalThis.__nativeDagPositive
        .fixture_scripted_payloads_reach_adk_runner,true);
      assert.equal(globalThis.__nativeDagPositive
        .independent_model_software_output_verified,false);
      assert.equal(globalThis.__nativeDagPositive.source_writes,
        existingFiles.length);
      assert.equal(globalThis.__nativeDagPositive.manifest_source,
        "engineer_signed_approved_plan");
      assert.equal(globalThis.__nativeDagPositive.created_test_files,1);
      assert.equal(globalThis.__nativeDagPositive.test_runner_runs,1);
      assert.equal(globalThis.__nativeDagPositive.tested_commit_sha,
        globalThis.__nativeDagPositive.approved_branch_sha);
    }else{
    // Load the ACTUAL production-style approved DAG dispatcher from the
    // same signed review gate, operational root, and immutable base SHA.
    // A read-only provider cannot create a branch, so this stage deliberately
    // proves fail-closed BEFORE any specialized A2A send/child DC issuance.
    let a2aSends=0,childAllocations=0;
    const dispatcher=await TrustedApprovedA2ADispatcher.loadWithScopedChildAuthority({
      approvals:reviewGate,coordinator,sessionId:session,
      expectedPlanDigest:packet.plan_digest,baseRevision:baseSha,
      expectedEngineerDid:engineerDid,
      agentBaseUrls:{
        backend:"http://127.0.0.1:18861",
        frontend:"http://127.0.0.1:18862",
        test:"http://127.0.0.1:18863"
      },
      a2a:{async sendProtectedTask(){
        a2aSends++;
        throw Error("A2A dispatch before verified branch provider effect");
      }},
      adapter:{adapterBaseUrl:adapterUrl,bearerToken:token,timeoutMs:60000},
      async authorityForTask(){
        childAllocations++;
        throw Error("Cannot allocate a child before verified branch creation");
      }
    });
    assert.equal(dispatcher.approvedBranch,workBranch);
    await assert.rejects(dispatcher.dispatch("backend"),/dependencies/);
    assert.equal(a2aSends,0);
    assert.equal(childAllocations,0);
    let branchRequestId;
    const countBefore=log.giteaReads;
    await assert.rejects(dispatcher.executeApprovedDag({
      async invokeOrchestratorTask(taskId,gatewayTaskId){
        assert.equal(taskId,"branch");
        assert.match(gatewayTaskId,/^dispatch_[A-Za-z0-9_-]{22}$/u);
        await assert.rejects(async()=>runtime.prepare({
          task_id:gatewayTaskId,agent_role:"orchestrator",
          tool:"create_branch",arguments:{
            base_branch:"main",branch:"feature/not-approved"
          }
        }),e=>e?.code==="approved_plan_denied");
        await assert.rejects(async()=>runtime.prepare({
          task_id:gatewayTaskId,agent_role:"orchestrator",
          tool:"update_file",arguments:{
            branch:"main",path:file,content:"malicious"
          }
        }));
        // Correct signed plan action: real EVM-root JWT and native Rust VP
        // verification, live OPA, then read-only Gitea provider DENIAL.
        const prepared=runtime.prepare({
          task_id:gatewayTaskId,agent_role:"orchestrator",
          tool:"create_branch",arguments:{
            base_branch:"main",branch:workBranch
          }
        });
        branchRequestId=prepared.request_id;
        const signed=await fetch(adapterUrl+"/v1/presentations",{
          method:"POST",
          headers:{authorization:"Bearer "+token,
            "content-type":"application/json"},
          body:JSON.stringify({
            credential_id:opId,
            disclosed_permissions:[prepared.required_permission],
            audience:prepared.audience,challenge:prepared.challenge
          })
        });
        assert.equal(signed.status,200);
        const jwt=(await signed.json()).signed_vp;
        assert.ok(typeof jwt==="string"&&jwt.length>100);
        await runtime.execute({request_id:prepared.request_id,signed_vp:jwt});
      }
    }),e=>e?.code==="provider_operation_unavailable");
    assert.equal(dispatcher.completedTaskIds.length,0);
    assert.equal(coordinator.phase,"closed"); // dispatcher closed and revoked root
    assert.equal(a2aSends,0);
    assert.equal(childAllocations,0);
    assert.equal(log.giteaReads,countBefore);
    const blocked=audit.events.filter(e=>e.event==="authorization_executed"&&
      e.request_id===branchRequestId);
    assert.equal(blocked.length,1);
    assert.equal(blocked[0].policy_decision,"allow");
    assert.equal(blocked[0].provider_result,"error");
    assert.equal(blocked[0].approved_plan_digest,packet.plan_digest);
    }
  }else{
    await authorityClient.revokeRoot(rootId);
    revoked=true;
  }
  const before=log.giteaReads;
  if(!revocationChecked){
    // Standalone Planning-only test revokes shortly before this point.
    await assert.rejects(
      runtime.execute({request_id:waiting.request_id,
        signed_vp:signedBeforeRevoke}),
      e=>e?.code==="verification_rejected"
    );
  }
  assert.equal(log.giteaReads,before);
  // A stale Planning read port must never
  // let any caller bypass status revocation or obtain new effective access.
  await assert.rejects(port.invoke("read_file",{branch:"main",path:file}));
  assert.equal(log.giteaReads,before);
  if(!signedHandoff)revisions.end(session);
  await assert.rejects(port.invoke("read_file",{branch:"main",path:file}));
  assert.equal(log.giteaReads,before);
  if(signedHandoff){
    assert.equal(coordinator.phase,"closed");
    // The newly bound dispatcher cannot continue its signed DAG after
    // provider refusal, and the former operational root is EVM-revoked.
    await assert.rejects(async()=>runtime.prepare({
      task_id:"dispatch_expired_native_handoff",agent_role:"orchestrator",
      tool:"create_branch",arguments:{base_branch:"main",branch:workBranch}
    }),e=>e?.code==="approved_plan_denied");
  }
  if(liveClient){
    assert.equal((await liveClient.getBranchMetadata("main")).commit_sha,baseSha);
    assert.equal((await liveClient.getBranchMetadata(scenario.fixtureBranch)).commit_sha,
      originalFeature);
  }
  console.log(JSON.stringify({
    event:"native_preliminary_adk_planning",
    status:"pass",
    rust_evm_root_issued:true,
    native_rust_vp_verified:true,
    live_opa:true,
    model_calls_paid:false,
    pinned_gitea_fixture:!realGitea,
    real_disposable_gitea_pinned_reads:realGitea,
    real_gitea_main_unchanged:realGitea,
    independent_revocation_denial:true,
    source_reads:proposed.verified_source_reads,
    approval_created:signedHandoff,
    trusted_planning_review:signedHandoff,
    signed_ed25519_fixture:signedHandoff,
    native_operational_root_and_activation:signedHandoff,
    operational_root_closed:signedHandoff,
    dispatcher_bound_signed_dag:signedHandoff,
    dispatcher_stopped_before_a2a_on_provider_denial:signedHandoff&&!positiveDag,
    a2a_tasks_dispatched:positiveDag?3:0,
    child_dc_issued:positiveDag?3:0,
    real_provider_mutations:positiveDag?11:0,
    provider_writes:positiveDag?11:0,
    ...(positiveDag?{positive_dag:globalThis.__nativeDagPositive}:{})
  }));
}finally{
  try{
    if(issued&&!revoked)await authorityClient.revokeRoot(rootId);
  }finally{
    if(receiptDir)await rm(receiptDir,{recursive:true,force:true});
  }
}
