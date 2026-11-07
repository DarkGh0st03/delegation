import test from "node:test";
import assert from "node:assert/strict";
import {createOwnerPrivateInterprocessMcpSession}
 from "../src/owner-private-crypto-stdio.ts";

test("R381.0 separate-process MCP broker ACKs once; Rust callback stays in owner",async()=>{
  let effects=0;
  const privateCredential=Object.freeze({
    id:"PRIVATE_ORIGINAL_OWNER_DC_DO_NOT_EXPOSE",
    credentialSubject:{per:[{operation:"read_file",resource:"gitea://private"}]}
  });
  const s=createOwnerPrivateInterprocessMcpSession("child_issue",async()=>{
    effects++;
    return privateCredential;
  });
  const result=await s.invokeOnce();
  assert.equal(result,privateCredential);
  assert.equal(effects,1);
  await assert.rejects(s.invokeOnce(),/child issuance unavailable/u);
  assert.equal(effects,1);
  await s.close();
});

test("R381.0 interprocess MCP supports separate root and presentation tools without sharing secrets",async()=>{
  for(const operation of ["root_issue","root_revoke",
    "presentation_create"] as const){
    let calls=0;
    const privateResult={secret:"PRIVATE_SIGNED_VP_OR_ROOT_SECRET"};
    const s=createOwnerPrivateInterprocessMcpSession(operation,async()=>{
      calls++;
      return privateResult;
    });
    assert.equal(await s.invokeOnce(),privateResult);
    assert.equal(calls,1);
    await assert.rejects(s.invokeOnce(),/unavailable/u);
  }
});

test("R381.0 close-before-MCP-connect and invalid roles never invoke signer",async()=>{
  let effects=0;
  const s=createOwnerPrivateInterprocessMcpSession("child_issue",async()=>{
    effects++;return "PRIVATE";
  });
  await s.close();
  await assert.rejects(s.invokeOnce(),/child issuance unavailable/u);
  assert.equal(effects,0);
  assert.throws(()=>createOwnerPrivateInterprocessMcpSession(
    "unrecognized_role" as never,async()=>1),/operation unavailable/u);
});

test("R381.0 signer failure is private and never retried after interprocess ACK",async()=>{
  let effects=0;
  const s=createOwnerPrivateInterprocessMcpSession("presentation_create",async()=>{
    effects++;
    throw Error("PRIVATE_NATIVE_RUST_SIGNING_KEY_LEAK");
  });
  await assert.rejects(s.invokeOnce(),error=>{
    assert.doesNotMatch(String(error),/PRIVATE_NATIVE_RUST_SIGNING_KEY_LEAK/u);
    return /Owner-private MCP presentation unavailable/u.test(String(error));
  });
  assert.equal(effects,1);
  await assert.rejects(s.invokeOnce());
  assert.equal(effects,1);
});

test("R381.0 two concurrent calls cannot create a second MCP or credential effect",async()=>{
  let effects=0;
  const s=createOwnerPrivateInterprocessMcpSession("child_issue",async()=>{
    effects++;
    return "signed-original";
  });
  const first=s.invokeOnce();
  await assert.rejects(s.invokeOnce(),/child issuance unavailable/u);
  assert.equal(await first,"signed-original");
  assert.equal(effects,1);
});
