/**
 * R412: the historical Engineer MCP/HTTP root issuer is not evaluated on
 * direct module import. No actual HTTP, Root, private MCP effect or paid AI.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import {stripTypeScriptTypes} from "node:module";
import {SourceTextModule} from "node:vm";
import {collectLegacyReferences,gitTrackedFiles,scanRuntimeIndirections}
 from "../r6-legacy-references.mjs";
import {auditR38517CallerInventory,R38518_ALLOWED_NONTEST_LEGACY_CALLERS}
 from "../r38517-canonical-route-closure.mjs";
import {PRIVATE_MCP_KEEP}
 from "../r38516-human-gate-and-legacy-reachability.mjs";
import {createLegacyOwnerPrivateMcpEngineerCredentialPort}
 from "../../packages/orchestrator-runtime/src/trusted-engineer-legacy-mcp-http-port.ts";

const root=fileURLToPath(new URL("../../../",import.meta.url));
const path="poc/packages/orchestrator-runtime/src/trusted-engineer-legacy-mcp-http-port.ts";
const issuer="poc/packages/orchestrator-runtime/src/authority-client.ts";
const source=()=>readFileSync(resolve(root,path),"utf8");
async function withFixtureEnv(fn){
 const keys=[
  "DELEGATION_LEGACY_ENGINEER_HTTP_FIXTURE",
  "DELEGATION_GATEWAY_ARCHITECTURE","APPROVED_RUNNER_NATIVE_MCP",
  "ENGINEER_CORE_NATIVE_MODE","ADAPTER_ENGINEER_NATIVE_SOCKET"
 ];
 const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{
  for(const k of keys)delete process.env[k];
  return await fn();
 }finally{
  for(const k of keys){
   if(previous[k]===undefined)delete process.env[k];
   else process.env[k]=previous[k];
  }
 }
}
test("R414 canonical Engineer selector is type-decoupled from HTTP transport",()=>{
 const canonical="poc/packages/orchestrator-runtime/src/trusted-engineer-crypto-port.ts";
 const src=readFileSync(resolve(root,canonical),"utf8");
 const module=new SourceTextModule(stripTypeScriptTypes(src),{identifier:canonical});
 assert.match(src,/import type \{TrustedEngineerCoreConfig\}\s*from "\.\/trusted-credential-contracts\.ts";/u);
 assert.doesNotMatch(src,/from "\.\/authority-(?:client|adapter-transport)\.ts"/u);
 assert.doesNotMatch(src,/\bAdapterClientConfig\b/u);
 assert.ok(!module.dependencySpecifiers.some(x=>/authority-client|authority-adapter-transport/u.test(x)));
 assert.doesNotMatch(src,/trusted-engineer-legacy-mcp-http-port|createOwnerPrivateMcpEngineerCredentialPort|assertLegacyEngineerHttpFixtureAllowed/u,
  "Canonical selector must not even reference historical HTTP fixture");
 const host=readFileSync(resolve(root,"poc/apps/orchestrator/src/trusted-engineer-host.mjs"),"utf8");
 assert.doesNotMatch(host,/import\(".*trusted-engineer-legacy-mcp-http-port\.ts"\)/u,
  "Operational Engineer host must not load historical HTTP issuance");
 assert.match(host,/const credentials=createTrustedEngineerCredentialPort\(\{/u,
  "Cold recovery must select the canonical Rust-only port");
 assert.doesNotMatch(src,/assertLegacyEngineerHttpFixtureAllowed/u,
  "Native Engineer selector must remain independent of historical HTTP gating");
 assert.match(source(),/assertLegacyEngineerHttpFixtureAllowed\(\);/u,
  "Explicit historical fixture must keep its own fail-closed authorization gate");
});
test("R412 historical MCP wrapper has one gated dynamic issuer import, no eager issuer edge",()=>{
 const src=source();
 const parsed=new SourceTextModule(stripTypeScriptTypes(src),{identifier:path});
 assert.ok(!parsed.dependencySpecifiers.includes("./authority-client.ts"));
 const hints=scanRuntimeIndirections(src).hints.filter(x=>
  x.kind==="dynamic-import"&&x.specifier==="./authority-client.ts");
 assert.equal(hints.length,1);
 const factory=src.indexOf("export function createLegacyOwnerPrivateMcpEngineerCredentialPort(");
 const guard=src.indexOf("assertLegacyEngineerHttpFixtureAllowed();",factory);
 const loader=src.indexOf('loaded??=import("./authority-client.ts")',guard);
 const afterLoad=src.indexOf("assertLegacyEngineerHttpFixtureAllowed();",loader);
 const create=src.indexOf("new m.SoftwareEngineerAuthorityBootstrap(pinnedConfig)",afterLoad);
 assert.ok(factory>=0&&guard>factory&&loader>guard&&afterLoad>loader&&create>afterLoad);
 assert.equal((src.match(/const rust=await historicalIssuer\(\)/gu)||[]).length,2);
 assert.ok((src.match(/assertLegacyEngineerHttpFixtureAllowed\(\);/gu)||[]).length>=9);
 assert.match(src,/const pinnedConfig:AdapterClientConfig=Object.freeze\(\{\.\.\.config\}\)/u,
  "config credentials and transport must be pinned before async lazy load");
 assert.match(src,/const pinned=structuredClone\(input\)/u,
  "root grants are pinned before any MCP/import async boundary");
 assert.match(src,/createOwnerPrivateCryptographicMcpSession\(\s*"root_issue"/u);
 assert.match(src,/createOwnerPrivateCryptographicMcpSession\(\s*"root_revoke"/u);
});
test("R412 direct legacy import cannot issue under missing or canonical profile, without HTTP",async()=>{
 const calls={count:0};
 const config={adapterBaseUrl:"http://historical.invalid",bearerToken:"dummy",
  fetchFn:async()=>{calls.count++;throw Error("HTTP must never occur");}};
 await withFixtureEnv(async()=>{
  assert.throws(()=>createLegacyOwnerPrivateMcpEngineerCredentialPort(config),
   /requires explicit opt-in/u);
  process.env.DELEGATION_LEGACY_ENGINEER_HTTP_FIXTURE="1";
  for(const [key,value] of [
   ["DELEGATION_GATEWAY_ARCHITECTURE","authority-only"],
   ["APPROVED_RUNNER_NATIVE_MCP","1"],
   ["ENGINEER_CORE_NATIVE_MODE","1"],
   ["ADAPTER_ENGINEER_NATIVE_SOCKET",""]
  ]){
   process.env[key]=value;
   assert.throws(()=>createLegacyOwnerPrivateMcpEngineerCredentialPort(config),
    /unavailable in native authority-only mode/u,key);
   delete process.env[key];
  }
  assert.throws(()=>createLegacyOwnerPrivateMcpEngineerCredentialPort({
   ...config,adapterBaseUrl:""
  }),/Adapter base URL cannot be empty/u);
  assert.throws(()=>createLegacyOwnerPrivateMcpEngineerCredentialPort({
   ...config,bearerToken:""
  }),/Engineer Adapter token cannot be empty/u);
  const port=createLegacyOwnerPrivateMcpEngineerCredentialPort(config);
  assert.equal(typeof port.issueScopedOrchestratorRoot,"function");
  assert.equal(typeof port.revokeRoot,"function");
  // A mode switch after construction must deny before private MCP setup.
  delete process.env.DELEGATION_LEGACY_ENGINEER_HTTP_FIXTURE;
  await assert.rejects(port.revokeRoot("urn:blocked"),/requires explicit opt-in/u);
  await assert.rejects(port.issueScopedOrchestratorRoot({}),
   /requires explicit opt-in/u);
 });
 assert.equal(calls.count,0);
});
test("R429 historical HTTP issuer graph is limited to private legacy fixture and Runner",()=>{
 const inv=collectLegacyReferences(root,gitTrackedFiles(root),{candidates:[issuer]});
 const entry=inv.candidates[0];
 assert.equal(entry.exists,true);
 assert.ok(!entry.staticImporters.some(x=>x.source===path));
 const dynamic=entry.runtimeIndirectionHints
  .filter(x=>x.kind==="dynamic-import").map(x=>x.source).sort();
 const historicalEvm=[
  "poc/apps/gateway/native-test/native-approved-three-adk-evm-e2e.mjs",
  "poc/apps/gateway/native-test/native-r110-repair-discovery-evm-e2e.mjs"
 ];
 assert.deepEqual(dynamic,[path].sort(),
  "Real EVM Root/repair scenarios must call Rust native, not a legacy HTTP issuer");
 assert.deepEqual(entry.staticImporters.filter(x=>historicalEvm.includes(x.source)),[],
  "EVM regression cannot statically import old HTTP issuer");
 assert.equal(entry.configuredCallers.length,0);
 const nativeRunner=readFileSync(resolve(root,
  "poc/apps/test-runner-controller/scripts/approved-gateway-runner-session.mjs"),"utf8");
 assert.doesNotMatch(nativeRunner,/authority-client\.ts|SoftwareEngineerAuthorityBootstrap/u,
  "Runner must not resurrect HTTP issuer");
 assert.ok(inv.unresolvedRuntimeIndirections.length>0,
  "Potential computed/external historical imports remain unproven");
});
test("R412 R385.17 disallows static regression even from exact allowed legacy fixture names",()=>{
 const entries=Object.entries(R38518_ALLOWED_NONTEST_LEGACY_CALLERS);
 const inventory={
  status:"INVENTORY_PROVENANCE_OK",
  legacyModules:entries.map(([name,allowed])=>({
   path:name,present:!/(?:trusted-reviewed-approved-dag|trusted-operational-repair-planner|trusted-repair-dag-controller|authority-adapter-transport)\.ts$/u.test(name),staticImporters:[],
   runtimeHints:allowed.map(source=>({source,kind:"dynamic-import"})),
   configuredCallers:[]
  })),
  protectedModules:PRIVATE_MCP_KEEP.map(path=>({path,present:true})),
  unresolvedRuntimeIndirections:1
 };
 const clean=auditR38517CallerInventory(inventory);
 assert.equal(clean.status,"CALLER_INVENTORY_OK",clean.issues.join("\n"));
 for(const source of [path]){
  const entry=inventory.legacyModules[0];
  entry.runtimeHints=entry.runtimeHints.filter(x=>x.source!==source);
  entry.staticImporters.push(source);
  const r=auditR38517CallerInventory(inventory);
  assert.equal(r.status,"CALLER_INVENTORY_FAIL");
  assert.match(r.issues.join("\n"),/requires lazy gated dynamic import/u);
  assert.equal(r.deletionAuthorized,false);
  entry.staticImporters.pop();
  entry.runtimeHints.push({source,kind:"dynamic-import"});
 }
});
