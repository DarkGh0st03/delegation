import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const root=new URL("../../../",import.meta.url);
const read=path=>readFileSync(new URL(path,root),"utf8");

test("R241 both live Engineer-owned workflows provision public Rust artifact tree for independent Gateway",()=>{
 const expected=[
  ".github/workflows/engineer-embedded-signed-dag-e2e.yml",
  ".github/workflows/engineer-embedded-signed-d1-e2e.yml"
 ];
 for(const path of expected){
  const workflow=read(path);
  assert.match(workflow,/install -d -m 0700 "\$ADAPTER_PUBLIC_ARTIFACT_DIR"/u,path);
  assert.match(workflow,/\$ADAPTER_PUBLIC_ARTIFACT_DIR\/accumulators/u,path);
  assert.match(workflow,/\$ADAPTER_PUBLIC_ARTIFACT_DIR\/status-lists/u,path);
  assert.match(workflow,/assert_verification_ready\(\)/u,path);
  assert.match(workflow,/GATEWAY_VERIFIER_MODE: core-rust/u,path);
  assert.doesNotMatch(workflow,/cargo run --manifest-path services\/delegation-adapter\/Cargo\.toml/u,path);
  assert.match(workflow,/test -z "\$\{GEMINI_API_KEY:-\}"/u,path);
 }
});

test("R241 Rust verifier itself validates public directory existence; provisioning is not a mock verifier",()=>{
 const rust=read("src/delegation/local/file_public_artifact_store.rs");
 const addon=read("services/delegation-core-node/src/lib.rs");
 assert.match(rust,/pub fn open_read_only/u);
 assert.match(rust,/for name in \["accumulators", "status-lists"\]/u);
 assert.match(rust,/fs::symlink_metadata\(&child\)/u);
 assert.match(addon,/cfg\.open_readers\(\)/u);
 assert.match(addon,/Core Rust public sources unavailable/u);
 assert.match(addon,/EvmAnchoredStatusListResolver/u);
});
