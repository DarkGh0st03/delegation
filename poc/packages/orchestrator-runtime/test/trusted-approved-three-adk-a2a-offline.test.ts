/**
 * One offline real Google ADK + real A2A SDK execution for all three roles.
 * The signed Ed25519 Engineer receipt and approved-DAG coordinator are real.
 * The Adapter HTTP issuer,
 * signed VP, Gateway/OPA replies and Git/Runner effects are deterministic
 * test fixtures. The separate native EVM integration checks those boundaries.
 * NO network LLM service, API key, actual Gitea or Docker is involved.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {BaseLlm} from "@google/adk";
import {createServer} from "node:net";
import {randomBytes,generateKeyPairSync} from "node:crypto";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {signEngineerApproval} from "../../../packages/plan-contracts/src/signed-approval.mjs";
import {SignedEngineerApprovalFileStore} from "../src/signed-approval-store.ts";
import {makeApproval,planDigest} from "../../../packages/plan-contracts/src/plan.mjs";
import {RUST_OPERATIONS} from "../../../apps/gateway/src/operation-catalog.ts";
import {TrustedApprovedA2ADispatcher} from "../src/trusted-approved-a2a-dispatcher.ts";
import {DelegatedA2ARoleRunner} from "../src/a2a-workflow.ts";
import {startSpecializedAgentServer} from "../../agent-runtime/src/server.ts";
import {DeterministicA2AOrchestrator} from "../../agent-runtime/src/orchestrator.ts";

const repo={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const ROOT="gitea://gitea.local/thesis/iam-console-poc";
const BRANCH="feature/approved-three-adk";
const scoped=ROOT+"/branches/"+encodeURIComponent(BRANCH);
const files={
  backend:"apps/backend/src/users/user.service.ts",
  frontend:"apps/frontend/src/pages/UserDetailPage.tsx"
};
const sha=["a","b","c"].map(x=>x.repeat(40));
const did="did:thesis:engineer";
const roles=["backend","frontend","test"];
function plan(session){
  return {
    schema_version:"1.0.0",plan_id:"offline-adk-three-role",
    session_id:session,version:1,repository:repo,base_revision:sha[0],
    requirement:"Approved backend and frontend updates followed by controlled tests",
    candidate_agents:roles.map(r=>({agent_id:r,did:"did:thesis:"+r,card_ref:"trusted:"+r})),
    tasks:[
      {id:"branch",agent_id:"orchestrator",title:"Create feature branch",
        description:"Create approved branch",depends_on:[],resources:[ROOT]},
      {id:"backend",agent_id:"backend",title:"Backend modification",
        description:"Update approved backend service",depends_on:["branch"],
        resources:[scoped+"/files/"+files.backend]},
      {id:"frontend",agent_id:"frontend",title:"Frontend modification",
        description:"Update approved user page",depends_on:["backend"],
        resources:[scoped+"/files/"+files.frontend]},
      {id:"tests",agent_id:"test",title:"Controlled tests",
        description:"Run approved acceptance tests",depends_on:["frontend"],resources:[scoped]}
    ],
    requested_permissions:[
      {id:"branch-p",task_id:"branch",agent_id:"orchestrator",
        operation:"create_branch",resource:ROOT,reason:"Isolated workspace"},
      {id:"backend-p",task_id:"backend",agent_id:"backend",
        operation:"update_file",resource:scoped+"/files/"+files.backend,
        reason:"Approved backend file"},
      {id:"frontend-p",task_id:"frontend",agent_id:"frontend",
        operation:"update_file",resource:scoped+"/files/"+files.frontend,
        reason:"Approved frontend file"},
      {id:"test-p",task_id:"tests",agent_id:"test",
        operation:"run_tests",resource:scoped,reason:"Approved test profile"}
    ],assumptions:[],uncertainties:[]
  };
}
class DeterministicModel extends BaseLlm{
  requests=[];turn=0;tool;args;
  constructor(tool,args){
    super({model:"offline-scripted-adk-no-api"});
    this.tool=tool;this.args=args;
  }
  async *generateContentAsync(req){
    this.requests.push(req);this.turn++;
    if(this.turn===1)yield {content:{role:"model",parts:[{
      functionCall:{id:"offline-allowed-call",name:this.tool,args:this.args}
    }]}};
    else yield {content:{role:"model",parts:[{text:"Tool exchange concluded."}]}};
  }
  connect(){return Promise.reject(Error("External ADK model connections forbidden"));}
}
async function port(){
  const s=createServer();
  await new Promise((resolve,reject)=>{
    s.once("error",reject);s.listen(0,"127.0.0.1",resolve);
  });
  const n=s.address().port;
  await new Promise(resolve=>s.close(resolve));
  return n;
}
function json(data,status=200){
  return new Response(JSON.stringify(data),{
    status,headers:{"content-type":"application/json"}
  });
}
async function setup({wrongBackendPath=false}={}){
  const session="offline-adk-"+randomBytes(6).toString("hex");
  const approved=plan(session);
  const receipt=makeApproval(approved,{
    allowedOperations:new Set(RUST_OPERATIONS),
    decision_id:"three-agent-decision",approved_by:did,
    approved_at:"2026-10-21T18:00:00Z",
    approved_permission_ids:approved.requested_permissions.map(p=>p.id)
  });
  const dir=await mkdtemp(join(tmpdir(),"signed-adk-three-role-"));
  const {privateKey,publicKey}=generateKeyPairSync("ed25519");
  const keyId="offline-three-role-ed25519";
  const signed=signEngineerApproval({
    plan:approved,approval:receipt,engineerDid:did,keyId,
    privateKeyPem:privateKey.export({format:"pem",type:"pkcs8"}).toString(),
    issuedAt:new Date().toISOString(),
    expiresAt:new Date(Date.now()+20*60_000).toISOString()
  });
  await writeFile(join(dir,session+".json"),JSON.stringify(signed),{mode:0o600});
  const store=new SignedEngineerApprovalFileStore({
    directory:dir,engineerDid:did,
    trustedKeys:{[keyId]:{engineer_did:did,
      public_key_pem:publicKey.export({format:"pem",type:"spki"}).toString()}}
  });
  const authenticated=await store.loadAuthenticatedApproval(session);
  assert.equal(planDigest(authenticated.plan),planDigest(approved));
  assert.equal(authenticated.authenticated_engineer_did,did);
  const evidence=new Map();
  const bindings=new Map();
  const effects=new Map();
  const issued=new Map();
  const servers=[];
  let providerRevision=sha[0],phase="execution";
  const events=[];
  const perms=approved.requested_permissions.map(p=>({
    operation:p.operation,resource:p.resource
  }));
  const expectedFor=role=>approved.requested_permissions.find(p=>p.agent_id===role);
  const coordinator={
    get phase(){return phase;},
    async bindDispatchedTask(id,privateId,role){
      if(phase!=="execution")throw Error("Closed approved session");
      bindings.set(privateId,{id,role});
      events.push("bound:"+id);
    },
    async confirmTask(privateId,observation){
      const binding=bindings.get(privateId),effect=effects.get(privateId);
      if(!binding||!effect||observation.runtime_task_id!==privateId||
         observation.role!==binding.role||observation.state!=="completed"||
         (observation.artifact &&
          (effect.branch!==observation.artifact.branch||
           effect.commit_sha!==observation.artifact.commit_sha))){
        throw Error("Trusted Gateway corroboration denied Task completion");
      }
      if(binding.role==="backend"||binding.role==="frontend"){
        const a=observation.artifact;
        if(!a.files_modified.includes(files[binding.role])||
           a.test_outcome!=="not_run")throw Error("Uncorroborated file artifact");
      }
      if(binding.role==="test"){
        if(effect.tested_commit_sha!==observation.artifact.tested_commit_sha||
           observation.artifact.project_tests!=="pass"||
           observation.artifact.researcher_acceptance!=="pass"){
          throw Error("Uncorroborated Runner acceptance");
        }
      }
      events.push("confirmed:"+binding.id);
    },
    async closeExecution(){phase="closed";events.push("closed");}
  };
  const gatewaySimulatedFetch=async(url,init)=>{
    const path=String(url),body=JSON.parse(String(init.body));
    try{
      if(path.endsWith("/v1/presentations")){
        const c=issued.get(body.credential_id);
        if(!c||body.disclosed_permissions.some(p=>!c.permissions.some(q=>
          p.operation===q.operation&&p.resource===q.resource))){
          return json({error:"Invalid delegated VP scope"},403);
        }
        return json({signed_vp:"fixture-vp:"+body.credential_id+":"+body.challenge});
      }
      if(path.endsWith("/v1/authorization/prepare")){
        const b=bindings.get(body.task_id);
        const row=expectedFor(body.agent_role);
        const op=body.tool;
        const wanted=op==="run_tests"?scoped:
          scoped+"/files/"+body.arguments.path;
        if(!b||b.role!==body.agent_role||!row||row.task_id!==b.id||
           row.operation!==op||row.resource!==wanted||
           body.arguments.branch!==BRANCH||
           (op==="run_tests"&&body.arguments.profile!=="poc-default")){
          return json({error:"Approved plan blocked unauthorized tool"},403);
        }
        const request_id="req-"+randomBytes(8).toString("hex");
        const challenge=randomBytes(12).toString("hex");
        evidence.set(request_id,{
          body,challenge,permission:{operation:op,resource:wanted}
        });
        events.push("prepared:"+b.id);
        return json({request_id,audience:"offline-gateway",
          challenge,required_permission:{operation:op,resource:wanted},
          expires_at:new Date(Date.now()+60_000).toISOString()},201);
      }
      if(path.endsWith("/v1/authorization/execute")){
        const prepared=evidence.get(body.request_id);
        if(!prepared||!body.signed_vp.endsWith(":"+prepared.challenge)){
          return json({error:"Challenge-bound fake VP rejected"},403);
        }
        const b=bindings.get(prepared.body.task_id);
        const cid=body.signed_vp.slice("fixture-vp:".length,
          body.signed_vp.length-prepared.challenge.length-1);
        const cred=issued.get(cid);
        if(!cred||cred.role!==b.role||
           !cred.permissions.some(p=>p.resource===prepared.permission.resource&&
              p.operation===prepared.permission.operation)){
          return json({error:"Scoped child credential denied"},403);
        }
        evidence.delete(body.request_id);
        const {tool,arguments:args}=prepared.body;
        let effect;
        if(tool==="update_file"){
          if(args.path===files.backend&&providerRevision===sha[0]){
            providerRevision=sha[1];
          }else if(args.path===files.frontend&&providerRevision===sha[1]){
            providerRevision=sha[2];
          }else{return json({error:"Provider rejected missing predecessor"},409);}
          effect={provider:"gitea",performed:true,tool,branch:BRANCH,
            path:args.path,revision:providerRevision,commit_sha:providerRevision,
            blob_sha:"d".repeat(40),precondition_blob_sha:"e".repeat(40)};
        }else if(tool==="run_tests"&&providerRevision===sha[2]){
          effect={provider:"runner",performed:true,tool,branch:BRANCH,
            revision:providerRevision,tested_commit_sha:providerRevision,
            runner_profile:"poc-default",status:"pass",phases:[],
            project_tests:{status:"pass",phases:[]},
            researcher_acceptance:{phase:"researcher_acceptance",status:"pass"}};
        }else{return json({error:"Unavailable provider operation"},403);}
        effects.set(prepared.body.task_id,{
          ...effect,commit_sha:providerRevision
        });
        events.push("effect:"+b.id);
        return json({execution:effect});
      }
      return json({error:"Unknown offline route"},404);
    }catch{
      return json({error:"Safe simulated service failure"},503);
    }
  };
  const models={},baseUrls={};
  const specs={
    backend:{tool:"update_file",args:{
      branch:BRANCH,path:wrongBackendPath?files.frontend:files.backend,
      content:"export const backendApproved=true;"
    }},
    frontend:{tool:"update_file",args:{
      branch:BRANCH,path:files.frontend,
      content:"export const frontendApproved=true;"
    }},
    test:{tool:"run_tests",args:{branch:BRANCH,profile:"poc-default"}}
  };
  try{
    for(const role of roles){
      models[role]=new DeterministicModel(specs[role].tool,specs[role].args);
      const server=await startSpecializedAgentServer({
        role,port:await port(),host:"127.0.0.1",delegatedAuthorization:true,
        adk:{model:models[role],gatewayBaseUrl:"http://offline-gateway",
          adapterBaseUrl:"http://offline-adapter",adapterToken:"private-agent-token",
          fetchFn:gatewaySimulatedFetch,maxModelTurns:3,maxModelCallMs:5000}
      });
      servers.push(server);baseUrls[role]=server.baseUrl;
    }
    const roleRunner=new DelegatedA2ARoleRunner({
      authorityIssuer:{
        async issueSpecializedChild(input){
          const role=input.selection.role,found=expectedFor(role);
          assert.ok(found);
          assert.equal(input.approved_task_id,found.task_id);
          assert.equal(input.parent_credential_id,"urn:approved:root");
          const permissions=[{resource:found.resource,operation:found.operation}];
          issued.set(input.credential_id,{role,permissions});
          events.push("issued:"+role);
          return {role,credential:{"@context":["https://www.w3.org/ns/credentials/v2"],
            id:input.credential_id,issuer:"did:thesis:orchestrator",
            type:["VerifiableCredential","DelegationCredential"],
            validFrom:input.valid_from,
            credentialSubject:{sub:"did:thesis:"+role,per:permissions}}};
        }
      },
      a2a:new DeterministicA2AOrchestrator({
        deadlineMs:15_000,initialIntervalMs:25,maxIntervalMs:80
      })
    });
    const dispatcher=await TrustedApprovedA2ADispatcher.load({
      approvals:store,coordinator,roleRunner,
      sessionId:session,expectedPlanDigest:planDigest(approved),
      expectedEngineerDid:did,baseRevision:sha[0],
      agentBaseUrls:baseUrls,
      async authorityForTask(id,role){
        assert.equal(expectedFor(role)?.task_id,id);
        return {
          parent_credential_id:"urn:approved:root",
          credential_id:"urn:offline:child:"+session+":"+role,
          valid_from:new Date().toISOString(),validity_seconds:300,
          credential_status:{type:"BitstringStatusListEntry",
            statusPurpose:"revocation",statusListIndex:String(400+roles.indexOf(role)),
            statusListCredential:"https://status.example/offline"}
        };
      }
    });
    return {dispatcher,coordinator,events,models,
      get revision(){return providerRevision;},
      async createBranch(planTaskId,privateId){
        assert.equal(planTaskId,"branch");
        assert.ok(bindings.has(privateId));
        effects.set(privateId,{provider:"gitea",tool:"create_branch",
          branch:BRANCH,commit_sha:sha[0],performed:true});
        events.push("effect:branch");
      },
      async close(){
        for(const server of servers.reverse())await server.close();
        await rm(dir,{recursive:true,force:true});
      }
    };
  }catch(e){
    for(const server of servers.reverse()){
      try{await server.close();}catch{}
    }
    await rm(dir,{recursive:true,force:true});
    throw e;
  }
}
test("one signed immutable DAG drives Backend, Frontend and Test through real ADK + HTTP A2A SDK",async()=>{
  const h=await setup();
  try{
    const d=h.dispatcher;
    await assert.rejects(d.dispatch("frontend"),/dependencies/);
    assert.equal(h.events.length,0);
    const result=await d.executeApprovedDag({
      invokeOrchestratorTask:h.createBranch
    });
    assert.deepEqual(result.completed_task_ids,["branch","backend","frontend","tests"]);
    assert.deepEqual(result.specialized_results.map(x=>x.role),roles);
    assert.equal(h.revision,sha[2]);
    assert.equal(h.coordinator.phase,"closed");
    for(const role of roles){
      assert.equal(h.models[role].requests.length,2);
      const text=JSON.stringify(h.models[role].requests);
      assert.ok(!text.includes("private-agent-token"));
      assert.ok(!text.includes("urn:offline:child:"));
      assert.ok(!text.includes("delegation_evidence"));
    }
    for(const role of roles){
      assert.ok(h.events.indexOf("issued:"+role)>h.events.indexOf("bound:"+role));
      const planTaskId=role==="test"?"tests":role;
      assert.ok(h.events.indexOf("confirmed:"+planTaskId)>
        h.events.indexOf("effect:"+planTaskId));
    }
    assert.ok(h.events.indexOf("confirmed:backend")<h.events.indexOf("bound:frontend"));
    assert.ok(h.events.indexOf("confirmed:frontend")<h.events.indexOf("bound:tests"));
    assert.equal(h.events.at(-1),"closed");
  }finally{await h.close();}
});
test("ADK call outside approved Task scope fails closed before Frontend and Test A2A",async()=>{
  const h=await setup({wrongBackendPath:true});
  try{
    await assert.rejects(h.dispatcher.executeApprovedDag({
      invokeOrchestratorTask:h.createBranch
    }),/Protected A2A task ended without completion|ADK|failed/);
    assert.deepEqual(h.dispatcher.completedTaskIds,["branch"]);
    assert.equal(h.coordinator.phase,"closed");
    assert.ok(!h.events.includes("bound:frontend"));
    assert.ok(!h.events.includes("bound:tests"));
    assert.ok(!h.events.includes("effect:backend"));
  }finally{await h.close();}
});
