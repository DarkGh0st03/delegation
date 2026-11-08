import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {stripTypeScriptTypes} from "node:module";
import {SourceTextModule} from "node:vm";
const root=fileURLToPath(new URL("../../../",import.meta.url));
const read=p=>readFileSync(resolve(root,p),"utf8");
const neutral="poc/packages/orchestrator-runtime/src/trusted-operational-repair-model-contracts.ts";
const planner="poc/packages/orchestrator-runtime/src/trusted-operational-repair-planner.ts";
const adk="poc/packages/orchestrator-runtime/src/trusted-adk-operational-repair-proposer.ts";
const owner="poc/packages/orchestrator-runtime/src/trusted-owner-operational-repair-handoff.ts";
test("R406 pure typed repair proposal contract has zero runtime dependencies",()=>{
 const src=read(neutral);
 for(const name of ["TrustedRepairPlanningObservation","TrustedRepairDiscoveryObservation","TrustedRepairDiagnosticSource","TrustedRepairModelInput"]){
  assert.match(src,new RegExp("export interface "+name+"\\b","u"));
 }
 assert.doesNotMatch(src,/\b(?:await|fetch|new\s+Trusted|create\w+Port)\s*\(/u);
 assert.doesNotMatch(src,/authority-client|authority-adapter-transport|trusted-repair-dag-controller|trusted-operational-repair-planner/u);
 const parsed=new SourceTextModule(stripTypeScriptTypes(src),{identifier:neutral});
 assert.deepEqual(parsed.dependencySpecifiers,[],
   "type-only repair input must not transitively import executable legacy planner");
});
test("R406 owner and ADK use neutral model input; old planner only reexports shape",()=>{
 assert.match(read(owner),/import type \{TrustedRepairModelInput\}[\s\S]*?from "\.\/trusted-operational-repair-model-contracts\.ts"/u);
 assert.match(read(adk),/import type \{TrustedRepairModelInput\} from "\.\/trusted-operational-repair-model-contracts\.ts"/u);
 assert.doesNotMatch(read(adk),/from "\.\/trusted-operational-repair-planner\.ts"/u);
 const old=read(planner);
 assert.match(old,/export \* from "\.\/trusted-owner-repair-planning-core\.ts"/u);
 const core=read("poc/packages/orchestrator-runtime/src/trusted-owner-repair-planning-core.ts");
 assert.match(core,/export type \{TrustedRepairPlanningObservation,TrustedRepairDiscoveryObservation,TrustedRepairDiagnosticSource,TrustedRepairModelInput\}/u);
 assert.match(core,/from "\.\/trusted-operational-repair-model-contracts\.ts"/u);
 assert.match(core,/export class TrustedOperationalRepairPlanner/u);
});
test("R406 type-only extraction does not remove the original fail-closed authority checks",()=>{
 const old=read("poc/packages/orchestrator-runtime/src/trusted-owner-repair-planning-core.ts"),host=read(owner);
 assert.match(old,/original.*root|signed.*root/iu);
 assert.match(old,/boundedTrustedRepairDiscoveryObservation/u);
 assert.match(old,/verifyTrustedRepairDiscoverySource/u);
 assert.match(host,/trustedOperationalAuthority\(\)/u);
 assert.match(host,/await import\(/u,
  "legacy recovery controller remains reachable; not authorized to delete it");
});

test("R406.2 private owner repair DAG port contract has no executable legacy dependency",()=>{
 const module="poc/packages/orchestrator-runtime/src/trusted-repair-dag-contracts.ts";
 const src=read(module);
 const parsed=new SourceTextModule(stripTypeScriptTypes(src),{identifier:module});
 assert.deepEqual(parsed.dependencySpecifiers,[],
  "read-only owner port shape must not load legacy DAG, Gateway IPC, signer or A2A");
 assert.match(src,/export type TrustedAdmittedRepairDagConfig=Readonly<\{/u);
 assert.match(src,/credentialForTask:/u);
 assert.match(src,/afterGatewayConfirmed\?:/u);
 assert.doesNotMatch(src,/from "\.\/trusted-repair-dag-controller\.ts"|from "\.\/authority-client\.ts"/u);
 const source=read(owner);
 assert.match(source,/import type \{TrustedAdmittedRepairDagConfig\}[\s\S]*?from "\.\/trusted-repair-dag-contracts\.ts"/u);
 assert.match(source,/TrustedOwnerRepairDagPorts=Omit<[\s\S]*?TrustedAdmittedRepairDagConfig,/u);
 assert.doesNotMatch(source,/import type \{executeTrustedAdmittedRepairDag\}/u);
 const controller=read("poc/packages/orchestrator-runtime/src/trusted-owner-repair-dag-execution.ts");
 assert.match(controller,/executeTrustedAdmittedRepairDag\(config:TrustedAdmittedRepairDagConfig\)/u);
 assert.match(controller,/original Rust root retired or replaced/u);
 assert.match(controller,/Gateway/u);
 assert.match(source,/await import\(\s*"\.\/trusted-owner-repair-dag-execution\.ts"\)/u,
  "Dynamic Owner DAG remains a real execution dependency; cannot be deleted");
 assert.doesNotMatch(source,/await import\(\s*"\.\/trusted-repair-dag-controller\.ts"\)/u);
});

test("R406.4 native Engineer core and socket ports never import historical HTTP shapes",()=>{
 const base="poc/packages/orchestrator-runtime/src/";
 const direct=read(base+"trusted-engineer-direct-core-port.ts");
 const socket=read(base+"trusted-engineer-native-port.ts");
 const contract=read(base+"trusted-credential-contracts.ts");
 assert.match(contract,/export interface TrustedEngineerCoreConfig/u);
 for(const source of [direct,socket]){
  assert.doesNotMatch(source,/from "\.\/authority-client\.ts"|from "\.\/authority-adapter-transport\.ts"/u);
  assert.match(source,/import type \{IssuedDelegationCredential,TrustedEngineerCoreConfig\}/u);
  assert.match(source,/from "\.\/trusted-credential-contracts\.ts"/u);
 }
 assert.match(direct,/config:Pick<TrustedEngineerCoreConfig,"bearerToken">/u);
 assert.match(socket,/interface NativeConfig extends TrustedEngineerCoreConfig/u);
 // The HTTP compatibility fixture remains distinct and gated.
 const selector=read(base+"trusted-engineer-crypto-port.ts");
 assert.match(selector,/assertLegacyEngineerHttpFixtureAllowed\(\)/u);
 assert.match(selector,/createDirectRustEngineerCredentialPort\(config\)/u);
 assert.match(selector,/createNativeRustEngineerCredentialPort\(/u);
});
