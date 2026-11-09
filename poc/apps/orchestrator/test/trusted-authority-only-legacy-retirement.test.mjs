/** R384.6: offline one-way retirement of obsolete potentially-billed paths.
 * No model inference, GitHub dispatch, secret loading or provider I/O. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {startProtectedGeminiOwnerSession}
 from '../src/run-trusted-gemini-owner.mjs';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
const path=(relative)=>join(repo,relative);

test('R384.6 old Gemini Signed DAG owner API is retired even in historical mode',async()=>{
 const before=process.env.DELEGATION_GATEWAY_ARCHITECTURE;
 try{
  process.env.DELEGATION_GATEWAY_ARCHITECTURE='legacy-signed-dag';
  await assert.rejects(startProtectedGeminiOwnerSession({
   configPath:'/no-such-private-manifest',inputFile:'/no-such-api-key',
   expectedSourceSha:'a'.repeat(40),
   chargeAuthorization:'I AUTHORIZE GEMINI API CHARGES'
  }),/Protected Gemini owner input denied/u);
 }finally{
  if(before===undefined)delete process.env.DELEGATION_GATEWAY_ARCHITECTURE;
  else process.env.DELEGATION_GATEWAY_ARCHITECTURE=before;
 }
});

test('R384.6 executable cannot select paid legacy mode even when requested explicitly',()=>{
 const executable=path('poc/apps/orchestrator/src/run-trusted-gemini-owner.mjs');
 const result=spawnSync(process.execPath,['--experimental-strip-types',executable],{
  env:{PATH:process.env.PATH,
   DELEGATION_GATEWAY_ARCHITECTURE:'legacy-signed-dag',
   DELEGATION_GEMINI_CHARGE_CONFIRMATION:'I AUTHORIZE GEMINI API CHARGES'},
  timeout:12000,encoding:'utf8'
 });
 assert.equal(result.status,1);
 assert.equal(result.stdout,'');
 assert.match(result.stderr,/Gemini owner startup denied/u);
 assert.doesNotMatch(result.stderr,/PRIVATE KEY|Bearer|API key/u);
});

test('R426 historical billed Signed DAG GitHub workflow is physically retired',()=>{
 assert.equal(existsSync(path('.github/workflows/gemini-paid-shared-mcp-final.yml')),false,
  'retired billed workflow must remain absent, not merely if:false');
});

test('R420 no obsolete paid workflow can be dispatched after physical retirement',()=>{
 const old=[
  'gemini-real-gitea-planning-only.yml',
  'gemini-planner-manual-feasibility.yml',
  'f1-paid-real-gitea-once.yml'
 ];
 for(const filename of old){
  const file=path('.github/workflows/'+filename);
  assert.equal(existsSync(file),false,
   'retired paid workflow must not remain runnable: '+filename);
 }
 // R426 verifies the retired Signed-DAG pilot is also physically absent.
});

test('R439 superseded standalone manual E2E launchers stay retired while source proofs remain',()=>{
 const cases=[
  ['r139-real-docker-repair-e2e.yml','poc/apps/test-runner-controller/scripts/r139-real-repair-evidence.mjs'],
  ['r387-native-test-agent-create-e2e.yml','poc/packages/orchestrator-runtime/test/r387-native-test-agent-create-e2e.mjs'],
  ['r388-native-test-create-docker-e2e.yml','poc/packages/orchestrator-runtime/test/r388-native-test-create-docker-e2e.mjs']
 ];
 const security=readFileSync(path('.github/workflows/isolated-positive-security-ci.yml'),'utf8');
 for(const [launcher,proof] of cases){
  assert.equal(existsSync(path('.github/workflows/'+launcher)),false,
   'superseded manual-only launcher must remain absent: '+launcher);
  assert.equal(existsSync(path(proof)),true,
   'historical runnable proof source must be retained: '+proof);
  assert.ok(security.includes("- '"+proof+"'"),
   'native Security CI must observe preserved source changes: '+proof);
 }
 for(const retained of ['r38513-native-strict-full-recovery.yml','r395-native-a2a-runner-e2e.yml']){
  assert.equal(existsSync(path('.github/workflows/'+retained)),true,
   'canonical native security or A2A Test Runner regression must remain: '+retained);
 }
});

test('R441 retired R394 standalone Runner launcher keeps its proof and R395 canonical successor',()=>{
 const oldLauncher='.github/workflows/r394-native-test-runner-pass-e2e.yml';
 const oldProof='poc/packages/orchestrator-runtime/test/r394-native-test-runner-pass-e2e.mjs';
 const successor='.github/workflows/r395-native-a2a-runner-e2e.yml';
 const successorProof='poc/packages/orchestrator-runtime/test/r395-native-a2a-runner-e2e.mjs';
 const preflight='.github/workflows/r393-native-test-runner-child-e2e.yml';
 const preflightProof='poc/packages/orchestrator-runtime/test/r393-native-test-runner-child-e2e.mjs';
 assert.equal(existsSync(path(oldLauncher)),false,'retired R394 launcher must not reappear');
 for(const filename of [oldProof,successor,successorProof,preflight,preflightProof])
  assert.equal(existsSync(path(filename)),true,'preserve runnable proof/negative gate: '+filename);
 const positive=readFileSync(path(successorProof),'utf8');
 for(const proof of [
  'r395_signed_separate_test_runner_child_preflight',
  'r395_native_a2a_test_runner_complete',
  'protected_runner_pass_attested:true',
  'independent_runner_receipt:true',
  'actual_adk_function_tool_run_tests:true',
  'authenticated_a2a_completion:true'
 ])assert.ok(positive.includes(proof),'canonical successor must retain: '+proof);
 const negative=readFileSync(path(preflightProof),'utf8');
 assert.ok(negative.includes('protected_runner_invoked:false'),
  'R393 independent staged-but-not-executed proof is not covered by R395');
 const security=readFileSync(path('.github/workflows/isolated-positive-security-ci.yml'),'utf8');
 for(const source of [oldProof,successorProof])
  assert.ok(security.includes("- '"+source+"'"),
   'native Security CI must watch retained source: '+source);
});

test('R432 public runtime cannot load retired HTTP Adapter Engineer authority',()=>{
 const index=readFileSync(path('poc/packages/orchestrator-runtime/src/index.ts'),'utf8');
 const neutral=readFileSync(path('poc/packages/orchestrator-runtime/src/trusted-credential-contracts.ts'),'utf8');
 for(const name of ['authority-adapter-transport.ts','authority-client.ts',
  'trusted-engineer-legacy-mcp-http-port.ts','trusted-engineer-legacy-fixture-gate.ts']){
  const target=path('poc/packages/orchestrator-runtime/src/'+name);
  assert.equal(existsSync(target),false,'retired issuer cannot be restored: '+name);
 }
 assert.match(index,/export type \{[\s\S]*?\} from "\.\/trusted-credential-contracts\.ts"/u);
 assert.doesNotMatch(index,/from "\.\/authority-client\.ts"|SoftwareEngineerAuthorityBootstrap/u);
 assert.doesNotMatch(neutral,/authority-client|authority-adapter-transport|postCredential|fetch\(/u);
});

test('R384.8 public runtime API exposes OIDC admission but not historical DAG execution',()=>{
 const index=readFileSync(path('poc/packages/orchestrator-runtime/src/index.ts'),'utf8');
 const consumer=readFileSync(path('poc/packages/orchestrator-runtime/src/trusted-github-admission-consumer.ts'),'utf8');
 assert.match(index,/export \{consumePinnedGithubAdmission\}/u);
 assert.match(index,/from "\.\/trusted-github-admission-consumer\.ts"/u);
 assert.doesNotMatch(index,/from "\.\/trusted-admitted-github-handoff\.ts"/u);
 assert.doesNotMatch(index,/startAdmittedGithubReviewedGeminiHandoff/u);
 assert.match(consumer,/admissionStore\.consume\(/u,
  'The new consumer must retain the original one-use HMAC store');
 assert.doesNotMatch(consumer,
  /trusted-reviewed-approved-dag|trusted-owner-operational-repair-handoff|startPersistedReviewedGeminiHandoff|GeminiAdkModel/u,
  'An OIDC admission must never load the historical DAG or a model');
});

test('R384.7 canonical operational entrypoints cannot directly import historical DAG, repair or Adapter paths',()=>{
 for(const file of [
  'poc/apps/orchestrator/src/canonical-owner-deployment.mjs',
  'poc/apps/orchestrator/src/trusted-authority-only-review-host.mjs',
  'poc/packages/orchestrator-runtime/src/trusted-authority-only-adaptive-work-loop.mjs',
  'poc/apps/orchestrator/src/trusted-authority-only-operational-launcher.mjs',
  'poc/apps/orchestrator/src/run-trusted-gemini-owner.mjs'
 ]){
  const body=readFileSync(path(file),'utf8');
  assert.doesNotMatch(body,/(?:import|from)\s*['"][^'"]*(?:trusted-reviewed-approved-dag|trusted-operational-repair-planner|trusted-repair-dag-controller|authority-adapter-transport)/u);
 }
});

test('R422 old one-shot Engineer/D1 CI checkpoints are absent; the proof workflows are manual-only',()=>{
 const cases=[
  ['d1-assertion-ci-request.json','d1-private-assertion-e2e.yml'],
  ['engineer-core-request.json','engineer-direct-native-contract.yml'],
  ['engineer-evm-request.json','engineer-direct-native-evm-e2e.yml'],
  ['engineer-d1-request.json','engineer-embedded-signed-d1-e2e.yml'],
  ['engineer-full-dag-request.json','engineer-embedded-signed-dag-e2e.yml']
 ];
 for(const [checkpoint,workflow] of cases){
  assert.equal(existsSync(path('.github/ci-checkpoints/'+checkpoint)),false,
   'stale one-shot release checkpoint must remain absent: '+checkpoint);
  const source=readFileSync(path('.github/workflows/'+workflow),'utf8');
  const found=/^(?:on|'on'):\s*\n([\s\S]*?)^permissions:/mu.exec(source);
  assert.ok(found,'historical signed-E2E workflow event block missing: '+workflow);
  const events=[...found[1].matchAll(/^  ([A-Za-z][A-Za-z0-9_-]*):/gmu)].map(x=>x[1]);
  assert.deepEqual(events,['workflow_dispatch'],
   'historical E2E can only be triggered explicitly: '+workflow);
  assert.match(source,/^jobs:\s*$/mu,
   'preserve the native Rust/Engineer/OPA/Gitea/Docker test job: '+workflow);
 }
});
