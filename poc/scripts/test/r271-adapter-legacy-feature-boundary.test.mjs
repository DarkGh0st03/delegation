import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";

const root=new URL("../../../",import.meta.url);
const read=path=>readFileSync(new URL(path,root),"utf8");

test("R271 shared CryptoRuntime stays default; retired HTTP binary needs explicit opt-in",()=>{
 const manifest=read("services/delegation-adapter/Cargo.toml");
 assert.match(manifest,/tiny_http\s*=\s*\{\s*version\s*=\s*"0\.12\.0",\s*optional\s*=\s*true\s*\}/u);
 assert.match(manifest,/\[features\]\s*\ndefault\s*=\s*\[\]/u);
 assert.match(manifest,/legacy-http\s*=\s*\["dep:tiny_http"\]/u);
 assert.match(manifest,/\[\[bin\]\]\s*\nname\s*=\s*"delegation-adapter"/u);
 assert.match(manifest,/required-features\s*=\s*\["legacy-http"\]/u);
 const lib=read("services/delegation-adapter/src/lib.rs");
 assert.match(lib,/#\[cfg\(feature = "legacy-http"\)\]\s*\npub mod http;/u);
 assert.match(lib,/pub mod crypto;/u);
 const owner=read("services/delegation-engineer-node/Cargo.toml");
 assert.match(owner,/delegation-adapter\s*=\s*\{\s*path = "\.\.\/delegation-adapter"\s*\}/u);
 assert.doesNotMatch(owner,/features\s*=\s*\["legacy-http"\]/u);
 const main=read("services/delegation-adapter/src/main.rs");
 assert.ok(main.indexOf("ENGINEER_CORE_NATIVE_MODE")<main.indexOf("AdapterConfig::from_env()"),
   "Do not initialize a competing HTTP issuer when direct Engineer is active");
});

test("R271 historical GitHub Adapter commands require the legacy HTTP Cargo feature",()=>{
 let commands=0;
 for(const name of readdirSync(new URL(".github/workflows/",root))){
  if(!/\.ya?ml$/u.test(name))continue;
  const workflow=read(".github/workflows/"+name);
  for(const line of workflow.split("\n")){
   if(!/cargo\s+(?:run|build|test)\b.*--manifest-path\s+services\/delegation-adapter\/Cargo\.toml/u.test(line))continue;
   commands++;
   assert.match(line,/--features legacy-http\b/u,
     name+" must opt into retired HTTP only for historical compatibility");
  }
 }
 assert.ok(commands>=15,"Expected to check historical explicit Adapter workflows");
 for(const name of [
  "engineer-embedded-signed-dag-e2e.yml",
  "engineer-embedded-signed-d1-e2e.yml",
  "gemini-paid-shared-mcp-final.yml"
 ]){
  const workflow=read(".github/workflows/"+name);
  assert.doesNotMatch(workflow,/cargo run.*services\/delegation-adapter\/Cargo\.toml/u);
  assert.doesNotMatch(workflow,/--features legacy-http/u);
 }
});
