/** R375.0 — original Engineer Review Host native root Branch first + SDK A2A
 * and original authenticated Gateway/Gitea/Docker; free scripted ADK.
 */
import assert from "node:assert/strict";
import {generateKeyPairSync,createHash,randomBytes,scryptSync} from "node:crypto";
import {createServer} from "node:net";
import {BaseLlm} from "@google/adk";
import {createTrustedAuthorityOnlyReviewHost}
 from "../../../apps/orchestrator/src/trusted-authority-only-review-host.mjs";
import {AuthorityPlanningCheckpointStore}
 from "../src/trusted-authority-planning-checkpoint.ts";
import {TrustedOperationalRecoveryStore}
 from "../src/trusted-operational-recovery-store.ts";
import {runTrustedAuthorityOnlyAdaptiveWorkLoop}
 from "../src/trusted-authority-only-adaptive-work-loop.mjs";
import {startSpecializedAgentServer}
 from "../../agent-runtime/src/server.ts";
import {startTrustedAuthorityOnlySdkA2AOwner}
 from "../src/trusted-authority-only-a2a-owner.ts";
import {mkdtemp,mkdir,writeFile,readdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";

import {RUST_OPERATIONS} from "../../../apps/gateway/src/operation-catalog.ts";
import {InMemoryAuditSink,InMemoryRequestStore,prepareAuthorization}
 from "../../../apps/gateway/src/prepare.ts";
import {executeAuthorization} from "../../../apps/gateway/src/execute.ts";
import {OpaPolicyClient} from "../../../apps/gateway/src/policy-client.ts";
import {loadDirectCoreRustVerifier} from "../../../apps/gateway/src/direct-core-loader.ts";
import {TrustedAuthorityOnlyGatewayAdmissions}
 from "../../../apps/gateway/src/trusted-authority-only-admissions.ts";
import {TrustedOperationalSessionStore}
 from "../../../apps/gateway/src/trusted-operational-session-store.ts";
import {createTrustedEngineerCredentialPort}
 from "../src/trusted-engineer-crypto-port.ts";
import {preliminaryReadPermissions}
 from "../src/trusted-engineer-authority.ts";
import {createNativeRustChildCryptographyPort}
 from "../src/trusted-child-crypto-port.ts";
import {TrustedAuthorityOnlyChildIssuer}
 from "../src/trusted-authority-only-child-issuer.ts";
import {DurableAuthorityOnlyChildJournal}
 from "../src/trusted-authority-only-child-journal.ts";
import {SignedAuthorityOnlyFileStore}
 from "../src/signed-authority-only-store.ts";
import {DurableAuthorityOnlyActivationJournal}
 from "../src/authority-only-activation-journal.ts";
import {DurableAuthorityTaskJournal}
 from "../src/trusted-authority-task-journal.ts";
import {TrustedAuthorityOnlyEngineerSession}
 from "../src/trusted-authority-only-engineer-session.ts";
import {TrustedAuthorityOnlyExecutionCoordinator}
 from "../src/trusted-authority-only-execution-coordinator.ts";
import {signAuthorityOnlyGrant,selectAuthorityOnlyGrant}
 from "../../../packages/plan-contracts/src/authority-only-approval.mjs";
import {createNativeOrchestratorPresentation}
 from "../src/native-orchestrator-presentation.ts";

import {GiteaClient} from "../../../apps/gateway/src/gitea-client.ts";
import {GiteaExecutor} from "../../../apps/gateway/src/gitea-executor.ts";
import {TrustedAuthorityOnlyGiteaMutationPreflight} from "../../../apps/gateway/src/trusted-authority-only-mutation-preflight.ts";
import {DurableAuthorityOnlyGiteaMutationIntentJournal} from "../../../apps/gateway/src/trusted-authority-only-mutation-intent-journal.ts";
import {TrustedAuthorityOnlyGiteaMutationExecutor} from "../../../apps/gateway/src/trusted-authority-only-mutation-executor.ts";
import {TrustedGatewayGiteaMutationEvidencePublisher,
 AuthenticatedGiteaMutationCompletionObserver} from "../../../apps/gateway/src/trusted-authority-only-gitea-mutation-evidence.ts";
import {DurableAuthorityOnlySequentialEffectJournal}
 from "../src/trusted-authority-only-sequential-effect-journal.ts";
import {DurableAuthorityOnlyTaskFenceJournal}
 from "../src/trusted-authority-only-task-fence-journal.ts";
import {TrustedAuthorityOnlyCompletionObserver}
 from "../src/trusted-authority-only-completion-observer.ts";
import {TrustedAuthorityOnlyRunnerPreflight}
 from "../../../apps/gateway/src/trusted-authority-only-runner-preflight.ts";
import {DurableAuthorityOnlyRunnerIntentJournal}
 from "../../../apps/gateway/src/trusted-authority-only-runner-intent-journal.ts";
import {TrustedAuthorityOnlyRunnerExecutor}
 from "../../../apps/gateway/src/trusted-authority-only-runner-executor.ts";
import {TrustedAuthorityOnlyPullRequestExecutor}
 from "../../../apps/gateway/src/trusted-authority-only-pull-request-executor.ts";
import {TrustedAuthorityOnlyBranchExecutor}
 from "../../../apps/gateway/src/trusted-authority-only-branch-executor.ts";
import {ProviderNotFoundError} from "../../../apps/gateway/src/errors.ts";
import {TrustedGatewayRunnerPassEvidencePublisher,
 AuthenticatedRunnerCompletionObserver}
 from "../../../apps/gateway/src/trusted-authority-only-runner-evidence.ts";
import {TrustedGatewayRunnerFailEvidencePublisher,
 AuthenticatedRunnerFailureObserver}
 from "../../../apps/gateway/src/trusted-authority-only-runner-failure-evidence.ts";
import {RunnerClient} from "../../../apps/gateway/src/runner-client.ts";
import {TrustedAuthorityOnlyEffectStager}
 from "../../../apps/gateway/src/trusted-authority-only-effect-stager.ts";
import {IsolatedDockerRunnerExecutor}
 from "../../../apps/test-runner-controller/src/isolated-executor.ts";
import {createRunnerHttpServer}
 from "../../../apps/test-runner-controller/src/http.ts";
import {ACCOUNT_SUSPENSION_REFERENCE_FILES}
 from "../../../apps/test-runner-controller/fixtures/account-suspension-reference.mjs";
import {ACCOUNT_SUSPENSION_BASELINE_PUBLIC_COMMIT,
 ACCOUNT_SUSPENSION_UNSOLVED_BASELINE_FILES}
 from "../../../apps/test-runner-controller/fixtures/account-suspension-unsolved-baseline.mjs";
import {TrustedGatewayGiteaReadEvidencePublisher}
 from "../../../apps/gateway/src/trusted-authority-only-gitea-publisher.ts";
import {AuthenticatedGiteaReadCompletionObserver}
 from "../../../apps/gateway/src/trusted-authority-only-gitea-evidence.ts";
import {TrustedAuthorityOnlySequentialReadUpdateStager}
 from "../../../apps/gateway/src/trusted-authority-only-sequential-read-update-stager.ts";

import {TrustedEffectStagingTaskRegistry}
 from "../../agent-runtime/src/trusted-effect-staging-task-registry.ts";
import {PrivateMcpTaskRegistry}
 from "../../agent-runtime/src/private-mcp-task-registry.ts";
import {DelegationEvidenceHandler}
 from "../../agent-runtime/src/delegation-evidence-handler.ts";
import {LocalCryptoMcpBridge}
 from "../../agent-runtime/src/local-crypto-mcp-bridge.ts";
import {connectTrustedOwnerEffectStagingClient,
 createTrustedEffectAgentBindingServer}
 from "../../agent-runtime/src/trusted-effect-staging-unix-ipc.ts";

assert.equal(process.env.R233_NATIVE_EVM,"1");
assert.equal(process.env.ENGINEER_CORE_NATIVE_MODE,"1");
assert.equal(process.env.ADAPTER_TRUST_PROFILE,"evm");
assert.equal(process.env.GATEWAY_VERIFIER_MODE,"core-rust");
assert.equal(process.env.APPROVED_RUNNER_NATIVE_MCP,"1");
const r3818NativeMcp=process.env.R3818_CANONICAL_NATIVE_MCP==="1";
assert.ok(process.env.R3818_CANONICAL_NATIVE_MCP===undefined||
 process.env.R3818_CANONICAL_NATIVE_MCP==="0"||r3818NativeMcp);
if(r3818NativeMcp)
 assert.equal(process.env.DELEGATION_GATEWAY_ARCHITECTURE,"authority-only");
assert.equal(process.env.GEMINI_API_KEY,undefined);
assert.equal(process.env.OPENAI_API_KEY,undefined);
const requireAddon=createRequire(import.meta.url);
assert.equal(typeof requireAddon("../src/native/delegation-engineer.node")
 .issue_engineer_root,"function");
const tokens=Object.fromEntries(["ENGINEER","ORCHESTRATOR","BACKEND","FRONTEND","TEST","GATEWAY"].map(role=>{
 const token=process.env["ADAPTER_CALLER_"+role];
 assert.ok(token,role+" private native bearer missing");
 return [role.toLowerCase(),token];
}));
const engineerDid=process.env.ADAPTER_ID_ENGINEER;
const frontendDid=process.env.ADAPTER_ID_FRONTEND;
const backendDid=process.env.ADAPTER_ID_BACKEND;
const testDid=process.env.ADAPTER_ID_TEST;
assert.match(engineerDid??"",/^did:/u);
assert.match(frontendDid??"",/^did:/u);
assert.match(backendDid??"",/^did:/u);
assert.match(testDid??"",/^did:/u);
const sessionId="r375-original-review-host-e2e";
// Opt-in native R376 shares the existing disposable Account Suspension proof.
const diagnosticMode=process.env.R376_NATIVE_DIAGNOSIS==="1";
assert.ok(process.env.R376_NATIVE_DIAGNOSIS===undefined||diagnosticMode);
const specialistStopRole=process.env.R377_NATIVE_SPECIALIST_STOP_ROLE??
 (process.env.R377_NATIVE_SPECIALIST_STOP==="1"?"backend":undefined);
assert.ok(specialistStopRole===undefined||
 (diagnosticMode&&["backend","frontend"].includes(specialistStopRole)));
const specialistStop=specialistStopRole!==undefined;
const diagnosticRole=specialistStopRole??"backend";
const sourceObservationMode=diagnosticMode&&!specialistStop;
/**
 * SCRIPTED fixture, NOT a generative coding LLM. One Task holds only one
 * signer-authorized directory (or file) UPDATE permission; each effect reads
 * the actual Gitea bytes and independently CAS-updates one approved path.
 * Different Task sessions keep separate source-revision stage boundaries.
 */
class ScriptedScopedReferenceWriter extends BaseLlm{
 constructor(branch,role,stages){
  super({model:"r375-free-scripted-reference-writer-no-paid-inference"});
  this.branch=branch;this.role=role;this.stages=stages;
  this.requests=[];this.stageIndex=0;this.stageTurn=0;
 }
 async *generateContentAsync(request){
  this.requests.push(request);
  const stage=this.stages[this.stageIndex];
  if(!stage)throw Error("R375 exhausted signed scripted "+this.role+" source stages");
  const turn=++this.stageTurn,limit=stage.readOnly?2:2*stage.files.length+1;
  if(turn>limit)throw Error("R375 model exceeded one Task's approved file stage");
  if(turn===limit){
   if(stage.readOnly&&!JSON.stringify(request).includes(
     JSON.stringify(stage.files[0].previous).slice(1,-1)))
    throw Error("R376 diagnostic read lacks actual protected Gitea source");
   this.stageIndex++;this.stageTurn=0;
   yield {content:{role:"model",parts:[{text:
    "Completed one signed "+this.role+" source group with independently confirmed CAS tool responses"
   }]}};
   return;
  }
  const file=stage.files[Math.floor((turn-1)/2)];
  if(turn%2===1){
   yield {content:{role:"model",parts:[{functionCall:{
    id:"r375-read-"+this.role+"-"+this.requests.length,
    name:"read_file",args:{branch:this.branch,path:file.path}
   }}]}};
  }else{
   // NEVER claim a source update from static fixture alone: the live ADK
   // functionResponse must return the exact Gitea content previously read.
   const got=JSON.stringify(request);
   if(!got.includes(JSON.stringify(file.previous).slice(1,-1)))
    throw Error("R375 "+this.role+" missing independent Gitea read evidence for "+file.path);
   yield {content:{role:"model",parts:[{functionCall:{
    id:"r375-update-"+this.role+"-"+this.requests.length,
    name:"update_file",args:{branch:this.branch,path:file.path,
     content:file.replacement}
   }}]}};
  }
 }
 connect(){throw Error("Paid provider connections prohibited by R375 checkpoint");}
}
async function freeRolePort(){
 const server=createServer();
 await new Promise((ok,bad)=>{
  server.once("error",bad);server.listen(0,"127.0.0.1",ok);
 });
 const value=server.address();
 if(!value||typeof value==="string")throw Error("no A2A loopback port");
 await new Promise((ok,bad)=>server.close(err=>err?bad(err):ok()));
 return value.port;
}
class ScriptedNativeDockerTest extends BaseLlm {
 constructor(branch,repairWriter){
  super({model:"r375-free-native-test-no-paid-inference"});
  this.branch=branch;this.requests=[];this.repairWriter=repairWriter;
 }
 async *generateContentAsync(req){
  this.requests.push(req);
  const requestIndex=this.requests.length;
  if(this.repairWriter&&requestIndex>=3&&requestIndex<=5){
   yield* this.repairWriter.generateContentAsync(req);
   return;
  }
  const turn=requestIndex-(this.repairWriter&&requestIndex>5?3:0);
  if(turn===1||turn===3){
   yield {content:{role:"model",parts:[{functionCall:{
    id:"r375-docker-"+turn,name:"run_tests",
    args:{branch:this.branch,profile:"poc-default"}
   }}]}};
  }else if(turn===2||turn===4){
   yield {content:{role:"model",parts:[{
    text:"Native Docker result received against owner-pinned HEAD"
   }]}};
  }else throw Error("Test model tried unauthorized non-Runner work");
 }
 connect(){throw Error("Paid provider calls prohibited");}
}
const repo={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
assert.equal(process.env.GITEA_OWNER,"thesis");
assert.equal(process.env.GITEA_REPOSITORY,"iam-console-poc");
let gatewayCasWrites=0,draftPrCreateAttempts=0,branchPostAttempts=0;
let privateCasStagingBranchPosts=0;
class ObservedGiteaClient extends GiteaClient{
 async updateFileWithHeadCas(input){gatewayCasWrites++;return super.updateFileWithHeadCas(input);}
 async createDraftPullRequest(...args){
  draftPrCreateAttempts++;
  return super.createDraftPullRequest(...args);
 }
}
const client=new ObservedGiteaClient({baseUrl:process.env.GITEA_HOST_BASE_URL,
 token:process.env.GITEA_GATEWAY_TOKEN,owner:repo.owner,repository:repo.repository,
 fetchFn:async(url,init)=>{
  if(init?.method==="POST"&&
     new URL(String(url)).pathname.endsWith("/branches")){
   const request=JSON.parse(String(init.body));
   if(request.new_branch_name==="feature/account-suspension")
    branchPostAttempts++;
   else if(typeof request.new_branch_name==="string"&&
           /^feature\/r302-internal-[a-f0-9]{28}$/u.test(request.new_branch_name))
    privateCasStagingBranchPosts++;
   else throw Error("Unexpected Gitea branch POST outside original protected Task");
  }
  return fetch(url,init);
 }});
assert.ok(process.env.GITEA_RUNNER_TOKEN,"Independent read-only token required");
const independentClient=new GiteaClient({baseUrl:process.env.GITEA_HOST_BASE_URL,
 token:process.env.GITEA_RUNNER_TOKEN,owner:repo.owner,repository:repo.repository});
// R375.1: genuine unsolved protected main is never modified.
const branch="feature/account-suspension";
const baselineMain=(await client.getBranchMetadata("main")).commit_sha;
assert.equal(baselineMain,ACCOUNT_SUSPENSION_BASELINE_PUBLIC_COMMIT);
await assert.rejects(independentClient.getBranchMetadata(branch),
 e=>e instanceof ProviderNotFoundError);
const backendPath="apps/backend/src/users/user.service.ts";
const mutationPath="apps/frontend/src/api/users-api.ts";
const sharedPath="packages/shared/src/account-status.ts";
const backendFiles=[backendPath,
 "apps/backend/src/users/user.controller.ts",
 "apps/backend/src/users/user.routes.ts"];
const frontendFiles=[mutationPath,
 "apps/frontend/src/pages/UserDetailPage.tsx",
 "apps/frontend/src/styles.css"];
const testFiles=[
 "tests/backend/user.service.test.ts",
 "tests/backend/user.routes.test.ts",
 "tests/frontend/UserDetailPage.test.tsx"
];
const backendOldContent=ACCOUNT_SUSPENSION_UNSOLVED_BASELINE_FILES[backendPath];
const oldContent=ACCOUNT_SUSPENSION_UNSOLVED_BASELINE_FILES[mutationPath];
const backendNewContent=backendOldContent+
 "\n// R375 scripted incomplete Backend D0: acceptance must FAIL before full repair\n";
const newContent=oldContent+
 "\n// R375 scripted incomplete Frontend D0: acceptance must FAIL before full repair\n";
for(const file of [sharedPath,...backendFiles,...frontendFiles,...testFiles]){
 assert.ok(typeof ACCOUNT_SUSPENSION_UNSOLVED_BASELINE_FILES[file]==="string",
  "R375 real protected-main file absent: "+file);
 assert.ok(typeof ACCOUNT_SUSPENSION_REFERENCE_FILES[file]==="string",
  "R375 functional source target missing: "+file);
 assert.notEqual(ACCOUNT_SUSPENSION_REFERENCE_FILES[file],
  ACCOUNT_SUSPENSION_UNSOLVED_BASELINE_FILES[file]);
}
const baseRevision=baselineMain;
const disposableMainHead=baselineMain;
assert.equal(branchPostAttempts,0);
const requirement="R375 original protected-main Account Suspension signed functional integration proof";
const resourcePrefix="gitea://gitea.local/thesis/iam-console-poc/branches/"+
 "feature%2Faccount-suspension";
const branchPermission={resource:"gitea://gitea.local/thesis/iam-console-poc",
 operation:"create_branch"};
const prPermission={resource:"gitea://gitea.local/thesis/iam-console-poc",
 operation:"create_pull_request"};
const testPermission={resource:resourcePrefix,operation:"run_tests"};
const pair=(file,operation)=>({
 resource:resourcePrefix+"/files/"+file,operation
});
const permissionsFor=file=>[pair(file,"read_file"),pair(file,"update_file")];
const approvedFiles=[sharedPath,...backendFiles,...frontendFiles,...testFiles];
const backendPermissions=permissionsFor(backendPath);
const taskPermissions=permissionsFor(mutationPath);
const sharedPermissions=permissionsFor(sharedPath);
// The signed Engineer ceiling and trusted root are canonically sorted by
// URI path. The model may separately choose source Task order after FAIL,
// but root permission order must match the independently normalized grant.
const grantPermissions=[
 branchPermission,prPermission,testPermission,
 ...[...approvedFiles].sort().flatMap(permissionsFor)
];
assert.equal(grantPermissions.length,23);
const nowMs=()=>Date.now();
const start=new Date();
const issuedAt=start.toISOString().replace(/\.\d{3}Z$/u,"Z");
const approvalExpiresAt=new Date(start.getTime()+55*60_000)
 .toISOString().replace(/\.\d{3}Z$/u,"Z");
const authKey="r375-disposable-ed25519";
const {publicKey,privateKey}=generateKeyPairSync("ed25519");
const proposed={
 schema_version:"1.0.0",session_id:sessionId,repository:repo,branch,
 base_revision:baseRevision,requirement,
 requested_permissions:grantPermissions
};
const grant=selectAuthorityOnlyGrant(proposed,grantPermissions,{
 allowedOperations:new Set(RUST_OPERATIONS)
});
const receipt=signAuthorityOnlyGrant({
 authorization:grant,engineerDid,keyId:authKey,
 privateKeyPem:privateKey.export({format:"pem",type:"pkcs8"}),
 issuedAt,expiresAt:approvalExpiresAt,
 allowedOperations:new Set(RUST_OPERATIONS)
});
const parent=await mkdtemp(join(tmpdir(),"delegation-r375-"));
// Native owner demands an owner-private socket directory. A shared runner
// temp directory is deliberately not trusted for Rust credential IPC.
// Match the already-green R233 fixture's private socket provisioning.
const socketPath=join(parent,"owner.sock");
process.env.ADAPTER_ENGINEER_NATIVE_SOCKET=socketPath;
const path=name=>join(parent,name);
const names=["approvals","keys","checkpoints","recovery","root-journal","coordinator-tasks","gateway-tasks",
 "gateway-activation","child-intents","gateway-child-intents",
 "sequences","flights","intent","receipts",
 "runner-intent","runner-receipts","runner-fail-receipts","runner-logs"];
try{
 for(const name of names)await mkdir(path(name),{mode:0o700});
 await writeFile(path("approvals")+"/"+sessionId+".json",
  JSON.stringify(receipt),{mode:0o600,flag:"wx"});
  // R375.2: the original Engineer Review Host owns Planning, root,
  // Coordinator, Gateway, Child issuer and every model-selected Task.
  // An independently signed disposable approval is persisted above and
  // MUST match the newly generated, source-grounded Planning checkpoint.
  const credentialPort=createTrustedEngineerCredentialPort({
   bearerToken:tokens.engineer,timeoutMs:60000
  });
  const snapshot={session_id:sessionId,repository:repo,
   base_revision:baseRevision,
   directories:["","apps","apps/backend","apps/backend/src","apps/backend/src/users",
    "apps/frontend","apps/frontend/src","apps/frontend/src/api",
    "apps/frontend/src/pages","packages","packages/shared","packages/shared/src",
    "tests","tests/backend","tests/frontend"],
   files:[sharedPath,...backendFiles,...frontendFiles,...testFiles]};
  const status=index=>({type:"BitstringStatusListEntry",
   statusPurpose:"revocation",statusListIndex:String(index),
   statusListCredential:"https://status.example/r375"});
  const params=(id,index,duration)=>({
   credential_id:id,valid_from:issuedAt,validity_seconds:duration,
   credential_status:status(index)
  });
  // The original native Child issuer rejects timestamps older than 60s.
  // The first true Docker FAIL takes >60s; refresh only Child *start
  // metadata* at the actual owner model-selected epoch, not the signed
  // Engineer grant, root authority, expiry or permitted operations.
  const freshChildParams=(id,index,duration)=>({
   credential_id:id,
   valid_from:new Date().toISOString().slice(0,19)+"Z",
   validity_seconds:duration,
   credential_status:status(index)
  });
  const preliminary=params("urn:r375:preliminary",29151,360);
  const operational=params("urn:r375:operational",29152,1800);
  const planningKey=generateKeyPairSync("ed25519");
  class ScriptedPermissionOnlyPlanner extends BaseLlm{
   constructor(){super({model:"r375-free-native-original-host-planner"});this.calls=0;}
   async *generateContentAsync(request){
    this.calls++;
    if(this.calls===1)yield {content:{role:"model",parts:[{
     functionCall:{id:"r375-source-read",name:"read_file",
      args:{branch:"main",path:backendPath}}
    }]}};
    else if(this.calls===2){
     const grounded=JSON.stringify(request);
     if(!grounded.includes(JSON.stringify(backendOldContent).slice(1,-1)))
      throw Error("R375 Planning did not receive the authenticated source bytes");
     yield {content:{role:"model",parts:[{text:JSON.stringify({
      requested_permissions:[
       {operation:"create_branch",resource_type:"repository",path:null},
       {operation:"create_pull_request",resource_type:"repository",path:null},
       {operation:"run_tests",resource_type:"branch",path:null},
       ...approvedFiles.flatMap(file=>[
        {operation:"read_file",resource_type:"file",path:file},
        {operation:"update_file",resource_type:"file",path:file}
       ])
      ],assumptions:[],uncertainties:[]
     })}]}};
    }else throw Error("R375 Planner exceeded scripted free budget");
   }
   connect(){throw Error("Paid Planning provider disabled");}
  }
  const planningModel=new ScriptedPermissionOnlyPlanner();
  const checkpointKey=generateKeyPairSync("ed25519");
  const checkpoints=new AuthorityPlanningCheckpointStore({
   directory:path("checkpoints"),trust:{
    trustedKeys:{owner:{public_key_pem:checkpointKey.publicKey.export({
     format:"pem",type:"spki"
    }).toString()}},
    expectedSessionId:sessionId,expectedRepository:repo,
    expectedBaseRevision:baseRevision,expectedWorkBranch:branch,
    expectedRequirement:requirement
   }
  });
  const engineerFile=path("keys")+"/engineer.pem";
  await writeFile(engineerFile,privateKey.export({format:"pem",type:"pkcs8"}),
   {mode:0o600,flag:"wx"});
  const salt=randomBytes(16);
  const nativePlanningVerifier=loadDirectCoreRustVerifier({
   allowGiteaScopeCoverage:true
  });
  let planningExecuteCount=0;
  const planningTransport=async(url,opts)=>{
   const body=JSON.parse(String(opts?.body));
   if(String(url).endsWith("/v1/authorization/prepare")){
    assert.equal(body.tool,"read_file");
    assert.equal(body.agent_role,"orchestrator");
    assert.deepEqual(body.arguments,{branch:"main",path:backendPath});
    return Response.json({request_id:"r375-planning-request",
     audience:"cloud-access-gateway",challenge:"r375-planning-source-challenge",
     required_permission:preliminaryReadPermissions(snapshot).find(p=>
      p.operation==="read_file"&&p.resource.endsWith("/files/"+backendPath))},{status:201});
   }
   if(String(url).endsWith("/v1/authorization/execute")){
    assert.equal(body.request_id,"r375-planning-request");
    const observed=await nativePlanningVerifier.verify({
     presenter:"orchestrator",audience:"cloud-access-gateway",
     challenge:"r375-planning-source-challenge",
     required_permission:preliminaryReadPermissions(snapshot).find(p=>
      p.operation==="read_file"&&p.resource.endsWith("/files/"+backendPath)),signed_vp:body.signed_vp
    });
    assert.equal(observed.credential_id,preliminary.credential_id);
    const actual=await independentClient.readTextFile(
     "main",backendPath,baseRevision);
    assert.equal(actual.content,backendOldContent);
    planningExecuteCount++;
    return Response.json({execution:{
     provider:"gitea",performed:true,tool:"read_file",
     branch:"main",path:backendPath,revision:baseRevision,content:actual.content
    }});
   }
   throw Error("R375 Planning cannot execute write or unknown Gateway route");
  };
  const operationalSessions=new TrustedOperationalSessionStore(path("gateway-activation"));
  const host=await createTrustedAuthorityOnlyReviewHost({
   snapshot,requirement,workBranch:branch,preliminaryRoot:preliminary,
   checkpoint:{store:checkpoints,backendKeyId:"owner",
    backendPrivateKeyPem:checkpointKey.privateKey.export({
     format:"pem",type:"pkcs8"
    }).toString()},
   activationJournal:new DurableAuthorityOnlyActivationJournal(path("root-journal")),
   taskJournal:new DurableAuthorityTaskJournal(path("coordinator-tasks")),
   operationalRecoveryStore:new TrustedOperationalRecoveryStore(path("recovery")),
   operationalSessionStore:operationalSessions,
   approval:{engineerDid,keyId:authKey,privateKeyFile:engineerFile,
    publicKeyPem:publicKey.export({format:"pem",type:"spki"}).toString(),
    receiptDirectory:path("approvals"),
    passwordSaltHex:salt.toString("hex"),
    passwordScryptHex:scryptSync("r375-engineer-test-only",salt,64).toString("hex")},
   planner:{model:planningModel,planId:"r375-native-review",
    maxModelTurns:3,maxProposalRevisions:0},
   trustedAgentRegistry:{
    backend:{did:backendDid,card_ref:"trusted:r375-backend",
     capabilities:["read_file","update_file"]},
    frontend:{did:frontendDid,card_ref:"trusted:r375-frontend",
     capabilities:["read_file","update_file"]},
    test:{did:testDid,card_ref:"trusted:r375-test",
     capabilities:diagnosticMode?["read_file","update_file","run_tests"]:["run_tests"]},
    orchestrator:{did:process.env.ADAPTER_ID_ORCHESTRATOR,
     card_ref:"trusted:r375-orchestrator",
     capabilities:["create_branch","create_pull_request"]}
   },
   credentials:credentialPort,
   planningRevisions:{
    async begin(taskId){return {task_id:taskId,
     base_revision:baseRevision,expires_at:new Date(Date.now()+600000).toISOString()};},
    async end(){return;}
   },
   gateway:{gatewayBaseUrl:"http://r375-planning.fixture.invalid",
    adapterToken:tokens.orchestrator,fetchFn:planningTransport,
    timeoutMs:60000}
  });
  assert.equal(planningModel.calls,2);
  assert.equal(planningExecuteCount,1);
  const {coordinator}=await host.activateOperational(operational);
  const liveRoot=coordinator.assertTrustedGatewayAuthorityBinding();
  assert.deepEqual(liveRoot.root_permissions,grantPermissions);
  assert.equal(liveRoot.root_credential_id,operational.credential_id);
  const evidenceKey=Buffer.alloc(32,96);
  const readObserver=new AuthenticatedGiteaReadCompletionObserver({
   directory:path("receipts"),key:evidenceKey,
   repository:"thesis/iam-console-poc",branch,
   giteaClient:independentClient,nowMs
  });
  const runnerObserver=new AuthenticatedRunnerCompletionObserver({
   directory:path("runner-receipts"),key:evidenceKey,
   repository:"thesis/iam-console-poc",branch,
   giteaClient:independentClient,nowMs
  });
  const nativePort=createNativeRustChildCryptographyPort({
   bearerToken:tokens.orchestrator,timeoutMs:60000
  },socketPath);
  let backendChild,child,runnerChild,issuedChildren=0;
  let nativeMcpChildCalls=0;
  const recordChild=(request,signed)=>{
   issuedChildren++;
   if(request.delegatee==="backend")backendChild=signed;
   else if(request.delegatee==="frontend")child=signed;
   else if(request.delegatee==="test")runnerChild=signed;
   else throw Error("Unexpected delegated specialist");
   return signed;
  };
  const nativeChildPort={kind:"rust-native",
   async issueChild(request){
    return recordChild(request,await nativePort.issueChild(request));
   },
   ...(r3818NativeMcp?{
    async issueChildViaPrivateMcp(request){
     nativeMcpChildCalls++;
     return recordChild(request,await nativePort.issueChildViaPrivateMcp(request));
    }
   }:{})
  };
  const execution=await host.admitOperationalExecution({
   operationalSessionStore:operationalSessions,
   gatewayTaskJournal:new DurableAuthorityTaskJournal(path("gateway-tasks")),
   issuerChildJournal:new DurableAuthorityOnlyChildJournal(path("child-intents")),
   gatewayChildJournal:new DurableAuthorityOnlyChildJournal(path("gateway-child-intents")),
   sequentialEffectJournal:new DurableAuthorityOnlySequentialEffectJournal(path("sequences")),
   effectFenceJournal:new DurableAuthorityOnlyTaskFenceJournal(path("flights")),
   completionObserver:new TrustedAuthorityOnlyCompletionObserver({
    // Both original Test D0 and independent replacement Test have distinct
    // signed Task IDs. Route EITHER to the original authenticated Runner
    // PASS observer, never to the unrelated read-only Gitea receipt store.
    // A Test FAIL still has no PASS receipt and cannot be attested here.
    readVerifiedCompletion:expected=>
     (expected.task_id==="r375-test-task"||
      expected.task_id==="r375-functional-retest")?
      runnerObserver.observe(expected):readObserver.observe(expected)
   }),nativeCryptoPort:nativeChildPort,
   ...(r3818NativeMcp?{privateChildMcpTransport:"native-stdio"}:{})
  });
  const gate=execution.gateway;
  assert.equal(gate.phase,"active");
  assert.equal(coordinator.registeredTaskCount,0);
  assert.equal(issuedChildren,0);
  assert.equal(gate.stagedCompletedTaskCount,0);

 const taskId="r375-frontend-task";let runtimeTaskId="dispatch_"+"F".repeat(22);
 const backendTaskId="r375-backend-task";let backendRuntimeId="dispatch_"+"B".repeat(22);
 const testTaskId="r375-test-task";let testRuntimeId="dispatch_"+"T".repeat(22);
 const diagnosticTaskId=specialistStop?"r377-"+diagnosticRole+"-no-change":"r376-authenticated-source-read";
 const diagnosticPath=diagnosticRole==="frontend"?mutationPath:sharedPath;
 const diagnosticPermissions=specialistStop?permissionsFor(diagnosticPath):[pair(diagnosticPath,"read_file")];
 const decisionOffset=diagnosticMode?1:0;
 const testRepairPath=diagnosticMode?testFiles.at(-1):undefined;
 const sourceTasks=approvedFiles.map((file,index)=>Object.freeze({
  file,task_id:"r375-functional-file-"+(index+1),
  agent_id:file===testRepairPath?"test":
   file.startsWith("apps/frontend/")||file.startsWith("tests/frontend/")?"frontend":"backend",
  permissions:permissionsFor(file)
 }));
 assert.equal(sourceTasks.length,10);
 const retestTaskId="r375-functional-retest";
 const requirementSha=createHash("sha256").update(requirement).digest("hex");
 assert.ok(socketPath.startsWith("/"));
 const verifier=loadDirectCoreRustVerifier({allowGiteaScopeCoverage:true});
 assert.equal(verifier.allowsGiteaScopeCoverage,true);
 const policy=new OpaPolicyClient({baseUrl:"http://127.0.0.1:8181",
  timeoutMs:6000});
 const store=new InMemoryRequestStore(),audit=new InMemoryAuditSink();
 let legacyWriteCalls=0;
 class ObservedGiteaExecutor extends GiteaExecutor {
  async execute(...args){if(args[0]?.request?.tool==="update_file")
    legacyWriteCalls++;return super.execute(...args);}
 }
 const executor=new ObservedGiteaExecutor(client);
 const journal=new DurableAuthorityOnlyGiteaMutationIntentJournal(path("intent"));
 const preflight=new TrustedAuthorityOnlyGiteaMutationPreflight({
  admissions:gate,giteaClient:client,journal,repository:"thesis/iam-console-poc",
  branch,nowMs
 });
 const observer=new AuthenticatedGiteaMutationCompletionObserver({
  directory:path("receipts"),key:evidenceKey,
  repository:"thesis/iam-console-poc",branch,giteaClient:independentClient,nowMs
 });
 const mutationExecutor=new TrustedAuthorityOnlyGiteaMutationExecutor({
  admissions:gate,preflight,journal,giteaClient:client,
  publisher:new TrustedGatewayGiteaMutationEvidencePublisher({
   directory:path("receipts"),key:evidenceKey,
   repository:"thesis/iam-console-poc",
   branch,independentGiteaClient:independentClient,nowMs
  }),observer,repository:"thesis/iam-console-poc",branch
 });
 // Separate native Test Runner path, bound to the SAME trusted Gateway.
 // It makes no provider call until native Rust VP and real OPA both allow.
 const runnerJournal=new DurableAuthorityOnlyRunnerIntentJournal(
  path("runner-intent"));
 const runnerPreflight=new TrustedAuthorityOnlyRunnerPreflight({
  admissions:gate,giteaClient:client,journal:runnerJournal,
  repository:"thesis/iam-console-poc",branch,nowMs
 });
 const runnerBearer=randomBytes(32).toString("hex");
 const controller=new IsolatedDockerRunnerExecutor({
  gitea_base_url:process.env.GITEA_RUNNER_BASE_URL,
  gitea_owner:"thesis",gitea_repository:"iam-console-poc",
  gitea_token:process.env.GITEA_RUNNER_TOKEN,
  docker_image:"node:22.15.0-bookworm",
  phase_timeout_ms:600000,total_timeout_ms:840000,
  log_dir:path("runner-logs"),acceptance_enabled:true,
  acceptance_dir:fileURLToPath(
   new URL("../../../runner/acceptance/",import.meta.url))
 });
 let runnerServer=createRunnerHttpServer({
  bind_host:"127.0.0.1",bind_port:0,gateway_token:runnerBearer,
  contract:{repository:"gitea://gitea.local/thesis/iam-console-poc",branch}
 },controller);
 await new Promise((ok,bad)=>{
  runnerServer.once("error",bad);runnerServer.listen(0,"127.0.0.1",ok);
 });
 const address=runnerServer.address();
 assert.ok(address&&typeof address!=="string");
 let runnerCalls=0;
 class ObservedRunnerClient extends RunnerClient{
  async run(request,signal){
   runnerCalls++;
   const result=await super.run(request,signal);
   process.stdout.write(JSON.stringify({
    event:"r375_runner_sanitized_result",
    status:result.status,
    project_status:result.project_tests?.status??null,
    acceptance_status:result.researcher_acceptance?.status??null,
    head_matches:result.tested_commit_sha===request.commit_sha
   })+"\n");
   return result;
  }
 }
 const runnerClient=new ObservedRunnerClient({
  baseUrl:"http://127.0.0.1:"+address.port,
  gatewayToken:runnerBearer,timeoutMs:900000
 });
 const failObserver=new AuthenticatedRunnerFailureObserver({
  directory:path("runner-fail-receipts"),key:evidenceKey,
  giteaClient:client,journal:runnerJournal,
  repository:"thesis/iam-console-poc",branch,nowMs
 });
 const failPublisher=new TrustedGatewayRunnerFailEvidencePublisher({
  directory:path("runner-fail-receipts"),key:evidenceKey,
  // The original RunnerExecutor requires the exact SAME Gateway Gitea port
  // for its one-shot flight; the independent MAC failure observer then
  // reopens the attested source HEAD through that original bound identity.
  runnerClient,independentGiteaClient:client,
  journal:runnerJournal,repository:"thesis/iam-console-poc",branch,nowMs
 });
 const runnerExecutor=new TrustedAuthorityOnlyRunnerExecutor({
  admissions:gate,preflight:runnerPreflight,
  journal:runnerJournal,giteaClient:client,runnerClient,
  publisher:new TrustedGatewayRunnerPassEvidencePublisher({
   directory:path("runner-receipts"),key:evidenceKey,
   runnerClient,independentGiteaClient:independentClient,
   repository:"thesis/iam-console-poc",branch,nowMs
  }),observer:runnerObserver,
  failurePublisher:failPublisher,failureObserver:failObserver,
  repository:"thesis/iam-console-poc",branch
 });
 const branchExecutor=new TrustedAuthorityOnlyBranchExecutor({
  admissions:gate,giteaClient:client,
  independentGiteaClient:independentClient,
  repository:"thesis/iam-console-poc",nowMs
 });
 const prExecutor=new TrustedAuthorityOnlyPullRequestExecutor({
  admissions:gate,giteaClient:client,runnerObserver,
  repository:"thesis/iam-console-poc",branch,
  independentGiteaClient:independentClient
 });
 const readPublisher=new TrustedGatewayGiteaReadEvidencePublisher({
  directory:path("receipts"),key:evidenceKey,admissions:gate,
  // Authenticated read-only client is independent from the Gateway writer.
  independentGiteaClient:independentClient,
  repository:"thesis/iam-console-poc",branch,nowMs
 });
 assert.equal(execution.bindNativeGatewayEffects({
  store,mutation:preflight,runner:runnerPreflight,
  giteaClient:client,mutationObserver:observer,
  ...(sourceObservationMode?{readObserver}:{}),
  runnerPassObserver:runnerObserver,failureObserver:failObserver,
  pullRequestExecutor:prExecutor,branchExecutor
 }).status,"owner_native_gateway_effects_bound_no_execution");
 const deps={store,audit,verifier,policy,repository:repo,executor,
  authorityOnlyAdmissions:gate,nowMs,authorityOnlyReadEnabled:true,
  authorityOnlyReceiptWriter:readPublisher,
  authorityOnlyMutationEnabled:true,authorityOnlyMutationExecutor:mutationExecutor,
  authorityOnlyRunnerEnabled:true,authorityOnlyRunnerExecutor:runnerExecutor,
  authorityOnlyPullRequestEnabled:true,
  authorityOnlyPullRequestExecutor:prExecutor,
  authorityOnlyBranchEnabled:true,
  authorityOnlyBranchExecutor:branchExecutor};
 // R375: three distinct pairs of role-pinned HMAC IPC channels; separate
 // agent registries and signing keys, but one original native Engineer root.
 const roles=["backend","frontend","test"],stageChannels={},agentBindingChannels={};
 const registries={},bindingServers=[],roleServers=[],urls={},events=[],prepared=[];
 const backendReferenceFiles=backendFiles.map(file=>Object.freeze({
  path:file,
  previous:file===backendPath?backendNewContent:
   ACCOUNT_SUSPENSION_UNSOLVED_BASELINE_FILES[file],
  replacement:ACCOUNT_SUSPENSION_REFERENCE_FILES[file]
 }));
 const frontendReferenceFiles=frontendFiles.map(file=>Object.freeze({
  path:file,
  previous:file===mutationPath?newContent:
   ACCOUNT_SUSPENSION_UNSOLVED_BASELINE_FILES[file],
  replacement:ACCOUNT_SUSPENSION_REFERENCE_FILES[file]
 }));
 const backendTestReferenceFiles=testFiles.filter(file=>
  file.startsWith("tests/backend/")).map(file=>Object.freeze({
   path:file,previous:ACCOUNT_SUSPENSION_UNSOLVED_BASELINE_FILES[file],
   replacement:ACCOUNT_SUSPENSION_REFERENCE_FILES[file]
  }));
 const frontendTestReferenceFiles=testFiles.filter(file=>
  file.startsWith("tests/frontend/")).map(file=>Object.freeze({
   path:file,previous:ACCOUNT_SUSPENSION_UNSOLVED_BASELINE_FILES[file],
   replacement:ACCOUNT_SUSPENSION_REFERENCE_FILES[file]
  }));
 const testRepairWriter=testRepairPath?new ScriptedScopedReferenceWriter(branch,"test",[
  {files:frontendTestReferenceFiles.filter(file=>file.path===testRepairPath)}
 ]):undefined;
 if(testRepairWriter)assert.equal(testRepairWriter.stages[0].files.length,1);
 const diagnosticStage={readOnly:true,files:[{path:diagnosticPath,
  previous:ACCOUNT_SUSPENSION_UNSOLVED_BASELINE_FILES[diagnosticPath]}]};
 const backendDiagnostic=Number(diagnosticMode&&diagnosticRole==="backend");
 const frontendDiagnostic=Number(diagnosticMode&&diagnosticRole==="frontend");
 const models={
  backend:new ScriptedScopedReferenceWriter(branch,"backend",[
   ...(backendDiagnostic?[diagnosticStage]:[]),
   {files:[{path:backendPath,previous:backendOldContent,replacement:backendNewContent}]},
   {files:[{path:sharedPath,
     previous:ACCOUNT_SUSPENSION_UNSOLVED_BASELINE_FILES[sharedPath],
     replacement:ACCOUNT_SUSPENSION_REFERENCE_FILES[sharedPath]}]},
   ...backendReferenceFiles.map(file=>({files:[file]})),
   ...backendTestReferenceFiles.map(file=>({files:[file]}))
  ]),
  frontend:new ScriptedScopedReferenceWriter(branch,"frontend",[
   ...(frontendDiagnostic?[diagnosticStage]:[]),
   {files:[{path:mutationPath,previous:oldContent,replacement:newContent}]},
   ...frontendReferenceFiles.map(file=>({files:[file]})),
   ...frontendTestReferenceFiles.filter(file=>file.path!==testRepairPath).map(file=>({files:[file]}))
  ]),
  test:new ScriptedNativeDockerTest(branch,testRepairWriter)
 };
 // R375.7 diagnostic: observe internal phase ACKs without changing the
 // actual owner Stager, signed Task, crypto registry or MCP tool semantics.
 // All hooks delegate to the original implementations and are restored.
 const cryptoTrace=[];
 const nativeMcpVpByRole={backend:0,frontend:0,test:0};
 let nativeE2eResultEmitted=false;
 // Diagnostic trace holds only fixed local phases, no paths or credentials.
 const recordPhase=(phase)=>{
  if(!/^[a-z_]{3,64}$/u.test(phase))return;
  cryptoTrace.push(phase);
  if(cryptoTrace.length>80)cryptoTrace.shift();
 };
 const originalSelect=TrustedEffectStagingTaskRegistry.prototype.selectFor;
 const originalChallenge=PrivateMcpTaskRegistry.prototype.stageGatewayChallenge;
 const originalCryptoInvoke=PrivateMcpTaskRegistry.prototype.invokeCrypto;
 const originalProofTake=PrivateMcpTaskRegistry.prototype.takeSignedPresentation;
 const originalCreate=DelegationEvidenceHandler.prototype.createPresentation;
 const originalMcpBridge=LocalCryptoMcpBridge.prototype.createSignedPresentation;
 TrustedEffectStagingTaskRegistry.prototype.selectFor=function(context){
  const port=originalSelect.call(this,context);
  if(context?.role!=="backend")return port;
  recordPhase("agent_port_selected");
  return Object.freeze({...port,
   stage:async requestId=>{
    recordPhase("agent_stage_entered");
    try{
     const result=await port.stage(requestId);
     recordPhase("agent_stage_ack_ok");return result;
    }catch(error){recordPhase("agent_stage_ack_rejected");throw error;}
   },
   ...(typeof port.attest==="function"?{
    attest:async(requestId,tool)=>port.attest(requestId,tool)
   }:{})
  });
 };
 PrivateMcpTaskRegistry.prototype.stageGatewayChallenge=function(taskId,prepared){
  recordPhase("crypto_challenge_entered");
  try{
   const result=originalChallenge.call(this,taskId,prepared);
   recordPhase("crypto_challenge_registered");return result;
  }catch(error){recordPhase("crypto_challenge_rejected");throw error;}
 };
 PrivateMcpTaskRegistry.prototype.invokeCrypto=async function(...args){
  recordPhase("mcp_crypto_invoke_entered");
  try{
   const result=await originalCryptoInvoke.apply(this,args);
   recordPhase("mcp_crypto_invoke_ok");return result;
  }catch(error){recordPhase("mcp_crypto_invoke_rejected");throw error;}
 };
 PrivateMcpTaskRegistry.prototype.takeSignedPresentation=function(...args){
  recordPhase("crypto_proof_take_entered");
  try{
   const result=originalProofTake.apply(this,args);
   recordPhase("crypto_proof_taken");return result;
  }catch(error){recordPhase("crypto_proof_take_rejected");throw error;}
 };
 LocalCryptoMcpBridge.prototype.createSignedPresentation=async function(prepared){
  recordPhase("mcp_bridge_presentation_entered");
  try{
   const signed=await originalMcpBridge.call(this,prepared);
   recordPhase(typeof signed==="string"&&signed.length>0?
    "mcp_bridge_returned_signed_string":"mcp_bridge_returned_invalid_type");
   return signed;
  }catch(error){
   recordPhase("mcp_bridge_presentation_rejected");throw error;
  }
 };
 DelegationEvidenceHandler.prototype.createPresentation=async function(prepared){
  recordPhase("private_rust_presentation_entered");
  try{
   const result=await originalCreate.call(this,prepared);
   if(r3818NativeMcp){
    const presenter=this.presenterId;
    const role=presenter===backendDid?"backend":
     presenter===frontendDid?"frontend":
     presenter===testDid?"test":undefined;
    if(!role)throw Error("Unrecognized original Rust MCP presenter DID");
    nativeMcpVpByRole[role]++;
   }
   recordPhase("private_rust_presentation_signed");return result;
  }catch(error){recordPhase("private_rust_presentation_denied");throw error;}
 };
 let owner;
 try{
  for(const role of roles){
   const stageSocket=path("stage-"+role+".sock");
   const stageSecret=path("stage-"+role+".hex");
   const bindingSocket=path("bind-"+role+".sock");
   const bindingSecret=path("bind-"+role+".hex");
   for(const secretFile of [stageSecret,bindingSecret])
    await writeFile(secretFile,randomBytes(32).toString("hex")+"\n",
     {mode:0o600,flag:"wx"});
   stageChannels[role]={socketPath:stageSocket,secretFile:stageSecret};
   agentBindingChannels[role]={socketPath:bindingSocket,
    secretFile:bindingSecret};
   const registry=new TrustedEffectStagingTaskRegistry();
   registries[role]=registry;
   const stageClient=await connectTrustedOwnerEffectStagingClient({
    socketPath:stageSocket,secretFile:stageSecret
   });
   const binder=await createTrustedEffectAgentBindingServer({
    socketPath:bindingSocket,secretFile:bindingSecret,
    registry,ownerStageClient:stageClient,expectedRole:role
   });
   bindingServers.push(binder);await binder.start();
  }
  let testSignedVp=null;
  const gatewayTransport=async(url,init)=>{
   // Same original Gateway implementation. Observe the transport entry
   // BEFORE parsing or touching a signed VP; classify only the route.
   recordPhase(String(url).endsWith("/v1/authorization/execute")?
    "gateway_execute_transport_entered":
    String(url).endsWith("/v1/authorization/prepare")?
     "gateway_prepare_transport_entered":"gateway_unexpected_transport");
   const body=JSON.parse(String(init?.body));
   if(String(url).endsWith("/v1/authorization/prepare")){
    if(body.agent_role==="backend")backendRuntimeId=body.task_id;
    else if(body.agent_role==="frontend")runtimeTaskId=body.task_id;
    else if(body.agent_role==="test")testRuntimeId=body.task_id;
    events.push("prepare_attempt_"+body.agent_role+"_"+body.tool);
    let response;
    try{
     response=prepareAuthorization(body,{
      audience:"cloud-access-gateway",request_ttl_ms:body.agent_role==="test"?1_200_000:120000,
      repository:repo
     },{store,audit,authorityOnlyAdmissions:gate,nowMs});
    }catch(error){
     process.stderr.write(JSON.stringify({
      event:"r375_safe_gateway_prepare_rejection",
      role:body.agent_role,tool:body.tool,
      reason_class:error?.constructor?.name??"unknown",
      reason_code:typeof error?.code==="string"?error.code:null
     })+"\n");
     throw error;
    }
    prepared.push({role:body.agent_role,tool:body.tool,response});
    events.push("prepare_"+body.agent_role+"_"+body.tool);
    return Response.json(response,{status:201});
   }
   if(String(url).endsWith("/v1/authorization/execute")){
    const record=store.get(body.request_id);
    // PreparedRequestRecord stores the role on its TOP-LEVEL envelope.
// Reading record.request.agent_role incorrectly treats every native execute
// as unknown, masking successful owner IPC and VP as tool_unavailable.
const tool=record?.request?.tool,role=record?.agent_role;
    if(!["read_file","update_file","run_tests"].includes(tool)||
       !["backend","frontend","test"].includes(role))
     throw Error("unrecognized role or native Gateway effect");
    events.push("execute_"+role+"_"+tool);
    if(role==="test")testSignedVp=body.signed_vp;
    try{return Response.json(await executeAuthorization(body,deps),{status:200});}
    catch(error){
     process.stderr.write("R375 denied "+role+" "+tool+": "+
      (error?.constructor?.name??"UnknownError")+"\n");
     return Response.json({error:"native_authorization_denied"},{status:403});
    }
   }
   throw Error("unrecognized Gateway route");
  };
  for(const role of roles){
   const opts={role,host:"127.0.0.1",port:await freeRolePort(),
    capabilityProfile:"approved-plan",delegatedAuthorization:true};
   if(["backend","frontend","test"].includes(role)){
    const keys=generateKeyPairSync("ed25519");
    opts.mcpTaskSigning={
     signingPrivateKeyPem:keys.privateKey.export({
      type:"pkcs8",format:"pem"}).toString(),
     signingPublicKeyPem:keys.publicKey.export({
      type:"spki",format:"pem"}).toString()
    };
    opts.adk={
     model:models[role],gatewayBaseUrl:"http://gateway.fixture.invalid",
     adapterToken:tokens[role],maxModelTurns:4,maxModelCallMs:15000,
     gatewayTimeoutMs:role==="test"?900000:60000,scopeModelPaths:true,
     trustedEffectTaskRegistry:registries[role],fetchFn:gatewayTransport,
     ...(r3818NativeMcp?{nativePresentationTransport:"mcp-stdio"}:{})
    };
   }
   const server=await startSpecializedAgentServer(opts);
   roleServers.push(server);urls[role]=server.baseUrl;
  }
  assert.equal(models.backend.requests.length,0);
  assert.equal(models.frontend.requests.length,0);
  // R375.2 no registered Task nor native Child before this real SDK
  // owner starts. Every subsequent step is selected by ADK and independently
  // completed before another model turn.
  assert.equal(coordinator.registeredTaskCount,0);
  let backendHead,frontendHead,verifiedRunnerBinding;
  // Original Review Host owns the FULL adaptive state and all effects.
  // No harness hooks may register Tasks or attest Gateway completions.
  assert.equal(coordinator.registeredTaskCount,0);
  assert.equal(issuedChildren,0);
  assert.equal(gate.stagedCompletedTaskCount,0);
  // R375: one original signature and exactly one read->CAS per Task.
  // The model does not have a fixed DAG: it selects the next Task only
  // after independent Gateway evidence of every preceding Task, with
  // seven tightly scoped functional corrections after the first true FAIL.
  const firstChoices=[
   {action:"delegate",task:{task_id:backendTaskId,agent_id:"backend",
    depends_on:[sourceObservationMode?diagnosticTaskId:"r375-original-root-branch"],permissions:backendPermissions,
    instruction:"Read unresolved Backend and commit incomplete D0 source"}},
   {action:"delegate",task:{task_id:taskId,agent_id:"frontend",
    depends_on:[backendTaskId],permissions:taskPermissions,
    instruction:"Read unresolved Frontend and commit incomplete D0 source"}},
   {action:"delegate",task:{task_id:testTaskId,agent_id:"test",
    depends_on:[taskId],permissions:[testPermission],
    instruction:"Run native Docker acceptance against the incomplete D0 branch"}}
  ];
  class FreeOriginalHostDecisionModel extends BaseLlm{
   constructor(){super({model:"r375-free-task-by-task-source-recovery"});
    this.calls=0;this.requests=[];this.verifiedFailBeforeRepair=false;}
   async *generateContentAsync(req){
    const n=this.calls++,context=JSON.stringify(req);
    this.requests.push(req);
    assert.ok(n<15+decisionOffset,
     "native original owner adaptive loop exceeded bounded decisions");
    if(n===0)assert.match(context,/r375-original-root-branch/u);
    const initialIndex=n-decisionOffset;
    let choice;
    if(diagnosticMode&&n===0){
     assert.doesNotMatch(context,/independent_runner_failure/u);
     choice={action:"delegate",task:{
      task_id:diagnosticTaskId,agent_id:diagnosticRole,
      depends_on:["r375-original-root-branch"],permissions:diagnosticPermissions,
      instruction:"Inspect "+diagnosticPath+" before the first edit"
     }};
    }else if(initialIndex<3){
     if(diagnosticMode&&initialIndex===0){
      assert.ok(context.includes(diagnosticTaskId));
      if(specialistStop){
       assert.match(context,/independently_verified_specialist_no_change/u);
       assert.match(context,/read_evidence_sha256/u);
       assert.doesNotMatch(context,/source_observations/u);
      }else{
       assert.match(context,/source_observations/u);
       assert.match(context,/source_sha256/u);
       assert.match(context,/account-status.ts/u);
      }
      assert.doesNotMatch(context,/independent_runner_failure/u);
     }
     if(initialIndex>0){
      assert.ok(context.includes(firstChoices[initialIndex-1].task.task_id),
       "ADK next Task requires previous original independent completion");
      if(diagnosticMode)
       assert.doesNotMatch(context,/source_observations/u,
        "Original source observations must expire after the first CAS");
     }
     choice=firstChoices[initialIndex];
    }else if(initialIndex<=12){
     const j=initialIndex-3,entry=sourceTasks[j];
     if(j===0){
      assert.match(context,/independent_runner_failure/u);
      assert.match(context,/independently_verified_test_failures/u);
      assert.match(context,/source_evidence_sha256/u);
      assert.match(context,/researcher_acceptance/u);
      assert.match(context,/verified_failure_preflight_only_not_approval/u);
      assert.ok(context.includes(testTaskId));
      for(const secret of [tokens.orchestrator,tokens.test,
       operational.credential_id,process.env.ADAPTER_EVM_PRIVATE_KEY_TEST])
       if(secret)assert.equal(context.includes(secret),false);
      this.verifiedFailBeforeRepair=true;
     }else{
      assert.equal(this.verifiedFailBeforeRepair,true);
      assert.ok(context.includes(sourceTasks[j-1].task_id),
       "No functional edit may precede the last independent source CAS");
     }
     choice={action:"delegate",task:{
      task_id:entry.task_id,agent_id:entry.agent_id,
      depends_on:[j===0?taskId:sourceTasks[j-1].task_id],
      permissions:entry.permissions,
      instruction:"Read real Gitea "+entry.file+
       " then submit one authorized full-file CAS for Account Suspension"
     }};
    }else if(n===13+decisionOffset){
     assert.ok(context.includes(sourceTasks.at(-1).task_id));
     assert.match(context,/independent_runner_failure/u);
     choice={action:"delegate",task:{
      task_id:retestTaskId,agent_id:"test",
      depends_on:[sourceTasks.at(-1).task_id],
      permissions:[testPermission],
      instruction:"Run Docker unit/build/researcher acceptance on the independently completed functional HEAD"
     }};
    }else{
     assert.ok(context.includes(retestTaskId),
      "PR readiness cannot precede completed replacement Test");
     choice={action:"ready_for_pr",
      reason:"Await original owner re-attestation of the newest real Docker PASS on identical HEAD"
     };
    }
    yield {content:{role:"model",parts:[{text:JSON.stringify(choice)}]}};
   }
   connect(){throw Error("Paid provider inference forbidden in R375");}
  }
  const controller=new FreeOriginalHostDecisionModel();
  let childMetadataCount=0;
  class FreeSignedPrTaskProposal extends BaseLlm{
   constructor(){super({model:"r375-free-signed-original-root-pr-proposer"});
    this.calls=0;this.requests=[];}
   async *generateContentAsync(req){
    this.calls++;this.requests.push(req);
    assert.equal(this.calls,1,"original root PR Task selection must be one shot");
    const context=JSON.stringify(req);
    assert.ok(context.includes(retestTaskId),
     "PR model must see independently accepted replacement Test");
    yield {content:{role:"model",parts:[{text:JSON.stringify({
     task_id:"r375-gitea-draft-pr",agent_id:"orchestrator",
     depends_on:[retestTaskId],permissions:[prPermission],
     instruction:"Create a Draft PR at the latest independently PASS-tested HEAD; never merge"
    })}]}};
   }
   connect(){throw Error("No paid provider calls allowed for original root PR");}
  }
  const prModel=new FreeSignedPrTaskProposal();
  let privatePrFlight,privatePrExecutorCalls=0;
  assert.equal(draftPrCreateAttempts,0);
  assert.throws(()=>gate.preflightCanonicalRequest({
   task_id:"dispatch_"+"Z".repeat(22),agent_role:"orchestrator",
   tool:"create_pull_request",arguments:{
    head_branch:branch,base_branch:"main",title:"PR without acceptance",
    body:"Must fail before independently authenticated Runner PASS"
   }
  }),/unbound runtime Task|Task/);

  // R375: Branch is selected, staged and attested by the SAME original
  // Review Host BEFORE the protected worker SDK A2A can start.
  class FreeSignedBranchProposal extends BaseLlm{
   constructor(){super({model:"r375-original-root-branch-only"});
    this.calls=0;this.requests=[];}
   async *generateContentAsync(req){
    this.calls++;this.requests.push(req);
    assert.equal(this.calls,1);
    assert.equal(branchPostAttempts,0);
    assert.equal(issuedChildren,0);
    assert.ok(JSON.stringify(req).includes("create_branch"));
    yield {content:{role:"model",parts:[{text:JSON.stringify({
     task_id:"r375-original-root-branch",agent_id:"orchestrator",
     depends_on:[],permissions:[branchPermission],
     instruction:"Create exactly one approved feature branch from immutable main"
    })}]}};
   }
   connect(){throw Error("Paid branch-model inference prohibited");}
  }
  const branchModel=new FreeSignedBranchProposal();
  let privateBranchFlight,privateBranchExecuteCalls=0;
  assert.equal(branchPostAttempts,0);
  await assert.rejects(independentClient.getBranchMetadata(branch),
   error=>error instanceof ProviderNotFoundError);
  const workflow=await execution.runCanonicalOperationalWorkflow({
   createBranch:{
    model:branchModel,branch,baseBranch:"main",
    permission:branchPermission,
    prepare:request=>{
     assert.equal(privateBranchFlight,undefined);
     assert.equal(request.agent_role,"orchestrator");
     assert.equal(request.tool,"create_branch");
     assert.deepEqual(request.arguments,{branch,base_branch:"main"});
     assert.equal(branchPostAttempts,0);
     assert.equal(coordinator.registeredTaskCount,1,
      "Root Branch must be the first and only registered Task");
     assert.equal(issuedChildren,0);
     const prepared=prepareAuthorization(request,{
      audience:"cloud-access-gateway",request_ttl_ms:120000,repository:repo
     },{store,audit,authorityOnlyAdmissions:gate,nowMs});
     assert.deepEqual(prepared.required_permission,branchPermission);
     privateBranchFlight={request,prepared};
     return prepared;
    },
    execute:async({request,prepared,expectedMainSha})=>{
     assert.equal(request,privateBranchFlight?.request);
     assert.equal(prepared.request_id,privateBranchFlight?.prepared.request_id);
     assert.equal(expectedMainSha,disposableMainHead);
     assert.equal(branchPostAttempts,0);
     await assert.rejects(independentClient.getBranchMetadata(branch),
      error=>error instanceof ProviderNotFoundError);
     const signedVp=await createNativeOrchestratorPresentation({
      socketPath,token:tokens.orchestrator,timeoutMs:60000
     },{
      credential_id:operational.credential_id,
      disclosed_permissions:[branchPermission],
      audience:prepared.audience,challenge:prepared.challenge
     });
     privateBranchFlight.signed_vp=signedVp;
     privateBranchExecuteCalls++;
     return executeAuthorization({
      request_id:prepared.request_id,signed_vp:signedVp
     },deps);
    }
   },
   sdk:{stageChannels,agentBindingChannels,agentBaseUrls:urls,
    a2aPolling:{deadlineMs:960000,initialIntervalMs:40,maxIntervalMs:1000}},
   adaptive:{model:controller,maxSteps:15+decisionOffset,
    nextChildParameters:({epoch,agent_id})=>{
     childMetadataCount++;
     if(diagnosticMode&&epoch===2&&agent_id===diagnosticRole)
      return freshChildParams("urn:r376:child:diagnostic-read",29167,900);
     if(epoch===2+decisionOffset&&agent_id==="backend")
      return freshChildParams("urn:r375:child:backend-d0",29153,600);
     if(epoch===3+decisionOffset&&agent_id==="frontend")
      return freshChildParams("urn:r375:child:frontend-d0",29154,600);
     if(epoch===4+decisionOffset&&agent_id==="test")
      return freshChildParams("urn:r375:child:test-failed",29155,1200);
     if(epoch>=5+decisionOffset&&epoch<=14+decisionOffset){
      const entry=sourceTasks[epoch-5-decisionOffset];
      if(!entry||entry.agent_id!==agent_id)
       throw Error("R375 signed repair epoch/agent differs from original proposal");
      return freshChildParams("urn:r375:child:functional-"+(epoch-4-decisionOffset),
       29156+(epoch-5-decisionOffset),900);
     }
     if(epoch===15+decisionOffset&&agent_id==="test")
      return freshChildParams("urn:r375:child:retest-pass",29166,1200);
     throw Error("Original Host rejected unexpected model-selected Child");
    }},
   draftPullRequest:{
    model:prModel,headBranch:branch,baseBranch:"main",
    title:"Account Suspension — original protected-main native acceptance PASS",
    body:"Immutable Engineer grant; original root, three worker roles, independently attested Docker and researcher acceptance PASS",
    permission:prPermission,
    prepare:request=>{
     assert.equal(privatePrFlight,undefined);
     assert.equal(request.agent_role,"orchestrator");
     assert.equal(request.tool,"create_pull_request");
     assert.equal(request.arguments.head_branch,branch);
     assert.equal(draftPrCreateAttempts,0);
     const prepared=prepareAuthorization(request,{
      audience:"cloud-access-gateway",request_ttl_ms:120000,repository:repo
     },{store,audit,authorityOnlyAdmissions:gate,nowMs});
     assert.deepEqual(prepared.required_permission,prPermission);
     privatePrFlight={request,prepared};
     return prepared;
    },
    execute:async({request,prepared,expectedHeadSha})=>{
     assert.equal(request,privatePrFlight?.request);
     assert.equal(prepared.request_id,privatePrFlight?.prepared.request_id);
     assert.equal(expectedHeadSha,
      (await independentClient.getBranchMetadata(branch)).commit_sha);
     assert.equal(draftPrCreateAttempts,0,
      "original PR POST cannot precede durable one-shot staging");
     const signedVp=await createNativeOrchestratorPresentation({
      socketPath,token:tokens.orchestrator,timeoutMs:60000
     },{
      credential_id:operational.credential_id,
      disclosed_permissions:[prPermission],
      audience:prepared.audience,challenge:prepared.challenge
     });
     privatePrFlight.signed_vp=signedVp;
     privatePrExecutorCalls++;
     return executeAuthorization({
      request_id:prepared.request_id,signed_vp:signedVp
     },deps);
    }
   }
  });
  assert.equal(workflow.status,"owner_operational_draft_pr_independently_attested");
  assert.equal(workflow.pr_created,true);
  assert.equal(workflow.pull_request_attested,true);
  assert.equal(workflow.branch?.status,"owner_original_branch_independently_attested");
  assert.equal(workflow.branch?.task_id,"r375-original-root-branch");
  assert.equal(workflow.branch?.base_revision,disposableMainHead);
  const report=workflow.adaptive;
  assert.equal(report.status,"owner_adaptive_work_ready_for_pr");
  assert.equal(report.pr_created,false);
  assert.equal(report.executed_tasks,13+Number(sourceObservationMode));
  assert.equal(report.source_test_task_id,retestTaskId);
  assert.match(report.source_test_runtime_task_id,/^dispatch_[A-Za-z0-9_-]{22}$/u);
  assert.equal(branchModel.calls,1);
  assert.equal(branchPostAttempts,1);
  assert.equal(privateBranchExecuteCalls,1);
  assert.equal(controller.calls,15+decisionOffset);
  assert.equal(controller.verifiedFailBeforeRepair,true);
  assert.equal(childMetadataCount,14+decisionOffset);
  assert.equal(issuedChildren,14+decisionOffset,
   "original root PR must never create an agent Child");
  assert.equal(coordinator.registeredTaskCount,16+decisionOffset);
  // The failed Test and any authenticated specialist stop remain incomplete.
  assert.equal(gate.stagedCompletedTaskCount,15+Number(sourceObservationMode),
   "only independently completed Tasks and the root PR count");
  if(specialistStop){
   const prefix="execute_"+diagnosticRole+"_";
   assert.deepEqual(events.filter(event=>event.startsWith(prefix)).slice(0,3),
    [prefix+"read_file",prefix+"read_file",prefix+"update_file"]);
  }
  assert.equal(gatewayCasWrites,12);
  assert.equal(privateCasStagingBranchPosts,12);
  assert.equal(runnerCalls,2);
  assert.equal((await readdir(path("runner-fail-receipts")))
   .filter(name=>name.endsWith(".runner-fail.json")).length,1);
  assert.equal((await readdir(path("runner-receipts")))
   .filter(name=>name.endsWith(".runner.json")).length,1);
  assert.equal(models.backend.stageIndex,7+backendDiagnostic);
  assert.equal(models.frontend.stageIndex,5-decisionOffset+frontendDiagnostic);
  assert.equal(models.backend.requests.length,21+2*backendDiagnostic);
  assert.equal(models.frontend.requests.length,15-3*decisionOffset+2*frontendDiagnostic);
  assert.equal(models.test.requests.length,4+3*decisionOffset);
  assert.deepEqual(events.filter(event=>event.startsWith("execute_test_")),
   diagnosticMode?["execute_test_run_tests","execute_test_read_file",
    "execute_test_update_file","execute_test_run_tests"]:
    ["execute_test_run_tests","execute_test_run_tests"]);
  if(testRepairWriter)assert.equal(testRepairWriter.stageIndex,1);
  assert.equal(legacyWriteCalls,0);
  const latest=(await independentClient.getBranchMetadata(branch)).commit_sha;
  assert.equal(latest,report.tested_commit_sha);
  assert.equal(latest,workflow.tested_commit_sha);
  assert.notEqual(latest,disposableMainHead);
  assert.equal((await independentClient.getBranchMetadata("main")).commit_sha,
   disposableMainHead);
  // Production source is NOT planted into disposable main by test owner.
  // All seven changed files are present exclusively at the latest branch HEAD
  // after independent original Gateway CAS of model-visible source bytes.
  for(const file of [sharedPath,...backendFiles,...frontendFiles,...testFiles]){
   const final=await independentClient.readTextFile(branch,file,latest);
   const main=await independentClient.readTextFile("main",file,disposableMainHead);
   assert.equal(final.content,ACCOUNT_SUSPENSION_REFERENCE_FILES[file],
    "original agent did not actually write full functional reference code: "+file);
   assert.equal(main.content,ACCOUNT_SUSPENSION_UNSOLVED_BASELINE_FILES[file],
    "test owner must not mutate original protected-main source: "+file);
  }
  assert.equal(prModel.calls,1);
  assert.equal(privatePrExecutorCalls,1);
  assert.equal(draftPrCreateAttempts,1);
  assert.equal(workflow.source_test_task_id,retestTaskId);
  assert.equal(workflow.pull_request_task_id,"r375-gitea-draft-pr");
  assert.equal(workflow.completed_work_tasks,13+Number(sourceObservationMode));
  assert.match(privatePrFlight?.request?.task_id??"",/^dispatch_[A-Za-z0-9_-]{22}$/u);
  assert.throws(()=>execution.childIssuer.assertTrustedIssuedChild(
   workflow.pull_request_task_id,coordinator));
  const draft=await independentClient.inspectDraftPullRequest({
   number:workflow.pull_request_number,headBranch:branch,baseBranch:"main",
   expectedHeadSha:latest,expectedBaseSha:disposableMainHead
  });
  assert.equal(draft.open,true);
  assert.equal(draft.draft,true);
  assert.equal(draft.merged,false);
  assert.equal(draft.head_revision,latest);
  assert.equal(draft.base_revision,disposableMainHead);
  await assert.rejects(executeAuthorization({
   request_id:privateBranchFlight.prepared.request_id,
   signed_vp:privateBranchFlight.signed_vp
  },deps),error=>error.code==="replay_detected");
  await assert.rejects(executeAuthorization({
   request_id:privatePrFlight.prepared.request_id,
   signed_vp:privatePrFlight.signed_vp
  },deps),error=>error.code==="replay_detected");
  await assert.rejects(execution.attestEnrolledPullRequestCompletion({
   taskId:workflow.pull_request_task_id,
   runtimeTaskId:privatePrFlight.request.task_id
  }),/already been attempted/);
  assert.equal(branchPostAttempts,1);
  assert.equal(draftPrCreateAttempts,1);
  if(r3818NativeMcp){
   assert.equal(nativeMcpChildCalls,issuedChildren,
    "Every original Child issuance must traverse private MCP Rust");
   for(const role of roles)assert.ok(nativeMcpVpByRole[role]>0,
    "Every original A2A role must sign via native MCP: "+role);
  }
  nativeE2eResultEmitted=true;
  process.stdout.write(JSON.stringify({
   event:specialistStop?"r377_specialist_no_change_native_docker_pass_draft_pr":
    diagnosticMode?"r376_authenticated_diagnostic_read_native_docker_pass_draft_pr":
    "r375_original_protected_main_functional_native_docker_pass_draft_pr",
   authenticated_diagnostic_source_seen_by_decider:sourceObservationMode,
   authenticated_source_seen_before_first_write:sourceObservationMode,
   signed_read_only_diagnostic_tasks:Number(sourceObservationMode),
   authenticated_specialist_no_change_recoveries:Number(specialistStop),
   ...(specialistStop?{authenticated_specialist_no_change_role:diagnosticRole}:{}),
   attested_test_agent_project_test_repairs:decisionOffset,
   status:"pass",
   original_main_immutable:true,
   feature_branch_created_from_original_root:true,
   independent_branch_get:true,
   native_rust_evm:true,real_opa:true,
   first_docker_status:"fail",first_failure_independent:true,
   recovery_source_code_authored_by_scripted_fixture:true,
   source_code_generated_autonomously_by_model:false,
   functional_source_files_updated:7,updated_project_test_files:3,
   cas_writes:gatewayCasWrites,
   second_docker_status:"pass",researcher_acceptance_pass:true,
   authenticated_runner_fail_receipts:1,authenticated_runner_pass_receipts:1,
   completed_gateway_tasks:gate.stagedCompletedTaskCount,
   registered_tasks:coordinator.registeredTaskCount,
   distinct_child_credentials:issuedChildren,original_engineer_approval_count:1,
   ...(r3818NativeMcp?{
    r3818_canonical_private_mcp_native_signing:true,
    native_mcp_child_issuances:nativeMcpChildCalls,
    native_mcp_presentations_by_role:nativeMcpVpByRole
   }:{}),
   original_root_pr_created:true,independent_pr_get:true,
   pr_draft:true,pr_open:true,pr_merged:false,
   pr_post_attempts:draftPrCreateAttempts,
   tested_head:latest,paid_model_calls:0
  })+"\n");
 }finally{
  if(diagnosticMode&&!nativeE2eResultEmitted){
   // The protected provider or A2A exception is deliberately NOT logged.
   // This distinguishes prepare, private stage, crypto and execute
   // without leaking signed credentials, repository text or model prompts.
   process.stderr.write(JSON.stringify({
    event:"r376_safe_native_owner_phase_diagnostic",
    phases:cryptoTrace.slice(-34),
    gateway_routes:events.filter(x=>typeof x==="string"&&
      /^(?:prepare_attempt_|prepare_|execute_)/u.test(x)).slice(-10),
    prepared_count:prepared.length,
    gateway_completed:gate.stagedCompletedTaskCount,
    registered:coordinator.registeredTaskCount
   })+"\n");
  }
  TrustedEffectStagingTaskRegistry.prototype.selectFor=originalSelect;
  PrivateMcpTaskRegistry.prototype.stageGatewayChallenge=originalChallenge;
  PrivateMcpTaskRegistry.prototype.invokeCrypto=originalCryptoInvoke;
  PrivateMcpTaskRegistry.prototype.takeSignedPresentation=originalProofTake;
  DelegationEvidenceHandler.prototype.createPresentation=originalCreate;
  LocalCryptoMcpBridge.prototype.createSignedPresentation=originalMcpBridge;
  const results=await Promise.allSettled([
   host.close(),...bindingServers.reverse().map(b=>b.close()),
   ...roleServers.reverse().map(s=>s.close()),
   new Promise((resolve,reject)=>
    runnerServer.close(err=>err?reject(err):resolve()))
  ]);
  for(const result of results)
   if(result.status==="rejected")throw result.reason;
 }
 assert.equal(host.phase,"revoked");
 assert.equal((await independentClient.getBranchMetadata("main")).commit_sha,
  disposableMainHead);
}finally{
 await rm(parent,{recursive:true,force:true});
}
