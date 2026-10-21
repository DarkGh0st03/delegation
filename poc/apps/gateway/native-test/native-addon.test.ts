import assert from "node:assert/strict";
import test from "node:test";
import {createRequire} from "node:module";
import {DirectCoreRustVerifier} from "../src/direct-core-verifier.ts";
import {loadDirectCoreRustVerifier} from "../src/direct-core-loader.ts";

const requireNative=createRequire(import.meta.url);
const native=requireNative("../src/native/delegation-core.node") as {
  assert_verification_ready():void;
  verify_verifiable_presentation(context:string,vp:string):Promise<string>;
};

test("Node loads a real compiled Rust addon with an asynchronous ABI",async()=>{
  assert.equal(typeof native.assert_verification_ready,"function");
  assert.equal(typeof native.verify_verifiable_presentation,"function");
  const promise=native.verify_verifiable_presentation("{}","header.payload.signature");
  assert.equal(typeof promise?.then,"function");
  await assert.rejects(promise,/Core Rust verification rejected/);
});

test("native mode refuses startup without public artifact and EVM source configuration",()=>{
  const names=[
    "CORE_RUST_RPC_URL","CORE_RUST_CHAIN_ID",
    "CORE_RUST_DID_REGISTRY_ADDRESS","CORE_RUST_ENTERPRISE_REGISTRY_ADDRESS",
    "CORE_RUST_ISSUER_REGISTRY_ADDRESS","CORE_RUST_PUBLIC_ARTIFACT_DIR",
    "CORE_RUST_DID_RESOLVER_SCRIPT"
  ];
  const prev=new Map(names.map(name=>[name,process.env[name]]));
  try{
    for(const name of names)delete process.env[name];
    assert.throws(native.assert_verification_ready,/config incomplete/);
    assert.throws(loadDirectCoreRustVerifier,/sources are not ready/);
  }finally{
    for(const name of names){
      const val=prev.get(name);
      if(val===undefined)delete process.env[name];else process.env[name]=val;
    }
  }
});

test("wrapper correctly rejects untrusted or empty inputs before calling native Rust",async()=>{
  const fake={
    verify_verifiable_presentation:async()=>{throw Error("must not reach native");}
  };
  const verifier=new DirectCoreRustVerifier(fake,{
    orchestrator:"did:thesis:orchestrator",
    backend:"did:thesis:backend",
    frontend:"did:thesis:frontend",
    test:"did:thesis:test"
  });
  await assert.rejects(verifier.verify({
    presenter:"backend",audience:"",challenge:"challenge",
    required_permission:{resource:"gitea://localhost/a",operation:"read_file"},
    signed_vp:"a.b.c"
  }));
});
