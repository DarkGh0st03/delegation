/** R374.0 — original Engineer Review Host native root Branch first + SDK A2A
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
import {invokeNativeCrypto}
 from "../../agent-runtime/src/native-crypto-ipc.ts";

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
const sessionId="r374-original-review-host-e2e";
class ScriptedReadThenCas extends BaseLlm {
 constructor(branch,path,oldContent,newContent){
  super({model:"r374-local-adk-read-then-cas-no-paid-inference"});
  this.branch=branch;this.path=path;
  this.oldContent=oldContent;this.newContent=newContent;
  this.requests=[];this.authorizedRepair=false;this.repairContent=null;
 }
 async *generateContentAsync(request){
  this.requests.push(request);
  const turn=this.requests.length;
  if(turn===1||turn===4){
   if(turn===4){
    if(this.path!=="apps/frontend/src/api/users-api.ts"||
       this.authorizedRepair!==true||
       typeof this.repairContent!=="string"||
       this.repairContent===this.newContent)
     throw Error("R374 cannot enter revision before authenticated Test FAIL");
    this.oldContent=this.newContent;
    this.newContent=this.repairContent;
   }
   yield {content:{role:"model",parts:[{functionCall:{
    name:"read_file",id:"r374-read",args:{
     branch:this.branch,path:this.path
    }
   }}]}};
  }else if(turn===2||turn===5){
   // An actual ADK FunctionResponse must carry the independently authorized
   // real Gitea source. A blind precomputed update is NOT a pass here.
   // Compare JSON-escaped UTF-8 bytes because ADK LlmRequest serializes
   // source newlines and quotes in functionResponse parts.
   const sourceEvidence=JSON.stringify(request);
   if(!sourceEvidence.includes(JSON.stringify(this.oldContent).slice(1,-1)))
    throw Error("R374 scripted ADK did not observe authenticated source bytes");
   yield {content:{role:"model",parts:[{functionCall:{
    name:"update_file",id:"r374-update",args:{
     branch:this.branch,path:this.path,content:this.newContent
    }
   }}]}};
  }else if(turn===3||turn===6){
   yield {content:{role:"model",parts:[{
    text:"Native source read and CAS update completed"
   }]}};
  }else{
   throw Error("R374 unexpected ADK turn beyond the signed two-effect Task");
  }
 }
 connect(){return Promise.reject(Error("Paid model connections disabled in R374"));}
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
 constructor(branch){
  super({model:"r374-local-adk-docker-test-no-paid-inference"});
  this.branch=branch;this.requests=[];
 }
 async *generateContentAsync(req){
  this.requests.push(req);
  if(this.requests.length===1||this.requests.length===3){
   yield {content:{role:"model",parts:[{functionCall:{
    id:"r374-docker-test",name:"run_tests",
    args:{branch:this.branch,profile:"poc-default"}
   }}]}};
  }else if(this.requests.length===2||this.requests.length===4){
   yield {content:{role:"model",parts:[{
    text:"Completed one native Test against owner-pinned Gitea HEAD"
   }]}};
  }else throw Error("R374 Docker Test model generated extra tool turns");
 }
 connect(){return Promise.reject(Error("Paid model connections prohibited"));}
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
// R374.1: genuine unsolved protected main is never modified.
const branch="feature/account-suspension";
const baselineMain=(await client.getBranchMetadata("main")).commit_sha;
assert.equal(baselineMain,ACCOUNT_SUSPENSION_BASELINE_PUBLIC_COMMIT);
await assert.rejects(independentClient.getBranchMetadata(branch),
 e=>e instanceof ProviderNotFoundError);
const backendPath="apps/backend/src/users/user.service.ts";
const backendOldContent=ACCOUNT_SUSPENSION_UNSOLVED_BASELINE_FILES[backendPath];
assert.ok(typeof backendOldContent==="string"&&backendOldContent.length>100);
const backendNewContent=backendOldContent+
 "\n// R374 delegated Backend CAS under original signed file scope\n";
const mutationPath="apps/frontend/src/api/users-api.ts";
const oldContent=ACCOUNT_SUSPENSION_UNSOLVED_BASELINE_FILES[mutationPath];
assert.ok(typeof oldContent==="string"&&oldContent.length>100);
const newContent=oldContent+"\n// R374 signed Frontend CAS on existing source\n";
const baseRevision=baselineMain;
const disposableMainHead=baselineMain;
assert.equal(branchPostAttempts,0);
const requirement="R374 disposable EVM proof for account suspension permission";
const resourcePrefix="gitea://gitea.local/thesis/iam-console-poc/branches/"+
 "feature%2Faccount-suspension";
const testPermission={resource:resourcePrefix,operation:"run_tests"};
const branchPermission={resource:"gitea://gitea.local/thesis/iam-console-poc",
 operation:"create_branch"};
const prPermission={resource:"gitea://gitea.local/thesis/iam-console-poc",
 operation:"create_pull_request"};
// Engineer-signed grants: root create_branch, exact Backend/Frontend file
// operations and run_tests. No create_pull_request grant exists.
const grantPermissions=[
 branchPermission,testPermission,
 {resource:resourcePrefix+"/files/"+backendPath,operation:"read_file"},
 {resource:resourcePrefix+"/files/"+backendPath,operation:"update_file"},
 {resource:resourcePrefix+"/files/"+mutationPath,operation:"read_file"},
 {resource:resourcePrefix+"/files/"+mutationPath,operation:"update_file"}
];
assert.equal(grantPermissions.length,6);
const readPermission={resource:resourcePrefix+"/files/"+mutationPath,
 operation:"read_file"};
const updatePermission={resource:resourcePrefix+"/files/"+mutationPath,
 operation:"update_file"};
const taskPermissions=[readPermission,updatePermission];
const backendReadPermission={resource:resourcePrefix+"/files/"+backendPath,
 operation:"read_file"};
const backendUpdatePermission={resource:resourcePrefix+"/files/"+backendPath,
 operation:"update_file"};
const backendPermissions=[backendReadPermission,backendUpdatePermission];
const nowMs=()=>Date.now();
const start=new Date();
const issuedAt=start.toISOString().replace(/\.\d{3}Z$/u,"Z");
const approvalExpiresAt=new Date(start.getTime()+55*60_000)
 .toISOString().replace(/\.\d{3}Z$/u,"Z");
const authKey="r374-disposable-ed25519";
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
const parent=await mkdtemp(join(tmpdir(),"delegation-r374-"));
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
  // R374.2: the original Engineer Review Host owns Planning, root,
  // Coordinator, Gateway, Child issuer and every model-selected Task.
  // An independently signed disposable approval is persisted above and
  // MUST match the newly generated, source-grounded Planning checkpoint.
  const credentialPort=createTrustedEngineerCredentialPort({
   bearerToken:tokens.engineer,timeoutMs:60000
  });
  const snapshot={session_id:sessionId,repository:repo,
   base_revision:baseRevision,
   directories:["","apps","apps/backend","apps/backend/src","apps/backend/src/users",
    "apps/frontend","apps/frontend/src","apps/frontend/src/api"],
   files:[backendPath,mutationPath]};
  const status=index=>({type:"BitstringStatusListEntry",
   statusPurpose:"revocation",statusListIndex:String(index),
   statusListCredential:"https://status.example/r374"});
  const params=(id,index,duration)=>({
   credential_id:id,valid_from:issuedAt,validity_seconds:duration,
   credential_status:status(index)
  });
  const preliminary=params("urn:r374:preliminary",29151,360);
  const operational=params("urn:r374:operational",29152,1800);
  const planningKey=generateKeyPairSync("ed25519");
  class ScriptedPermissionOnlyPlanner extends BaseLlm{
   constructor(){super({model:"r374-free-native-original-host-planner"});this.calls=0;}
   async *generateContentAsync(request){
    this.calls++;
    if(this.calls===1)yield {content:{role:"model",parts:[{
     functionCall:{id:"r374-source-read",name:"read_file",
      args:{branch:"main",path:backendPath}}
    }]}};
    else if(this.calls===2){
     const grounded=JSON.stringify(request);
     if(!grounded.includes(JSON.stringify(backendOldContent).slice(1,-1)))
      throw Error("R374 Planning did not receive the authenticated source bytes");
     yield {content:{role:"model",parts:[{text:JSON.stringify({
      requested_permissions:[
       {operation:"create_branch",resource_type:"repository",path:null},
       {operation:"read_file",resource_type:"file",path:backendPath},
       {operation:"update_file",resource_type:"file",path:backendPath},
       {operation:"read_file",resource_type:"file",path:mutationPath},
       {operation:"update_file",resource_type:"file",path:mutationPath},
       {operation:"run_tests",resource_type:"branch",path:null}
      ],assumptions:[],uncertainties:[]
     })}]}};
    }else throw Error("R374 Planner exceeded scripted free budget");
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
    return Response.json({request_id:"r374-planning-request",
     audience:"cloud-access-gateway",challenge:"r374-planning-source-challenge",
     required_permission:preliminaryReadPermissions(snapshot).find(p=>p.operation==="read_file")},{status:201});
   }
   if(String(url).endsWith("/v1/authorization/execute")){
    assert.equal(body.request_id,"r374-planning-request");
    const observed=await nativePlanningVerifier.verify({
     presenter:"orchestrator",audience:"cloud-access-gateway",
     challenge:"r374-planning-source-challenge",
     required_permission:preliminaryReadPermissions(snapshot).find(p=>p.operation==="read_file"),signed_vp:body.signed_vp
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
   throw Error("R374 Planning cannot execute write or unknown Gateway route");
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
    passwordScryptHex:scryptSync("r374-engineer-test-only",salt,64).toString("hex")},
   planner:{model:planningModel,planId:"r374-native-review",
    maxModelTurns:3,maxProposalRevisions:0},
   trustedAgentRegistry:{
    backend:{did:backendDid,card_ref:"trusted:r374-backend",
     capabilities:["read_file","update_file"]},
    frontend:{did:frontendDid,card_ref:"trusted:r374-frontend",
     capabilities:["read_file","update_file"]},
    test:{did:testDid,card_ref:"trusted:r374-test",
     capabilities:["run_tests"]},
    orchestrator:{did:process.env.ADAPTER_ID_ORCHESTRATOR,
     card_ref:"trusted:r374-orchestrator",
     capabilities:["create_branch"]}
   },
   credentials:credentialPort,
   planningRevisions:{
    async begin(taskId){return {task_id:taskId,
     base_revision:baseRevision,expires_at:new Date(Date.now()+600000).toISOString()};},
    async end(){return;}
   },
   gateway:{gatewayBaseUrl:"http://r374-planning.fixture.invalid",
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
  const nativeChildPort={kind:"rust-native",
   async issueChild(request){
    const signed=await nativePort.issueChild(request);
    issuedChildren++;
    if(request.delegatee==="backend")backendChild=signed;
    else if(request.delegatee==="frontend")child=signed;
    else if(request.delegatee==="test")runnerChild=signed;
    else throw Error("Unexpected delegated specialist");
    return signed;
   }
  };
  const execution=await host.admitOperationalExecution({
   operationalSessionStore:operationalSessions,
   gatewayTaskJournal:new DurableAuthorityTaskJournal(path("gateway-tasks")),
   issuerChildJournal:new DurableAuthorityOnlyChildJournal(path("child-intents")),
   gatewayChildJournal:new DurableAuthorityOnlyChildJournal(path("gateway-child-intents")),
   sequentialEffectJournal:new DurableAuthorityOnlySequentialEffectJournal(path("sequences")),
   effectFenceJournal:new DurableAuthorityOnlyTaskFenceJournal(path("flights")),
   completionObserver:new TrustedAuthorityOnlyCompletionObserver({
    readVerifiedCompletion:expected=>expected.task_id==="r374-test-task"?
     runnerObserver.observe(expected):readObserver.observe(expected)
   }),nativeCryptoPort:nativeChildPort
  });
  const gate=execution.gateway;
  assert.equal(gate.phase,"active");
  assert.equal(coordinator.registeredTaskCount,0);
  assert.equal(issuedChildren,0);
  assert.equal(gate.stagedCompletedTaskCount,0);

 const taskId="r374-frontend-task";let runtimeTaskId="dispatch_"+"F".repeat(22);
 const backendTaskId="r374-backend-task";let backendRuntimeId="dispatch_"+"B".repeat(22);
 const testTaskId="r374-test-task";let testRuntimeId="dispatch_"+"T".repeat(22);
 const repairTaskId="r374-frontend-repair",retestTaskId="r374-retest-task";
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
    event:"r374_runner_sanitized_result",
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
 // R374: three distinct pairs of role-pinned HMAC IPC channels; separate
 // agent registries and signing keys, but one original native Engineer root.
 const roles=["backend","frontend","test"],stageChannels={},agentBindingChannels={};
 const registries={},bindingServers=[],roleServers=[],urls={},events=[],prepared=[];
 const models={
  backend:new ScriptedReadThenCas(branch,backendPath,
   backendOldContent,backendNewContent),
  frontend:new ScriptedReadThenCas(branch,mutationPath,oldContent,newContent),
  test:new ScriptedNativeDockerTest(branch)
 };
 // R374.7 diagnostic: observe internal phase ACKs without changing the
 // actual owner Stager, signed Task, crypto registry or MCP tool semantics.
 // All hooks delegate to the original implementations and are restored.
 const cryptoTrace=[];
 const recordPhase=(phase)=>{if(cryptoTrace.length<24)cryptoTrace.push(phase);};
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
      event:"r374_safe_gateway_prepare_rejection",
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
     process.stderr.write("R374 denied "+role+" "+tool+": "+
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
     trustedEffectTaskRegistry:registries[role],fetchFn:gatewayTransport
    };
   }
   const server=await startSpecializedAgentServer(opts);
   roleServers.push(server);urls[role]=server.baseUrl;
  }
  assert.equal(models.backend.requests.length,0);
  assert.equal(models.frontend.requests.length,0);
  // R374.2 no registered Task nor native Child before this real SDK
  // owner starts. Every subsequent step is selected by ADK and independently
  // completed before another model turn.
  assert.equal(coordinator.registeredTaskCount,0);
  let backendHead,frontendHead,verifiedRunnerBinding;
  // Original Review Host owns the FULL adaptive state and all effects.
  // No harness hooks may register Tasks or attest Gateway completions.
  assert.equal(coordinator.registeredTaskCount,0);
  assert.equal(issuedChildren,0);
  assert.equal(gate.stagedCompletedTaskCount,0);
  // R374: no repair Task is selected/staged until the first native Runner
  // FAIL is authenticated, placed in original-owner context, and returned
  // to the next ADK decision. This remains a deterministic free model,
  // NOT application-code generation by real Gemini.
  const initialChoices=[
   {action:"delegate",task:{task_id:backendTaskId,agent_id:"backend",
    depends_on:["r374-original-root-branch"],permissions:backendPermissions,
    instruction:"Read the original unresolved Backend code then CAS-update it"}},
   {action:"delegate",task:{task_id:taskId,agent_id:"frontend",
    depends_on:[backendTaskId],permissions:taskPermissions,
    instruction:"Read existing Frontend after verified Backend, then protected CAS"}},
   {action:"delegate",task:{task_id:testTaskId,agent_id:"test",
    depends_on:[taskId],permissions:[testPermission],
    instruction:"Run authentic Docker acceptance on the pinned first Frontend HEAD"}}
  ];
  class FreeOriginalHostDecisionModel extends BaseLlm{
   constructor(){super({model:"r374-original-host-model-driven-recovery-no-paid"});
    this.calls=0;this.requests=[];this.failureReadiness=[];}
   async *generateContentAsync(req){
    const n=this.calls++;this.requests.push(req);
    assert.ok(n<6,"no unbounded automatic recovery without approval");
    const encoded=JSON.stringify(req);
    if(!n)assert.match(encoded,/r374-original-root-branch/u);
    if(n===1||n===2)
     assert.ok(encoded.includes(initialChoices[n-1].task.task_id),
      "ADK did not observe prior independently completed Task");
    const assertPrivate=(context)=>{
     for(const secret of [
      tokens.orchestrator,tokens.test,operational.credential_id,
      process.env.ADAPTER_EVM_PRIVATE_KEY_TEST
     ])if(secret)assert.equal(context.includes(secret),false);
    };
    let choice;
    if(n<3)choice=initialChoices[n];
    else if(n===3){
     // The failed Test is deliberately not in the completed ledger.
     // Only the original independent MAC receipt makes this branch reachable.
     assert.match(encoded,/independent_runner_failure/u);
     assert.match(encoded,/independently_verified_test_failures/u);
     assert.match(encoded,/source_evidence_sha256/u);
     assert.match(encoded,/researcher_acceptance/u);
     assert.match(encoded,/verified_failure_preflight_only_not_approval/u);
     assert.ok(encoded.includes(testTaskId));
     assertPrivate(encoded);
     this.failureReadiness.push("original_test_fail_authenticated");
     models.frontend.authorizedRepair=true;
     models.frontend.repairContent=newContent+
      "\n// R374 scripted FE revision after verified acceptance failure (still not a functional repair)\n";
     choice={action:"delegate",task:{
      task_id:repairTaskId,agent_id:"frontend",depends_on:[taskId],
      permissions:taskPermissions,
      instruction:"Independently read and CAS-revise Frontend after authenticated acceptance FAIL, within existing exact scope"
     }};
    }else if(n===4){
     assert.ok(encoded.includes(repairTaskId),
      "Retest can depend only on independently completed repair");
     assert.match(encoded,/independent_runner_failure/u);
     assert.match(encoded,/researcher_acceptance/u);
     assertPrivate(encoded);
     choice={action:"delegate",task:{
      task_id:retestTaskId,agent_id:"test",
      depends_on:[repairTaskId],permissions:[testPermission],
      instruction:"Run another real native Docker acceptance against verified corrected HEAD"
     }};
    }else{
     assert.ok(encoded.includes(testTaskId));
     assert.ok(encoded.includes(retestTaskId));
     assert.match(encoded,/independently_verified_test_failures/u);
     assert.match(encoded,/researcher_acceptance/u);
     assert.match(encoded,/source_evidence_sha256/u);
     assertPrivate(encoded);
     this.failureReadiness.push("retest_fail_authenticated");
     choice={action:"blocked",
      reason:"Second authentic Docker acceptance FAIL; signed recovery budget exhausted and no PR permission"};
    }
    yield {content:{role:"model",parts:[{text:JSON.stringify(choice)}]}};
   }
   connect(){throw Error("Paid model API forbidden in R374");}
  }
  const controller=new FreeOriginalHostDecisionModel();
  let childMetadataCount=0;
  // R374: Branch is selected, staged and attested by the SAME original
  // Review Host BEFORE the protected worker SDK A2A can start.
  class FreeSignedBranchProposal extends BaseLlm{
   constructor(){super({model:"r374-original-root-branch-only"});
    this.calls=0;this.requests=[];}
   async *generateContentAsync(req){
    this.calls++;this.requests.push(req);
    assert.equal(this.calls,1);
    assert.equal(branchPostAttempts,0);
    assert.equal(issuedChildren,0);
    assert.ok(JSON.stringify(req).includes("create_branch"));
    yield {content:{role:"model",parts:[{text:JSON.stringify({
     task_id:"r374-original-root-branch",agent_id:"orchestrator",
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
     const signed=await invokeNativeCrypto({
      socketPath,token:tokens.orchestrator,timeoutMs:60000
     },"create_presentation",{
      credential_id:operational.credential_id,
      disclosed_permissions:[branchPermission],
      audience:prepared.audience,challenge:prepared.challenge
     });
     assert.equal(typeof signed.signed_vp,"string");
     privateBranchFlight.signed_vp=signed.signed_vp;
     privateBranchExecuteCalls++;
     return executeAuthorization({
      request_id:prepared.request_id,signed_vp:signed.signed_vp
     },deps);
    }
   },
   sdk:{stageChannels,agentBindingChannels,agentBaseUrls:urls,
    a2aPolling:{deadlineMs:960000,initialIntervalMs:40,maxIntervalMs:1000}},
   adaptive:{model:controller,maxSteps:6,
    nextChildParameters:({epoch,agent_id})=>{
     childMetadataCount++;
     if(epoch===2&&agent_id==="backend")
      return params("urn:r374:child:backend",29153,600);
     if(epoch===3&&agent_id==="frontend")
      return params("urn:r374:child:frontend",29154,600);
     if(epoch===4&&agent_id==="test")
      return params("urn:r374:child:test",29155,1200);
     if(epoch===5&&agent_id==="frontend")
      return params("urn:r374:child:frontend-repair",29156,1200);
     if(epoch===6&&agent_id==="test")
      return params("urn:r374:child:retest",29157,1200);
     throw Error("Original Host denied unexpected Child metadata");
    }}

  });
  assert.equal(workflow.status,"owner_operational_work_finished_without_pr");
  assert.equal(workflow.adaptive_status,"owner_adaptive_work_blocked");
  assert.equal(workflow.executed_tasks,3);
  assert.equal(workflow.pr_created,false);
  assert.equal(workflow.branch?.status,"owner_original_branch_independently_attested");
  assert.equal(workflow.branch?.task_id,"r374-original-root-branch");
  assert.equal(workflow.branch?.base_revision,disposableMainHead);
  assert.equal(branchModel.calls,1);
  assert.equal(branchPostAttempts,1);
  assert.equal(privateBranchExecuteCalls,1);
  assert.equal(controller.calls,6);
  assert.equal(childMetadataCount,5);
  assert.equal(issuedChildren,5);
  assert.equal(coordinator.registeredTaskCount,6);
  assert.equal(gate.stagedCompletedTaskCount,4);
  assert.equal(gatewayCasWrites,3);
  assert.equal(privateCasStagingBranchPosts,3);
  assert.equal(draftPrCreateAttempts,0);
  assert.equal(runnerCalls,2);
  assert.equal((await readdir(path("runner-receipts")))
   .filter(name=>name.endsWith(".runner.json")).length,0,
   "failed Test must never be recorded as successful Runner");
  assert.equal((await readdir(path("runner-fail-receipts")))
   .filter(name=>name.endsWith(".runner-fail.json")).length,2,
   "original Runner FAIL must have exactly one authenticated receipt");
  assert.equal(gate.stagedCompletedTaskCount,4,
   "neither failed Test may enter successful Gateway completion ledger");
  assert.deepEqual(controller.failureReadiness,[
   "original_test_fail_authenticated","retest_fail_authenticated"
  ]);
  assert.equal(draftPrCreateAttempts,0);
  assert.equal(models.backend.requests.length,3);
  assert.equal(models.frontend.requests.length,6);
  assert.ok(models.test.requests.length>=1);
  assert.equal(legacyWriteCalls,0);
  assert.equal((await independentClient.getBranchMetadata("main")).commit_sha,disposableMainHead);
  const latest=(await independentClient.getBranchMetadata(branch)).commit_sha;
  assert.notEqual(latest,disposableMainHead);
  const actual=await independentClient.readTextFile(branch,backendPath,latest);
  assert.equal(actual.content,backendNewContent);
  const actualFrontend=await independentClient.readTextFile(branch,mutationPath,latest);
  assert.equal(actualFrontend.content,models.frontend.repairContent);
  assert.ok(models.frontend.repairContent.startsWith(newContent));
  assert.notEqual(actualFrontend.content,newContent,
   "native second Frontend CAS must be independently visible at latest HEAD");
  assert.equal((await independentClient.readTextFile("main",mutationPath,disposableMainHead)).content,oldContent);
  assert.equal((await independentClient.readTextFile("main",backendPath,disposableMainHead)).content,backendOldContent);
  await assert.rejects(executeAuthorization({
   request_id:privateBranchFlight.prepared.request_id,
   signed_vp:privateBranchFlight.signed_vp
  },deps),error=>error.code==="replay_detected");
  assert.equal(branchPostAttempts,1);
  process.stdout.write(JSON.stringify({
   event:"r374_native_original_branch_first_authenticated_fail_repair_retest_fail",
   original_protected_unsolved_main_unchanged:true,preexisting_feature_branch:false,
   model_selected_root_branch:true,independent_branch_get:true,
   real_native_rust_evm:true,opa_real:true,branch_posts:branchPostAttempts,
   private_cas_staging_branch_posts:privateCasStagingBranchPosts,
   original_gateway_completed_tasks:gate.stagedCompletedTaskCount,
   native_worker_children:issuedChildren,backend_native_read_then_cas:true,
   frontend_native_read_then_cas:true,
   gateway_cas_writes:gatewayCasWrites,frontend_calls:models.frontend.requests.length,
   test_calls:models.test.requests.length,docker_runner_calls:runnerCalls,
   original_registered_tasks:coordinator.registeredTaskCount,
   failed_test_incomplete:true,authenticated_runner_fail_receipts:2,
   model_observed_original_fail_then_repair:true,
   model_selected_frontend_repair:true,model_selected_retest:true,
   second_runner_failure_independently_observed:true,
   original_root_recovery_without_new_signed_scope:true,
   signed_completion_ledger_excludes_both_failed_tests:true,
   runner_pass_attested:false,autonomous_source_generation:false,
   recovery_executed:true,draft_pr_created:false,paid_model_calls:0
  })+"\n");
 }finally{
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
