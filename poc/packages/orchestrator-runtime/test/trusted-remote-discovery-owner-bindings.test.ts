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
