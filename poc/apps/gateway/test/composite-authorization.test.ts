import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryCompositeStore,
  prepareCompositeAuthorization,
  verifyCompositeAuthorization,
  prepareReadCompositeAuthorization,
  executeReadCompositeAuthorization
} from "../src/composite-authorization.ts";
import { InMemoryAuditSink } from "../src/prepare.ts";
import { GatewayRuntime } from "../src/runtime.ts";
import { createGatewayHttpServer } from "../src/http.ts";
import { VerificationRejectedError, VerificationUnavailableError } from "../src/errors.ts";
import type {
  MultipleVerificationRequest, PolicyInput, PolicyPort, VerifierPort,
  VerifiedDelegation, ExecutionPort
} from "../src/types.ts";

const config={
  audience:"cloud-access-gateway",
  request_ttl_ms:120_000,
  repository:{authority:"gitea.local",owner:"thesis",repository:"iam-console-poc"}
};
const now=1_800_000_000_000;
const request={
  task_id:"backend-task",
  agent_role:"backend",
  actions:[
    {tool:"read_file",arguments:{branch:"feature/demo",path:"apps/backend/src/app.ts"}},
    {tool:"update_file",arguments:{branch:"feature/demo",path:"apps/backend/src/app.ts",
      content:"updated"}}
  ]
};
const authorization=(request_id:string)=>({request_id,signed_vp:"signed.jwt.payload"});
class Verifier implements VerifierPort {
  readonly calls:MultipleVerificationRequest[]=[];
  async verify():Promise<VerifiedDelegation>{throw Error("Legacy verification must not be used");}
  async verifyMultiple(input:MultipleVerificationRequest):Promise<VerifiedDelegation> {
    this.calls.push(input);
    return {
      presenter_id:"did:thesis:backend",
      credential_id:"urn:credential:backend",issuer_id:"did:thesis:orchestrator",
      permissions:input.required_permissions,
      hierarchy_depth:1,expiration:"9999999999999999999999"
    };
  }
}
class Policy implements PolicyPort {
  readonly calls:PolicyInput[]=[];
  decision:(index:number)=>boolean =()=>true;
  async evaluate(input:PolicyInput){
    this.calls.push(input);
    return {allow:this.decision(this.calls.length),policy_version:"offline-policy-v1"};
  }
}
function fixture(verifier:VerifierPort=new Verifier(), policy:PolicyPort=new Policy()){
  const store=new InMemoryCompositeStore();
  const audit=new InMemoryAuditSink();
  let counter=0;
  const deps={
    config,store,audit,verifier,policy,
    nowMs:()=>now,requestId:()=> "c-"+(++counter),challenge:()=> "challenge-"+counter
  };
  return {deps,store,audit};
}
async function rejected(p:Promise<unknown>,status:number,code:string){
  await assert.rejects(p,(error:unknown)=>
    error instanceof Error && "statusCode" in error && "code" in error &&
    error.statusCode===status && error.code===code);
}

test("composite prepare binds two Gateway-derived permissions to one challenge",async()=>{
  const {deps,store,audit}=fixture();
  const result=prepareCompositeAuthorization(request,deps);
  assert.equal(result.authorization_only,true);
  assert.equal(result.required_permissions.length,2);
  assert.deepEqual(result.required_permissions.map(x=>x.operation),["read_file","update_file"]);
  assert.equal(result.required_permissions[0].resource,result.required_permissions[1].resource);
  assert.equal(result.challenge,"challenge-1");
  assert.equal(store.size(),1);
  assert.equal(audit.events[0].event,"composite_authorization_prepared");
  assert.equal(audit.events[0].provider_result,"not_called");
});

test("all VP and OPA permissions must pass, one outcome only, no provider",async()=>{
  const verifier=new Verifier(),policy=new Policy();
  const {deps,audit}=fixture(verifier,policy);
  const p=prepareCompositeAuthorization(request,deps);
  const result=await verifyCompositeAuthorization(authorization(p.request_id),deps);
  assert.equal(result.decision,"allow");
  assert.equal(result.authorization_only,true);
  assert.equal(result.policies.length,2);
  assert.equal(verifier.calls.length,1);
  assert.deepEqual(verifier.calls[0].required_permissions,p.required_permissions);
  assert.equal(policy.calls.length,2);
  assert.deepEqual(policy.calls.map(x=>x.required_permission),p.required_permissions);
  assert.equal(audit.events.at(-1)?.event,"composite_authorization_verified");
  assert.equal(audit.events.at(-1)?.decision,"allow");
  assert.equal(audit.events.at(-1)?.provider_result,"not_called");
  await rejected(verifyCompositeAuthorization(authorization(p.request_id),deps),
    409,"replay_detected");
});

test("one missing VP permission rejects whole bundle before OPA",async()=>{
  const verifier:VerifierPort={
    async verify(){throw Error("old route")},
    async verifyMultiple(r){
      return {presenter_id:"did:thesis:backend",credential_id:"c",issuer_id:"i",
        permissions:[r.required_permissions[0]],hierarchy_depth:1,expiration:999999999999};
    }
  };
  const policy=new Policy(), {deps,audit}=fixture(verifier,policy);
  const p=prepareCompositeAuthorization(request,deps);
  await rejected(verifyCompositeAuthorization(authorization(p.request_id),deps),
    503,"verifier_unavailable");
  assert.equal(policy.calls.length,0);
  assert.equal(audit.events.at(-1)?.decision,"deny");
});

test("a real verifier rejection denies all without consulting OPA",async()=>{
  const verifier:VerifierPort={
    async verify(){throw Error("legacy")},
    async verifyMultiple(){throw new VerificationRejectedError("write_file undisclosed");}
  };
  const policy=new Policy(),{deps}=fixture(verifier,policy);
  const p=prepareCompositeAuthorization(request,deps);
  await rejected(verifyCompositeAuthorization(authorization(p.request_id),deps),
    403,"verification_rejected");
  assert.equal(policy.calls.length,0);
});

test("OPA denial of second action rejects entire bundle",async()=>{
  const policy=new Policy();policy.decision=(index)=>index===1;
  const {deps,audit}=fixture(new Verifier(),policy);
  const p=prepareCompositeAuthorization(request,deps);
  await rejected(verifyCompositeAuthorization(authorization(p.request_id),deps),403,"policy_denied");
  assert.equal(policy.calls.length,2);
  assert.equal(audit.events.at(-1)?.provider_result,"not_called");
});

test("OPA unavailable/invalid and verifier unavailable fail closed",async()=>{
  for(const policy of [
    {async evaluate(){throw Error("OPA down");}},
    {async evaluate(){return {allow:"yes",policy_version:"x"};}}
  ]){
    const {deps}=fixture(new Verifier(),policy as PolicyPort);
    const p=prepareCompositeAuthorization(request,deps);
    await rejected(verifyCompositeAuthorization(authorization(p.request_id),deps),
      503,"policy_unavailable");
  }
  const missingVerifier:VerifierPort={async verify(){throw Error("old")} };
  const {deps}=fixture(missingVerifier,new Policy());
  const p=prepareCompositeAuthorization(request,deps);
  await rejected(verifyCompositeAuthorization(authorization(p.request_id),deps),
    503,"verifier_unavailable");
});

test("composite cannot contain user-selected permissions, duplicate scopes or unimplemented tools",()=>{
  const {deps,store}=fixture();
  const attack=[
    {...request,required_permissions:[{resource:"gitea://attacker/repo",operation:"update_file"}]},
    {...request,actions:[...request.actions,{...request.actions[0]}]},
    {...request,actions:[request.actions[0]]},
    {...request,actions:[request.actions[0],{tool:"delete_file",arguments:{}}]},
    {...request,actions:[request.actions[0],{tool:"read_file",arguments:{
      branch:"feature/demo",path:"../private.key"}}]}
  ];
  for(const input of attack){
    assert.throws(()=>prepareCompositeAuthorization(input,deps));
  }
  assert.equal(store.size(),0);
});

test("expired composite request is consumed and cannot be replayed",async()=>{
  const {deps}=fixture();
  const p=prepareCompositeAuthorization(request,deps);
  deps.nowMs=()=>now+config.request_ttl_ms;
  await rejected(verifyCompositeAuthorization(authorization(p.request_id),deps),
    410,"expired_request");
  await rejected(verifyCompositeAuthorization(authorization(p.request_id),deps),
    409,"replay_detected");
});

test("HTTP composite verification checks two policies, never invokes provider",async()=>{
  const verifier=new Verifier(),policy=new Policy();
  let performed=0;
  const executor:ExecutionPort={
    provider:"mock",
    async execute(){performed++;throw Error("composite must never reach provider");}
  };
  const runtime=new GatewayRuntime({
    bind_host:"127.0.0.1",bind_port:0,prepare:config,
    adapter_url:"http://unused",adapter_gateway_token:"unused",
    opa_url:"http://unused",opa_timeout_ms:1000,provider_mode:"mock",gitea_timeout_ms:1000
  },{verifier,policy,executor,audit:new InMemoryAuditSink()});
  const server=createGatewayHttpServer(runtime);
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try{
    const a=server.address();assert.ok(a && typeof a==="object");
    const base="http://127.0.0.1:"+a.port;
    const post=async(path:string,body:unknown)=>{
      const response=await fetch(base+path,{
        method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)
      });
      return {status:response.status,body:await response.json()};
    };
    const prepared=await post("/v1/authorization/prepare-composite",request);
    assert.equal(prepared.status,201);
    assert.equal(prepared.body.authorization_only,true);
    const verified=await post("/v1/authorization/verify-composite",authorization(prepared.body.request_id));
    assert.equal(verified.status,200);
    assert.equal(verified.body.decision,"allow");
    assert.equal(verified.body.authorization_only,true);
    assert.equal(verified.body.policies.length,2);
    assert.equal(performed,0);
    const replay=await post("/v1/authorization/verify-composite",authorization(prepared.body.request_id));
    assert.equal(replay.status,409);
  }finally{
    await new Promise<void>((resolve,reject)=>
      server.close(error=>error?reject(error):resolve()));
  }
});

test("R158 approved read composite executes two pinned Gateway reads only after multi-VP and OPA",async()=>{
 const verifier=new Verifier(),policy=new Policy(),audit=new InMemoryAuditSink();
 const calls:unknown[]=[],events:unknown[]=[];
 const pinned="a".repeat(40);
 const binding={
  authorizePrepare(_task:string,_role:string,_permission:unknown,req:{arguments:{branch:string}}){
   assert.equal(req.arguments.branch,"feature/demo");
   return {plan_digest:"b".repeat(64),plan_task_id:"approved-read",
     work_branch:"feature/demo"};
  },
  assertAuthorizedForExecution(rec:{approved_plan_digest:string;pinned_revision:string}){
   assert.equal(rec.approved_plan_digest,"b".repeat(64));
   assert.equal(rec.pinned_revision,pinned);
  },
  beginProviderEffect(){events.push("begin");return ()=>events.push("end");},
  recordProviderSuccess(rec:{request_id:string},result:unknown){
   events.push(["record",rec.request_id,result]);
  }
 };
 const executor:ExecutionPort={
  provider:"gitea",
  async resolveReadRevision(branch){assert.equal(branch,"feature/demo");return pinned;},
  async execute(record){
   calls.push(record);
   assert.equal(record.pinned_revision,pinned);
   const req=record.request;
   assert.equal(req.tool,"read_file");
   const path=req.arguments.path;
   return {provider:"gitea",performed:true,tool:"read_file",
    branch:"feature/demo",path,revision:pinned,blob_sha:"c".repeat(40),
    last_commit_sha:pinned,size:5,encoding:"utf-8",content:"hello"};
  }
 };
 const rt=new GatewayRuntime({
  bind_host:"127.0.0.1",bind_port:0,prepare:config,
  adapter_url:"http://unused",adapter_gateway_token:"unused",
  opa_url:"http://unused",opa_timeout_ms:1000,provider_mode:"mock",
  gitea_timeout_ms:1000
 },{verifier,policy,executor,audit,approvedPlans:binding as never});
 const input={task_id:"backend-task",agent_role:"backend",actions:[
  {tool:"read_file",arguments:{branch:"feature/demo",path:"src/one.ts"}},
  {tool:"read_file",arguments:{branch:"feature/demo",path:"src/two.ts"}}
 ]};
 const prepared=await rt.prepareReadComposite(input);
 assert.equal(prepared.authorization_only,false);
 assert.equal(prepared.pinned_revision,pinned);
 assert.equal(calls.length,0);
 await rejected(rt.verifyComposite(authorization(prepared.request_id)),403,
  "composite_mode_denied");
 const result=await rt.executeReadComposite(authorization(prepared.request_id));
 assert.equal(result.executions.length,2);
 assert.deepEqual(result.executions.map(x=>x.tool),["read_file","read_file"]);
 assert.equal(verifier.calls.length,1);
 assert.deepEqual(verifier.calls[0].required_permissions,
  prepared.required_permissions);
 assert.equal(policy.calls.length,2);
 assert.equal(calls.length,2);
 assert.deepEqual(events.map(x=>Array.isArray(x)?x[0]:x),
  ["begin","record","record","end"]);
 assert.equal(audit.events.at(-1)?.event,"composite_read_executed");
 assert.equal(audit.events.at(-1)?.provider_result,"success");
 await rejected(rt.executeReadComposite(authorization(prepared.request_id)),
  409,"replay_detected");
});

test("R158 read composites reject unsigned scopes, writes and mixed branches before provider I/O",async()=>{
 const {deps}=fixture();
 const ops={...deps,executor:{
  provider:"gitea",async resolveReadRevision(){return "a".repeat(40);},
  async execute(){throw Error("Must not read unapproved resources");}
 } as ExecutionPort};
 const good={task_id:"backend-task",agent_role:"backend",actions:[
  {tool:"read_file",arguments:{branch:"feature/demo",path:"src/one.ts"}},
  {tool:"read_file",arguments:{branch:"feature/demo",path:"src/two.ts"}}
 ]};
 await rejected(prepareReadCompositeAuthorization(good,ops),403,
  "composite_trusted_binding_required");
 await rejected(prepareReadCompositeAuthorization({...good,actions:[
  ...good.actions.slice(0,1),{tool:"update_file",
   arguments:{branch:"feature/demo",path:"src/two.ts",content:"x"}}
 ]},ops),403,"composite_read_only");
 await rejected(prepareReadCompositeAuthorization({...good,actions:[
  good.actions[0],{tool:"read_file",arguments:{
   branch:"feature/other",path:"src/two.ts"}}
 ]},ops),403,"composite_branch_mismatch");
});

test("R158 OPA second permission denial produces zero read effects",async()=>{
 const policy=new Policy();policy.decision=(i)=>i===1;
 const {deps}=fixture(new Verifier(),policy);
 let performed=0;
 const obj={...deps,approvedPlans:{
  authorizePrepare(){return {plan_digest:"d".repeat(64),
    plan_task_id:"one",work_branch:"feature/demo"};},
  assertAuthorizedForExecution(){},
  beginProviderEffect(){throw Error("Forbidden before OPA");},
  recordProviderSuccess(){throw Error("Must not be called");}
 } as never,executor:{provider:"gitea",
  async resolveReadRevision(){return "a".repeat(40);},
  async execute(){performed++;throw Error("must not read");}
 } as ExecutionPort};
 const input={task_id:"backend-task",agent_role:"backend",actions:[
  {tool:"read_file",arguments:{branch:"feature/demo",path:"src/a.ts"}},
  {tool:"read_file",arguments:{branch:"feature/demo",path:"src/b.ts"}}
 ]};
 const prepared=await prepareReadCompositeAuthorization(input,obj);
 await rejected(executeReadCompositeAuthorization(
  authorization(prepared.request_id),obj),403,"policy_denied");
 assert.equal(performed,0);
});
