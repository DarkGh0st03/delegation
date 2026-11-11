import test from "node:test";
import assert from "node:assert/strict";
import {createTrustedRemoteDiscoveryOwnerBindings} from
 "../src/trusted-remote-discovery-owner-bindings.ts";

test("R151.49 owner refuses a forged issuer/handoff or unpaired private source",()=>{
 const cases=[null,{},{
  issuer:{issueSpecializedChild:async()=>{}},handoff:{dispatchIssuedChild:async()=>{}},
  issueInput:{selection:{role:"backend"}}
 }];
 for(const config of cases)
  assert.throws(()=>createTrustedRemoteDiscoveryOwnerBindings(
   config as Parameters<typeof createTrustedRemoteDiscoveryOwnerBindings>[0]
  ),/Trusted remote discovery owner binding NO-GO/);
});


test("R151.51 late assembly requires exact Backend selection before any transport",async()=>{
 const {assembleTrustedRemoteDiscoveryOwner}=await import("../src/trusted-remote-discovery-owner-assembly.ts");
 let calls=0;
 const transport=async()=>{calls++;throw Error("transport must not run");};
 for(const issueInput of [undefined,{},
  {selection:{role:"frontend"},approved_task_id:"discovery"},
  {selection:{role:"backend"},approved_task_id:"foreign-task"}
 ]){
  await assert.rejects(assembleTrustedRemoteDiscoveryOwner({
   discoveryTaskId:"discovery",issueInput,fetchFn:transport,
   a2a:{sendProtectedTask:transport}
  } as never,{} as never),/one exact Backend Task/);
 }
 // Extra authority-shaped fields in operator ports cannot replace the
 // trusted context; a structural coordinator is rejected before issuer IPC.
 await assert.rejects(assembleTrustedRemoteDiscoveryOwner({
  discoveryTaskId:"discovery",
  issueInput:{selection:{role:"backend"},approved_task_id:"discovery"},
  coordinator:{phase:"execution"},gateway:{},intake:{},
  fetchFn:transport,a2a:{sendProtectedTask:transport}
 } as never,{} as never),/live Gateway, pinned read and A2A transport required/);
 assert.equal(calls,0);
});
