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
    (v:any)=>{v.skills.push({...v.skills[0],id:"untrusted-extra-skill"});},
    (v:any)=>{v.skills.push({...v.skills[0]});},
    (v:any)=>{v.capabilities.extensions[0].params.taskCapabilities=["run_tests"];},
    (v:any)=>{v.capabilities.extensions[0].params.taskCapabilities=["read_file","read_file"];},
    (v:any)=>{delete v.capabilities.extensions[0].params.taskCapabilities;},
    (v:any)=>{v.supportedInterfaces[0].protocolVersion="0.0";},
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

test("R379 verified Agent Card capability subset stays scoped to the declared role",async()=>{
 const endpoints={
  backend:"http://127.0.0.1:60001",frontend:"http://127.0.0.1:60002",
  test:"http://127.0.0.1:60003"
 };
 const profiles=await assertTrustedApprovedA2AStartup({endpoints,fetchFn:async url=>{
  const role=ROLES.find(role=>String(url)===endpoints[role]+"/.well-known/agent-card.json")!;
  const card=createSpecializedAgentCard(role,endpoints[role]);
  if(role==="backend")card.capabilities.extensions[0]!.params.taskCapabilities=["read_file"];
  return Response.json(card);
 }});
 assert.deepEqual(profiles.backend,{did:"did:thesis:backend-agent",capabilities:["read_file"]});
 assert.equal(profiles.frontend.capabilities.includes("run_tests"),false);
 assert.equal(profiles.test.capabilities.includes("run_tests"),true);
 assert.equal(Object.isFrozen(profiles.backend.capabilities),true);
});


test("R382.3 trusted startup probe matches each Agent Card to original native Rust role DID",async()=>{
 const names=["APPROVED_RUNNER_NATIVE_MCP","DELEGATION_GATEWAY_ARCHITECTURE",
  "ADAPTER_TRUST_PROFILE",...ROLES.map(role=>"ADAPTER_ID_"+role.toUpperCase())];
 const prior=new Map(names.map(name=>[name,process.env[name]]));
 try{
  process.env.APPROVED_RUNNER_NATIVE_MCP="1";
  process.env.DELEGATION_GATEWAY_ARCHITECTURE="authority-only";
  process.env.ADAPTER_TRUST_PROFILE="evm";
  const identities=Object.fromEntries(ROLES.map((role,i)=>[
   role,"did:ethr:0x7a69:0x"+String(i+2).padStart(40,"0")
  ])) as Record<typeof ROLES[number],string>;
  for(const role of ROLES)
   process.env["ADAPTER_ID_"+role.toUpperCase()]=identities[role];
  const endpoints={
   backend:"http://127.0.0.1:61001",frontend:"http://127.0.0.1:61002",
   test:"http://127.0.0.1:61003"
  };
  const roleFor=(url:string)=>ROLES.find(role=>
   url===endpoints[role]+"/.well-known/agent-card.json")!;
  let readCount=0;
  const goodFetch=async(raw:string|URL|Request)=>{
   const role=roleFor(String(raw));assert.ok(role);
   readCount++;
   return Response.json(createSpecializedAgentCard(role,endpoints[role],{
    capabilityProfile:"approved-plan",delegatedAuthorization:true,
    nativeSignerDid:identities[role]
   }));
  };
  const profiles=await assertTrustedApprovedA2AStartup({
   endpoints,fetchFn:goodFetch as typeof fetch
  });
  assert.equal(readCount,3,"one role-pinned Card probe per specialist");
  for(const role of ROLES)
   assert.equal(profiles[role].did,identities[role]);
  // R386: native Test cards publish create_file as discovery metadata,
  // but actual creation remains restricted to signed project-test sources
  // through the original Gateway/owner. Card forgery cannot expand scope.
  const nativeTestCard=createSpecializedAgentCard("test",endpoints.test,{
   nativeSignerDid:identities.test,capabilityProfile:"approved-plan",
   delegatedAuthorization:true
  });
  assert.deepEqual(nativeTestCard.capabilities.extensions?.[0]?.params?.taskCapabilities,
   ["read_file","update_file","create_file","run_tests"]);
  for(const role of ["backend","frontend"] as const){
   const card=createSpecializedAgentCard(role,endpoints[role],{
    nativeSignerDid:identities[role],capabilityProfile:"approved-plan"
   });
   assert.deepEqual(card.capabilities.extensions?.[0]?.params?.taskCapabilities,
    ["read_file","update_file","create_file"]);
  }
  await assert.rejects(assertTrustedApprovedA2AStartup({
   endpoints,fetchFn:(async(raw:string|URL|Request)=>{
    const role=roleFor(String(raw));
    const card=createSpecializedAgentCard(role,endpoints[role],{
     nativeSignerDid:identities[role]
    });
    if(role==="test")
     card.capabilities.extensions[0]!.params.taskCapabilities=
      ["read_file","update_file","create_file","delete_file","run_tests"];
    return Response.json(card);
   }) as typeof fetch
  }),/pinned localhost role-card verification denied/u);


  // A historical synthetic Card is not an alternative identity in the
  // same canonical Rust session, even when skill/capabilities still match.
  await assert.rejects(assertTrustedApprovedA2AStartup({
   endpoints,fetchFn:(async(raw:string|URL|Request)=>{
    const role=roleFor(String(raw));
    return Response.json(createSpecializedAgentCard(role,endpoints[role]));
   }) as typeof fetch
  }),/pinned localhost role-card verification denied/u);
  await assert.rejects(assertTrustedApprovedA2AStartup({
   endpoints,fetchFn:(async(raw:string|URL|Request)=>{
    const role=roleFor(String(raw));
    const card=createSpecializedAgentCard(role,endpoints[role],{
     nativeSignerDid:identities[role]
    });
    if(role==="backend")
     card.capabilities.extensions[0]!.params.agentDid=identities.frontend;
    return Response.json(card);
   }) as typeof fetch
  }),/pinned localhost role-card verification denied/u);
 }finally{
  for(const [k,v] of prior)
   if(v===undefined)delete process.env[k];
   else process.env[k]=v;
 }
});
