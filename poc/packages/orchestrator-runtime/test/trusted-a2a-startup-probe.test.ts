import test from "node:test";
import assert from "node:assert/strict";
import {randomInt} from "node:crypto";
import {startSpecializedAgentServer} from "../../agent-runtime/src/server.ts";
import {createSpecializedAgentCard} from "../../agent-runtime/src/cards.ts";
import {assertTrustedApprovedA2AStartup}
  from "../src/trusted-a2a-startup-probe.ts";

const ROLES=["backend","frontend","test"] as const;
async function withRealRoles(
  action:(input:{endpoints:Record<typeof ROLES[number],string>;
                servers:Awaited<ReturnType<typeof startSpecializedAgentServer>>[]})=>Promise<void>,
  overrides:Partial<Record<typeof ROLES[number],{
    delegatedAuthorization?:boolean;capabilityProfile?:"legacy"|"approved-plan";
  }>>={}
){
  const base=42000+randomInt(0,5000)*3;
  const servers:Awaited<ReturnType<typeof startSpecializedAgentServer>>[]=[];
  try{
    for(let i=0;i<ROLES.length;i++){
      const role=ROLES[i]!;
      servers.push(await startSpecializedAgentServer({
        role,host:"127.0.0.1",port:base+i,
        delegatedAuthorization:
          overrides[role]?.delegatedAuthorization??true,
        capabilityProfile:overrides[role]?.capabilityProfile??"approved-plan",
        taskHandler:async()=>{throw Error("readiness must not execute a Task");}
      }));
    }
    const endpoints=Object.fromEntries(
      servers.map(server=>[server.role,server.baseUrl])
    ) as Record<typeof ROLES[number],string>;
    await action({servers,endpoints});
    assert.deepEqual(servers.map(server=>server.executor.executionCount),
      [0,0,0]);
  }finally{
    await Promise.allSettled(servers.map(server=>server.close()));
  }
}

test("R5 only genuine, distinct localhost delegated A2A HTTP Agent Cards are ready",async()=>{
  await withRealRoles(async({endpoints})=>{
    await assertTrustedApprovedA2AStartup({endpoints});
  });
});

test("R5 swapped Agent Card identities fail without sending protected Tasks",async()=>{
  await withRealRoles(async({endpoints})=>{
    await assert.rejects(assertTrustedApprovedA2AStartup({
      endpoints:{...endpoints,backend:endpoints.frontend,
        frontend:endpoints.backend}
    }),/pinned localhost role-card verification denied/);
  });
});

test("R5 unsigned/non-delegated Agent Card cannot impersonate a trusted role",async()=>{
  await withRealRoles(async({endpoints})=>{
    await assert.rejects(assertTrustedApprovedA2AStartup({endpoints}),
      /pinned localhost role-card verification denied/);
  },{frontend:{delegatedAuthorization:false}});
});

test("R5 private Agent Card readiness rejects noncanonical or duplicate endpoints without network",async()=>{
  await withRealRoles(async({endpoints})=>{
    let fetchCalls=0;
    const fetchFn=async()=>{
      fetchCalls++;
      throw Error("no call permitted");
    };
    const invalid=[
      {...endpoints,backend:"http://localhost:8080"},
      {...endpoints,backend:"http://127.0.0.1:8080@attacker.invalid"},
      {...endpoints,backend:"http://127.0.0.1:65536"},
      {...endpoints,backend:"https://127.0.0.1:8443"},
      {...endpoints,backend:"http://127.0.0.1:8080/attacker"},
      {...endpoints,backend:endpoints.frontend}
    ];
    for(const bad of invalid){
      await assert.rejects(assertTrustedApprovedA2AStartup({
        endpoints:bad,fetchFn:fetchFn as any
      }),/pinned localhost role-card verification denied/);
    }
    assert.equal(fetchCalls,0);
  });
});

test("R5 role card profile and advertised private transport cannot be downgraded",async()=>{
  const endpoints={
    backend:"http://127.0.0.1:60001",
    frontend:"http://127.0.0.1:60002",
    test:"http://127.0.0.1:60003"
  };
  const forge=(role:typeof ROLES[number])=>{
    const card=createSpecializedAgentCard(role,endpoints[role],{
      capabilityProfile:"approved-plan",delegatedAuthorization:true
    });
    return card;
  };
  const cases=[
    (v:any)=>{v.capabilities.extensions=[];},
    (v:any)=>{v.supportedInterfaces[0].url="http://localhost:9000/a2a/rest";},
    (v:any)=>{v.capabilities.extensions[0].params.agentDid="did:attacker";},
    (v:any)=>{v.skills[0].id="unsupported-tool";},
    (v:any)=>{v.supportedInterfaces[0].protocolBinding="gRPC";}
  ];
  for(const mutate of cases){
    const fakeFetch=async(url:string|URL|Request)=>{
      const role=ROLES.find(role=>String(url).includes(endpoints[role]))!;
      assert.ok(role);
      const card=forge(role);
      if(role==="backend")mutate(card);
      return new Response(JSON.stringify(card),{
        headers:{"content-type":"application/json"},status:200
      });
    };
    await assert.rejects(assertTrustedApprovedA2AStartup({
      endpoints,fetchFn:fakeFetch as typeof fetch
    }),/pinned localhost role-card verification denied/);
  }
});
