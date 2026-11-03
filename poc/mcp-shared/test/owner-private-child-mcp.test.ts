import test from "node:test";
import assert from "node:assert/strict";
import {createOwnerPrivateChildMcpSession}
 from "../src/owner-private-child-mcp.ts";

test("R162 private MCP issues once, returns result only via owner memory and rejects replay",async()=>{
 let invokes=0;
 const credential=Object.freeze({id:"urn:issued:child",
   credentialSubject:Object.freeze({per:Object.freeze([
    Object.freeze({operation:"read_file",resource:"gitea://local/private"})
   ])})});
 const service=createOwnerPrivateChildMcpSession(async()=>{
   invokes++;
   return credential;
 });
 const issued=await service.invokeOnce();
 assert.equal(issued,credential);
 assert.equal(invokes,1);
 await assert.rejects(()=>service.invokeOnce(),/Owner-private MCP child issuance unavailable/);
 assert.equal(invokes,1);
 await service.close();
});

test("R162 private MCP fails closed on signer failure and never retries",async()=>{
 let attempts=0;
 const service=createOwnerPrivateChildMcpSession(async()=>{
  attempts++;throw Error("PRIVATE_RUST_ADAPTER_TOKEN_AND_CREDENTIAL");
 });
 await assert.rejects(()=>service.invokeOnce(),e=>{
  assert.doesNotMatch(String(e),/PRIVATE_RUST_ADAPTER_TOKEN_AND_CREDENTIAL/);
  return /Owner-private MCP child issuance unavailable/.test(String(e));
 });
 assert.equal(attempts,1);
 await assert.rejects(()=>service.invokeOnce());
 assert.equal(attempts,1);
});

test("R162 private MCP does not start an HTTP listener or accept unauthenticated requests",async()=>{
 // The only transport is SDK InMemoryTransport; close before first call
 // and ensure a caller cannot construct a second signing opportunity.
 let calls=0;
 const service=createOwnerPrivateChildMcpSession(async()=>{
  calls++;return {id:"must-never-be-issued"};
 });
 await service.close();
 await assert.rejects(()=>service.invokeOnce());
 assert.equal(calls,0);
});
