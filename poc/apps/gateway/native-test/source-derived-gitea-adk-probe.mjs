/**
 * Test-only: actual disposable Gitea -> controlled ADK read_file response ->
 * offline source-dependent update_file -> actual Gitea commit.
 * No Gemini, no reference implementation bytes or paid inference.
 *
 * This is NOT an authenticated Engineer approval, DC/VP/OPA authorization,
 * native Gateway E2E, autonomous programming or Docker acceptance proof.
 * Those are tested in separate signed-DAG and acceptance workflows.
 */
import assert from "node:assert/strict";
import {createHash,randomBytes} from "node:crypto";
import {BaseLlm,InMemorySessionService,Runner} from "@google/adk";
import {compilePlanningProposal}
  from "../../../packages/orchestrator-runtime/src/trusted-adk-planner.ts";
import {makeApproval,assertApprovedPlanScope}
  from "../../../packages/plan-contracts/src/plan.mjs";
import {RUST_OPERATIONS} from "../src/operation-catalog.ts";
import {GiteaClient} from "../src/gitea-client.ts";
import {createAdkSpecializedAgent}
  from "../../../packages/agent-runtime/src/adk-specialized-agents.ts";
import {bindModelsToApprovedRoleTasks}
  from "./approved-plan-agent-model-binding.mjs";

const FILE="apps/frontend/src/pages/UserDetailPage.tsx";
const SHA=/^[a-f0-9]{40}$/u;
const ENGINEER="did:thesis:offline-source-probe";
class SourceDerivedModel extends BaseLlm{
  #turn=0;
  constructor(context){
    super({model:"offline-source-derived-real-gitea"});
    assert.equal(context.role,"frontend");
    assert.equal(context.tasks.length,1);
    const read=context.approved_permissions.filter(p=>p.operation==="read_file");
    const edit=context.approved_permissions.filter(p=>p.operation==="update_file");
    assert.equal(read.length,1);assert.equal(edit.length,1);
    assert.equal(read[0].resource,edit[0].resource);
    const locator=read[0].resource.match(/\/branches\/([^/]+)\/files\/(.+)$/u);
    if(!locator)throw Error("Invalid approved model resource");
    this.branch=decodeURIComponent(locator[1]);
    this.path=locator[2].split("/").map(decodeURIComponent).join("/");
    this.sourceSeen=false;this.output=null;
  }
  async *generateContentAsync(request){
    ++this.#turn;
    if(this.#turn===1){
      yield {content:{role:"model",parts:[{functionCall:{
        id:"real-source-read",name:"read_file",
        args:{branch:this.branch,path:this.path}
      }}]}};
      return;
    }
    if(this.#turn===2){
      const results=(request.contents??[]).flatMap(c=>c.parts??[])
        .filter(p=>p.functionResponse?.name==="read_file")
        .map(p=>p.functionResponse.response);
      const item=results.at(-1);
      if(item?.ok!==true||typeof item.result?.content!=="string"){
        yield {content:{role:"model",parts:[{
          text:"Refused: no verified source from authorized read_file."
        }]}};
        return;
      }
      const contents=item.result.content;
      this.sourceSeen=true;
      const digest=createHash("sha256").update(contents,"utf8")
        .digest("hex").slice(0,24);
      this.output=contents+(contents.endsWith("\n")?"":"\n")+
        "// offline-source-digest:"+digest+"\n";
      yield {content:{role:"model",parts:[{functionCall:{
        id:"real-source-update",name:"update_file",
        args:{branch:this.branch,path:this.path,content:this.output}
      }}]}};
      return;
    }
    yield {content:{role:"model",parts:[{
      text:"Offline source-derived probe concluded."
    }]}};
  }
  connect(){throw Error("External LLM connections prohibited");}
}

export async function runSourceDerivedGiteaAdkProbe({
  baseUrl,readToken,writeToken,pinnedMainSha
}={}){
  assert.match(baseUrl,/^http:\/\/127\.0\.0\.1:\d+$/u);
  assert.match(pinnedMainSha,SHA);
  assert.ok(typeof readToken==="string"&&readToken.length>20);
  assert.ok(typeof writeToken==="string"&&writeToken.length>20);
  const connection={baseUrl,owner:"thesis",repository:"iam-console-poc",
    timeoutMs:20000};
  const reader=new GiteaClient({...connection,token:readToken});
  const writer=new GiteaClient({...connection,token:writeToken});
  const pristine=await reader.readTextFile("main",FILE,pinnedMainSha);
  assert.equal(pristine.revision,pinnedMainSha);
  const workBranch="feature/source-digest-probe-"+
    randomBytes(6).toString("hex");
  const snapshot={
    session_id:"probe-"+randomBytes(6).toString("hex"),
    repository:{authority:"gitea.local",owner:"thesis",
      repository:"iam-console-poc"},base_revision:pinnedMainSha,
    files:[FILE],directories:["","apps","apps/frontend",
      "apps/frontend/src","apps/frontend/src/pages"]
  };
  const intent=[
    {id:"branch",agent_id:"orchestrator",title:"Create isolated branch",
      description:"Protect immutable main",depends_on:[],
      permissions:[{operation:"create_branch",path:null,
        reason:"Keep source-derived probe isolated"}]},
    {id:"edit",agent_id:"frontend",title:"Source-dependent annotation",
      description:"Read authorized source and record its digest as a comment",
      depends_on:["branch"],
      permissions:["read_file","update_file"].map(operation=>({
        operation,path:FILE,reason:"Approved single-file source probe"
      }))}
  ];
  const {plan}=compilePlanningProposal({
    tasks:intent,assumptions:[],uncertainties:[]
  },{
    snapshot,agents:{frontend:{did:"did:thesis:offline-frontend",
      card_ref:"trusted:offline-frontend"}},
    requirement:"Generate a harmless digest annotation from actual source",
    planId:"source-digest-probe",workBranch
  });
  // This review is deliberately an unsigned local test fixture.
  const approval=makeApproval(plan,{
    allowedOperations:new Set(RUST_OPERATIONS),
    decision_id:"offline-probe-review",approved_by:ENGINEER,
    approved_at:new Date().toISOString(),
    approved_permission_ids:plan.requested_permissions.map(p=>p.id)
  });
  const approvedRows=assertApprovedPlanScope(plan,approval,{
    allowedOperations:new Set(RUST_OPERATIONS),
    expectedEngineerDid:ENGINEER
  });
  const bound=bindModelsToApprovedRoleTasks({
    plan,approvedRows,modelFactory:ctx=>new SourceDerivedModel(ctx)
  });
  assert.deepEqual(bound.selected_roles,["frontend"]);
  const model=bound.models.frontend;
  assert.ok(model instanceof SourceDerivedModel);
  const created=await writer.createBranch("main",workBranch);
  assert.equal(created.base_revision,pinnedMainSha);
  let sourceSeen=null;const calls=[];
  const configured=createAdkSpecializedAgent({
    role:"frontend",model,trustedBranch:workBranch,
    trustedTaskPaths:[FILE],
    trustedFilePermissions:[
      {operation:"read_file",path:FILE},
      {operation:"update_file",path:FILE}
    ],
    gatewayClient:{async invoke(name,args){
      calls.push(name);
      assert.equal(args.branch,workBranch);
      assert.equal(args.path,FILE);
      if(name==="read_file"){
        const result=await reader.readTextFile(workBranch,FILE);
        assert.equal(result.revision,pinnedMainSha);
        sourceSeen=result.content;
        return {content:result.content};
      }
      if(name==="update_file"){
        assert.equal(sourceSeen,pristine.content);
        assert.ok(typeof args.content==="string");
        assert.ok(args.content.startsWith(sourceSeen));
        return writer.updateFile(workBranch,FILE,args.content,
          "test: source-derived digest annotation");
      }
      throw Error("Unexpected offline probe operation");
    }}
  });
  const appName="source_digest_real_gitea",sessionService=new InMemorySessionService();
  const runner=new Runner({appName,agent:configured.agent,sessionService});
  await sessionService.createSession({
    appName,userId:"offline",sessionId:"gitea-probe"
  });
  for await(const event of runner.runAsync({
    userId:"offline",sessionId:"gitea-probe",
    newMessage:{role:"user",parts:[{
      text:"Carry out the approved one-file source-dependent annotation"
    }]}
  })){
    assert.equal(event.errorCode,undefined);
    assert.equal(event.errorMessage,undefined);
  }
  assert.deepEqual(calls,["read_file","update_file"]);
  assert.equal(model.sourceSeen,true);
  const updated=await reader.readTextFile(workBranch,FILE);
  const head=await reader.getBranchMetadata(workBranch);
  assert.match(head.commit_sha,SHA);
  assert.notEqual(head.commit_sha,pinnedMainSha);
  assert.equal(updated.revision,head.commit_sha);
  assert.equal(updated.content,model.output);
  assert.notEqual(updated.content,pristine.content);
  assert.equal((await reader.getBranchMetadata("main")).commit_sha,
    pinnedMainSha);
  assert.equal((await reader.readTextFile("main",FILE,pinnedMainSha))
    .content,pristine.content);
  return Object.freeze({
    status:"PASS",source_derived_tool_output:true,
    gitea_provider_committed:true,main_unchanged:true,
    external_model_calls:0,signed_gateway_credential_e2e:false,
    review_fixture_not_human_signed:true,
    source_sha:pinnedMainSha,feature_sha:head.commit_sha,
    controlled_calls:2,files_modified:1
  });
}
