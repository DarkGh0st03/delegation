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

test('R384.6 both historical billed GitHub Actions jobs are unconditionally skipped',()=>{
 const workflow=readFileSync(
  path('.github/workflows/gemini-paid-shared-mcp-final.yml'),'utf8');
 assert.match(workflow,/^name: RETIRED - Historical Gemini Signed DAG Pilot \(Disabled\)$/mu);
 for(const name of ['account-suspension','f1-real-gitea-planning']){
  const offset=workflow.indexOf('  '+name+':\n');
  assert.ok(offset>=0,'historical job must remain visible for migration audit');
  const opening=workflow.slice(offset,offset+300);
  assert.match(opening,/^    if: \$\{\{ false \}\}$/mu,
   'historical job must never reach a potentially-billed step');
 }
});


test('R384.7 remaining historical paid workflows cannot execute any job',()=>{
 for(const [filename,job] of [
  ['gemini-real-gitea-planning-only.yml','real-planner'],
  ['gemini-planner-manual-feasibility.yml','read-only-planner'],
  ['f1-paid-real-gitea-once.yml','f1-real-planning']
 ]){
  const contents=readFileSync(path('.github/workflows/'+filename),'utf8');
  assert.match(contents,/^on:\s*$/mu,'preserve archived workflow evidence');
  const marker='  '+job+':\n';
  const offset=contents.indexOf(marker);
  assert.ok(offset>=0,job+' missing from '+filename);
  const jobBody=contents.slice(offset+marker.length);
  const boundary=jobBody.search(/^  [a-zA-Z0-9_-]+:\s*$/mu);
  const section=boundary<0?jobBody:jobBody.slice(0,boundary);
  assert.match(section,/^    if:\s*\$\{\{ false \}\}\s*$/mu,
   job+' must never execute, even with prior paid consent');
 }
});

test('R384.9 public runtime cannot load historical HTTP Adapter Engineer authority',()=>{
 const index=readFileSync(path('poc/packages/orchestrator-runtime/src/index.ts'),'utf8');
 const neutral=readFileSync(
  path('poc/packages/orchestrator-runtime/src/trusted-credential-contracts.ts'),'utf8');
 // R419: the split Adapter transport was physically deleted. The
 // legacy issuer keeps its original exact-permission and revocation checks.
 const retiredTransport=path('poc/packages/orchestrator-runtime/src/authority-adapter-transport.ts');
 assert.equal(existsSync(retiredTransport),false,
  'historical HTTP transport must not reappear as a compatibility shim');
 const historic=readFileSync(
  path('poc/packages/orchestrator-runtime/src/authority-client.ts'),'utf8');
 assert.match(index,/export type \{[\s\S]*?\} from "\.\/trusted-credential-contracts\.ts"/u);
 assert.doesNotMatch(index,/from "\.\/authority-client\.ts"/u);
 assert.doesNotMatch(index,/SoftwareEngineerAuthorityBootstrap/u);
 assert.doesNotMatch(neutral,/authority-client|authority-adapter-transport|postCredential|fetch\(/u);
 assert.match(historic,/from "\.\/trusted-credential-contracts\.ts"/u);
 assert.doesNotMatch(historic,/from "\.\/authority-adapter-transport\.ts"/u);
 assert.match(historic,/export async function postCredential\(/u);
 assert.match(historic,/class SoftwareEngineerAuthorityBootstrap/u);
 assert.match(historic,/Adapter root issuance response differs from exact trusted permissions/u);
 assert.match(historic,/Adapter root DC revocation not confirmed/u);
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
