import test from "node:test";
import assert from "node:assert/strict";
import { GiteaClient } from "../src/gitea-client.ts";
import { GiteaReadOnlyExecutor } from "../src/gitea-read-executor.ts";
import { TrustedPlanningRevisions } from "../src/planning-revisions.ts";
import { InMemoryRequestStore, InMemoryAuditSink, prepareAuthorization } from "../src/prepare.ts";
import { executeAuthorization } from "../src/execute.ts";
import { GatewayError } from "../src/errors.ts";
import type {PolicyPort,VerifierPort} from "../src/types.ts";

const A="a".repeat(40), B="b".repeat(40);
const base="http://gitea:3000/api/v1/repos/thesis/iam-console-poc";
const repo={authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"};
const config={audience:"cloud-access-gateway",request_ttl_ms:120_000,repository:repo};
const response=(data:unknown)=>new Response(JSON.stringify(data),{status:200});
const taskId="session-pinned-1";
function fixture(){
  const urls:string[]=[];
  let movingSha=A;
  let now=1_800_000_000_000;
  const client=new GiteaClient({
    baseUrl:"http://gitea:3000",token:"gateway-secret",
    owner:"thesis",repository:"iam-console-poc",
    fetchFn:(async (url,init)=>{
      assert.equal((init?.headers as Record<string,string>).authorization,"token gateway-secret");
      const s=String(url);
      urls.push(s);
      if(s===base){
        return response({name:"iam-console-poc",owner:{login:"thesis"},
          default_branch:"main",full_name:"thesis/iam-console-poc"});
      }
      if(s===base+"/branches/main"){
        return response({name:"main",commit:{id:movingSha}});
      }
      const marker="?ref=";
      assert.ok(s.includes(marker),"content must be commit-pinned");
      const revision=s.split(marker)[1];
      assert.equal(revision,A,"Planning must read initial SHA, never moving main");
      if(s.startsWith(base+"/contents/apps/backend/user.ts?")){
        return response({
          type:"file",path:"apps/backend/user.ts",sha:"blob-from-"+revision,
          encoding:"base64",content:Buffer.from("const pinned = 'a';").toString("base64")
        });
      }
      if(s.startsWith(base+"/contents/apps/backend?")){
        return response([{type:"file",name:"user.ts",
          path:"apps/backend/user.ts",size:23}]);
      }
      if(s.startsWith(base+"/contents?")){
        return response([{type:"dir",name:"apps",path:"apps"}]);
      }
      throw Error("Unexpected Gitea request "+s);
    }) as typeof fetch
  });
  const revisions=new TrustedPlanningRevisions(client,{nowMs:()=>now});
  const store=new InMemoryRequestStore(),audit=new InMemoryAuditSink();
  let n=0,providerCalls=0;
  const executor=new GiteaReadOnlyExecutor(client);
  const verifier:VerifierPort={
    async verify(req){return {
      presenter_id:"did:thesis:orchestrator",
      credential_id:"urn:root:planning",issuer_id:"did:thesis:engineer",
      permissions:[req.required_permission],hierarchy_depth:1,
      expiration:"999999999999999999"
    };}
  };
  const policy:PolicyPort={
    async evaluate(input){
      assert.equal(input.pinned_revision,A);
      assert.equal(input.agent_role,"orchestrator");
      return {allow:true,policy_version:"phase6-ro-v1"};
    }
  };
  const prepare=(tool:string,args:Record<string,unknown>,agent_role="orchestrator",task_id=taskId)=>{
    return prepareAuthorization({task_id,agent_role,tool,arguments:args},
      config,{store,audit,planningRevisions:revisions,
        nowMs:()=>now,requestId:()=>"pin-"+(++n),challenge:()=>"nonce-"+n});
  };
  const execute=(id:string)=>executeAuthorization({
    request_id:id,signed_vp:"real-in-production-not-in-unit-test"
  },{store,audit,verifier,policy,repository:repo,
    executor:{
      provider:"gitea",
      async execute(record){providerCalls++;return executor.execute(record);}
    },planningRevisions:revisions,nowMs:()=>now});
  return {
    revisions,store,audit,urls,client,prepare,execute,
    moveMain(){movingSha=B;},
    advance(ms:number){now+=ms;},
    get providerCalls(){return providerCalls;}
  };
}

test("one trusted Gitea main SHA is reused for repository, directory and file after main moves",async()=>{
  const f=fixture();
  const started=await f.revisions.begin(taskId,600_000);
  assert.equal(started.base_revision,A);
  f.moveMain();
  const requests=[
    f.prepare("read_repository",{}),
    f.prepare("list_directory",{branch:"main",path:""}),
    f.prepare("list_directory",{branch:"main",path:"apps/backend"}),
    f.prepare("read_file",{branch:"main",path:"apps/backend/user.ts"})
  ];
  for(const p of requests){
    const record=f.store.get(p.request_id);
    assert.equal(record?.pinned_revision,A);
  }
  const results=await Promise.all(requests.map(p=>f.execute(p.request_id)));
  assert.deepEqual(results.map(x=>x.execution.tool),
    ["read_repository","list_directory","list_directory","read_file"]);
  assert.deepEqual(results.map(x=>(x.execution as {revision:string}).revision),
    [A,A,A,A]);
  assert.equal((results[3].execution as {content:string}).content,"const pinned = 'a';");
  assert.equal(f.urls.filter(u=>u.endsWith("/branches/main")).length,1);
  assert.equal(f.providerCalls,4);
  assert.ok(f.audit.events.filter(e=>e.event==="authorization_prepared")
    .every(e=>e.pinned_revision===A));
  assert.ok(f.audit.events.filter(e=>e.event==="authorization_executed")
    .every(e=>e.pinned_revision===A));
});

test("Gateway uses the same nonrenewable 45-minute provisional maximum as the Rust issuer",async()=>{
  const f=fixture();
  await assert.rejects(f.revisions.begin(taskId,2700001),
    (e:unknown)=>e instanceof GatewayError&&e.code==="invalid_planning_session");
  const pinned=await f.revisions.begin(taskId,2700000);
  assert.equal(pinned.base_revision,A);
  f.advance(2700000);
  assert.throws(()=>f.prepare("read_repository",{}),
    (e:unknown)=>e instanceof GatewayError&&e.code==="planning_session_required");
  assert.equal(f.store.size(),0);
});

test("without registered trusted session, main Planning reads fail before preparing challenges",()=>{
  const f=fixture();
  for(const [tool,arguments_]of [
    ["read_repository",{}],
    ["list_directory",{branch:"main",path:""}],
    ["read_file",{branch:"main",path:"README.md"}]
  ] as const){
    assert.throws(()=>f.prepare(tool,arguments_ as Record<string,unknown>),
      (e:unknown)=>e instanceof GatewayError&&e.code==="planning_session_required");
  }
  assert.equal(f.store.size(),0);
  assert.equal(f.urls.length,0);
});

test("model cannot choose base_revision, ref, extra authority or another branch",async()=>{
  const f=fixture();
  await f.revisions.begin(taskId,600_000);
  for(const [tool,args]of [
    ["read_file",{branch:"main",path:"README.md",revision:B}],
    ["list_directory",{branch:"main",path:"",base_revision:B}],
    ["read_repository",{ref:B}],
    ["read_file",{branch:B,path:"README.md"}],
    ["list_directory",{branch:"feature/other",path:""}],
    ["update_file",{branch:"feature/other",path:"README.md",content:"malicious"}],
    ["run_tests",{branch:"feature/other",profile:"poc-default"}]
  ] as const)assert.throws(()=>f.prepare(tool,args as Record<string,unknown>));
  assert.equal(f.store.size(),0);
});

test("stopped/expired sessions block prepared requests before provider I/O",async()=>{
  for(const reason of ["ended","expired"]){
    const f=fixture();
    await f.revisions.begin(taskId,1000);
    const p=f.prepare("read_file",{branch:"main",path:"apps/backend/user.ts"});
    if(reason==="ended")f.revisions.end(taskId);else f.advance(1001);
    await assert.rejects(f.execute(p.request_id),
      (e:unknown)=>e instanceof GatewayError&&e.code==="planning_revision_invalid");
    assert.equal(f.providerCalls,0);
    await assert.rejects(f.execute(p.request_id),/already consumed/);
  }
});

test("Gitea registration rejects malformed SHA, duplicate sessions and long TTL",async()=>{
  const a=fixture();
  await assert.rejects(a.revisions.begin(taskId,900_001),/Invalid trusted Planning session/);
  const promise=a.revisions.begin(taskId,1000);
  await assert.rejects(a.revisions.begin(taskId,1000),
    (e:unknown)=>e instanceof GatewayError&&e.code==="planning_session_exists");
  await promise;
  await assert.rejects(a.revisions.begin(taskId,1000),/already registered/);
  const badClient={
    async readRepository(){return {full_name:"thesis/iam-console-poc",
      default_branch:"main",revision:"not-a-sha"};}
  };
  const bad=new TrustedPlanningRevisions(badClient);
  await assert.rejects(bad.begin("other",1000),
    (e:unknown)=>e instanceof GatewayError&&e.code==="planning_revision_unavailable");
});

test("session end during VP/OPA checks denies before provider I/O",async()=>{
  const f=fixture();
  await f.revisions.begin(taskId,60_000);
  const p=f.prepare("read_file",{branch:"main",path:"apps/backend/user.ts"});
  let release!:(value:{allow:boolean;policy_version:string})=>void;
  let started!:()=>void;
  const inside=new Promise<void>(resolve=>{started=resolve;});
  const gate=new Promise<{allow:boolean;policy_version:string}>(resolve=>{release=resolve});
  const promise=executeAuthorization({
    request_id:p.request_id,signed_vp:"signed"
  },{store:f.store,audit:f.audit,planningRevisions:f.revisions,repository:repo,
    verifier:{async verify(req){return {
      presenter_id:"did:thesis:orchestrator",credential_id:"vc",
      issuer_id:"engineer",permissions:[req.required_permission],hierarchy_depth:1,
      expiration:"9999999999"};}},
    policy:{async evaluate(){started();return gate;}},
    executor:{provider:"gitea",async execute(){throw Error("Provider must not be called");}}});
  await inside;
  f.revisions.end(taskId);
  release({allow:true,policy_version:"opa"});
  await assert.rejects(promise,/Planning revision not active/);
  assert.equal(f.providerCalls,0);
});
