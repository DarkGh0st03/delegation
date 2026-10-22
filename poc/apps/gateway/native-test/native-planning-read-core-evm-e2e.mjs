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
import {randomBytes,randomInt} from "node:crypto";
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
const file="apps/backend/src/users/user.service.ts";
const disposableBase=process.env.PLANNING_DISPOSABLE_GITEA_URL;
const disposableToken=process.env.PLANNING_DISPOSABLE_GITEA_READ_TOKEN;
const disposableSha=process.env.PLANNING_DISPOSABLE_GITEA_MAIN_SHA;
const realGitea=[disposableBase,disposableToken,disposableSha]
  .some(v=>v!==undefined);
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
  (await liveClient.getBranchMetadata("feature/account-suspension")).commit_sha:undefined;
const session="native-read-plan-"+randomBytes(5).toString("hex");
const rootId="urn:native:planning-only-"+randomBytes(7).toString("hex");
const snapshot={
  session_id:session,repository:repo,base_revision:baseSha,
  directories:["","apps","apps/backend","apps/backend/src","apps/backend/src/users"],
  files:[file]
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
const workBranch="feature/native-planning-read";
const planSketch={
  tasks:[
    {id:"branch",agent_id:"orchestrator",title:"Create isolated work branch",
      description:"Keep all changes out of main",depends_on:[],
      permissions:[{operation:"create_branch",path:null,reason:"Separate workflow"}]},
    {id:"backend",agent_id:"backend",title:"Update approved service",
      description:"Implement the bounded requirement",depends_on:["branch"],
      permissions:[
        {operation:"read_file",path:file,reason:"Inspect existing code"},
        {operation:"update_file",path:file,reason:"Apply the approved edit"}
      ]}
  ],assumptions:[],uncertainties:[]
};
class ScriptedReadPlanner extends BaseLlm{
  turns=0; requests=[];
  constructor(){super({model:"native-planning-offline-script"});}
  async *generateContentAsync(req){
    this.requests.push(req);this.turns++;
    if(this.turns===1){
      yield {content:{role:"model",parts:[{functionCall:{
        id:"planning-source-read",name:"read_file",
        args:{branch:"main",path:file}
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
    assert.equal(branch,"main");assert.equal(path,file);
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
const config={bind_host:"127.0.0.1",bind_port:0,
  prepare:{audience:"cloud-access-gateway",request_ttl_ms:120000,repository:repo},
  opa_url:opaUrl,opa_timeout_ms:15000,
  provider_mode:"mock",gitea_timeout_ms:15000};
const runtime=new GatewayRuntime(config,{
  planningRevisions:revisions,audit,
  verifier:loadDirectCoreRustVerifier(),
  policy:new OpaPolicyClient({baseUrl:opaUrl,timeoutMs:15000}),
  executor:new GiteaReadOnlyExecutor(gitea)
});
const authorityClient=new SoftwareEngineerAuthorityBootstrap({
  adapterBaseUrl:adapterUrl,bearerToken:engineerToken,timeoutMs:60000
});
const authority=new TrustedEngineerAuthoritySession({
  snapshot,credentials:authorityClient,
  approvals:{async loadAuthenticatedApproval(){
    throw Error("An unapproved Planning proposal must never activate Execution");
  }},
  authenticatedEngineerDid:engineerDid,
  planningRevisions:revisions
});
const coordinator=new TrustedExecutionCoordinator({
  authority,credentials:authorityClient,
  sessionId:session,baseRevision:baseSha,
  approvedGatewayPlans:{
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
  assert.equal(coordinator.trustedPlanningAuthority().permissions.length,7);
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
    requirement:"Improve authorized backend behavior",
    planId:"native-planning-proposal",agents,readPort:port
  }).propose();
  assert.equal(proposed.status,"unapproved_proposal");
  assert.equal(proposed.verified_source_reads,1);
  assert.equal(proposed.plan.base_revision,baseSha);
  assert.equal(proposed.plan.repository.repository,"iam-console-poc");
  assert.equal(proposed.plan.requested_permissions.length,3);
  assert.equal(log.adapterPresentations,1);
  assert.equal(log.prepares,1);
  assert.equal(log.executions,1);
  assert.equal(log.giteaReads,2); // actual trusted SHA bootstrap + pinned source read
  if(liveClient){
    // Read-only PAT and the provider are backed by the disposable Gitea,
    // never the public baseline or an in-memory repository emulator.
    const fileAtSha=await liveClient.readTextFile("main",file,baseSha);
    assert.ok(fileAtSha.content.includes("listUsers"));
    assert.equal(fileAtSha.revision,baseSha);
  }
  const executed=audit.events.filter(e=>e.event==="authorization_executed");
  assert.equal(executed.length,1);
  assert.equal(executed[0].decision,"allow");
  assert.equal(executed[0].policy_decision,"allow");
  assert.equal(executed[0].pinned_revision,baseSha);
  assert.equal(executed[0].provider_result,"success");
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
  await authorityClient.revokeRoot(rootId);
  revoked=true;
  const before=log.giteaReads;
  await assert.rejects(
    runtime.execute({request_id:waiting.request_id,
      signed_vp:signedBeforeRevoke}),
    (e)=>e?.code==="verification_rejected"
  );
  assert.equal(log.giteaReads,before);
  // Coordinator is still in Planning; retaining its read port must not
  // let any caller bypass status revocation or obtain new effective access.
  await assert.rejects(port.invoke("read_file",{branch:"main",path:file}));
  assert.equal(log.giteaReads,before);
  revisions.end(session);
  await assert.rejects(port.invoke("read_file",{branch:"main",path:file}));
  assert.equal(log.giteaReads,before);
  if(liveClient){
    assert.equal((await liveClient.getBranchMetadata("main")).commit_sha,baseSha);
    assert.equal((await liveClient.getBranchMetadata("feature/account-suspension")).commit_sha,
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
    approval_created:false,
    provider_writes:0
  }));
}finally{
  if(issued&&!revoked)await authorityClient.revokeRoot(rootId);
}
