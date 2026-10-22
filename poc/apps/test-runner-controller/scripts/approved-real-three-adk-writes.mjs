/**
 * Opt-in positive provider integration: real scripted ADK Backend/Frontend
 * agents, real A2A servers, Rust-issued task-scoped child credentials, real
 * signed VP / native Core verifier / OPA and actual Gitea file commits.
 *
 * The scripted model applies narrow functional edits to pinned reference
 * source. This proves controlled provider behavior, NOT generative AI code.
 * Test Agent runs after both edits on their real final Git SHA elsewhere.
 */
import assert from "node:assert/strict";
import {BaseLlm} from "@google/adk";
import {createServer} from "node:net";
import {randomBytes} from "node:crypto";
import {DeterministicA2AOrchestrator} from
  "../../../packages/agent-runtime/src/orchestrator.ts";
import {startSpecializedAgentServer} from
  "../../../packages/agent-runtime/src/server.ts";
import {TrustedApprovedA2ADispatcher} from
  "../../../packages/orchestrator-runtime/src/trusted-approved-a2a-dispatcher.ts";
import {ACCOUNT_SUSPENSION_REFERENCE_FILES} from
  "../fixtures/account-suspension-reference.mjs";
import {approvedFunctionalEdit} from "./approved-functional-reference.mjs";

export const THREE_ROLE_FILES=Object.freeze({
  backend:"apps/backend/src/users/user.service.ts",
  frontend:"apps/frontend/src/pages/UserDetailPage.tsx"
});
const ROLES=["backend","frontend"];
export const READ_ONLY_CONTEXT=Object.freeze({
  backend:"packages/shared/src/account-status.ts",
  frontend:"apps/frontend/src/api/users-api.ts"
});
const gatewayUrl="http://approved-gateway-inprocess.invalid";
const adapterUrl="http://127.0.0.1:8090";

class ScriptedAdkFileEdit extends BaseLlm{
  #args;#reads;#turn=0;
  constructor(readPath,args){
    super({model:"offline-fixed-allowed-source-comment"});
    this.#reads=[
      {branch:args.branch,path:args.path},
      {branch:args.branch,path:readPath}
    ];
    this.#args=args;
  }
  async *generateContentAsync(){
    this.#turn++;
    if(this.#turn<=this.#reads.length)yield {content:{role:"model",parts:[{
      functionCall:{id:"approved-source-read-"+this.#turn,
        name:"read_file",args:this.#reads[this.#turn-1]}
    }]}};
    else if(this.#turn===3)yield {content:{role:"model",parts:[{
      functionCall:{id:"real-gitea-approved-edit",name:"update_file",args:this.#args}
    }]}};
    else yield {content:{role:"model",parts:[{text:"Repository operation finished."}]}};
  }
  connect(){throw Error("No external model connections in scripted native E2E");}
}
async function allocatePort(){
  const server=createServer();
  await new Promise((ok,fail)=>{
    server.once("error",fail);server.listen(0,"127.0.0.1",ok);
  });
  const port=server.address().port;
  await new Promise(ok=>server.close(ok));
  return port;
}
function json(x,status=200){
  return new Response(JSON.stringify(x),{
    status,headers:{"content-type":"application/json"}
  });
}
export async function applyApprovedRealAgentEdits({
  approvals,coordinator,sessionId,expectedEngineerDid,baseRevision,
  planDigest,gateway,gitea,approvedBranch,operationalRootId
}){
  const servers=[];
  const endpoints={};
  const effects=[];
  const validatedReads=new Map();
  try{
    const dispatchFetch=async(url,request)=>{
      const target=String(url);
      if(target.startsWith(adapterUrl+"/"))return fetch(url,request);
      const body=JSON.parse(String(request?.body));
      try{
        if(target===gatewayUrl+"/v1/authorization/prepare"){
          if(body.tool==="update_file"){
            // Abort BEFORE prepare/execute/provider I/O when the scripted
            // model has not observed its exact approved source and context.
            const role=ROLES.find(x=>THREE_ROLE_FILES[x]===body.arguments?.path);
            if(!role||!validatedReads.has(THREE_ROLE_FILES[role])||
               !validatedReads.has(READ_ONLY_CONTEXT[role])){
              throw Error("Functional edit requires both pinned reads before Gateway Prepare");
            }
          }
          return json(gateway.prepare(body),201);
        }
        if(target===gatewayUrl+"/v1/authorization/execute"){
          const result=await gateway.execute(body);
          assert.equal(result.policy.allow,true);
          assert.equal(result.policy.policy_version,"phase6-approved-branch-v2");
          assert.equal(result.execution.provider,"gitea");
          assert.equal(result.execution.performed,true);
          if(result.execution.tool==="read_file"){
            const observed=result.execution;
            const expected=ACCOUNT_SUSPENSION_REFERENCE_FILES[observed.path];
            if(typeof expected!=="string"||observed.content!==expected){
              throw Error("Untrusted source mismatch: abort pinned functional edit");
            }
            validatedReads.set(observed.path,observed.content);
          }
          if(result.execution.tool==="update_file"&&
             !validatedReads.has(result.execution.path)){
            throw Error("Functional edit requires prior verified target read");
          }
          effects.push(result.execution);
          return json(result);
        }
        throw Error("No such approved Gateway route");
      }catch(e){
        return json({error:"trusted_gateway_denied",message:String(e.message)},
          Number.isInteger(e.status)?e.status:403);
      }
    };
    for(const role of ROLES){
      const path=THREE_ROLE_FILES[role];
      const source=ACCOUNT_SUSPENSION_REFERENCE_FILES[path];
      assert.equal(typeof source,"string");
      // The real provider file is independently checked during each
      // authorized read; actual write is a pinned, non-LLM transformation.
      const content=approvedFunctionalEdit(role,source);
      const server=await startSpecializedAgentServer({
        role,host:"127.0.0.1",port:await allocatePort(),
        delegatedAuthorization:true,
        adk:{model:new ScriptedAdkFileEdit(READ_ONLY_CONTEXT[role],{
          branch:approvedBranch,path,content
        }),gatewayBaseUrl:gatewayUrl,
          adapterBaseUrl:adapterUrl,
          adapterToken:process.env["ADAPTER_CALLER_"+role.toUpperCase()],
          fetchFn:dispatchFetch,maxModelTurns:4,maxModelCallMs:30_000,
          gatewayTimeoutMs:30_000}
      });
      servers.push(server);
      endpoints[role]=server.baseUrl;
    }
    const dispatcher=await TrustedApprovedA2ADispatcher.loadWithScopedChildAuthority({
      approvals,coordinator,sessionId,expectedEngineerDid,
      expectedPlanDigest:planDigest,baseRevision,
      agentBaseUrls:{
        backend:endpoints.backend,frontend:endpoints.frontend,
        test:"http://127.0.0.1:1"
      },
      a2a:new DeterministicA2AOrchestrator({
        deadlineMs:120_000,initialIntervalMs:60,maxIntervalMs:250
      }),
      adapter:{adapterBaseUrl:adapterUrl,
        bearerToken:process.env.ADAPTER_CALLER_ORCHESTRATOR,timeoutMs:30_000},
      async authorityForTask(taskId,role){
        if(!ROLES.includes(role)||taskId!==role){
          throw Error("Unrecognized approved specialist Task");
        }
        return {
          parent_credential_id:operationalRootId,
          credential_id:"urn:native:positive-write-"+role+"-"+
            randomBytes(10).toString("hex"),
          valid_from:new Date(Date.now()-1000).toISOString(),
          validity_seconds:1200,
          credential_status:{
            type:"BitstringStatusListEntry",statusPurpose:"revocation",
            statusListIndex:role==="backend"?"18074":"18075",
            statusListCredential:
              "https://status.example/lists/scoped-native-evm"
          }
        };
      }
    });
    let lastSha=await gitea.getBranchMetadata(approvedBranch);
    for(const role of ROLES){
      const outcome=await dispatcher.dispatch(role);
      assert.deepEqual(outcome.artifact.files_modified,
        [THREE_ROLE_FILES[role]]);
      assert.equal(outcome.artifact.test_outcome,"not_run");
      const actual=await gitea.getBranchMetadata(approvedBranch);
      assert.equal(outcome.artifact.commit_sha,actual.commit_sha,
        "A2A artifact SHA must match actual independently reread Gitea HEAD");
      assert.notEqual(actual.commit_sha,lastSha.commit_sha);
      const reread=await gitea.readTextFile(
        approvedBranch,THREE_ROLE_FILES[role]);
      assert.equal(reread.revision,actual.commit_sha);
      assert.equal(reread.content,approvedFunctionalEdit(role,
        ACCOUNT_SUSPENSION_REFERENCE_FILES[THREE_ROLE_FILES[role]]));
      assert.notEqual(reread.content,
        ACCOUNT_SUSPENSION_REFERENCE_FILES[THREE_ROLE_FILES[role]],
        "Each scripted role must perform a substantive source change");
      lastSha=actual;
    }
    assert.deepEqual(dispatcher.completedTaskIds,ROLES);
    assert.deepEqual(effects.map(x=>x.tool),
      ["read_file","read_file","update_file",
       "read_file","read_file","update_file"]);
    assert.deepEqual(effects.filter(x=>x.tool==="read_file").map(x=>x.path),[
      THREE_ROLE_FILES.backend,READ_ONLY_CONTEXT.backend,
      THREE_ROLE_FILES.frontend,READ_ONLY_CONTEXT.frontend
    ]);
    return {finalSha:lastSha.commit_sha,operations:effects.filter(
      x=>x.tool==="update_file").length,
      verifiedReads:effects.filter(x=>x.tool==="read_file").length,
      completedTaskIds:dispatcher.completedTaskIds};
  }finally{
    for(const server of servers.reverse())await server.close();
  }
}
